import Database from "better-sqlite3";
import { loadConfig, type Config, type Stage, ADT_DIR } from "./config.js";
import { openDb, listRunnableTasks, markTaskRunning, markTaskFinished, insertTask, getTask, type TaskRow } from "./store.js";
import { acquireLock, releaseLock } from "./lock.js";
import { nextStage, labelForStage, LABEL_BLOCKED } from "./labels.js";
import { createClient, listReadyIssues, listIssuesByLabel, getIssue, getComments, postComment, replaceAdtLabel, hasApprovedReview, isPRMerged } from "./github.js";
import { ensureWorktree, pruneWorktrees, branchName } from "./worktree.js";
import { spawnCcMm, buildPromptFile, DEFAULT_TOOLS } from "./claude-code.js";
import * as path from "node:path";
import * as fs from "node:fs";

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// GitHub retry helper: retries 5xx up to 3 times (1s/2s/4s), bails on 401
async function withGh<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [1000, 2000, 4000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (err.status === 401) {
        console.error(`GitHub 401 on ${label}. Run 'adt setup' to re-authenticate.`);
        throw err;
      }
      if (err.status && err.status >= 500 && err.status < 600 && attempt < delays.length) {
        console.log(`GitHub ${err.status} on ${label}, retrying in ${delays[attempt]}ms (attempt ${attempt + 1}/${delays.length})`);
        await new Promise(r => setTimeout(r, delays[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Check if user has approved the design stage
async function checkApproval(
  client: ReturnType<typeof createClient>,
  repo: string,
  issueNumber: number,
  _stage: Stage,
): Promise<boolean> {
  const comments = await withGh("getComments", () => getComments(client, repo, issueNumber));
  // Check for /adt-approve comment
  const hasApproveComment = comments.some(c =>
    /^\/adt-approve(\s.*)?$/im.test(c.body)
  );
  if (hasApproveComment) return true;

  // Also check if an open PR for this issue has an approved review
  // Look for PR URL patterns in issue body and comments
  const issue = await withGh("getIssue", () => getIssue(client, repo, issueNumber));
  const allTexts = [issue.body || "", ...comments.map(c => c.body)];
  const prNumbers = new Set<number>();
  const escapedRepo = repo.replace("/", "\\/");
  const prRegex = new RegExp(`(?:${escapedRepo}|github\\.com\\/${escapedRepo})[\\/]pull[\\/](\\d+)`, "gi");
  for (const text of allTexts) {
    let match: RegExpExecArray | null;
    while ((match = prRegex.exec(text)) !== null) {
      prNumbers.add(parseInt(match[1], 10));
    }
  }

  for (const prNum of prNumbers) {
    try {
      if (await withGh("hasApprovedReview", () => hasApprovedReview(client, repo, prNum))) {
        return true;
      }
    } catch (_) {
      // Ignore errors checking individual PRs
    }
  }

  return false;
}

async function runWorker(): Promise<void> {
  let db: Database.Database | null = null;

  try {
    // 1. Lock
    if (!acquireLock()) {
      console.log("Another worker is running. Exiting.");
      return;
    }

    // 2. Prune stale worktrees
    await pruneWorktrees(process.cwd());

    // 3. Load config
    const config = loadConfig();

    // 4. Open store
    db = openDb(path.join(ADT_DIR, "state.db"));

    // 5. Reset stuck tasks (running but no longer active from crashed workers)
    {
      const now = Math.floor(Date.now() / 1000);
      for (const stage of ["reqs", "design", "impl", "review"] as const) {
        const timeout = config.stageTimeouts[stage];
        const maxAge = 2 * timeout * 60; // 2 * maxDuration in seconds
        const cutoff = now - maxAge;
        db!.prepare("UPDATE tasks SET status = 'pending', updated_at = ? WHERE status = 'running' AND stage = ? AND updated_at < ?").run(now, stage, cutoff);
      }
    }

    // 5b. Cleanup pass: find review-stage tasks whose PR has been merged
    {
      console.log("[cleanup] Starting cleanup pass...");
      const reviewTasks = db!.prepare(
        "SELECT * FROM tasks WHERE stage = 'review' AND status IN ('pending', 'running', 'done')"
      ).all() as TaskRow[];
      console.log(`[cleanup] Found ${reviewTasks.length} review tasks`);
      let didCleanup = false;
      for (const rt of reviewTasks) {
        console.log(`[cleanup] Task #${rt.issue_number}: status=${rt.status}, repo=${rt.repo}`);
        const client2 = createClient(config.githubToken);
        const comments = await withGh("getComments", () => getComments(client2, rt.repo, rt.issue_number));
        const allText = comments.map(c => c.body).join("\n");
        console.log(`[cleanup] Got ${comments.length} comments, scanning for PR URLs...`);
        const prRegex = /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/g;
        let m: RegExpExecArray | null;
        let merged = false;
        const foundPrs: number[] = [];
        while ((m = prRegex.exec(allText)) !== null) {
          const prNum = parseInt(m[1], 10);
          foundPrs.push(prNum);
          try {
            const isMerged = await withGh("isPRMerged", () => isPRMerged(client2, rt.repo, prNum));
            console.log(`[cleanup]   PR #${prNum} merged? ${isMerged}`);
            if (isMerged) {
              merged = true;
              break;
            }
          } catch (e) {
            console.log(`[cleanup]   PR #${prNum} check failed:`, (e as Error).message);
          }
        }
        console.log(`[cleanup] PRs found in comments: ${foundPrs.length > 0 ? foundPrs.join(',') : 'none'}`);
        if (merged) {
          console.log(`[cleanup] Task #${rt.issue_number} PR merged -- cleaning up.`);
          markTaskFinished(db, rt.id, "done");
          await withGh("replaceAdtLabel", () => replaceAdtLabel(client2, rt.repo, rt.issue_number, "adt:done"));
          if (rt.worktree_path) {
            try {
              const { removeWorktree } = await import("./worktree.js");
              await removeWorktree(process.cwd(), rt.issue_number);
              console.log(`[cleanup] Worktree for #${rt.issue_number} removed.`);
            } catch (e) {
              console.error(`[cleanup] Worktree cleanup failed for #${rt.issue_number}:`, e);
            }
          }
          didCleanup = true;
        }
      }
      if (didCleanup) {
        console.log("Cleanup complete.");
      }
    }

    // 6. List runnable tasks from store
    let task: TaskRow | null = null;
    let skipWaitingUserCheck = false;
    // First, check for waiting-user tasks that have been approved or replied to
    const waitingTasks = db!.prepare(
      "SELECT * FROM tasks WHERE status = 'waiting-user' ORDER BY created_at ASC"
    ).all() as TaskRow[];
    for (const wt of waitingTasks) {
      task = wt;
      // Break — we'll process it via the waiting-user branch below.
      // If the branch determines "still waiting, do nothing", we'll fall through.
      break;
    }
    if (!task) {
      const pending = listRunnableTasks(db);
      if (pending.length > 0) {
        task = pending[0]; // Sorted by FIFO + stage priority
      }
    }

    // 7. If nothing in store, scan GitHub for new adt:ready issues
    if (!task) {
      const client = createClient(config.githubToken);
      for (const repo of config.repos) {
        // First scan for adt:grill (highest priority — exploratory needs)
        const grillIssues = await withGh("listIssuesByLabel", () => listIssuesByLabel(client, repo, "adt:grill"));
        if (grillIssues.length > 0) {
          const issue = grillIssues[0];
          const slug = slugFromTitle(issue.title);
          const branch = branchName(issue.number, slug);
          const repoPath = process.cwd();
          const wtPath = await ensureWorktree(repoPath, issue.number, branch, config.githubToken);
          const taskId = insertTask(db, repo, issue.number, "grill", "pending", wtPath, branch);
          task = getTask(db, taskId);
          break;
        }
        // Then scan for adt:ready (normal flow)
        const readyIssues = await withGh("listReadyIssues", () => listReadyIssues(client, repo));
        if (readyIssues.length > 0) {
          const issue = readyIssues[0];
          const slug = slugFromTitle(issue.title);
          const branch = branchName(issue.number, slug);
          const repoPath = process.cwd();
          const wtPath = await ensureWorktree(repoPath, issue.number, branch, config.githubToken);
          const taskId = insertTask(db, repo, issue.number, "grill", "pending", wtPath, branch);
          task = getTask(db, taskId);
          break;
        }
      }
      if (!task) {
        console.log("No runnable tasks.");
        return;
      }
    }

    // 8. If the selected task is waiting for user, check for approval before proceeding
    let fallThroughToGitHub = false;
    if (task && task.status === "waiting-user" && !skipWaitingUserCheck) {
      const waitingTask: TaskRow = task;
      if (waitingTask.stage === "design") {
        const client = createClient(config.githubToken);
        const approved = await checkApproval(client, waitingTask.repo, waitingTask.issue_number, waitingTask.stage);
        if (!approved) {
          console.log(`Task #${waitingTask.issue_number} is waiting for design approval.`);
          return;
        }
        // Approved — advance to impl
        const next = nextStage(waitingTask.stage);
        if (next) {
          markTaskFinished(db, waitingTask.id, "pending");
          db!.prepare("UPDATE tasks SET stage = ? WHERE id = ?").run(next, waitingTask.id);
          const label = labelForStage(next, "running");
          const client2 = createClient(config.githubToken);
          await withGh("replaceAdtLabel", () => replaceAdtLabel(client2, waitingTask.repo, waitingTask.issue_number, label));
          await withGh("postComment", () => postComment(client2, waitingTask.repo, waitingTask.issue_number,
            `## adt: design approved\\n\\nDesign has been approved. Proceeding to implementation.`));
        }
        return; // Next worker run will pick up impl
      }
      // For reqs waiting-user, check if user has replied (any non-bot comment
      // after the last waiting-user comment). If so, advance to design.
      if (waitingTask.stage === "reqs") {
        const client = createClient(config.githubToken);
        const comments = await withGh("getComments", () => getComments(client, waitingTask.repo, waitingTask.issue_number));
        // Find the last "## adt: reqs" comment (the PM's waiting-user marker)
        let lastAdtIdx = -1;
        for (let i = 0; i < comments.length; i++) {
          if (/^## adt: reqs/m.test(comments[i].body)) lastAdtIdx = i;
        }
        // Any user comment (login is not the bot) AFTER lastAdtIdx means reply
        const userReplied = comments.slice(lastAdtIdx + 1).some(c =>
          c.user && c.user.login && c.user.login !== "github-actions[bot]"
        );
        if (!userReplied) {
          console.log(`Task #${waitingTask.issue_number} is waiting for user input (${waitingTask.stage}).`);
          // Skip this waiting-user task, fall through to GitHub scan for other runnable issues
          fallThroughToGitHub = true;
        } else {
          // User replied — advance to design
          const next = nextStage(waitingTask.stage);
          if (next) {
            markTaskFinished(db, waitingTask.id, "pending");
            db!.prepare("UPDATE tasks SET stage = ? WHERE id = ?").run(next, waitingTask.id);
            const label = labelForStage(next, "running");
            const client2 = createClient(config.githubToken);
            await withGh("replaceAdtLabel", () => replaceAdtLabel(client2, waitingTask.repo, waitingTask.issue_number, label));
            await withGh("postComment", () => postComment(client2, waitingTask.repo, waitingTask.issue_number,
              `## adt: reqs complete (user replied)\\n\\nProceeding to ${next}.`));
            return; // We did work, return; next run picks up design stage
          }
        }
      } else {
        // Other stages waiting-user: skip
        console.log(`Task #${waitingTask.issue_number} is waiting for user input (${waitingTask.stage}).`);
        return;
      }
    }

    if (fallThroughToGitHub) {
      // Reset task to null and re-run the GitHub scan block
      const client = createClient(config.githubToken);
      for (const repo of config.repos) {
        const issues = await withGh("listReadyIssues", () => listReadyIssues(client, repo));
        if (issues.length > 0) {
          const issue = issues[0];
          const slug = slugFromTitle(issue.title);
          const branch = branchName(issue.number, slug);
          const repoPath = process.cwd();
          const wtPath = await ensureWorktree(repoPath, issue.number, branch, config.githubToken);
          const taskId = insertTask(db, repo, issue.number, "grill", "pending", wtPath, branch);
          task = getTask(db, taskId);
          break;
        }
      }
      if (!task) {
        console.log("No runnable tasks.");
        return;
      }
    }

    // (Cleanup pass is at step 5b — runs before task selection so merged-PR
    // tasks don't compete for the queue.)

    // 10. Mark running
    markTaskRunning(db, task.id);

    // 11. Get issue data from GitHub
    const client = createClient(config.githubToken);
    const issue = await withGh("getIssue", () => getIssue(client, task.repo, task.issue_number));
    const comments = await withGh("getComments", () => getComments(client, task.repo, task.issue_number));

    // 11a. Check if issue is closed (user cancellation)
    if (issue.state === "closed") {
      console.log(`Task #${task.issue_number} issue is closed. Marking cancelled.`);
      markTaskFinished(db, task.id, "cancelled");
      return;
    }

    // 12. Build prompt and context
    const wtPath = task.worktree_path!;
    const promptFile = buildPromptFile(wtPath, {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      repo: task.repo,
    }, comments, task.stage, task.branch!);

    // 13. Spawn cc-mm
    const timeout = config.stageTimeouts[task.stage] || 30;
    const tools = DEFAULT_TOOLS[task.stage] || [];
    const spawnOpts = {
      cwd: wtPath,
      stage: task.stage,
      promptFile,
      maxDuration: timeout,
      allowedTools: tools,
      env: { GH_TOKEN: config.githubToken },
    };
    let result = await spawnCcMm(spawnOpts);

    // 13a. Parse-error retry: retry once with augmented prompt
    if (!result.ok && result.error.includes("Failed to parse result")) {
      console.log(`Task #${task.issue_number} parse error, retrying once with augmented prompt...`);
      const retryPromptPath = promptFile + ".retry.md";
      const originalPrompt = fs.readFileSync(promptFile, "utf-8");
      fs.writeFileSync(
        retryPromptPath,
        originalPrompt + '\n\n**NOTE:** Your previous output was unparseable. Re-emit valid JSON.\n',
      );
      result = await spawnCcMm({ ...spawnOpts, promptFile: retryPromptPath });
    }

    // 14. Handle result
    if (!result.ok) {
      // Failed
      markTaskFinished(db, task.id, "failed");
      await withGh("postComment", () => postComment(
        client, task.repo, task.issue_number,
        `## adt: ${task.stage} failed\n\n${result.error}\n\n<details><summary>Last output</summary>\n\n\`\`\`\n${result.partialOutput}\n\`\`\`\n</details>`,
      ));
      await withGh("replaceAdtLabel", () => replaceAdtLabel(client, task.repo, task.issue_number, LABEL_BLOCKED));
      return;
    }

    const stageResult = result.result;

    // 15. Handle each status variant
    switch (stageResult.status) {
      case "waiting-user": {
        markTaskFinished(db, task.id, "waiting-user");
        const label = labelForStage(task.stage, "waiting-user");
        await withGh("postComment", () => postComment(client, task.repo, task.issue_number, `## adt: ${task.stage}\n\n${stageResult.summary}`));
        await withGh("replaceAdtLabel", () => replaceAdtLabel(client, task.repo, task.issue_number, label));
        break;
      }
      case "done": {
        const next = nextStage(task.stage);
        if (next) {
          markTaskFinished(db, task.id, "pending");
          // Update stage in store
          db!.prepare("UPDATE tasks SET stage = ? WHERE id = ?").run(next, task.id);
          const label = labelForStage(next, "running");
          await withGh("postComment", () => postComment(client, task.repo, task.issue_number, `## adt: ${task.stage} complete\n\n${stageResult.summary}\n\nProceeding to ${next}.`));
          await withGh("replaceAdtLabel", () => replaceAdtLabel(client, task.repo, task.issue_number, label));
        } else {
          // Review done, check for PR and mark merge-ready
          markTaskFinished(db, task.id, "done");
          // Check for open PR via comments to detect PR number
          await withGh("replaceAdtLabel", () => replaceAdtLabel(client, task.repo, task.issue_number, "adt:merge-ready"));
          await withGh("postComment", () => postComment(client, task.repo, task.issue_number, `## adt: review complete\n\n${stageResult.summary}\n\nPR is ready for merge.`));
        }
        break;
      }
      case "blocked": {
        markTaskFinished(db, task.id, "blocked");
        const msg = `## adt: blocked\n\n**Reason:** ${stageResult.reason}${stageResult.details ? `\n\n**Details:** ${stageResult.details}` : ""}`;
        await withGh("postComment", () => postComment(client, task.repo, task.issue_number, msg));
        await withGh("replaceAdtLabel", () => replaceAdtLabel(client, task.repo, task.issue_number, LABEL_BLOCKED));
        break;
      }
    }
  } catch (err: any) {
    if (err.status === 401) {
      console.error("GitHub authentication failed. Run 'adt setup' to re-authenticate.");
    } else {
      console.error("Worker error:", err);
    }
  } finally {
    releaseLock();
    if (db) db.close();
  }
}

export { runWorker };
