import Database from 'better-sqlite3';

type Stage = 'grill' | 'reqs' | 'design' | 'impl' | 'verify' | 'review';
type TaskStatus = 'pending' | 'running' | 'waiting-user' | 'done' | 'failed' | 'blocked' | 'cancelled';

interface TaskRow {
  id: number;
  repo: string;
  issue_number: number;
  stage: Stage;
  status: TaskStatus;
  worktree_path: string | null;
  branch: string | null;
  created_at: number;
  updated_at: number;
}

interface EventRow {
  id: number;
  task_id: number;
  kind: string;
  payload: string;
  created_at: number;
}

function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      worktree_path TEXT,
      branch TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_repo_issue ON tasks(repo, issue_number);
  `);
  return db;
}

const STAGE_ORDER: Record<Stage, number> = { grill: -1, reqs: 0, design: 1, impl: 2, verify: 3, review: 4 };

function listRunnableTasks(db: Database.Database): TaskRow[] {
  const stmt = db.prepare(`
    SELECT * FROM tasks WHERE status = 'pending'
    ORDER BY created_at ASC
  `);
  const rows = stmt.all() as TaskRow[];
  // Sort in-memory: ties broken by stage priority
  rows.sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
  });
  return rows;
}

function insertTask(
  db: Database.Database,
  repo: string,
  issueNumber: number,
  stage: Stage,
  status: TaskStatus,
  worktreePath: string | null,
  branch: string | null,
): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO tasks (repo, issue_number, stage, status, worktree_path, branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(repo, issueNumber, stage, status, worktreePath, branch, now, now);
  return Number(result.lastInsertRowid);
}

function getTask(db: Database.Database, taskId: number): TaskRow | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  return row ?? null;
}

function getAllTasks(db: Database.Database): TaskRow[] {
  return db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all() as TaskRow[];
}

function markTaskRunning(db: Database.Database, taskId: number): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('running', now, taskId);
}

function markTaskFinished(db: Database.Database, taskId: number, newStatus: TaskStatus): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, taskId);
}

export {
  openDb, listRunnableTasks, markTaskRunning, markTaskFinished,
  insertTask, getTask, getAllTasks,
  TaskRow, EventRow, Stage, TaskStatus,
};
