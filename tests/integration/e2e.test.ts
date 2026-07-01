import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseStageResult } from "../../src/result.js";
import { labelForStage, nextStage, stageFromLabel, ALL_ADT_LABELS } from "../../src/labels.js";
import { openDb, insertTask, getTask, listRunnableTasks, markTaskRunning, markTaskFinished } from "../../src/store.js";

const TMP = path.join("/tmp", "adt-e2e-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  process.env.ADT_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  delete process.env.ADT_DIR;
});

describe("full 4-stage lifecycle", () => {
  it("walks reqs -> waiting-user -> design -> done -> impl -> done -> review -> done via store", () => {
    const dbPath = path.join(TMP, "state.db");
    const db = openDb(dbPath);

    const taskId = insertTask(db, "owner/repo", 42, "reqs", "pending", "/tmp/wt", "adt/issue-42-test");
    expect(getTask(db, taskId)).not.toBeNull();

    markTaskRunning(db, taskId);
    markTaskFinished(db, taskId, "waiting-user");

    markTaskFinished(db, taskId, "pending");
    db.prepare("UPDATE tasks SET stage = ? WHERE id = ?").run("design", taskId);
    expect(getTask(db, taskId)!.stage).toBe("design");

    markTaskRunning(db, taskId);
    markTaskFinished(db, taskId, "pending");
    db.prepare("UPDATE tasks SET stage = ? WHERE id = ?").run("impl", taskId);
    expect(getTask(db, taskId)!.stage).toBe("impl");

    markTaskRunning(db, taskId);
    markTaskFinished(db, taskId, "pending");
    db.prepare("UPDATE tasks SET stage = ? WHERE id = ?").run("review", taskId);
    expect(getTask(db, taskId)!.stage).toBe("review");

    markTaskRunning(db, taskId);
    markTaskFinished(db, taskId, "done");
    expect(getTask(db, taskId)!.status).toBe("done");

    db.close();
  });

  it("skips waiting-user tasks in listRunnable", () => {
    const dbPath = path.join(TMP, "state.db");
    const db = openDb(dbPath);
    insertTask(db, "x/y", 1, "reqs", "waiting-user", "/tmp/wt1", "b1");
    insertTask(db, "x/y", 2, "reqs", "pending", "/tmp/wt2", "b2");
    expect(listRunnableTasks(db)).toHaveLength(1);
    expect(listRunnableTasks(db)[0].issue_number).toBe(2);
    db.close();
  });
});

describe("result parsing", () => {
  it("parses all three variants", () => {
    expect(parseStageResult(JSON.stringify({ status: "waiting-user", summary: "Need input" })).status).toBe("waiting-user");

    const done = parseStageResult(JSON.stringify({ status: "done", summary: "All good", artifacts: { prUrl: "https://github.com/x/y/pull/1" } }));
    expect(done.status).toBe("done");
    if (done.status === "done") expect(done.artifacts!.prUrl).toBeDefined();

    const blocked = parseStageResult(JSON.stringify({ status: "blocked", reason: "Push rejected", details: "non-fast-forward" }));
    expect(blocked.status).toBe("blocked");
    if (blocked.status === "blocked") expect(blocked.reason).toBe("Push rejected");
  });
});

describe("labels state machine", () => {
  it("covers all 4 stages", () => {
    for (const s of ["reqs", "design", "impl", "review"] as const) {
      expect(labelForStage(s, "running")).toBe("adt:" + s + "-running");
      expect(labelForStage(s, "waiting-user")).toBe("adt:" + s + "-waiting");
    }
    expect(nextStage("reqs")).toBe("design");
    expect(nextStage("design")).toBe("impl");
    expect(nextStage("impl")).toBe("review");
    expect(nextStage("review")).toBeNull();
  });
});
