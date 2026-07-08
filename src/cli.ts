#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, saveConfig, type Config, ADT_DIR } from "./config.js";
import { runWorker } from "./worker.js";
import { openDb, getAllTasks, type TaskRow } from "./store.js";
import { acquireLock, releaseLock } from "./lock.js";
import {
  addHabit,
  markHabitDone,
  listHabitsForToday,
  todayLocal,
  EmptyHabitNameError,
  UnknownHabitError,
} from "./habits.js";
import * as path from "node:path";
import * as os from "node:os";
import { createInterface } from "node:readline";
import { runDoctor } from "./doctor.js";

const program = new Command();

program
  .name("adt")
  .description("Agent Dev Team - GitHub Issue-driven multi-agent dev team")
  .version("0.1.0");

program
  .command("setup")
  .description("Configure adt with GitHub token and repos")
  .option("--add <repo>", "Add a repo to watch")
  .option("--remove <repo>", "Remove a repo from watch")
  .action(async (opts) => {
    const adtDir = ADT_DIR;
    let cfg: Config;

    try {
      cfg = loadConfig();
    } catch {
      // First-time setup
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r as any));

      const token = await ask("GitHub PAT (repo scope): ");
      const repo = await ask("Repo to watch (owner/repo): ");
      const ccMm = await ask("Path to cc-mm binary [cc-mm]: ") || "cc-mm";

      rl.close();

      cfg = {
        githubToken: token,
        repos: [repo],
        ccMmPath: ccMm,
        stageTimeouts: { grill: 15, reqs: 10, design: 20, impl: 60, verify: 15, review: 30 },
      };
      saveConfig(cfg);
      console.log(`Config saved to ${path.join(adtDir, "config.json")}`);
      return;
    }

    if (opts.add) {
      if (!cfg.repos.includes(opts.add)) cfg.repos.push(opts.add);
      saveConfig(cfg);
      console.log(`Added ${opts.add}. Repos: ${cfg.repos.join(", ")}`);
    } else if (opts.remove) {
      cfg.repos = cfg.repos.filter(r => r !== opts.remove);
      saveConfig(cfg);
      console.log(`Removed ${opts.remove}. Repos: ${cfg.repos.join(", ")}`);
    } else {
      console.log("Config already exists. Use --add/--remove to manage repos.");
    }
  });

program
  .command("run")
  .description("Execute one worker run (pick task, run one stage)")
  .action(async () => {
    await runWorker();
    process.exit(0);
  });

program
  .command("status")
  .description("Show all tasks and their current stages")
  .action(() => {
    const cfg = loadConfig();
    const dbPath = path.join(ADT_DIR, "state.db");
    const db = openDb(dbPath);
    const tasks = getAllTasks(db);

    if (tasks.length === 0) {
      console.log("No tasks.");
    } else {
      console.log(`${"Repo".padEnd(25)} ${"Issue".padEnd(8)} ${"Stage".padEnd(10)} ${"Status".padEnd(15)}`);
      console.log("-".repeat(60));
      for (const t of tasks) {
        console.log(`${t.repo.padEnd(25)} #${String(t.issue_number).padEnd(7)} ${t.stage.padEnd(10)} ${t.status.padEnd(15)}`);
      }
    }
    db.close();
  });

program
  .command("clean")
  .description("Prune stale worktrees")
  .action(async () => {
    const cfg = loadConfig();
    // prune all repos -- in v1 we prune the current repo
    const { pruneWorktrees } = await import("./worktree.js");
    await pruneWorktrees(process.cwd());
    console.log("Worktrees pruned.");
  });

program
  .command("pause <taskRef>")
  .description("Pause a task (repo#n)")
  .action(async (taskRef: string) => {
    const [repo, issueStr] = taskRef.split("#");
    const issueNumber = parseInt(issueStr, 10);
    if (!repo || !issueNumber) {
      console.error("Use format: owner/repo#n (e.g. my/repo#42)");
      process.exit(1);
    }
    const dbPath = path.join(ADT_DIR, "state.db");
    const db = openDb(dbPath);
    db.prepare("UPDATE tasks SET status = ? WHERE repo = ? AND issue_number = ? AND status IN (?, ?)")
      .run("cancelled", repo, issueNumber, "pending", "waiting-user");
    db.close();
    console.log(`Paused ${taskRef}`);
  });

program
  .command("resume <taskRef>")
  .description("Resume a paused task (repo#n)")
  .action(async (taskRef: string) => {
    const [repo, issueStr] = taskRef.split("#");
    const issueNumber = parseInt(issueStr, 10);
    if (!repo || !issueNumber) {
      console.error("Use format: owner/repo#n (e.g. my/repo#42)");
      process.exit(1);
    }
    const dbPath = path.join(ADT_DIR, "state.db");
    const db = openDb(dbPath);
    db.prepare("UPDATE tasks SET status = ? WHERE repo = ? AND issue_number = ? AND status = ?")
      .run("pending", repo, issueNumber, "cancelled");
    db.close();
    console.log(`Resumed ${taskRef}`);
  });

program
  .command("doctor")
  .description("Validate local config and runtime (read-only)")
  .action(async () => {
    process.exit(await runDoctor());
  });

const habitCmd = program
  .command("habit")
  .description("Track daily habits (single-user, local)");

habitCmd
  .command("add <name>")
  .description("Register a habit (idempotent)")
  .action((name: string) => {
    try {
      const h = addHabit(name);
      console.log(`Added '${h.name}'`);
    } catch (e) {
      if (e instanceof EmptyHabitNameError) {
        console.error("error: habit name cannot be empty");
        process.exit(1);
      }
      throw e;
    }
  });

habitCmd
  .command("done <name>")
  .description("Mark a habit done for today (idempotent same-day)")
  .action((name: string) => {
    try {
      markHabitDone(name);
      console.log(`Marked '${name}' done for ${todayLocal()}`);
    } catch (e) {
      if (e instanceof EmptyHabitNameError) {
        console.error("error: habit name cannot be empty");
        process.exit(1);
      }
      if (e instanceof UnknownHabitError) {
        console.error(`error: no such habit: '${name}'. Add it with 'adt habit add ${name}' first.`);
        process.exit(1);
      }
      throw e;
    }
  });

habitCmd
  .command("list")
  .description("Show today's status for all registered habits")
  .action(() => {
    const rows = listHabitsForToday();
    if (rows.length === 0) {
      console.log("No habits yet. Add one with: adt habit add <name>");
      return;
    }
    for (const { habit, doneToday } of rows) {
      const mark = doneToday ? "✅" : "❌";
      console.log(`${mark} ${habit.name}`);
    }
  });

program.parse();
