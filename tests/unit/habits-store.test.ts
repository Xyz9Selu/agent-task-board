import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addHabit,
  EmptyHabitNameError,
  HABITS_STORAGE_KEY,
  HabitError,
  loadHabits,
  markHabitDone,
  listHabits,
  removeHabit,
  saveHabits,
  StorageError,
  UnknownHabitError,
  type HabitsFile,
} from "../../src/habits/store.js";

/**
 * In-memory `Storage` shim that mirrors the subset of `localStorage` used by
 * the store. Keeps the test suite independent of jsdom.
 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

// Fixed "now" used by date-sensitive tests (mid-day, local-time-friendly).
const fixedNow = () => new Date(2026, 6, 2, 13, 0, 0); // 2026-07-02
const fixedToday = "2026-07-02";

let storage: Storage;

beforeEach(() => {
  storage = createMemoryStorage();
});

afterEach(() => {
  storage.clear();
});

describe("loadHabits / saveHabits", () => {
  it("returns { habits: [] } when storage is empty", () => {
    expect(loadHabits(storage)).toEqual({ habits: [] });
  });

  it("returns { habits: [] } when the value is an empty string", () => {
    storage.setItem(HABITS_STORAGE_KEY, "");
    expect(loadHabits(storage)).toEqual({ habits: [] });
  });

  it("returns { habits: [] } when the value is malformed JSON", () => {
    storage.setItem(HABITS_STORAGE_KEY, "not-json{");
    expect(loadHabits(storage)).toEqual({ habits: [] });
  });

  it("returns { habits: [] } when the JSON shape is wrong", () => {
    storage.setItem(HABITS_STORAGE_KEY, JSON.stringify({ not: "habits" }));
    expect(loadHabits(storage)).toEqual({ habits: [] });
  });

  it("round-trips through saveHabits → loadHabits", () => {
    const file: HabitsFile = {
      habits: [
        {
          name: "read",
          createdAt: "2026-07-01T00:00:00.000Z",
          completions: ["2026-07-01", "2026-07-02"],
        },
      ],
    };
    saveHabits(file, storage);
    expect(loadHabits(storage)).toEqual(file);
  });

  it("wraps setItem errors as StorageError", () => {
    const broken: Storage = {
      ...storage,
      setItem() {
        const e = new Error("quota exceeded");
        throw e;
      },
    };
    expect(() => saveHabits({ habits: [] }, broken)).toThrow(StorageError);
  });
});

describe("addHabit", () => {
  it("creates a habit with empty completions and persists", () => {
    const h = addHabit("exercise", storage, fixedNow);
    expect(h.name).toBe("exercise");
    expect(h.completions).toEqual([]);
    expect(h.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(loadHabits(storage).habits).toHaveLength(1);
  });

  it("is idempotent — re-adding returns the same habit and preserves createdAt", () => {
    const first = addHabit("read", storage, fixedNow);
    const second = addHabit("read", storage, fixedNow);
    expect(second.name).toBe(first.name);
    expect(second.createdAt).toBe(first.createdAt);
    expect(loadHabits(storage).habits).toHaveLength(1);
  });

  it("trims whitespace", () => {
    const h = addHabit("  meditate  ", storage, fixedNow);
    expect(h.name).toBe("meditate");
  });

  it("throws EmptyHabitNameError on empty / whitespace name", () => {
    expect(() => addHabit("", storage, fixedNow)).toThrow(EmptyHabitNameError);
    expect(() => addHabit("   ", storage, fixedNow)).toThrow(
      EmptyHabitNameError,
    );
  });

  it("sorts habits by name (case-insensitive) after add", () => {
    addHabit("zebra", storage, fixedNow);
    addHabit("Apple", storage, fixedNow);
    addHabit("mango", storage, fixedNow);
    const names = loadHabits(storage).habits.map((h: { name: string }) => h.name);
    expect(names).toEqual(["Apple", "mango", "zebra"]);
  });

  it("is case-sensitive on dedupe — Exercise and exercise coexist", () => {
    addHabit("Exercise", storage, fixedNow);
    addHabit("exercise", storage, fixedNow);
    expect(loadHabits(storage).habits).toHaveLength(2);
  });
});

describe("markHabitDone", () => {
  it("appends today's local date to completions", () => {
    addHabit("read", storage, fixedNow);
    const h = markHabitDone("read", storage, fixedNow);
    expect(h.completions).toEqual([fixedToday]);
    expect(loadHabits(storage).habits[0].completions).toEqual([fixedToday]);
  });

  it("is idempotent same-day", () => {
    addHabit("read", storage, fixedNow);
    markHabitDone("read", storage, fixedNow);
    markHabitDone("read", storage, fixedNow);
    expect(loadHabits(storage).habits[0].completions).toEqual([fixedToday]);
  });

  it("appends a second entry when called on a different day", () => {
    addHabit("read", storage, fixedNow);
    markHabitDone("read", storage, () => new Date(2026, 6, 1, 9, 0, 0));
    markHabitDone("read", storage, fixedNow);
    expect(loadHabits(storage).habits[0].completions).toEqual([
      "2026-07-01",
      "2026-07-02",
    ]);
  });

  it("throws UnknownHabitError when the habit is not registered", () => {
    expect(() => markHabitDone("ghost", storage, fixedNow)).toThrow(
      UnknownHabitError,
    );
    try {
      markHabitDone("ghost", storage, fixedNow);
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownHabitError);
      expect(e).toBeInstanceOf(HabitError);
      const err = e as UnknownHabitError;
      expect(err.habitName).toBe("ghost");
      expect(err.message).toContain("ghost");
    }
  });

  it("throws EmptyHabitNameError on empty name", () => {
    expect(() => markHabitDone("", storage, fixedNow)).toThrow(
      EmptyHabitNameError,
    );
  });
});

describe("removeHabit", () => {
  it("removes the habit and its completions", () => {
    addHabit("read", storage, fixedNow);
    markHabitDone("read", storage, fixedNow);
    removeHabit("read", storage);
    expect(loadHabits(storage).habits).toEqual([]);
  });

  it("is a no-op when the habit does not exist", () => {
    addHabit("read", storage, fixedNow);
    removeHabit("ghost", storage);
    expect(loadHabits(storage).habits).toHaveLength(1);
  });

  it("trims whitespace before matching", () => {
    addHabit("read", storage, fixedNow);
    removeHabit("  read  ", storage);
    expect(loadHabits(storage).habits).toEqual([]);
  });
});

describe("listHabits", () => {
  it("returns doneToday=false and streak=0 for fresh habits", () => {
    addHabit("read", storage, fixedNow);
    addHabit("exercise", storage, fixedNow);
    const rows = listHabits(storage, fixedNow);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.doneToday).toBe(false);
      expect(r.streak).toBe(0);
    }
  });

  it("reflects doneToday=true after marking a habit done", () => {
    addHabit("read", storage, fixedNow);
    addHabit("exercise", storage, fixedNow);
    markHabitDone("read", storage, fixedNow);
    const rows = listHabits(storage, fixedNow);
    const byName = new Map(rows.map((r: { habit: { name: string } }) => [r.habit.name, r]));
    expect(byName.get("read")?.doneToday).toBe(true);
    expect(byName.get("read")?.streak).toBe(1);
    expect(byName.get("exercise")?.doneToday).toBe(false);
    expect(byName.get("exercise")?.streak).toBe(0);
  });

  it("returns [] when the store is empty", () => {
    expect(listHabits(storage, fixedNow)).toEqual([]);
  });
});

describe("corruption tolerance", () => {
  it("corrupt JSON loads as empty and a subsequent add re-creates the file", () => {
    storage.setItem(HABITS_STORAGE_KEY, "{not json");
    expect(loadHabits(storage).habits).toEqual([]);
    addHabit("read", storage, fixedNow);
    expect(loadHabits(storage).habits).toHaveLength(1);
  });
});