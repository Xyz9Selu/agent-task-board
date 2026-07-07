import { useCallback, useEffect, useState } from "react";
import {
  addHabit as addHabitStore,
  listHabits as listHabitsStore,
  markHabitDone as markHabitDoneStore,
  removeHabit as removeHabitStore,
} from "../habits/store.js";
import type { HabitRow } from "../habits/store.js";

/**
 * React state hook for the habits store.
 *
 * - Hydrates from `localStorage` on mount.
 * - Re-reads from the store after every mutation so the in-memory copy is
 *   always canonical (the store re-sorts on add, etc.).
 * - Bumps a `version` every minute so a long-open tab crosses midnight
 *   without a reload — `doneToday` and `streak` re-derive against the new
 *   "today". The interval is cleared on unmount.
 *
 * The hook is the only place that calls `loadHabits` from React; the pure
 * store stays unit-testable without `renderHook`.
 */
export function useHabits() {
  const [version, setVersion] = useState(0);

  // Re-read the store on every change. Cheap (one JSON.parse), correct,
  // and keeps the hook resilient to cross-tab writes from the same
  // browser — though in v1 we don't actively listen for the `storage`
  // event, the next mutation refresh picks up changes.
  const rows: HabitRow[] = listHabitsStore();

  // Refresh "today" once a minute so a tab left open across midnight
  // updates without a manual reload. Cheap (<10 habits); cleared on
  // unmount.
  useEffect(() => {
    const id = window.setInterval(() => setVersion((v) => v + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // `version` is read by the line above in the next render — bumping it
  // here would be redundant, but referencing it ensures the dep array
  // captures the dependency intentionally.
  void version;

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const add = useCallback(
    (name: string) => {
      addHabitStore(name);
      refresh();
    },
    [refresh],
  );

  const done = useCallback(
    (name: string) => {
      markHabitDoneStore(name);
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    (name: string) => {
      removeHabitStore(name);
      refresh();
    },
    [refresh],
  );

  return { rows, add, done, remove };
}