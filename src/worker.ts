import Database from "better-sqlite3";
import { loadConfig, type Config, type Stage, ADT_DIR } from "./config.js";
import { openDb, listRunnableTasks, markTaskRunning, markTaskFinished, insertTask, getTask, type TaskRow } from "./store.js";
import { acquireLock, releaseLock } from "./lock.js";
import { nextStage, labelForStage, LABEL_BLOCKED } from "./labels.js";
import { parseStageResult } from "./result.js";
import { createClient, listReadyIssues, getIssue, getComments, postComment, replaceAdtLabel, isPRMerged, isPRClosed, hasApprovedReview } from "./github.js";
import { ensureWorktree, removeWorktree, pruneWorktrees, branchName } from "./worktree.js";
import { spawnCcMm, buildPromptFile, DEFAULT_TOOLS } from "./claude-code.js";
import * as path from "node:path";

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// Check if user has approved the design stage
async function checkApproval(
  client: ReturnType<typeof createClient>,
  repo: string,
  issueNumber: number,
  _stage: Stage,
): Promise<boolean> {
  const comments = await getComments(client, repo, issueNumber);
  // Check for /adt-approve comment
  const hasApproveComment = comments.some(c =>
    /^\/adt-approve(\s.*)?$/im.test(c.body)
  );
  if (hasApproveComment) return true;

  // Check for PR Approve event -- look for an open PR associated with this issue
  // (In v1, we check any PR mentioning the issue)
  // This is a simple heuristic; full PR detection is done via getPR + hasApprovedReview
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

    // 2. Load config
    const config = loadConfig();

    // 3. Open store
    db = openDb(path.join(ADT_DIR, "state.db"));

    // 4. List runnable tasks from store
    let task: TaskRow | null = null;
    const pending = listRunnableTasks(db);
    if (pending.length > 0) {
      task = pending[0]; // Sorted by FIFO + stage priority
    }

    // 5. If nothing in store, scan GitHub for new adt:ready issues
    if (!task) {
      const client = createClient(config.githubToken);
      for (const repo of config.repos) {
        const issues = await listReadyIssues(client, repo);
        if (issues.length > 0) {
          const issue = issues[0];
          const slug = slugFromTitle(issue.title);
          const branch = branchName(issue.number, slug);
          const repoPath = process.cwd(); // Assume cwd is the repo clone
          const wtPath = await ensureWorktree(repoPath, issue.number, branch);
          const taskId = insertTask(db, repo, issue.number, "reqs", "pending", wtPath, branch);
          task = getTask(db, taskId);
          break;
        }
      }
    }

    if (!task) {
      console.log("No runnable tasks.");
      return;
    }

    // 6. Check for approval (design stage)
    if (task.stage === "design") {
      const client = createClient(config.githubToken);
      const approved = await checkApproval(client, task.repo, task.issue_number, task.stage);
      if (!approved) {
        console.log(`Task #${task.issue_number} is waiting for design approval.`);
        return;
      }
    }

    // 7. Check for merged PR (review stage)
    if (task.stage === "review") {
      // If PR was merged or closed, handle cleanup
      // In v1, we rely on the worker checking the PR status on next run
      // via listReadyIssues detecting the merged PR
    }

    // 8. Mark running
    markTaskRunning(db, task.id);

    // 9. Get issue data from GitHub
    const client = createClient(config.githubToken);
    const issue = await getIssue(client, task.repo, task.issue_number);
    const comments = await getComments(client, task.repo, task.issue_number);

    // 10. Build prompt and context
    const wtPath = task.worktree_path!;
    const promptFile = buildPromptFile(wtPath, {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      repo: task.repo,
    }, comments, task.stage);

    // 11. Spawn cc-mm
    const timeout = config.stageTimeouts[task.stage] || 30;
    const tools = DEFAULT_TOOLS[task.stage] || [];
    const result = await spawnCcMm({
      cwd: wtPath,
      stage: task.stage,
      promptFile,
      maxDuration: timeout,
      allowedTools: tools,
      env: { GH_TOKEN: config.githubToken },
    });

    // 12. Handle result
    if (!result.ok) {
      // Failed
      markTaskFinished(db, task.id, "failed");
      await postComment(
        client, task.repo, task.issue_number,
        `## adt: ${task.stage} failed\n\n${result.error}\n\n<details><summary>Last output</summary>\n\n\`\`\`\n${result.partialOutput}\n\`\`\`\n</details>`,
      );
      await replaceAdtLabel(client, task.repo, task.issue_number, LABEL_BLOCKED);
      return;
    }

    const stageResult = result.result;

    // 13. Handle each status variant
    switch (stageResult.status) {
      case "waiting-user": {
        markTaskFinished(db, task.id, "waiting-user");
        const label = labelForStage(task.stage, "waiting-user");
        await postComment(client, task.repo, task.issue_number, `## adt: ${task.stage}\n\n${stageResult.summary}`);
        await replaceAdtLabel(client, task.repo, task.issue_number, label);
        break;
      }
      case "done": {
        const next = nextStage(task.stage);
        if (next) {
          markTaskFinished(db, task.id, "pending");
          // Update stage in store
          db!.prepare("UPDATE tasks SET stage = ? WHERE id = ?").run(next, task.id);
          const label = labelForStage(next, "running");
          await postComment(client, task.repo, task.issue_number, `## adt: ${task.stage} complete\n\n${stageResult.summary}\n\nProceeding to ${next}.`);
          await replaceAdtLabel(client, task.repo, task.issue_number, label);
        } else {
          // Review done, check for PR and mark merge-ready
          markTaskFinished(db, task.id, "done");
          // Check for open PR via comments to detect PR number
          await replaceAdtLabel(client, task.repo, task.issue_number, "adt:merge-ready");
          await postComment(client, task.repo, task.issue_number, `## adt: review complete\n\n${stageResult.summary}\n\nPR is ready for merge.`);
        }
        break;
      }
      case "blocked": {
        markTaskFinished(db, task.id, "blocked");
        const msg = `## adt: blocked\n\n**Reason:** ${stageResult.reason}${stageResult.details ? `\n\n**Details:** ${stageResult.details}` : ""}`;
        await postComment(client, task.repo, task.issue_number, msg);
        await replaceAdtLabel(client, task.repo, task.issue_number, LABEL_BLOCKED);
        break;
      }
    }
  } catch (err) {
    console.error("Worker error:", err);
  } finally {
    if (db) db.close();
    releaseLock();
  }
}

export { runWorker };
