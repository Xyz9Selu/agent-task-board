import { isEmptyName, normalizeName } from "./normalize.js";
import { computeStreak } from "./streak.js";
import { todayLocal } from "./today.js";

/**
 * Browser-side habit tracker store. Persists a JSON file to `localStorage`
 * under a single key. This module is a parallel store to `src/habits.ts`
 * (the CLI's Node-fs-backed store) — it shares the on-disk JSON shape and
 * the normalization rules, but is intentionally a separate module so the
 * browser bundle never imports `node:fs`.
 *
 * Every function takes an optional `storage` argument defaulting to
 * `window.localStorage` and an optional `now` argument defaulting to
 * `() => new Date()`. The arguments let tests inject a fake `Storage` and a
 * fixed clock without monkey-patching globals.
 */

export const HABITS_STORAGE_KEY = "agent-task-board:habits";

export interface Habit {
  name: string;
  createdAt: string; // ISO-8601
  completions: string[]; // YYYY-MM-DD, ascending, deduped
}

export interface HabitsFile {
  habits: Habit[];
}

export interface HabitRow {
  habit: Habit;
  doneToday: boolean;
  streak: number;
}

export class HabitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HabitError";
  }
}

export class EmptyHabitNameError extends HabitError {
  constructor() {
    super("habit name cannot be empty");
    this.name = "EmptyHabitNameError";
  }
}

export class UnknownHabitError extends HabitError {
  readonly habitName: string;
  constructor(name: string) {
    super(`no such habit: '${name}'`);
    this.name = "UnknownHabitError";
    this.habitName = name;
  }
}

export class StorageError extends HabitError {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

function getStorage(storage?: Storage): Storage {
  return storage ?? window.localStorage;
}

function sortHabits(habits: Habit[]): void {
  habits.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Load the habits file from `localStorage`. Missing key, empty value, and
 * malformed JSON are all tolerated and returned as `{ habits: [] }` — the
 * same way the CLI module treats a missing / unreadable file. The UI cannot
 * show a broken-state view in v1, so recovery is silent.
 */
export function loadHabits(storage?: Storage): HabitsFile {
  const s = getStorage(storage);
  let raw: string | null;
  try {
    raw = s.getItem(HABITS_STORAGE_KEY);
  } catch {
    return { habits: [] };
  }
  if (raw === null || raw.trim() === "") {
    return { habits: [] };
  }
  try {
    const parsed = JSON.parse(raw) as HabitsFile;
    if (!parsed || !Array.isArray(parsed.habits)) {
      return { habits: [] };
    }
    return parsed;
  } catch {
    return { habits: [] };
  }
}

/**
 * Save the habits file to `localStorage`. Wraps `setItem` in a try/catch so
 * Safari private mode and quota errors surface as a `StorageError` instead of
 * an uncaught exception.
 */
export function saveHabits(file: HabitsFile, storage?: Storage): void {
  const s = getStorage(storage);
  try {
    s.setItem(HABITS_STORAGE_KEY, JSON.stringify(file, null, 2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new StorageError(`failed to save habits: ${msg}`);
  }
}

/**
 * Add a new habit. Normalizes the name (trim), rejects empty, and is
 * idempotent — re-adding an existing habit (case-sensitive match) returns the
 * existing habit unchanged.
 *
 * Throws `EmptyHabitNameError` if `name` is empty / whitespace-only after
 * trim.
 */
export function addHabit(
  name: string,
  storage?: Storage,
  now: () => Date = () => new Date(),
): Habit {
  const normalized = normalizeName(name);
  if (isEmptyName(normalized)) {
    throw new EmptyHabitNameError();
  }
  const file = loadHabits(storage);
  const existing = file.habits.find((h) => h.name === normalized);
  if (existing) return existing;
  const habit: Habit = {
    name: normalized,
    createdAt: now().toISOString(),
    completions: [],
  };
  file.habits.push(habit);
  sortHabits(file.habits);
  saveHabits(file, storage);
  return habit;
}

/**
 * Mark a habit as completed for `today` (local-time). Idempotent same-day.
 *
 * Throws `EmptyHabitNameError` if `name` is empty, or `UnknownHabitError`
 * (carrying the name) if the habit is not registered.
 */
export function markHabitDone(
  name: string,
  storage?: Storage,
  now: () => Date = () => new Date(),
): Habit {
  const normalized = normalizeName(name);
  if (isEmptyName(normalized)) {
    throw new EmptyHabitNameError();
  }
  const file = loadHabits(storage);
  const habit = file.habits.find((h) => h.name === normalized);
  if (!habit) {
    throw new UnknownHabitError(normalized);
  }
  const today = todayLocal(now());
  if (habit.completions.includes(today)) {
    return habit;
  }
  habit.completions.push(today);
  habit.completions.sort();
  saveHabits(file, storage);
  return habit;
}

/**
 * Remove a habit and its completions from the store. No-op (and not an error)
 * if the habit is not present — `localStorage` does not support
 * transactional deletes, and v1 callers use this from a confirmation
 * dialog.
 */
export function removeHabit(name: string, storage?: Storage): void {
  const normalized = normalizeName(name);
  const file = loadHabits(storage);
  const before = file.habits.length;
  file.habits = file.habits.filter((h) => h.name !== normalized);
  if (file.habits.length === before) return;
  saveHabits(file, storage);
}

/**
 * Return one row per habit with `doneToday` and `streak` pre-computed. The
 * returned list is sorted by `name` (the same order the store uses on
 * disk).
 */
export function listHabits(
  storage?: Storage,
  now: () => Date = () => new Date(),
): HabitRow[] {
  const file = loadHabits(storage);
  const today = todayLocal(now());
  return file.habits.map((habit) => ({
    habit,
    doneToday: habit.completions.includes(today),
    streak: computeStreak(habit.completions, today),
  }));
}