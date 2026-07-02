# Project glossary

## Concepts

- **Task** — One GitHub Issue being worked on by the team. Identified by `(repo, issue_number)`.
- **Stage** — One of `reqs`, `design`, `impl`, `review`. A task progresses through them in order.
- **Role** — The kind of work being done at a stage: PM (reqs), Dev (design + impl), Reviewer (review). Roles are configured via prompts inside the `agent-dev-team` skill, not TS code.
- **Status** — A task's runnable state: `pending` (can advance), `running` (worker is on it), `waiting-user` (blocked on user reply), `blocked` (team hit an error), `done`, `cancelled`.
- **Runnable task** — A task with status `pending`. `waiting-user` and `running` are excluded from the queue by the worker (see ADR 0001).
- **Worker run** — One invocation of `adt run`. Picks at most one runnable task, executes one stage, exits.
- **Stage result** — The JSON file `.adt/<stage>-result.json` written by the skill at the end of each stage. Schema lives in `src/result.ts`.

## People

- **User** — The human product owner. The only person who can advance a task past a `waiting-user` checkpoint.
- **Team** — The collective of PM/Dev/Reviewer roles driven by cc-mm.

## Artifacts

- **Worktree** — A per-task git worktree under `<repo>/../.adt-worktrees/issue-<n>/`, branch `adt/issue-<n>-<slug>`. Lives from first stage until PR merge.
- **Design doc** — Markdown file at `docs/designs/<issue>.md` committed on the task branch.
- **Requirements summary** — A comment on the Issue posted by the PM role after the user replies to clarifying questions.

## Signals (user → team)

- **Trigger** — Adding label `adt:ready` to an Issue starts it.
- **Cancel** — Closing the Issue, or commenting `/adt-cancel`.
- **Approve design** — Commenting on the Issue or PR whose body matches `^/adt-approve(\s.*)?$` (case-insensitive).
- **Merge** — Clicking "Merge" on the PR. Worker detects via polling on next run.

## Stages → user-intervention map

| Stage | User action to advance | User intervention? |
|---|---|---|
| reqs | Reply to PM's clarifying questions on the Issue | Yes |
| design | Post `/adt-approve` on Issue or PR | Yes |
| impl | (none — autonomous) | No |
| review | Click Merge on the PR | Yes |

## Non-decisions

- **Stage skipping is not supported.** Trivial issues (typo fixes, dep bumps) still go through all four stages. The user explicitly rejected "trivial-skip" labels because the friction of adding them outweighs the savings.