# agent-dev-team (adt) — User Manual

> v0.1.0 | 2026-07-01

## What is this?

`adt` is a local CLI that turns your GitHub Issues into a multi-agent development team. You label an Issue `adt:ready`, and a team of three AI roles — PM, Dev, Reviewer — picks it up, implements it, and opens a PR. You stay in the loop at three checkpoints: requirements, design, and merge. Everything happens in GitHub comments and labels.

## Quick start

```bash
# 1. Install
cd ~/agent-dev-team
npm install && npm run build && npm link

# 2. Setup (one time)
adt setup
# Prompts for:
#   - GitHub PAT (needs "repo" scope — create at https://github.com/settings/tokens)
#   - Repo to watch, e.g. "my-org/my-project"
#   - Path to cc-mm binary (default: "cc-mm")
# Config saved to ~/.adt/config.json

# 3. Schedule periodic runs (pick ONE)
#    Option A: tmux session
tmux new -s adt
while true; do adt run; sleep 60; done

#    Option B: cron
#    Add to crontab -e:
#    */1 * * * * adt run >> ~/.adt/log 2>&1

#    Option C: systemd timer (Linux)
#    systemctl --user enable adt.timer
```

## How it works

```
You label an Issue "adt:ready"
          │
          ▼
  ╔═══════════════════════════════════════╗
  ║  STAGE 1: reqs          Role: PM     ║
  ║  PM reads the Issue, asks clarifying ║
  ║  questions in a comment.             ║
  ║  ── YOU REPLY ──                     ║
  ║  PM synthesizes a Requirements       ║
  ║  Summary and advances.               ║
  ╚═══════════════════════════════════════╝
          │
          ▼
  ╔═══════════════════════════════════════╗
  ║  STAGE 2: design        Role: Dev    ║
  ║  Dev explores the codebase, writes   ║
  ║  a design doc, commits it.           ║
  ║  ── YOU APPROVE ──                   ║
  ║  Comment "/adt-approve" or approve   ║
  ║  the PR on GitHub.                   ║
  ╚═══════════════════════════════════════╝
          │
          ▼
  ╔═══════════════════════════════════════╗
  ║  STAGE 3: impl          Role: Dev    ║
  ║  Dev implements, writes tests,       ║
  ║  commits, and pushes.                ║
  ║  (Autonomous — no action needed)     ║
  ╚═══════════════════════════════════════╝
          │
          ▼
  ╔═══════════════════════════════════════╗
  ║  STAGE 4: review      Role: Reviewer ║
  ║  Reviewer runs tests, opens a PR,    ║
  ║  and posts a summary.                ║
  ║  ── YOU MERGE ──                     ║
  ║  Click "Merge" on the GitHub PR.     ║
  ║  Next adt run cleans up.             ║
  ╚═══════════════════════════════════════╝
```

Each `adt run` advances exactly one task by one stage. If a stage needs your input, the worker posts a comment and pauses that task — the next `adt run` picks up the next available task instead.

## Commands

| Command | What it does |
|---|---|
| `adt setup` | First-time config (GitHub PAT, repos, cc-mm path) |
| `adt setup --add owner/repo` | Add another repo to watch |
| `adt setup --remove owner/repo` | Stop watching a repo |
| `adt run` | Pick one task, execute one stage, exit |
| `adt status` | Show all tasks grouped by repo, current stage, status |
| `adt pause owner/repo#42` | Pause a task (it won't be picked up) |
| `adt resume owner/repo#42` | Resume a paused task |
| `adt clean` | Prune stale git worktrees |
| `adt habit add <name>` | Register a habit for daily tracking (idempotent) |
| `adt habit done <name>` | Mark a habit done for today (idempotent same-day) |
| `adt habit list` | Show today's status for all registered habits |
| `adt doctor` | Validate local config and runtime (read-only) |

## How to interact during a task

### During requirements (Stage 1)

The PM posts clarifying questions as an Issue comment. Just reply normally on the Issue. The next `adt run` detects your reply and advances the task.

### During design (Stage 2)

The Dev posts a design doc. To approve:

- **Option A**: Comment `/adt-approve` on the Issue or PR.
- **Option B**: Use the GitHub PR Review UI — click "Approve" on the design PR.

### During implementation (Stage 3)

No action needed. The team works autonomously.

### During review (Stage 4)

Reviewer opens a PR. Read it, run the checks, click **Merge**. Next `adt run` cleans up the worktree and closes the loop.

### To cancel a task

- Comment `/adt-cancel` on the Issue, **or**
- Close the Issue, **or**
- Close the PR without merging.

The team preserves all artifacts (comments, commits, branch). You can re-open and re-label `adt:ready` to retry.

### If something goes wrong

If the team hits an error it can't recover from, it posts a comment and labels the Issue `adt:blocked`. Read the comment, fix the problem, remove `adt:blocked`, and re-label `adt:ready`.

## Labels reference

| Label | Meaning |
|---|---|
| `adt:ready` | Trigger — you've assigned this Issue to the team |
| `adt:reqs-running` | PM is working on requirements |
| `adt:reqs-waiting` | PM posted questions, waiting for your reply |
| `adt:design-running` | Dev is writing the design document |
| `adt:design-waiting` | Design doc is ready, waiting for your approval |
| `adt:impl-running` | Dev is implementing |
| `adt:review-running` | Reviewer is preparing the PR |
| `adt:merge-ready` | PR is open, waiting for your merge |
| `adt:blocked` | Team is stuck, needs your help |
| `adt:cancelled` | Task was cancelled |

At any time, exactly one `adt:*` label is present (or `adt:blocked`).

## Stage timeouts (and how to change them)

| Stage | Default timeout |
|---|---|
| reqs (PM) | 10 minutes |
| design (Dev) | 20 minutes |
| impl (Dev) | 60 minutes |
| review (Reviewer) | 30 minutes |

If a stage times out, the team posts an error comment and marks the task blocked. To change defaults, edit `~/.adt/config.json`:

```json
{
  "githubToken": "...",
  "repos": ["owner/repo"],
  "ccMmPath": "cc-mm",
  "stageTimeouts": {
    "reqs": 15,
    "design": 30,
    "impl": 90,
    "review": 45
  }
}
```

## Multi-repo

To watch multiple repos:

```bash
adt setup --add owner/repo-two
adt setup --add owner/repo-three
```

`adt run` scans all configured repos and picks the oldest runnable task across all of them.

Remove a repo: `adt setup --remove owner/repo-two`

## State and data

- **Config**: `~/.adt/config.json`
- **Task DB**: `~/.adt/state.db` (SQLite)
- **Lock**: `~/.adt/lock.pid` (prevents concurrent workers)
- **Habits**: `~/.adt/habits.json` (plain JSON, single-user)
- **Worktrees**: `<repo>/../.adt-worktrees/issue-<n>/`
- **Logs**: stdout from your scheduler (cron/systemd). Add `>> ~/.adt/log` to capture.

## Multiple tasks at once

The worker is **serial** — one task per `adt run`. If you label 5 Issues, they queue up and process one at a time. A task waiting for your input (status `waiting-user`) is skipped so the team stays productive.

## Troubleshooting

### "No config found" on `adt run`
Run `adt setup` first.

### "Another worker is running"
A previous `adt run` is still going or crashed. If you're sure nothing is running, delete `~/.adt/lock.pid`.

### Task stuck in "running" forever
The worker has automatic stuck-task detection — after 2× the stage timeout, it resets the task to `pending`. If you need it sooner, manually reset in the DB or delete the task row.

### GitHub 401
Your PAT expired or was revoked. Run `adt setup` to re-authenticate.

### Worktrees accumulating
Run `adt clean` periodically to prune stale worktrees.

## Requirements

- **Node.js 20+**
- **cc-mm** CLI (the AI agent runtime) — must be installed and on PATH or configured in setup
- **GitHub PAT** with `repo` scope
- **Git** — your repo must be cloned locally, and `adt` must be run from within the clone (or cron must `cd` to it)

## Tips

- Start with a small Issue ("fix a typo in README") to see the team in action before assigning real work.
- Check `adt status` periodically to see what's in the pipeline.
- The design doc is committed to `docs/designs/<issue>.md` on the task branch — you can review it there before approving.
- All team comments are prefixed with `## adt: <stage>` so they're easy to find in the GitHub UI.
- If you have multiple clones of the same repo, each clone needs its own `adt` instance (or run `adt` from a single canonical clone).

## adt habit

`adt habit` is a small daily checklist that lives next to the rest of the team state — single-user, per-machine, plain JSON. Three commands:

```bash
adt habit add exercise     # register a habit (idempotent)
adt habit done exercise    # mark it done for today (idempotent same-day)
adt habit list             # show today's status for all habits
```

`list` prints one line per habit with a ✅ (done today) or ❌ (not yet). On an empty store it prints `No habits yet. Add one with: adt habit add <name>`.

Data lives in `~/.adt/habits.json` and looks like:

```json
{
  "habits": [
    {
      "name": "exercise",
      "createdAt": "2026-07-02T13:45:00.000Z",
      "completions": ["2026-07-01", "2026-07-02"]
    }
  ]
}
```

"Today" is your local date (`YYYY-MM-DD`), so marking a habit done at 11pm counts for today even if UTC has already rolled over. `done` exits non-zero if the habit isn't registered (run `add` first). v1 is intentionally minimal — no streaks, no reminders, no history views.

## adt doctor

`adt doctor` is a read-only health check for your local setup. It runs five checks and prints a pass/fail table, exiting 0 when everything is healthy and 1 otherwise.

```bash
adt doctor
```

Checks (in order):

- **config** — `~/.adt/config.json` exists, parses as JSON, and has the required fields (`githubToken`, `repos[]`).
- **token** — the resolved GitHub token (env-first: `GITHUB_TOKEN`, then `GH_TOKEN`, then `config.githubToken`) authenticates against GitHub. This matches what `adt run` actually uses.
- **repos** — each entry in `config.repos[]` is reachable on GitHub (per-repo pass/fail shown).
- **ccMm** — the `ccMmPath` resolves to an executable. A bare command name is looked up on `PATH`; an explicit `/`-path is checked directly.
- **labels** — the full set of `adt:*` labels exists on at least one configured repo (per-repo coverage shown).

`doctor` is safe to run before `setup` — a missing config file just fails the `config` check, and the other checks still run (token from env, `ccMm` from `PATH`, labels skipped). It makes no filesystem or GitHub changes.
