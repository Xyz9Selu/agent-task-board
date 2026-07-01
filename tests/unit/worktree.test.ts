import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureWorktree, removeWorktree, pruneWorktrees, worktreePath, branchName, worktreesDir } from "../../src/worktree.js";
import simpleGit from "simple-git";

const TMP = `/tmp/worktree-test-${Date.now()}`;
const BARE = path.join(TMP, "bare");
const REPO = path.join(TMP, "test-repo");
let git: ReturnType<typeof simpleGit>;

beforeEach(async () => {
  // Create a bare repository to act as origin
  fs.mkdirSync(BARE, { recursive: true });
  const bareGit = simpleGit(BARE);
  await bareGit.init(true); // bare repo

  // Clone from bare to create test repo with origin remote
  const cloneGit = simpleGit(TMP);
  await cloneGit.clone(BARE, "test-repo");
  git = simpleGit(REPO);
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");
  fs.writeFileSync(path.join(REPO, "README.md"), "# test\n");
  await git.add("README.md");
  await git.commit("initial commit");
  // Push main so origin/main exists
  await git.raw("checkout", "-b", "main");
  await git.push("origin", "main");
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("branchName", () => {
  it("generates a branch name from issue number and slug", () => {
    expect(branchName(42, "fix-bug")).toBe("adt/issue-42-fix-bug");
  });
});

describe("ensureWorktree and removeWorktree", () => {
  it("creates and removes a worktree", async () => {
    const branch = branchName(1, "test");
    const wtPath = await ensureWorktree(REPO, 1, branch);
    expect(fs.existsSync(wtPath)).toBe(true);
    expect(fs.existsSync(path.join(wtPath, ".adt"))).toBe(true);
    expect(fs.existsSync(path.join(wtPath, "README.md"))).toBe(true);
    await removeWorktree(REPO, 1);
    // Verify worktree is no longer in git worktree list
    const list = await git.raw("worktree", "list");
    expect(list).not.toContain(wtPath);
  });

  it("returns existing worktree path on second call", async () => {
    const branch = branchName(2, "test");
    const wtPath1 = await ensureWorktree(REPO, 2, branch);
    const wtPath2 = await ensureWorktree(REPO, 2, branch);
    expect(wtPath1).toBe(wtPath2);
  });

  it("prunes stale worktree entries after manual directory removal", async () => {
    const branch = branchName(3, "prune-test");
    const wtPath = await ensureWorktree(REPO, 3, branch);
    expect(fs.existsSync(wtPath)).toBe(true);

    // Manually delete worktree directory to simulate a crash
    fs.rmSync(wtPath, { recursive: true, force: true });

    // The worktree should still appear in git worktree list before pruning
    const listBefore = await git.raw("worktree", "list");
    expect(listBefore).toContain(wtPath);

    // Prune stale entries
    await pruneWorktrees(REPO);

    // After pruning, the worktree should no longer appear in the list
    const listAfter = await git.raw("worktree", "list");
    expect(listAfter).not.toContain(wtPath);
  });
});
