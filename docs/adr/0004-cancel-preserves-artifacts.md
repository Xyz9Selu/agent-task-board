# 0004 — Cancellation preserves all stage artifacts

When the user cancels a task — by `/adt-cancel` comment, closing the Issue, **or closing the design/review PR without merging** — the worker kills the running `cc-mm` subprocess (if any) and leaves all produced artifacts in place: any comments already posted to the Issue or PR, any commits already on the `adt/issue-<n>-*` branch, the worktree itself, any open or closed PRs. The task is marked `cancelled` in the store and labelled `adt:cancelled` on the Issue, but nothing is rolled back.

The user can then inspect what was done and decide:
- Re-open the Issue (or re-open the PR), remove `adt:cancelled`, re-label `adt:ready` to retry — but stages are NOT idempotent (see ADR 0005), so the retry may produce duplicate artifacts.
- Manually clean up (close PR, delete branch, `git worktree remove`).

We considered auto-cleanup on cancel (delete branch, close PR, remove worktree). Rejected because cancellation is rare and preserving the evidence is more useful than auto-cleaning. The next worker run also skips cancelled tasks.

Note: this ADR covers user-initiated cancellation. System-initiated failures (cc-mm crash, worker crash) follow ADR 0005.