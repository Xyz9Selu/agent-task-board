import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Per-test tmp ADT_DIR so each suite starts clean.
const testDir = path.join("/tmp", `adt-habits-test-${process.pid}-${Date.now()}`);
const habitsFilePath = path.join(testDir, "habits.json");
process.env.ADT_DIR = testDir;

// Dynamic import so ADT_DIR is read at module-load time.
const habitsModule = await import("../../src/habits.js");
const {
  addHabit,
  markHabitDone,
  listHabitsForToday,
  loadHabits,
  saveHabits,
  todayLocal,
  normalizeName,
  EmptyHabitNameError,
  UnknownHabitError,
} = habitsModule;

// Fixed "now" used by date-sensitive tests (mid-day UTC+local-friendly).
const fixedNow = new Date(2026, 6, 2, 13, 0, 0); // 2026-07-02 13:00 local

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("todayLocal", () => {
  it("returns YYYY-MM-DD in local time", () => {
    expect(todayLocal(fixedNow)).toBe("2026-07-02");
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date(2026, 0, 5, 9, 0, 0); // Jan 5
    expect(todayLocal(d)).toBe("2026-01-05");
  });
});

describe("normalizeName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeName("  read  ")).toBe("read");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeName("   ")).toBe("");
  });
});

describe("addHabit", () => {
  it("creates a habit and persists to disk", () => {
    const h = addHabit("exercise", habitsFilePath);
    expect(h.name).toBe("exercise");
    expect(h.completions).toEqual([]);
    expect(h.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const onDisk = JSON.parse(fs.readFileSync(habitsFilePath, "utf-8"));
    expect(onDisk.habits).toHaveLength(1);
    expect(onDisk.habits[0].name).toBe("exercise");
  });

  it("is idempotent — re-adding returns the same habit and preserves createdAt", async () => {
    const first = addHabit("read", habitsFilePath);
    // Tiny pause so any accidental re-write would have a new timestamp.
    await new Promise((r) => setTimeout(r, 5));
    const second = addHabit("read", habitsFilePath);
    expect(second.name).toBe(first.name);
    expect(second.createdAt).toBe(first.createdAt);

    const file = loadHabits(habitsFilePath);
    expect(file.habits).toHaveLength(1);
  });

  it("trims whitespace from the name", () => {
    const h = addHabit("  meditate  ", habitsFilePath);
    expect(h.name).toBe("meditate");
  });

  it("throws EmptyHabitNameError on empty / whitespace name", () => {
    expect(() => addHabit("", habitsFilePath)).toThrow(EmptyHabitNameError);
    expect(() => addHabit("   ", habitsFilePath)).toThrow(EmptyHabitNameError);
  });

  it("sorts habits by name (case-insensitive) after add", () => {
    addHabit("zebra", habitsFilePath);
    addHabit("Apple", habitsFilePath);
    addHabit("mango", habitsFilePath);
    const file = loadHabits(habitsFilePath);
    expect(file.habits.map((h) => h.name)).toEqual(["Apple", "mango", "zebra"]);
  });
});

describe("markHabitDone", () => {
  it("appends today's local date to completions", () => {
    addHabit("read", habitsFilePath);
    const h = markHabitDone("read", habitsFilePath, fixedNow);
    expect(h.completions).toEqual(["2026-07-02"]);

    const file = loadHabits(habitsFilePath);
    expect(file.habits[0].completions).toEqual(["2026-07-02"]);
  });

  it("is idempotent same-day — calling twice adds a single entry", () => {
    addHabit("read", habitsFilePath);
    markHabitDone("read", habitsFilePath, fixedNow);
    markHabitDone("read", habitsFilePath, fixedNow);

    const file = loadHabits(habitsFilePath);
    expect(file.habits[0].completions).toEqual(["2026-07-02"]);
  });

  it("appends a second entry when called on a different day", () => {
    addHabit("read", habitsFilePath);
    markHabitDone("read", habitsFilePath, new Date(2026, 6, 1, 9, 0, 0));
    markHabitDone("read", habitsFilePath, new Date(2026, 6, 2, 9, 0, 0));

    const file = loadHabits(habitsFilePath);
    expect(file.habits[0].completions).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("throws UnknownHabitError when the habit is not registered", () => {
    expect(() => markHabitDone("ghost", habitsFilePath, fixedNow)).toThrow(UnknownHabitError);
    try {
      markHabitDone("ghost", habitsFilePath, fixedNow);
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownHabitError);
      expect((e as InstanceType<typeof UnknownHabitError>).habitName).toBe("ghost");
      expect((e as InstanceType<typeof UnknownHabitError>).message).toContain("ghost");
    }
  });

  it("throws EmptyHabitNameError on empty name", () => {
    expect(() => markHabitDone("", habitsFilePath, fixedNow)).toThrow(EmptyHabitNameError);
  });
});

describe("listHabitsForToday", () => {
  it("returns one row per habit with doneToday=false on a fresh add", () => {
    addHabit("read", habitsFilePath);
    addHabit("exercise", habitsFilePath);

    const rows = listHabitsForToday(habitsFilePath, fixedNow);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.doneToday).toBe(false);
  });

  it("reflects done=true after marking the habit done", () => {
    addHabit("read", habitsFilePath);
    addHabit("exercise", habitsFilePath);
    markHabitDone("read", habitsFilePath, fixedNow);

    const rows = listHabitsForToday(habitsFilePath, fixedNow);
    const byName = new Map(rows.map((r) => [r.habit.name, r.doneToday]));
    expect(byName.get("read")).toBe(true);
    expect(byName.get("exercise")).toBe(false);
  });

  it("does not treat yesterday's completion as today", () => {
    // Pre-seed a habit with only a stale completion.
    saveHabits(
      {
        habits: [
          {
            name: "read",
            createdAt: "2026-06-30T12:00:00.000Z",
            completions: ["2020-01-01"],
          },
        ],
      },
      habitsFilePath,
    );

    const rows = listHabitsForToday(habitsFilePath, fixedNow);
    expect(rows).toHaveLength(1);
    expect(rows[0].doneToday).toBe(false);
  });

  it("returns [] when the store is empty (file absent)", () => {
    const rows = listHabitsForToday(habitsFilePath, fixedNow);
    expect(rows).toEqual([]);
  });

  it("returns [] when the store file is empty string", () => {
    fs.writeFileSync(habitsFilePath, "");
    const rows = listHabitsForToday(habitsFilePath, fixedNow);
    expect(rows).toEqual([]);
  });
});

describe("round-trip / file lifecycle", () => {
  it("saves then reloads the same shape", () => {
    saveHabits(
      {
        habits: [
          {
            name: "read",
            createdAt: "2026-07-01T00:00:00.000Z",
            completions: ["2026-07-01", "2026-07-02"],
          },
        ],
      },
      habitsFilePath,
    );
    const loaded = loadHabits(habitsFilePath);
    expect(loaded.habits[0].name).toBe("read");
    expect(loaded.habits[0].completions).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("tolerates a missing file as empty", () => {
    fs.rmSync(habitsFilePath, { force: true });
    expect(loadHabits(habitsFilePath)).toEqual({ habits: [] });
  });

  it("tolerates a malformed file as empty", () => {
    fs.writeFileSync(habitsFilePath, JSON.stringify({}));
    expect(loadHabits(habitsFilePath)).toEqual({ habits: [] });
  });
});

describe("atomic write", () => {
  it("leaves no leftover .tmp file after a successful save", () => {
    addHabit("read", habitsFilePath);
    const dirEntries = fs.readdirSync(testDir);
    const tmpLeftovers = dirEntries.filter((e) => e.includes(".tmp-"));
    expect(tmpLeftovers).toEqual([]);
  });
});