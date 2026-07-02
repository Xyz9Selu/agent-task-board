import * as path from "node:path";
import * as fs from "node:fs";
import simpleGit, { simpleGit as createGit, type SimpleGit } from "simple-git";

function worktreesDir(repoPath: string): string {
  return path.join(repoPath, "..", ".adt-worktrees");
}

function worktreePath(repoPath: string, issueNumber: number): string {
  return path.join(worktreesDir(repoPath), `issue-${issueNumber}`);
}

function branchName(issueNumber: number, slug: string): string {
  return `adt/issue-${issueNumber}-${slug}`;
}

async function ensureWorktree(repoPath: string, issueNumber: number, branch: string, githubToken?: string): Promise<string> {
  const git: SimpleGit = createGit(repoPath);
  const wtPath = worktreePath(repoPath, issueNumber);
  const wtDir = worktreesDir(repoPath);

  fs.mkdirSync(wtDir, { recursive: true });

  // Rewrite origin to HTTPS-with-token so cc-mm's git push uses the PAT.
  // Worktrees created via `git worktree add` inherit the parent's remote config,
  // but if origin is SSH the push will be denied (no SSH key, or wrong key).
  if (githubToken) {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === "origin");
    if (origin) {
      const sshMatch = origin.refs.fetch.match(/git@github\.com:([^/]+)\/(.+?)\.git/);
      if (sshMatch) {
        const [, owner, repoName] = sshMatch;
        const httpsUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repoName}.git`;
        await git.removeRemote("origin");
        await git.addRemote("origin", httpsUrl);
      } else {
        // Already HTTPS — rewrite with the token in case it lacks auth
        const httpsMatch = origin.refs.fetch.match(/https:\/\/github\.com\/([^/]+)\/(.+?)\.git/);
        if (httpsMatch && !origin.refs.fetch.includes("x-access-token:")) {
          const [, owner, repoName] = httpsMatch;
          const httpsUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repoName}.git`;
          await git.removeRemote("origin");
          await git.addRemote("origin", httpsUrl);
        }
      }
    }
  }

  // Check if worktree already exists
  const list = await git.raw("worktree", "list");
  if (list.includes(wtPath)) {
    return wtPath;
  }

  // Fetch to sync remote refs (branch may have been pushed by another agent)
  await git.fetch();
  // Explicitly fetch origin/main to ensure ref is up-to-date
  try {
    await git.fetch("origin", "main");
  } catch (e) {
    // 'main' may not exist on remote (rare); fall back
  }
  // Check if branch exists (local or remote tracking)
  const branches = await git.branch(["-a"]);
  const branchExistsLocal = branches.all.includes(branch);
  const branchExistsRemote = branches.all.includes(`remotes/origin/${branch}`);
  if (branchExistsLocal || branchExistsRemote) {
    // Branch exists, add worktree for it
    await git.raw("worktree", "add", wtPath, branch);
  } else {
    // Create new branch from origin/main (or HEAD if origin/main missing)
    const baseRef = branches.all.includes("remotes/origin/main") ? "origin/main" : "HEAD";
    await git.raw("worktree", "add", "-b", branch, wtPath, baseRef);
  }

  // Create .adt context directory
  fs.mkdirSync(path.join(wtPath, ".adt"), { recursive: true });

  return wtPath;
}

async function removeWorktree(repoPath: string, issueNumber: number): Promise<void> {
  const git: SimpleGit = createGit(repoPath);
  const wtPath = worktreePath(repoPath, issueNumber);

  if (!fs.existsSync(wtPath)) return;

  await git.raw("worktree", "remove", wtPath, "--force");
}

async function pruneWorktrees(repoPath: string): Promise<void> {
  const git: SimpleGit = createGit(repoPath);
  await git.raw("worktree", "prune");
}

export { ensureWorktree, removeWorktree, pruneWorktrees, worktreePath, branchName, worktreesDir };
