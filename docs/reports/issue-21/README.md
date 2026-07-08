# Review Report — Issue #21: `adt doctor` config validation

> Stage: **review** for `Xyz9Selu/agent-task-board#21`
> Branch: `adt/issue-21-add-an-adt-doctor-command-for-config-validation`
> Reviewer: agent-dev-team review stage

## Project type note

The `agent-dev-team` review template is written for a web project with Playwright + full-page screenshots. `agent-task-board` is a **Node.js CLI** (`commander` + `@octokit/rest`, no `npm run dev`, no port 5173, no browser surface), so the Playwright section does not apply. The review below adapts the same goals — verify behavior, document findings, and gate the PR — to the project's actual form factor.

## 1. What was verified

### 1.1 Unit / component tests

`npm test` (Vitest, 11 test files):

```
 Test Files  11 passed (11)
      Tests  119 passed (119)
   Duration  4.78s
```

- All 35 new tests in `tests/unit/doctor.test.ts` pass, covering every check (`config`, `token`, `repos`, `ccMm`, `labels`) and the runner's exit-code logic.
- No pre-existing tests regressed.
- Total runtime 4.78 s — under the 5 s acceptance budget for `doctor` itself, with headroom for the full suite.

### 1.2 End-to-end CLI smoke runs

The `adt doctor` command was exercised against four real on-disk configs in addition to the unit tests:

| Scenario | ADT_DIR | Expected behavior | Observed | Exit |
|----------|---------|-------------------|----------|------|
| No config | `/tmp/empty-adt` (missing file) | `config ✗`, `token ✓` (env), `repos ✗` (no config), `ccMm ✓`, `labels ✗` (no config); overall `1` | Matches | `1` |
| Malformed JSON | `/tmp/adt-malformed/config.json` = `not valid json {{{` | `config ✗` with parse-error message; other checks still run | Matches | `1` |
| Missing `githubToken` field | `/tmp/adt-missing-token/config.json` (no token field) | `config ✗` "missing required field: githubToken" | Matches | `1` |
| Full config + env token | `/tmp/adt-test-config/config.json` + `GITHUB_TOKEN=…` | `config ✓`; token/repos/labels hit GitHub (401 against a dummy token, but the path is exercised) | Matches | `1` |

Sample output (no-config run, exactly as printed by the CLI):

```
✗ config  no config at /tmp/empty-adt/config.json — run `adt setup`
✓ token   ok
✗ repos   no config — skipping repo check
✓ ccMm    ok
✗ labels  no config — skipping label check

Some checks failed. See above.
```

Sample output (real-config run, hitting GitHub with a dummy token):

```
✓ config  ok
✗ token   token rejected by GitHub (401) — token may be expired or missing scopes
✗ repos   1 of 1 repos unreachable
    ✗ Xyz9Selu/agent-task-board — GitHub error: 401 Bad credentials
✓ ccMm    ok
✗ labels  could not fetch labels from any repo
    ✗ Xyz9Selu/agent-task-board: could not fetch labels
```

Both match the design: padded columns, `✓`/`✗` Unicode marks, no ANSI color, per-repo sub-lines indented by 4 spaces, final summary line, exit code matches overall result.

### 1.3 Diff review vs `origin/main`

```
 docs/designs/21.md        | 237 ++++++++++++++++++++++++
 docs/user-manual.md       |  19 ++
 src/cli.ts                |   8 +
 src/config.ts             |  51 +++++-
 src/doctor.ts             | 284 +++++++++++++++++++++++++++++
 src/worker.ts             |  26 +--
 tests/unit/doctor.test.ts | 447 ++++++++++++++++++++++++++++++++++++++++++++++
 7 files changed, 1058 insertions(+), 14 deletions(-)
```

**Design compliance — walked through every §3–§5 decision in `docs/designs/21.md`:**

| Design decision | Status | Evidence |
|-----------------|--------|----------|
| `doctor` registered in `src/cli.ts` between `resume` and `habit` | ✅ | `src/cli.ts:150-155` |
| `checkConfig` returns the four documented failure modes | ✅ | `src/doctor.ts:29-61` — missing file, read error, JSON parse error, missing `githubToken`/`repos[]` |
| `checkToken` uses `resolveToken`, `GET /user`, 4 s timeout, 401 has its own message | ✅ | `src/doctor.ts:65-90`, `src/doctor.ts:8-16` (`withTimeout`) |
| `checkRepos` fans out via `Promise.all`; per-repo sub-line; 404/403 distinguished | ✅ | `src/doctor.ts:94-135` |
| `checkCcMm` PATH-resolves bare names via `which` (2 s timeout); checks exec bit (0o111) for explicit paths | ✅ | `src/doctor.ts:139-186` |
| `checkLabels` uses `ALL_ADT_LABELS` from `src/labels.ts`; any-one-repo pass rule | ✅ | `src/doctor.ts:5` (import), `src/doctor.ts:190-246` |
| Runner prints table + final summary line; returns 0/1 | ✅ | `src/doctor.ts:264-277` |
| `Config` interface unchanged; `loadConfig` behavior preserved | ✅ | `src/config.ts:12-35` untouched; `resolveToken`/`tryReadConfig` added alongside |
| `worker.ts` uses `resolveToken` everywhere it used `config.githubToken` | ✅ | 10 call-sites updated: `src/worker.ts:125, 191, 200, 213, 229, 241, 251, 273, 289, 316, 345` |
| Read-only — no `writeFileSync`, no `postComment`, no DB writes | ✅ | `src/doctor.ts` only uses `fs.readFileSync`, `fs.existsSync`, `fs.statSync`, `execFile('which', …)`, and Octokit `GET` endpoints |
| User-manual section present | ✅ | `docs/user-manual.md:260-277` (new `## adt doctor` block) and row in the commands table |

**Findings (none blocking):**

1. **`tryReadConfig` mutates the parsed `r` object** — `src/config.ts:67-70` writes `r.ccMmPath = 'cc-mm'` on the raw object when the field is not a string. Functionally correct (the local mutation is harmless because `r` isn't used elsewhere) but stylistically muddled: a non-string `ccMmPath` (e.g. `42`) is silently coerced rather than reported as a config error, even though the same module would treat a non-string `githubToken` as a hard error. Low-priority; flagged for a follow-up cleanup, not for this PR.
2. **`checkLabels` all-errored path** — when every repo's label fetch fails, the aggregate message says "could not fetch labels from any repo" and returns `ok: false`. That is the right call (Q7 — network errors count as failures) but it can look identical to a 404; in practice the per-repo `✗ repo: could not fetch labels` sub-line is informative enough. No change recommended.
3. **`tokenSource()` is exported but unused** — `src/config.ts:45-49` defines a helper that returns which env var won; nothing in `doctor.ts` or `worker.ts` calls it. It is harmless and plausibly useful for future debugging, but if we want a tight PR it could be dropped. Not blocking.

## 2. Acceptance criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `adt doctor` runs in <5 s for a typical setup | ✅ | Test suite 4.78 s; per-check timeouts (4 s token, 4 s repo, 4 s labels, 2 s `which`) + `Promise.all` parallelism |
| Each check prints a clear ✓/✗ line plus a one-line explanation on failure | ✅ | `src/doctor.ts:266-272` |
| Exit code matches overall pass/fail state | ✅ | `src/doctor.ts:277` returns 0/1; `src/cli.ts:153` `process.exit`s it |
| All output is human-readable (no JSON dumps) | ✅ | Only `console.log`; no `JSON.stringify` in `src/doctor.ts` |
| Read-only — no filesystem or GitHub mutations | ✅ | See "Read-only" row in the design-compliance table above |

## 3. Verdict

**APPROVE — ready to merge.**

- All 119 unit tests pass.
- Live CLI smoke runs against four config shapes behave as the design specifies.
- The implementation matches the approved design point-for-point.
- Two cosmetic follow-ups noted (`tryReadConfig` mutation, unused `tokenSource`) but neither is a blocker for this PR.

The PR is opened against `main` and links to issue #21.
