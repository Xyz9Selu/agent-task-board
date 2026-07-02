# Task 8 Fix Report

## Changes Made

### 1. Add assertion to removeWorktree test (Medium)
- After calling `removeWorktree`, added assertion verifying the worktree path is no longer present in `git worktree list` output.
- Replaced the old `// Just verify we do not crash` comment with `expect(list).not.toContain(wtPath)`.

### 2. Fix ensureWorktree to handle remote-only branches (Medium)
- Added `await git.fetch()` before checking branch existence, so remote refs are synced first.
- Replaced `git.branchLocal()` with `git.branch(["-a"])` to check both local and remote-tracking branches.
- Added separate checks for `branchExistsLocal` and `branchExistsRemote` (checking `remotes/origin/${branch}`).
- This ensures that if another agent has pushed a branch to the remote, `ensureWorktree` can find it and create a local worktree from it, rather than trying to create a duplicate branch from `origin/main`.

### 3. Add a test for pruneWorktrees (Low)
- Added `pruneWorktrees` to the import in the test file.
- Added a new test case `"prunes stale worktree entries after manual directory removal"` that:
  1. Creates a worktree via `ensureWorktree`
  2. Manually removes the worktree directory with `fs.rmSync` (simulating a crash)
  3. Verifies the worktree still appears in `git worktree list` before pruning
  4. Calls `pruneWorktrees`
  5. Verifies the worktree is no longer listed after pruning

## Test Results

- All 4 tests in `tests/unit/worktree.test.ts` pass (3 previous + 1 new).
