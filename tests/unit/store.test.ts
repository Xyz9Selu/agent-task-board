import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, listRunnableTasks, markTaskRunning, markTaskFinished, insertTask, getTask, getAllTasks } from '../../src/store.js';

const testDir = path.join('/tmp', 'adt-store-test-' + Date.now());
const testDbPath = path.join(testDir, 'state.db');

let db: Database.Database;

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
  db = openDb(testDbPath);
});

afterEach(() => {
  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('insertTask and getTask', () => {
  it('inserts and retrieves a task', () => {
    const id = insertTask(db, 'owner/repo', 42, 'reqs', 'pending', null, null);
    const task = getTask(db, id);
    expect(task).not.toBeNull();
    expect(task!.repo).toBe('owner/repo');
    expect(task!.issue_number).toBe(42);
    expect(task!.stage).toBe('reqs');
    expect(task!.status).toBe('pending');
  });
});

describe('listRunnableTasks', () => {
  it('returns pending tasks ordered by stage priority', () => {
    const id1 = insertTask(db, 'x/y', 1, 'impl', 'pending', '/tmp/wt1', 'adt/issue-1');
    const id2 = insertTask(db, 'x/y', 2, 'reqs', 'pending', '/tmp/wt2', 'adt/issue-2');
    const id3 = insertTask(db, 'x/y', 3, 'design', 'pending', '/tmp/wt3', 'adt/issue-3');
    // id4 is waiting-user, should be skipped
    insertTask(db, 'x/y', 4, 'reqs', 'waiting-user', '/tmp/wt4', 'adt/issue-4');

    const runnable = listRunnableTasks(db);
    expect(runnable.length).toBe(3);
    // Oldest reqs first, then design, then impl
    expect(runnable[0].issue_number).toBe(2); // reqs
    expect(runnable[1].issue_number).toBe(3); // design
    expect(runnable[2].issue_number).toBe(1); // impl
  });

  it('returns empty when no runnable tasks', () => {
    insertTask(db, 'x/y', 1, 'reqs', 'waiting-user', '/tmp/wt', 'b');
    insertTask(db, 'x/y', 2, 'design', 'running', '/tmp/wt2', 'b2');
    expect(listRunnableTasks(db)).toEqual([]);
  });
});

describe('markTaskRunning', () => {
  it('updates status to running and sets updated_at', () => {
    const id = insertTask(db, 'x/y', 1, 'reqs', 'pending', null, null);
    const before = getTask(db, id)!.updated_at;
    markTaskRunning(db, id);
    const task = getTask(db, id)!;
    expect(task.status).toBe('running');
    expect(task.updated_at).toBeGreaterThanOrEqual(before);
  });
});

describe('markTaskFinished', () => {
  it('updates status to the given value', () => {
    const id = insertTask(db, 'x/y', 1, 'impl', 'running', '/tmp/wt', 'b');
    markTaskFinished(db, id, 'done');
    expect(getTask(db, id)!.status).toBe('done');
  });
});

describe('getAllTasks', () => {
  it('returns all tasks ordered by updated_at desc', () => {
    insertTask(db, 'a/b', 1, 'reqs', 'pending', null, null);
    insertTask(db, 'a/b', 2, 'design', 'done', null, null);
    expect(getAllTasks(db)).toHaveLength(2);
  });
});
