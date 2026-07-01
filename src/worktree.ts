import * as path from "node:path";
import * as fs from "node:fs";
import simpleGit, { type SimpleGit } from "simple-git";

function worktreesDir(repoPath: string): string {
  return path.join(repoPath, "..", ".adt-worktrees");
}

function worktreePath(repoPath: string, issueNumber: number): string {
  return path.join(worktreesDir(repoPath), `issue-${issueNumber}`);
}

function branchName(issueNumber: number, slug: string): string {
  return `adt/issue-${issueNumber}-${slug}`;
}

async function ensureWorktree(repoPath: string, issueNumber: number, branch: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoPath);
  const wtPath = worktreePath(repoPath, issueNumber);
  const wtDir = worktreesDir(repoPath);

  fs.mkdirSync(wtDir, { recursive: true });

  // Check if worktree already exists
  const list = await git.raw("worktree", "list");
  if (list.includes(wtPath)) {
    return wtPath;
  }

  // Fetch to sync remote refs (branch may have been pushed by another agent)
  await git.fetch();
  // Check if branch exists (local or remote tracking)
  const branches = await git.branch(["-a"]);
  const branchExistsLocal = branches.all.includes(branch);
  const branchExistsRemote = branches.all.includes(`remotes/origin/${branch}`);
  if (branchExistsLocal || branchExistsRemote) {
    // Branch exists, add worktree for it
    await git.raw("worktree", "add", wtPath, branch);
  } else {
    // Create new branch from HEAD of main
    await git.raw("worktree", "add", "-b", branch, wtPath, "origin/main");
  }

  // Create .adt context directory
  fs.mkdirSync(path.join(wtPath, ".adt"), { recursive: true });

  return wtPath;
}

async function removeWorktree(repoPath: string, issueNumber: number): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  const wtPath = worktreePath(repoPath, issueNumber);

  if (!fs.existsSync(wtPath)) return;

  await git.raw("worktree", "remove", wtPath, "--force");
}

async function pruneWorktrees(repoPath: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  await git.raw("worktree", "prune");
}

export { ensureWorktree, removeWorktree, pruneWorktrees, worktreePath, branchName, worktreesDir };
