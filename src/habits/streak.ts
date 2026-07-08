import { addDays, todayLocal } from "./today.js";

/**
 * Current streak ending `today`: consecutive daily completions counting back
 * from `today`. Returns `0` if `today` is not in `completions` (per the
 * decision in `docs/designs/17.md` §3 — no grace day).
 *
 * Preconditions: `completions` is sorted ascending and contains no
 * duplicates. `markHabitDone` enforces both, so callers can rely on it.
 *
 * The loop walks by local calendar day via `addDays` (which uses
 * `Date.setDate`), so DST spring-forward / fall-back days are handled
 * correctly without manual ms arithmetic.
 */
export function computeStreak(completions: string[], today: string): number {
  if (!completions.includes(today)) return 0;

  const set = new Set(completions);
  let streak = 0;
  let cursor = today;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Pure variant of `todayLocal` re-exported so `streak.ts` is self-contained
 * for callers that only need the streak helper.
 */
export { todayLocal };