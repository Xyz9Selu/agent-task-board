/**
 * Returns today's local-time date in `YYYY-MM-DD` form.
 *
 * Mirrors `todayLocal` in `src/habits.ts` (the CLI module) so the page and the
 * CLI agree on "today" for a given user. A `now` parameter is accepted for
 * tests and for the `setInterval` tick inside the hook.
 */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Adds `days` calendar days to a `YYYY-MM-DD` string and returns the result
 * in the same format. Walks by local calendar day (via `Date.setDate`) so
 * DST spring-forward / fall-back days are handled correctly.
 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayLocal(d);
}