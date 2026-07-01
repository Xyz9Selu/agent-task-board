# 0008 — Multi-repo support in v1; setup configures repo list

`adt setup` configures a **list** of GitHub repos (`["owner/repo1", "owner/repo2", ...]`) along with the PAT and `cc-mm` path. `adt run` scans every configured repo for Issues labelled `adt:ready` and operates on whichever task is next runnable across the union.

Each repo has its own worktree directory under its respective local clone (e.g., `~/work/repo1/.adt-worktrees/issue-42/`). The SQLite store at `~/.adt/state.db` is shared across repos — the `repo` column on each `tasks` row disambiguates.

We expanded from the original v1 single-repo stance because the user works across multiple repos and the incremental complexity is small (one extra config field, one extra loop in `worker.ts` to pick the next task across repos).

## Implications

- Per-repo state: each repo's worktrees, branches, design docs are local to that repo's clone. The shared DB just tracks metadata.
- Setup adds/removes repos via `adt setup --add owner/repo` / `adt setup --remove owner/repo`.
- `adt status` shows tasks grouped by repo.