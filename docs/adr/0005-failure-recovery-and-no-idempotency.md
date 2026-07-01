# 0005 — Worker leaves cc-mm running on crash; stages are not idempotent

When the TS worker process crashes mid-stage:
- The SQLite store still has `status="running"` and the worker's PID.
- `cc-mm` may still be executing (orphaned child process).
- On the next `adt run`, the new worker detects `status="running"` and an elapsed time exceeding 2× the stage's `maxDuration`. It resets `status` to `pending` and proceeds.
- The orphaned `cc-mm` process is **not** explicitly killed by `adt` — it runs to completion (or natural timeout) and its writes to `.adt/result.json` may overlap with the re-run. Whichever finishes last wins.

We considered active orphan reaping (worker kills any `cc-mm` from a previous crashed worker before starting its own). Rejected because cross-process process tracking on a local machine is fragile and adds little value — the new `cc-mm`'s result.json overwrites the old one, and any commits or comments posted by the orphan are visible on GitHub for the user to inspect.

## Stage idempotency

Stages are **not** guaranteed idempotent. Re-running a stage (e.g., after a failure, or after the user re-labels an Issue) may produce duplicate comments on the Issue, duplicate commits on the branch, or duplicate pushes. The user accepts this trade-off because designing idempotent stages (comment de-dup by hash, commit de-dup by content fingerprint) would significantly increase code complexity for a recovery path that is rare.

When the worker re-runs a stage, it does not check whether the stage previously completed. It runs the stage as if for the first time, starting from the existing worktree state (commits, files) preserved from prior runs.