# Task 9 Review Fix Report

## Changes

### 1. [BUG/Medium] SIGKILL escalation dead code — `src/claude-code.ts`

Removed the `!child.killed` guard from the inner `setTimeout` in `spawnCcMm`.
`child.kill("SIGTERM")` on the line above sets `child.killed = true`, making the
guard always evaluate `false`, so SIGKILL was never actually sent. Now
`child.kill("SIGKILL")` is called unconditionally in the grace-period timeout.

### 2. [Low] Dangling inner timer — `src/claude-code.ts`

Stored the inner `setTimeout` (30 s grace period before SIGKILL) in a
`killTimer` variable. Both `clearTimeout(timer)` and `clearTimeout(killTimer)`
are now called in the `close` and `error` handlers, preventing a dangling timer
if the child exits or fails to spawn during the grace window.

### 3. [Low] Misleading comment — `src/claude-code.ts`

Rewrote `// Retry: the output is in stdout, try parsing that` to
`// Include stdout tail in error for debugging` — the code never actually
retried; it just included stdout in the error message.

### 4. [Low] Missing branch.txt assertion — `tests/unit/claude-code.test.ts`

Added `expect(fs.existsSync(...branch.txt))` and `expect(branchTxt).toBe("adt/issue-42-auto")`
to the `buildPromptFile` test to cover the context file that was being written
but not verified.

## Testing

All existing tests pass (2/2).
