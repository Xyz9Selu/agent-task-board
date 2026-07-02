# 0007 — Branch conflicts block the task; user handles manually

When `cc-mm`'s `git push` to the task's `adt/issue-<n>-*` branch is rejected (non-fast-forward because the user or another tool pushed a commit in the meantime), the worker marks the stage `failed`, labels the Issue `adt:blocked`, and posts a comment describing the push rejection.

The user is expected to:
1. `git fetch` and inspect the diverging commits.
2. Either rebase the team's work onto the user's commit (or vice versa), or merge.
3. Remove `adt:blocked`, re-label `adt:ready` to retry the stage.

We considered letting `cc-mm` auto-rebase and re-push. Rejected because:
- Auto-rebase on a branch the user is actively editing can silently drop or reorder commits in surprising ways.
- The user is the source of truth on what's intended to ship; we should not silently resolve conflicts.
- The conflict is rare in practice (the team has the branch to itself most of the time) and the manual recovery is straightforward.