import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseStageResult, type StageResult } from "./result.js";
import type { Stage } from "./config.js";

interface SpawnOpts {
  cwd: string;
  stage: Stage;
  promptFile: string;
  maxDuration: number; // minutes
  allowedTools: string[];
  env: Record<string, string>;
  ccMmPath?: string; // optional path to cc-mm binary
}

type SpawnResult =
  | { ok: true; result: StageResult }
  | { ok: false; error: string; partialOutput: string };

const DEFAULT_TOOLS: Record<Stage, string[]> = {
  grill: ["Bash", "Read", "Write"],
  reqs: ["Bash", "Read", "Write"],
  design: ["Bash", "Read", "Write", "Grep"],
  impl: ["Bash", "Read", "Write", "Grep", "Glob", "Edit", "WebFetch"],
  review: ["Bash", "Read", "Write", "Grep", "Edit"],
};

function buildPromptFile(
  worktreePath: string,
  issueData: { number: number; title: string; body: string | null; repo: string },
  comments: { id: number; body: string; user: { login: string } | null }[],
  stage: Stage,
  branchName: string,
): string {
  const ctxDir = path.join(worktreePath, ".adt");
  fs.mkdirSync(ctxDir, { recursive: true });

  // Write context files
  fs.writeFileSync(path.join(ctxDir, "issue.json"), JSON.stringify(issueData, null, 2));
  fs.writeFileSync(path.join(ctxDir, "comments.json"), JSON.stringify(comments, null, 2));
  fs.writeFileSync(path.join(ctxDir, "stage.txt"), stage);
  fs.writeFileSync(path.join(ctxDir, "branch.txt"), branchName);

  // Write the prompt that tells cc-mm what to do
  const stageHint = stage === "grill"
    ? `This is the GRILL stage — the Issue body is a rough idea. Your goal: sharpen the requirement via Socratic questioning, using the \`grill-with-docs\` skill. After each exchange, post your questions or progress to the Issue as a comment (using \`gh issue comment\`), then write your result JSON.

Two outcomes are possible:
- status="waiting-user": you've posted clarifying questions and need the user to respond before continuing. The questions go in \`summary\`.
- status="done": the user has already responded (check .adt/comments.json) AND requirements are crisp. Write a Requirements Summary in \`summary\`, set the Issue to \`adt:reqs-waiting\`-ready state by removing \`adt:grill\` label, and the worker will continue with the normal reqs stage.

Look at the latest comment in .adt/comments.json. If it's a user reply (login is not your bot), and it answers your previous round of questions, treat that as the user's confirmation that requirements are clear and produce a Requirements Summary.`
    : `Your skill (agent-dev-team) defines what to do for each stage.`;

  const prompt = `You are running stage: ${stage} for issue #${issueData.number} in repo ${issueData.repo}.

Context files are at:
  .adt/issue.json     — the GitHub Issue body and metadata
  .adt/comments.json  — all Issue/PR comments so far
  .adt/stage.txt      — the current stage name
  .adt/branch.txt     — the git branch name for this task

${stageHint}

Execute the stage, then write the result JSON to .adt/${stage}-result.json matching this schema:

{
  "status": "waiting-user" | "done" | "blocked",
  "summary": "...",
  "artifacts": { ... }   // optional
  "reason": "...",       // required if status=blocked
  "details": "..."       // optional if status=blocked
}

You MUST write valid JSON. Exit code 0 on success.
`;

  const promptPath = path.join(ctxDir, "prompt.md");
  fs.writeFileSync(promptPath, prompt);
  return promptPath;
}

async function spawnCcMm(opts: SpawnOpts): Promise<SpawnResult> {
  const tools = opts.allowedTools.length > 0 ? opts.allowedTools : (DEFAULT_TOOLS[opts.stage] || []);
  // Read prompt from file and pass via --print (-p)
  const promptContent = fs.readFileSync(opts.promptFile, "utf-8");
  const args = [
    "-p", promptContent,
    "--allowedTools", tools.join(","),
    "--dangerously-skip-permissions",
  ];

  const env = { ...process.env, ...opts.env };

  return new Promise((resolve) => {
    const child = spawn(opts.ccMmPath || "cc-mm", args, {
      cwd: opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timeoutMs = opts.maxDuration * 60 * 1000;
    let killed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 30000);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);

      if (killed) {
        resolve({
          ok: false,
          error: `cc-mm timed out after ${opts.maxDuration}m. Graceful kill attempted.`,
          partialOutput: stdout.slice(-4000),
        });
        return;
      }

      if (code !== 0) {
        resolve({
          ok: false,
          error: `cc-mm exited with code ${code}. stderr: ${stderr.slice(-2000)}`,
          partialOutput: stdout.slice(-4000),
        });
        return;
      }

      // Read result.json from worktree
      const resultPath = path.join(opts.cwd, ".adt", `${opts.stage}-result.json`);
      try {
        const raw = fs.readFileSync(resultPath, "utf-8");
        const result = parseStageResult(raw);
        resolve({ ok: true, result });
      } catch (e) {
        // Include stdout tail in error for debugging
        resolve({
          ok: false,
          error: `Failed to parse result: ${e}. stdout tail: ${stdout.slice(-2000)}`,
          partialOutput: stdout.slice(-4000),
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ ok: false, error: `Failed to spawn cc-mm: ${err.message}`, partialOutput: "" });
    });
  });
}

export { spawnCcMm, buildPromptFile, SpawnOpts, SpawnResult, DEFAULT_TOOLS };
