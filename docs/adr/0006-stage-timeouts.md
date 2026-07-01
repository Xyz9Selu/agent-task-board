# 0006 — Stage timeouts and graceful kill

Default per-stage `maxDuration` (wall clock from worker spawn to child exit):

| Stage | maxDuration |
|---|---|
| reqs (PM) | 10 minutes |
| design (Dev) | 20 minutes |
| impl (Dev) | 60 minutes |
| review (Reviewer) | 30 minutes |

When the timer expires:
1. Worker sends `SIGTERM` to the `cc-mm` child.
2. After a 30-second grace period, worker sends `SIGKILL`.
3. Whatever artifacts `cc-mm` produced (partial comments, partial commits, partial `.adt/result.json`) stay on disk and on GitHub.
4. The stage is marked `failed` in the store; the Issue is labelled `adt:blocked` with a comment noting the timeout and pointing to the partial output.

Values are configurable via `~/.adt/config.json` (`stageTimeouts` field). Defaults above are generous because cc-mm work tends to spike on first call and settle down on subsequent calls; better to over-budget than to spuriously kill productive runs.