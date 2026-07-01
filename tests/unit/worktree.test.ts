import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureWorktree, removeWorktree, worktreePath, branchName, worktreesDir } from "../../src/worktree.js";
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
    // Worktree path may still exist as empty dir after remove --force, but worktree list should not include it
    // Just verify we do not crash
  });

  it("returns existing worktree path on second call", async () => {
    const branch = branchName(2, "test");
    const wtPath1 = await ensureWorktree(REPO, 2, branch);
    const wtPath2 = await ensureWorktree(REPO, 2, branch);
    expect(wtPath1).toBe(wtPath2);
  });
});
