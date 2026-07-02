import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ADT_DIR = process.env.ADT_DIR || path.join(os.homedir(), ".adt");
const DEFAULT_HABITS_PATH = path.join(ADT_DIR, "habits.json");

interface Habit {
  name: string;
  createdAt: string; // ISO-8601
  completions: string[]; // YYYY-MM-DD, ascending
}

interface HabitsFile {
  habits: Habit[];
}

class HabitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HabitError";
  }
}

class EmptyHabitNameError extends HabitError {
  constructor() {
    super("habit name cannot be empty");
    this.name = "EmptyHabitNameError";
  }
}

class UnknownHabitError extends HabitError {
  readonly habitName: string;
  constructor(name: string) {
    super(`no such habit: '${name}'`);
    this.name = "UnknownHabitError";
    this.habitName = name;
  }
}

function defaultPath(): string {
  return path.join(ADT_DIR, "habits.json");
}

function loadHabits(filePath: string = defaultPath()): HabitsFile {
  if (!fs.existsSync(filePath)) {
    return { habits: [] };
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  if (raw.trim() === "") {
    return { habits: [] };
  }
  const parsed = JSON.parse(raw) as HabitsFile;
  if (!parsed || !Array.isArray(parsed.habits)) {
    return { habits: [] };
  }
  return parsed;
}

function saveHabits(file: HabitsFile, filePath: string = defaultPath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function sortHabits(habits: Habit[]): void {
  habits.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function normalizeName(name: string): string {
  return name.trim();
}

function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addHabit(name: string, filePath?: string): Habit {
  const normalized = normalizeName(name);
  if (normalized === "") {
    throw new EmptyHabitNameError();
  }
  const fp = filePath ?? defaultPath();
  const file = loadHabits(fp);
  const existing = file.habits.find((h) => h.name === normalized);
  if (existing) {
    return existing; // idempotent
  }
  const habit: Habit = {
    name: normalized,
    createdAt: new Date().toISOString(),
    completions: [],
  };
  file.habits.push(habit);
  sortHabits(file.habits);
  saveHabits(file, fp);
  return habit;
}

function markHabitDone(
  name: string,
  filePath?: string,
  now: Date = new Date(),
): Habit {
  const normalized = normalizeName(name);
  if (normalized === "") {
    throw new EmptyHabitNameError();
  }
  const fp = filePath ?? defaultPath();
  const file = loadHabits(fp);
  const habit = file.habits.find((h) => h.name === normalized);
  if (!habit) {
    throw new UnknownHabitError(normalized);
  }
  const today = todayLocal(now);
  if (habit.completions.includes(today)) {
    return habit; // idempotent same-day
  }
  habit.completions.push(today);
  habit.completions.sort();
  saveHabits(file, fp);
  return habit;
}

function listHabitsForToday(
  filePath?: string,
  now: Date = new Date(),
): Array<{ habit: Habit; doneToday: boolean }> {
  const fp = filePath ?? defaultPath();
  const file = loadHabits(fp);
  const today = todayLocal(now);
  return file.habits.map((habit) => ({
    habit,
    doneToday: habit.completions.includes(today),
  }));
}

export {
  addHabit,
  markHabitDone,
  listHabitsForToday,
  loadHabits,
  saveHabits,
  todayLocal,
  normalizeName,
  Habit,
  HabitsFile,
  HabitError,
  EmptyHabitNameError,
  UnknownHabitError,
  DEFAULT_HABITS_PATH,
};