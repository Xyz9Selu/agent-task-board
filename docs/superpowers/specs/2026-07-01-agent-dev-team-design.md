# agent-dev-team — Design Spec

**Date**: 2026-07-01
**Status**: Draft (pending user approval)
**Author**: brainstorming session with user

## 1. Purpose

`agent-dev-team` (binary name `adt`) is a local CLI tool that turns GitHub Issues into autonomous multi-agent software work. The user acts as the product owner: they assign tasks by labeling Issues, and a team of three AI roles (PM, Dev, Reviewer) implements them. The team pulls the user in at three explicit checkpoints (requirements, design, merge) and otherwise works asynchronously.

All team↔user communication happens on GitHub (Issue/PR comments, labels, @mentions). No external chat, no dashboard.

## 2. Core concepts

### 2.1 Roles

| Role | Stage | Goal | Output |
|---|---|---|---|
| **PM** | reqs | Clarify requirements with the user | `Requirements Summary` comment on Issue |
| **Dev** | design | Produce a design document for user approval | `docs/designs/<issue>.md` committed to branch |
| **Dev** | impl | Implement and test on a feature branch | Commits on branch |
| **Reviewer** | review | Open a PR ready for the user to merge | GitHub PR |

### 2.2 Lifecycle

```
Issue (any state) ──[user labels adt:ready]──▶ STAGE: reqs
                                                  │
                            ┌───── user replies ──┘
                            ▼
                          STAGE: design
                            │
                            ▼
                          STAGE: impl
                            │
                            ▼
                          STAGE: review
                            │
                  ───── user clicks Merge on GitHub ─────▶ DONE
                  (worker detects via polling on next run)
```

User intervention is required at:
- **reqs**: PM posts clarifying questions → user replies on Issue
- **design**: Dev posts design doc → user approves ("approved" / 👍 reaction / explicit comment)
- **merge**: user clicks "Merge" on the GitHub PR

The `impl` stage does not require user action; the team proceeds autonomously.

### 2.3 Trigger

User adds label `adt:ready` to an Issue. The next `adt run` invocation picks it up and starts Stage 1.

## 3. Architecture — Stateless Worker Model

`adt` does **not** run a long-lived daemon. Instead, the user configures a periodic invocation:

```bash
# user runs ONE of these on their machine
while true; do adt run; sleep 60; done
# or: cron, systemd timer, launchd plist
```

Each invocation of `adt run`:
1. Acquires a global file lock (flock) — exits silently if another worker is running.
2. Picks the oldest task where stage ∈ {reqs, design, impl, review} and status is not `running`.
3. Sets up the per-task git worktree (creates if missing).
4. Spawns one `cc-mm` subprocess with the `agent-dev-team` skill loaded, passing context files (Issue body, comment history, stage name) via `--prompt-file`.
5. `cc-mm` runs the current stage, writes its outcome to `.adt/<stage>-result.json` in the worktree.
6. Worker reads the result, updates GitHub (comment + label transition), updates the SQLite store, releases lock, exits.

### 3.1 Process model

- `adt` is a short-lived Node process per stage. No in-memory state across stages.
- `cc-mm` is a short-lived child process per stage. Fresh context per stage.
- All persistent state lives in:
  - SQLite at `~/.adt/state.db` (task + stage status, used for crash recovery)
  - GitHub (Issue/PR comments, labels — the source of truth for "what has the user said")
  - The git repo itself (commits, branch state)

### 3.2 Git isolation

Each task gets its own git worktree under `<repo>/../.adt-worktrees/issue-<n>/` with branch `adt/issue-<n>-<slug>`. Worktrees are created on first stage execution and removed when the task is fully merged and cleaned up.

## 4. Components

The TypeScript codebase contains only OS-level and infrastructure logic. All orchestration logic lives in the `agent-dev-team` skill.

| File | Responsibility |
|---|---|
| `src/cli.ts` | commander entry. Subcommands: `setup`, `run`, `status`, `clean`, `pause`, `resume` |
| `src/worker.ts` | Single-stage orchestration: pick task → prep context → spawn cc-mm → parse result → update store + GitHub |
| `src/store.ts` | SQLite wrapper over `better-sqlite3`. Schema for tasks + events. |
| `src/github.ts` | Octokit wrapper: list issues by label, read comments, post comments, set/clear labels, get PR status |
| `src/worktree.ts` | `simple-git` wrapper: `worktree add`, `worktree remove`, `worktree prune` |
| `src/claude-code.ts` | `spawn('cc-mm', [...])` wrapper. Builds the prompt file, invokes cc-mm with `--prompt-file`, `--output-format json`, parses result. |
| `src/labels.ts` | Constants + state-machine table mapping (stage, status) → label set |
| `src/lock.ts` | POSIX `flock` wrapper around `~/.adt/lock` |
| `src/result.ts` | zod schemas for `.adt/<stage>-result.json` |

There are **no** `src/roles/*.ts` files. Roles are defined inside the skill (a markdown document), not in TS.

## 5. Data flow — one worker run

```
adt run (cron triggers)
│
├─ flock(.adt/lock) → on fail: exit 0
│
├─ store.listReady() → [
│     { issue: 42, repo: "x/y", stage: "reqs", status: "pending" },
│     { issue: 37, repo: "x/y", stage: "impl", status: "pending" },
│   ]
│  → pick: oldest task with status="pending" (FIFO by issue.createdAt, ties broken
│    by stage order: reqs > design > impl > review so an in-flight pipeline makes progress)
│
├─ store.markRunning(taskId)
│
├─ worktree.ensure(taskId, repo, branchName)
│     → git worktree add if missing
│
├─ Prepare context files in worktree/.adt/:
│     - issue.json       (Issue body + metadata)
│     - comments.json    (all Issue/PR comments)
│     - branch.txt       (current branch name)
│     - stage.txt        (current stage name)
│
├─ claude-code.spawn({
│     cwd: worktreePath,
│     promptFile: worktree/.adt/prompt.md,
│     outputFormat: "json",
│     maxDuration: roleDuration[currentStage],
│     allowedTools: roleAllowedTools[currentStage],
│   })
│
├─ cc-mm runs:
│     - loads ~/.claude/skills/agent-dev-team (SKILL.md)
│     - reads prompt.md (system + user instructions for this stage)
│     - executes stage logic (reads issue, writes result.json, etc.)
│     - exits with code 0 (or non-zero on error)
│
├─ Read worktree/.adt/<stage>-result.json
│
├─ Switch on result.status:
│     ├─ "waiting-user"  → post comment, set label adt:<stage>-waiting, store stays running
│     ├─ "done"          → post summary comment, advance to next stage label, mark stage done
│     ├─ "blocked"       → post error comment, set label adt:blocked, mark stage failed
│     └─ parse error     → retry once, else → blocked
│
├─ store.markFinished(taskId, newStatus)
│
└─ flock release, exit 0
```

## 6. Lifecycle / State machine

| Current stage | User action that advances | Next stage | User intervention point |
|---|---|---|---|
| `reqs` (PM) | User replies to PM's questions on Issue | `design` (Dev) | ✅ Yes — must answer questions |
| `design` (Dev) | User posts an Issue/PR comment whose body matches `^/adt-approve(\s.*)?$` (case-insensitive) | `impl` (Dev) | ✅ Yes — must approve design |
| `impl` (Dev) | cc-mm finishes implementation + tests | `review` (Reviewer) | ❌ No — autonomous |
| `review` (Reviewer) | User merges PR on GitHub | (task done) | ✅ Yes — must click merge |

When `adt run` finds a task whose PR is already merged → cleanup: remove all `adt:*` labels, remove worktree, mark task `done`.

### 6.1 Labels

| Label | Meaning |
|---|---|
| `adt:ready` | User has marked this Issue as ready for the team |
| `adt:reqs-running` | PM is working on requirements |
| `adt:reqs-waiting` | PM has posted questions, waiting for user |
| `adt:design-running` | Dev is writing design |
| `adt:design-waiting` | Dev has posted design, waiting for user approval |
| `adt:impl-running` | Dev is implementing |
| `adt:review-running` | Reviewer is preparing PR |
| `adt:merge-ready` | PR is open, waiting for user to merge |
| `adt:blocked` | Team is stuck; needs manual intervention |

At any time, exactly one of the `adt:<stage>-*` labels is present (or `adt:blocked`).

## 7. The `agent-dev-team` skill

The skill lives at `~/.claude/skills/agent-dev-team/SKILL.md`. Frontmatter:

```yaml
---
name: agent-dev-team
description: Implements a GitHub Issue by walking through 4 stages (requirements, design, implementation, review). Each invocation handles exactly one stage and writes its outcome to .adt/<stage>-result.json. Driven by `adt run`.
---
```

The SKILL.md body defines:
- The 4 stages with their goals, inputs, allowed actions, expected outputs.
- How to read context files (`.adt/issue.json`, `.adt/comments.json`, `.adt/stage.txt`).
- The exact schema for `.adt/<stage>-result.json` (matches the zod schema in `src/result.ts`).
- The "waiting-user" vs "done" vs "blocked" decision rules.
- How to post GitHub comments and switch labels via the `gh` CLI (using `GH_TOKEN` env var passed by the TS worker — not Octokit, because cc-mm runs sandboxed and we don't want to bundle the Octokit library inside the skill prompt context).

**GitHub access split**: the TS worker uses Octokit for issue listing, comment fetching, and label management outside of `cc-mm`. Inside `cc-mm`, the skill uses `gh` CLI (already authenticated via env var). This keeps the skill prompt minimal and avoids teaching the LLM Octokit's API surface.

### 7.1 Result schema

Every stage writes `.adt/<stage>-result.json` matching this zod schema (also enforced by `src/result.ts`):

```ts
const StageResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("waiting-user"),
    summary: z.string(),                       // shown to user in comment
    artifacts: z.record(z.string()).optional(), // e.g. { designPath: "docs/designs/42.md" }
  }),
  z.object({
    status: z.literal("done"),
    summary: z.string(),
    artifacts: z.record(z.string()).optional(),
  }),
  z.object({
    status: z.literal("blocked"),
    reason: z.string(),
    details: z.string().optional(),
  }),
]);
```

Worker behavior on each variant:
- `waiting-user` → set label `adt:<stage>-waiting`, post `summary` as Issue comment
- `done` → set label `adt:<next-stage>-running` (or `adt:merge-ready` if stage=review), post `summary` as Issue/PR comment, advance store
- `blocked` → set label `adt:blocked`, post `reason` + `details` as Issue comment

The skill is the **only place** where stage-level decision logic lives. The TS worker is dumb — it just passes inputs and outputs.

## 8. Error handling

| Failure | Detection | Response |
|---|---|---|
| `cc-mm` timeout | wall-clock exceeds `maxDuration` | SIGTERM → 30s grace → SIGKILL. Mark stage `failed`. Post last stdout + timeout msg as Issue comment. Label `adt:blocked`. |
| `cc-mm` non-zero exit | child exit code | Mark stage `failed`. Post stderr tail as Issue comment. Label `adt:blocked`. |
| Result JSON parse error | zod validation fails | Retry once with augmented prompt ("Re-emit valid JSON"). Still fails → label `adt:blocked`. |
| GitHub API 401 | Octokit throws on auth | Stop worker. CLI prints message instructing user to re-run `adt setup`. |
| GitHub API 5xx | Octokit throws | Exponential backoff 3×. Still fails → mark stage `failed`, `adt:blocked`. |
| Worktree creation fails | git exit code | Don't create task record. Surface error in CLI. |
| Stale worktree on disk | `git worktree list` mismatch | `git worktree prune` on next `adt run` start. |
| Task stuck in `running` > 2× maxDuration | store timestamp check | Mark `failed` (assume prior worker died). Next worker can pick up. |
| User closes Issue / comments "cancel" | GitHub polling | Next worker detects → mark task `cancelled`, remove worktree. |

## 9. Testing

- **Unit (Vitest)**:
  - `store.ts`: CRUD + state transitions
  - `labels.ts`: state machine table correctness
  - `claude-code.ts`: spawn wrapper (mocked `child_process.spawn`)
  - `result.ts`: zod schema validation
  - `lock.ts`: flock acquire/release semantics
- **Integration**:
  - Fixture GitHub repo (test double via nock or local Octokit mock)
  - Fixture `cc-mm` binary (bash script that emits canned `result.json`)
  - Walk full 4-stage happy path
  - Failure injection: timeout, malformed JSON, GitHub 5xx, worktree conflict
- **Manual smoke**:
  - Real fork of a sandbox repo
  - 3 canonical Issues: small bug, small feature, large feature
  - End-to-end with real `cc-mm` and real GitHub

## 10. Tech stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **GitHub**: `@octokit/rest`
- **State**: `better-sqlite3`
- **Git**: `simple-git`
- **LLM**: `cc-mm` (external binary) — invoked via `child_process.spawn`
- **Validation**: `zod`
- **CLI**: `commander`
- **Tests**: `vitest`
- **Lint/format**: `biome`
- **Packaging**: `tsc` → `dist/`; install via `npm link` or published to npm

## 11. File structure

```
agent-dev-team/
├── package.json
├── tsconfig.json
├── biome.json
├── README.md
├── .gitignore
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-07-01-agent-dev-team-design.md
├── src/
│   ├── cli.ts
│   ├── worker.ts
│   ├── store.ts
│   ├── github.ts
│   ├── worktree.ts
│   ├── claude-code.ts
│   ├── labels.ts
│   ├── lock.ts
│   └── result.ts
├── tests/
│   ├── unit/
│   │   ├── store.test.ts
│   │   ├── labels.test.ts
│   │   ├── claude-code.test.ts
│   │   └── result.test.ts
│   └── integration/
│       └── e2e.test.ts
└── fixtures/
    ├── fake-cc-mm.sh
    └── sample-issue.json
```

The `agent-dev-team` skill is installed at `~/.claude/skills/agent-dev-team/SKILL.md` (out of repo, lives alongside the user's other Claude Code skills). It is not part of this repo's source tree.

## 12. Setup / first-run UX

```bash
# 1. Install
npm install -g agent-dev-team
# or: git clone + npm link

# 2. One-time setup
adt setup
# prompts for:
#   - GitHub PAT (with repo scope)
#   - Repos to watch: a list of "owner/repo" (one or more — see ADR 0008)
#   - Path to cc-mm binary (default: which cc-mm)
# writes ~/.adt/config.json
# add/remove repos later via:
#   adt setup --add owner/repo
#   adt setup --remove owner/repo

# 3. Schedule periodic runs
# user adds ONE of:
#   - cron:  */1 * * * *  adt run >> ~/.adt/log 2>&1
#   - systemd timer
#   - launchd plist
#   - tmux session with: while true; do adt run; sleep 60; done

# 4. (Optional) Inspect state
adt status
# shows all tasks grouped by repo, current stage, last activity

# 5. (Optional) Pause/resume a specific task
adt pause <owner/repo>#<n>
adt resume <owner/repo>#<n>
```

## 13. Out of scope (v1)

- GitHub App / webhook support (PAT + polling only)
- Subagent delegation (Reviewer is single-process)
- Cost / token tracking (rely on cc-mm's own accounting)
- Web dashboard / CLI TUI (status is plain text)
- Composing with `grill-with-docs` / `domain-modeling` skills
- Team-level parallelism (serial only)

## 14. Architectural decision records

Decisions made during brainstorming are recorded as ADRs under `docs/adr/`:

| ADR | Title |
|---|---|
| 0001 | Skip waiting-user tasks; keep worktree until merge |
| 0002 | Trust cc-mm's built-in sandboxing |
| 0003 | Approval signal: `/adt-approve` comment OR PR Approve event |
| 0004 | Cancellation preserves all stage artifacts (covers `/adt-cancel`, Issue close, PR close without merge) |
| 0005 | Worker leaves cc-mm running on crash; stages are not idempotent |
| 0006 | Stage timeouts and graceful kill |
| 0007 | Branch conflicts block the task; user handles manually |
| 0008 | Multi-repo support in v1; setup configures repo list |

## 15. Open questions for the implementation plan

- Should `adt run` log to stdout, syslog, or `~/.adt/log`?
- Exact format of `prompt.md` — templated from stage + context, or hand-written per stage?
- Should `adt setup` validate the PAT immediately by listing the repo?
- Cron default interval: 60s? configurable?
- When the user types `/adt-pause 42` as an Issue comment, does the worker detect that on next run?