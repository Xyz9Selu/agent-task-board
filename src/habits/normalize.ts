/**
 * Trims surrounding whitespace from a habit name. Case is preserved — the
 * store performs case-sensitive dedupe so `Exercise` and `exercise` are
 * distinct habits.
 */
export function normalizeName(name: string): string {
  return name.trim();
}

/**
 * Returns `true` if `name` is empty after normalization. Empty / whitespace-
 * only names are rejected at the API boundary with `EmptyHabitNameError`.
 */
export function isEmptyName(name: string): boolean {
  return normalizeName(name) === "";
}