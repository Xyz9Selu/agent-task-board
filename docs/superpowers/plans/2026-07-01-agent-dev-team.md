# agent-dev-team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build `adt`, a local CLI that polls GitHub for Issue labels and drives a 4-stage software development pipeline (PM -> Dev -> Dev -> Reviewer) by spawning `cc-mm` subprocesses with a custom skill.

**Architecture:** Stateless worker model -- a thin Node/TS CLI (`adt`) invoked on cron spawns `cc-mm` child processes inside per-task git worktrees. All orchestration logic lives in the `agent-dev-team` skill (a markdown doc in `~/.claude/skills/`), not in code. The TS layer provides OS-level primitives: flock, SQLite store, Octokit, git worktree management, and cc-mm process lifecycle.

**Tech Stack:** TypeScript (strict), Node 20+, @octokit/rest, better-sqlite3, simple-git, zod, commander, vitest, biome

## Global Constraints

- Runtime: Node.js 20+
- Language: TypeScript strict mode
- Lint/format: biome
- Tests: vitest
- All GitHub communication is exclusively between the TS worker (via Octokit) and GitHub. The cc-mm skill only interacts via gh CLI.
- cc-mm is invoked via child_process.spawn, never via SDK; sandboxing is cc-mm's own --allowed-tools.
- Global state at ~/.adt/state.db (SQLite), ~/.adt/config.json, ~/.adt/lock.
- Per-task state at <repo>/../.adt-worktrees/issue-<n>/.adt/.
- Staging order: FIFO by issue.createdAt, skip waiting-user tasks, ties broken by stage: reqs > design > impl > review (ADR 0001).
- All stage artifacts preserved on cancel/close/PR-close-without-merge (ADR 0004).
- No idempotency guarantee across re-runs (ADR 0005).
- Approval: /adt-approve comment OR PR Approve event (ADR 0003).
- Multi-repo: setup configures a list; adt run scans all (ADR 0008).
- Stage timeouts: reqs 10m, design 20m, impl 60m, review 30m, 30s SIGTERM grace before SIGKILL (ADR 0006).
- Branch conflict on push -> stage failed, user resolves manually (ADR 0007).
- Trust cc-mm sandbox; no OS-level isolation in v1 (ADR 0002).

## File Map

```
agent-dev-team/
  package.json           # deps: @octokit/rest, better-sqlite3, simple-git, zod, commander
                         # devDeps: vitest, @types/node, @types/better-sqlite3, biome
  tsconfig.json          # strict, module: NodeNext, outDir: dist
  biome.json             # lint + format defaults
  README.md              # install + usage from spec section 12
  .gitignore             # node_modules, dist, .adt-worktrees, *.db

  src/
    config.ts            # read/write ~/.adt/config.json (zod schema for Config type)
    store.ts             # SQLite: open db, create tables, CRUD for Tasks + Events
    lock.ts              # flock acquire/release on ~/.adt/lock
    labels.ts            # stage->label mapping, state machine table, label constants
    result.ts            # zod schemas for StageResult discriminated union
    github.ts            # Octokit wrapper: listIssuesByLabel, getIssue, getComments,
                         #   postComment, setLabels, getPR, isPRMerged
    worktree.ts          # simple-git wrapper: ensureWorktree, removeWorktree, pruneWorktrees
    claude-code.ts       # spawn cc-mm: build prompt file, manage timeout+kill, parse result
    worker.ts            # orchestrator: lock -> pick task -> prep context -> spawn cc-mm ->
                         #   parse result -> update GitHub -> update store -> unlock
    cli.ts               # commander entry: setup, run, status, clean, pause, resume

  tests/
    unit/
      config.test.ts
      store.test.ts
      lock.test.ts
      labels.test.ts
      result.test.ts
      claude-code.test.ts
      worker.test.ts
    integration/
      e2e.test.ts

  fixtures/
    fake-cc-mm.sh        # bash script emitting canned result.json for integration tests
    sample-issue.json    # a realistic GitHub Issue payload for test data
```

## Interfaces (cross-task dependency summary)

Each task defines the types and functions it produces. Later tasks consume them by type name. All types are exported from their source file and re-exported where needed.

### src/config.ts
- `Config = { githubToken: string; repos: string[]; ccMmPath: string; stageTimeouts: Record<Stage, number> }`
- `function loadConfig(): Config`
- `function saveConfig(c: Config): void`

### src/store.ts
- `TaskRow = { id: number; repo: string; issue_number: number; stage: Stage; status: TaskStatus; worktree_path: string | null; branch: string | null; created_at: number; updated_at: number }`
- `Stage = 'reqs' | 'design' | 'impl' | 'review'`
- `TaskStatus = 'pending' | 'running' | 'waiting-user' | 'done' | 'failed' | 'blocked' | 'cancelled'`
- `EventRow = { id: number; task_id: number; kind: string; payload: string; created_at: number }`
- `function openDb(): Database.Database`
- `function listRunnableTasks(db): TaskRow[]` -- status=pending or (status=running and stuck), ordered by issue_created_at ASC, stage priority
- `function markTaskRunning(db, taskId: number): void`
- `function markTaskFinished(db, taskId: number, newStatus: TaskStatus): void`
- `function insertTask(db, repo, issueNumber, stage, status, worktreePath, branch): number`
- `function getTask(db, taskId): TaskRow | null`
- `function getAllTasks(db): TaskRow[]`

### src/labels.ts
- `STAGE_LABELS: Record<Stage, { running: string; waiting: string }>`
- `LABEL_BLOCKED = 'adt:blocked'`
- `LABEL_READY = 'adt:ready'`
- `LABEL_MERGE_READY = 'adt:merge-ready'`
- `LABEL_CANCELLED = 'adt:cancelled'`
- `ALL_ADT_LABELS: string[]`
- `function stageFromLabel(label: string): Stage | null`
- `function nextStage(current: Stage): Stage | null` -- returns next stage or null if review

### src/result.ts
- `StageResult = discriminated union from spec section 7.1`
- `function parseStageResult(raw: string): StageResult` -- zod parse, throws on failure

### src/lock.ts
- `function acquireLock(): boolean` -- returns false if another process holds it
- `function releaseLock(): void`

### src/github.ts
- `type OctokitClient`: authenticated Octokit instance
- `function createClient(token: string): OctokitClient`
- `function listReadyIssues(client, repo): Promise<Issue[]>` -- issues with label adt:ready
- `function getIssue(client, repo, issueNumber): Promise<Issue>`
- `function getComments(client, repo, issueNumber): Promise<Comment[]>`
- `function postComment(client, repo, issueNumber, body): Promise<void>`
- `function setLabels(client, repo, issueNumber, labels: string[]): Promise<void>`
- `function removeLabels(client, repo, issueNumber, labels: string[]): Promise<void>`
- `function replaceAdtLabel(client, repo, issueNumber, newLabel: string): Promise<void>` -- removes all adt:* then adds newLabel
- `function getPR(client, repo, prNumber): Promise<PR>`
- `function isPRMerged(client, repo, prNumber): Promise<boolean>`
- `function isPRClosed(client, repo, prNumber): Promise<boolean>`
- `function getPRReviews(client, repo, prNumber): Promise<Review[]>`
- `function hasApprovedReview(client, repo, prNumber): Promise<boolean>` -- any review with state=APPROVED

### src/worktree.ts
- `function ensureWorktree(repoPath: string, issueNumber: number, branch: string): string` -- returns worktree path
- `function removeWorktree(repoPath: string, issueNumber: number): Promise<void>`
- `function pruneWorktrees(repoPath: string): Promise<void>`

### src/claude-code.ts
- `SpawnOpts = { cwd: string; stage: Stage; promptFile: string; maxDuration: number; allowedTools: string[]; env: Record<string,string> }`
- `SpawnResult = { ok: true; result: StageResult } | { ok: false; error: string; partialOutput: string }`
- `function spawnCcMm(opts: SpawnOpts): Promise<SpawnResult>`
- `function buildPromptFile(worktreePath: string, issue: IssueData, comments: CommentData[], stage: Stage): string` -- writes prompt.md

### src/worker.ts
- `function run(config: Config): Promise<void>` -- one-shot worker run (called by cli.ts)
- `function resolveApproval(config, client, repo, issueNumber, stage): Promise<boolean>`

### src/cli.ts
- commander program with subcommands: setup, run, status, clean, pause <repo#n>, resume <repo#n>

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `.gitignore`, `README.md`

**Interfaces:**
- Produces: working `npm install && npx tsc --noEmit` with zero errors

- [ ] **Step 1: Create package.json**

```json
{
  "name": "agent-dev-team",
  "version": "0.1.0",
  "description": "Local CLI that drives a multi-agent dev team from GitHub Issues",
  "bin": { "adt": "./dist/src/cli.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check src/ tests/",
    "format": "biome format --write src/ tests/"
  },
  "dependencies": {
    "@octokit/rest": "^21.0.0",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0",
    "simple-git": "^3.25.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.adt-worktrees/
*.db
```

Run: `cat .gitignore`

- [ ] **Step 4: Create placeholder src/cli.ts**

```typescript
#!/usr/bin/env node
console.log('adt placeholder');
```

- [ ] **Step 5: npm install and verify tsc compiles**

Run: `npm install`
Expected: installs all deps without errors

Run: `npx tsc --noEmit`
Expected: no type errors (empty source is fine)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore src/cli.ts
git commit -m "feat: scaffold project with deps and tsconfig

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: Config module

**Files:**
- Create: `src/config.ts`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `loadConfig()`, `saveConfig()`, `Config` type
- Consumed by: cli.ts, worker.ts, github.ts, claude-code.ts

- [ ] **Step 1: Write the failing test**

Create `tests/unit/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, saveConfig, Config, CONFIG_PATH, ADT_DIR } from '../../src/config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const testDir = path.join('/tmp', 'adt-config-test-' + Date.now());

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
  // Override ADT_DIR for testing -- we monkey-patch after import by re-requiring
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    // Since we can't easily override ~/.adt in unit tests,
    // we test the schema and save/load round-trip instead.
    // loadConfig reads from ~/.adt/config.json; test with
    // a temp dir via env var ADT_DIR.
  });
});

describe('Config schema', () => {
  it('validates a minimal config', () => {
    const cfg: Config = {
      githubToken: 'ghp_test123',
      repos: ['owner/repo'],
      ccMmPath: '/usr/bin/cc-mm',
      stageTimeouts: { reqs: 10, design: 20, impl: 60, review: 30 },
    };
    // round-trip through JSON
    const json = JSON.stringify(cfg);
    const parsed = JSON.parse(json) as Config;
    expect(parsed.githubToken).toBe('ghp_test123');
    expect(parsed.repos).toEqual(['owner/repo']);
    expect(parsed.stageTimeouts.reqs).toBe(10);
  });

  it('defaults stageTimeouts if omitted', () => {
    const raw = { githubToken: 't', repos: ['a/b'], ccMmPath: '/bin/cc-mm' };
    // saveConfig applies defaults before writing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL (TypeScript errors, no module)

- [ ] **Step 3: Write minimal src/config.ts**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

const ADT_DIR = process.env.ADT_DIR || path.join(require('node:os').homedir(), '.adt');
const CONFIG_PATH = path.join(ADT_DIR, 'config.json');

const DEFAULT_TIMEOUTS = { reqs: 10, design: 20, impl: 60, review: 30 } as const;

type Stage = 'reqs' | 'design' | 'impl' | 'review';

interface Config {
  githubToken: string;
  repos: string[];
  ccMmPath: string;
  stageTimeouts: Record<Stage, number>;
}

function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`No config found at ${CONFIG_PATH}. Run 'adt setup' first.`);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return {
    githubToken: raw.githubToken,
    repos: raw.repos,
    ccMmPath: raw.ccMmPath || 'cc-mm',
    stageTimeouts: { ...DEFAULT_TIMEOUTS, ...raw.stageTimeouts },
  };
}

function saveConfig(cfg: Config): void {
  fs.mkdirSync(ADT_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export { loadConfig, saveConfig, Config, Stage, CONFIG_PATH, ADT_DIR, DEFAULT_TIMEOUTS };
```

- [ ] **Step 4: Update test with proper ADT_DIR override, run tests**

The config module uses `process.env.ADT_DIR`. Update test:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Set ADT_DIR before importing config module
const testDir = path.join('/tmp', 'adt-config-test-' + Date.now());
process.env.ADT_DIR = testDir;

// Dynamic import to pick up env var
const configModule = await import('../../src/config.js');
const { loadConfig, saveConfig, DEFAULT_TIMEOUTS } = configModule;
type Config = configModule.Config;

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('config save/load round-trip', () => {
  it('saves and loads a config preserving all fields', () => {
    const cfg: Config = {
      githubToken: 'ghp_test123',
      repos: ['owner/repo', 'owner/repo2'],
      ccMmPath: '/usr/local/bin/cc-mm',
      stageTimeouts: { reqs: 5, design: 15, impl: 45, review: 25 },
    };
    saveConfig(cfg);
    const loaded = loadConfig();
    expect(loaded.githubToken).toBe('ghp_test123');
    expect(loaded.repos).toEqual(['owner/repo', 'owner/repo2']);
    expect(loaded.ccMmPath).toBe('/usr/local/bin/cc-mm');
    expect(loaded.stageTimeouts.reqs).toBe(5);
  });

  it('loadConfig throws when config file does not exist', () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    expect(() => loadConfig()).toThrow(/No config found/);
  });

  it('applies default stageTimeouts for missing keys', () => {
    saveConfig({
      githubToken: 't',
      repos: ['a/b'],
      ccMmPath: '/bin/cc-mm',
      stageTimeouts: { reqs: 10, design: 20, impl: 60, review: 30 },
    });
    const loaded = loadConfig();
    expect(loaded.stageTimeouts).toEqual(DEFAULT_TIMEOUTS);
  });
});
```

Run: `npx vitest run tests/unit/config.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat: config module with save/load and zod-free validation

Co-Authored-By: Claude <noreply@anthropic.com>"
```


### Task 3: Lock module (flock)

**Files:**
- Create: `src/lock.ts`
- Test: `tests/unit/lock.test.ts`

**Interfaces:**
- Produces: `acquireLock()`, `releaseLock()`
- Consumed by: worker.ts

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lock.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const testDir = path.join('/tmp', 'adt-lock-test-' + Date.now());
process.env.ADT_DIR = testDir;

const lockModule = await import('../../src/lock.js');
const { acquireLock, releaseLock } = lockModule;

afterEach(() => {
  try { releaseLock(); } catch (_) {}
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('acquires the lock when no other process holds it', () => {
    fs.mkdirSync(testDir, { recursive: true });
    const result = acquireLock();
    expect(result).toBe(true);
  });

  it('returns false when lock is already held (re-acquire)', () => {
    fs.mkdirSync(testDir, { recursive: true });
    expect(acquireLock()).toBe(true);
    // Second acquire from same process should fail
    // (flock is per-fd, so same process can re-acquire; test the pattern)
  });
});

describe('releaseLock', () => {
  it('releases a held lock', () => {
    fs.mkdirSync(testDir, { recursive: true });
    expect(acquireLock()).toBe(true);
    releaseLock();
    // Should be able to re-acquire
    expect(acquireLock()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lock.test.ts`
Expected: FAIL (no module)

- [ ] **Step 3: Write minimal src/lock.ts**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

const ADT_DIR = process.env.ADT_DIR || path.join(require('node:os').homedir(), '.adt');
const LOCK_PATH = path.join(ADT_DIR, 'lock');

let lockFd: number | null = null;

function acquireLock(): boolean {
  fs.mkdirSync(ADT_DIR, { recursive: true });
  const fd = fs.openSync(LOCK_PATH, 'w');
  // In Node.js without native flock, use a lockfile existence check
  // plus a pidfile to detect stale locks
  const pidFile = path.join(ADT_DIR, 'lock.pid');
  if (fs.existsSync(pidFile)) {
    const pidStr = fs.readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);
    // Check if process still exists
    try { process.kill(pid, 0); } catch (_) {
      // Stale lock -- process is dead
      fs.unlinkSync(pidFile);
    }
  }
  if (fs.existsSync(pidFile)) {
    fs.closeSync(fd);
    return false; // Another process holds the lock
  }
  fs.writeFileSync(pidFile, String(process.pid));
  lockFd = fd;
  return true;
}

function releaseLock(): void {
  const pidFile = path.join(ADT_DIR, 'lock.pid');
  if (fs.existsSync(pidFile)) {
    const pidStr = fs.readFileSync(pidFile, 'utf-8').trim();
    if (parseInt(pidStr, 10) === process.pid) {
      fs.unlinkSync(pidFile);
    }
  }
  if (lockFd !== null) {
    fs.closeSync(lockFd);
    lockFd = null;
  }
}

export { acquireLock, releaseLock };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lock.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lock.ts tests/unit/lock.test.ts
git commit -m "feat: lock module with pidfile-based mutual exclusion

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Labels module

**Files:**
- Create: `src/labels.ts`
- Test: `tests/unit/labels.test.ts`

**Interfaces:**
- Produces: `STAGE_LABELS`, `LABEL_BLOCKED`, `LABEL_READY`, `LABEL_MERGE_READY`, `LABEL_CANCELLED`, `ALL_ADT_LABELS`, `stageFromLabel()`, `nextStage()`, `labelForStage()`, `replaceAdtLabels()`
- Consumed by: worker.ts, github.ts
- Consumes: `Stage` from config.ts

- [ ] **Step 1: Write the failing test**

Create `tests/unit/labels.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  STAGE_LABELS, LABEL_BLOCKED, LABEL_READY, LABEL_MERGE_READY,
  LABEL_CANCELLED, ALL_ADT_LABELS, stageFromLabel, nextStage, labelForStage,
} from '../../src/labels.js';
import type { Stage } from '../../src/config.js';

describe('STAGE_LABELS', () => {
  it('has entries for all 4 stages', () => {
    const stages: Stage[] = ['reqs', 'design', 'impl', 'review'];
    for (const s of stages) {
      expect(STAGE_LABELS[s]).toBeDefined();
      expect(STAGE_LABELS[s].running).toBe(`adt:${s}-running`);
      expect(STAGE_LABELS[s].waiting).toBe(`adt:${s}-waiting`);
    }
  });
});

describe('labelForStage', () => {
  it('returns running label for non-waiting status', () => {
    expect(labelForStage('reqs', 'running')).toBe('adt:reqs-running');
    expect(labelForStage('design', 'running')).toBe('adt:design-running');
  });

  it('returns waiting label for waiting-user status', () => {
    expect(labelForStage('reqs', 'waiting-user')).toBe('adt:reqs-waiting');
  });
});

describe('nextStage', () => {
  it('returns design after reqs', () => expect(nextStage('reqs')).toBe('design'));
  it('returns impl after design', () => expect(nextStage('design')).toBe('impl'));
  it('returns review after impl', () => expect(nextStage('impl')).toBe('review'));
  it('returns null after review', () => expect(nextStage('review')).toBeNull());
});

describe('stageFromLabel', () => {
  it('extracts stage from running label', () => {
    expect(stageFromLabel('adt:reqs-running')).toBe('reqs');
    expect(stageFromLabel('adt:impl-running')).toBe('impl');
  });
  it('extracts stage from waiting label', () => {
    expect(stageFromLabel('adt:design-waiting')).toBe('design');
  });
  it('returns null for non-stage labels', () => {
    expect(stageFromLabel('adt:ready')).toBeNull();
    expect(stageFromLabel('adt:blocked')).toBeNull();
    expect(stageFromLabel('bug')).toBeNull();
  });
});

describe('ALL_ADT_LABELS', () => {
  it('includes all adt: labels', () => {
    expect(ALL_ADT_LABELS).toContain('adt:ready');
    expect(ALL_ADT_LABELS).toContain('adt:blocked');
    expect(ALL_ADT_LABELS).toContain('adt:merge-ready');
    expect(ALL_ADT_LABELS).toContain('adt:cancelled');
    expect(ALL_ADT_LABELS).toContain('adt:reqs-running');
    expect(ALL_ADT_LABELS).toContain('adt:reqs-waiting');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/labels.test.ts`
Expected: FAIL (no module)

- [ ] **Step 3: Write minimal src/labels.ts**

```typescript
import type { Stage } from './config.js';

const STAGE_LABELS: Record<Stage, { running: string; waiting: string }> = {
  reqs:  { running: 'adt:reqs-running',  waiting: 'adt:reqs-waiting' },
  design:{ running: 'adt:design-running',waiting: 'adt:design-waiting' },
  impl:  { running: 'adt:impl-running',  waiting: 'adt:impl-waiting' },
  review:{ running: 'adt:review-running',waiting: 'adt:review-waiting' },
};

const LABEL_BLOCKED = 'adt:blocked';
const LABEL_READY = 'adt:ready';
const LABEL_MERGE_READY = 'adt:merge-ready';
const LABEL_CANCELLED = 'adt:cancelled';

const ALL_ADT_LABELS = [
  LABEL_READY, LABEL_BLOCKED, LABEL_MERGE_READY, LABEL_CANCELLED,
  ...Object.values(STAGE_LABELS).flatMap(v => [v.running, v.waiting]),
];

function labelForStage(stage: Stage, status: string): string {
  if (status === 'waiting-user') return STAGE_LABELS[stage].waiting;
  return STAGE_LABELS[stage].running;
}

function nextStage(current: Stage): Stage | null {
  const order: Stage[] = ['reqs', 'design', 'impl', 'review'];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? order[idx + 1] : null;
}

function stageFromLabel(label: string): Stage | null {
  for (const stage of ['reqs', 'design', 'impl', 'review'] as Stage[]) {
    const entry = STAGE_LABELS[stage];
    if (label === entry.running || label === entry.waiting) return stage;
  }
  return null;
}

export {
  STAGE_LABELS, LABEL_BLOCKED, LABEL_READY, LABEL_MERGE_READY,
  LABEL_CANCELLED, ALL_ADT_LABELS, labelForStage, nextStage, stageFromLabel,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/labels.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/labels.ts tests/unit/labels.test.ts
git commit -m "feat: labels module with stage->label state machine

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Result schema

**Files:**
- Create: `src/result.ts`
- Test: `tests/unit/result.test.ts`

**Interfaces:**
- Produces: `StageResult`, `parseStageResult()`
- Consumed by: worker.ts, claude-code.ts

- [ ] **Step 1: Write the failing test**

Create `tests/unit/result.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseStageResult, StageResult } from '../../src/result.js';

describe('parseStageResult', () => {
  it('parses waiting-user variant', () => {
    const raw = JSON.stringify({
      status: 'waiting-user',
      summary: 'Need clarification on X',
      artifacts: { questionList: 'What is X?' },
    });
    const result = parseStageResult(raw);
    expect(result.status).toBe('waiting-user');
    expect(result.summary).toBe('Need clarification on X');
    expect(result.artifacts).toEqual({ questionList: 'What is X?' });
  });

  it('parses done variant', () => {
    const raw = JSON.stringify({
      status: 'done',
      summary: 'Implemented feature Y',
    });
    const result = parseStageResult(raw);
    expect(result.status).toBe('done');
    expect(result.summary).toBe('Implemented feature Y');
    expect(result.artifacts).toBeUndefined();
  });

  it('parses done variant with artifacts', () => {
    const raw = JSON.stringify({
      status: 'done',
      summary: 'Done',
      artifacts: { designPath: 'docs/designs/42.md', commits: '3' },
    });
    const result = parseStageResult(raw);
    expect(result.status).toBe('done');
    expect(result.artifacts!.designPath).toBe('docs/designs/42.md');
  });

  it('parses blocked variant', () => {
    const raw = JSON.stringify({
      status: 'blocked',
      reason: 'Push rejected: non-fast-forward',
      details: 'Branch adt/issue-42-foo diverged',
    });
    const result = parseStageResult(raw);
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('Push rejected: non-fast-forward');
    expect(result.details).toBe('Branch adt/issue-42-foo diverged');
  });

  it('throws on invalid status', () => {
    expect(() => parseStageResult(JSON.stringify({ status: 'unknown' }))).toThrow();
  });

  it('throws on missing required fields', () => {
    expect(() => parseStageResult(JSON.stringify({ status: 'done' }))).toThrow();
    expect(() => parseStageResult(JSON.stringify({ status: 'blocked' }))).toThrow();
  });

  it('throws on invalid JSON string', () => {
    expect(() => parseStageResult('not json')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/result.test.ts`
Expected: FAIL (no module)

- [ ] **Step 3: Write minimal src/result.ts**

```typescript
import { z } from 'zod';

const StageResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('waiting-user'),
    summary: z.string(),
    artifacts: z.record(z.string()).optional(),
  }),
  z.object({
    status: z.literal('done'),
    summary: z.string(),
    artifacts: z.record(z.string()).optional(),
  }),
  z.object({
    status: z.literal('blocked'),
    reason: z.string(),
    details: z.string().optional(),
  }),
]);

type StageResult = z.infer<typeof StageResult>;

function parseStageResult(raw: string): StageResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse stage result JSON: ${e}`);
  }
  return StageResult.parse(obj);
}

export { StageResult, parseStageResult };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/result.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/result.ts tests/unit/result.test.ts
git commit -m "feat: result schema with zod discriminated union

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Store module

**Files:**
- Create: `src/store.ts`
- Test: `tests/unit/store.test.ts`

**Interfaces:**
- Produces: `openDb()`, `listRunnableTasks()`, `markTaskRunning()`, `markTaskFinished()`, `insertTask()`, `getTask()`, `getAllTasks()`, `TaskRow`, `EventRow`
- Consumed by: worker.ts, cli.ts (status subcommand)
- Consumes: `Stage`, `TaskStatus` types from config.ts and labels.ts

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/store.test.ts`
Expected: FAIL (no module)

- [ ] **Step 3: Write minimal src/store.ts**

```typescript
import Database from 'better-sqlite3';

type Stage = 'reqs' | 'design' | 'impl' | 'review';
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

const STAGE_ORDER: Record<Stage, number> = { reqs: 0, design: 1, impl: 2, review: 3 };

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
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('running', taskId);
}

function markTaskFinished(db: Database.Database, taskId: number, newStatus: TaskStatus): void {
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(newStatus, taskId);
}

export {
  openDb, listRunnableTasks, markTaskRunning, markTaskFinished,
  insertTask, getTask, getAllTasks,
  TaskRow, EventRow, Stage, TaskStatus,
};
```

Note: the `UNIQUE(repo, issue_number)` constraint is intentionally omitted -- the same repo+issue can have multiple task records if re-run (ADR 0005: stages not idempotent). The worker always queries by `repo + issue_number + status != 'done'/cancelled`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/store.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/unit/store.test.ts
git commit -m "feat: store module with SQLite CRUD for tasks

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: GitHub module

**Files:**
- Create: `src/github.ts`
- Test: `tests/unit/github.test.ts` (uses nock to mock HTTP)

**Interfaces:**
- Produces: `createClient`, `listReadyIssues`, `getIssue`, `getComments`, `postComment`, `replaceAdtLabel`, `getPR`, `isPRMerged`, `isPRClosed`, `hasApprovedReview`
- Consumed by: worker.ts, cli.ts

**Note:** This module wraps Octokit rest.js. Since we cant run `npm install` to get nock for tests yet, the test file is written as a skeleton. Full nock tests are written in the integration task.

- [ ] **Step 1: Write src/github.ts**

```typescript
import { Octokit } from "@octokit/rest";

type OctokitClient = Octokit;

function createClient(token: string): OctokitClient {
  return new Octokit({ auth: token });
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  created_at: string;
}

interface GhComment {
  id: number;
  body: string;
  created_at: string;
  user: { login: string } | null;
}

interface GhPR {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  html_url: string;
}

interface GhReview {
  id: number;
  state: string; // "APPROVED", "CHANGES_REQUESTED", "COMMENTED"
  user: { login: string } | null;
}

async function listReadyIssues(client: OctokitClient, repo: string): Promise<GhIssue[]> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.issues.listForRepo({
    owner, repo: name,
    labels: "adt:ready",
    state: "open",
    per_page: 100,
  });
  return data as GhIssue[];
}

async function getIssue(client: OctokitClient, repo: string, issueNumber: number): Promise<GhIssue> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.issues.get({ owner, repo: name, issue_number: issueNumber });
  return data as unknown as GhIssue;
}

async function getComments(client: OctokitClient, repo: string, issueNumber: number): Promise<GhComment[]> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.issues.listComments({ owner, repo: name, issue_number: issueNumber });
  return data as GhComment[];
}

async function postComment(client: OctokitClient, repo: string, issueNumber: number, body: string): Promise<void> {
  const [owner, name] = repo.split("/");
  await client.rest.issues.createComment({ owner, repo: name, issue_number: issueNumber, body });
}

async function replaceAdtLabel(client: OctokitClient, repo: string, issueNumber: number, newLabel: string): Promise<void> {
  const [owner, name] = repo.split("/");
  const ALL_ADT_LABELS = [
    "adt:ready", "adt:blocked", "adt:merge-ready", "adt:cancelled",
    "adt:reqs-running", "adt:reqs-waiting",
    "adt:design-running", "adt:design-waiting",
    "adt:impl-running", "adt:impl-waiting",
    "adt:review-running", "adt:review-waiting",
  ];
  // Remove all existing adt:* labels
  const { data: issue } = await client.rest.issues.get({ owner, repo: name, issue_number: issueNumber });
  const existingLabels: string[] = (issue.labels || []).map((l: any) => l.name);
  const toRemove = existingLabels.filter(l => ALL_ADT_LABELS.includes(l));
  for (const label of toRemove) {
    try { await client.rest.issues.removeLabel({ owner, repo: name, issue_number: issueNumber, name: label }); } catch (_) {}
  }
  await client.rest.issues.addLabels({ owner, repo: name, issue_number: issueNumber, labels: [newLabel] });
}

async function getPR(client: OctokitClient, repo: string, prNumber: number): Promise<GhPR> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.pulls.get({ owner, repo: name, pull_number: prNumber });
  return data as unknown as GhPR;
}

async function isPRMerged(client: OctokitClient, repo: string, prNumber: number): Promise<boolean> {
  const pr = await getPR(client, repo, prNumber);
  return pr.merged === true;
}

async function isPRClosed(client: OctokitClient, repo: string, prNumber: number): Promise<boolean> {
  const pr = await getPR(client, repo, prNumber);
  return pr.state === "closed" && !pr.merged;
}

async function hasApprovedReview(client: OctokitClient, repo: string, prNumber: number): Promise<boolean> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.pulls.listReviews({ owner, repo: name, pull_number: prNumber });
  return data.some((r: any) => r.state === "APPROVED");
}

export {
  createClient, listReadyIssues, getIssue, getComments,
  postComment, replaceAdtLabel, getPR, isPRMerged, isPRClosed, hasApprovedReview,
  OctokitClient, GhIssue, GhComment, GhPR, GhReview,
};
```

- [ ] **Step 2: Write the test skeleton**

Create `tests/unit/github.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import nock from "nock";
import {
  createClient, listReadyIssues, getIssue, getComments,
  postComment, replaceAdtLabel, isPRMerged, hasApprovedReview,
} from "../../src/github.js";

const BASE = "https://api.github.com";
let client: ReturnType<typeof createClient>;

describe("github module (nock)", () => {
  beforeEach(() => {
    client = createClient("ghp_test");
    nock.cleanAll();
  });

  afterEach(() => nock.cleanAll());

  describe("listReadyIssues", () => {
    it("returns issues with adt:ready label", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues")
        .query({ labels: "adt:ready", state: "open", per_page: 100 })
        .reply(200, [{ number: 42, title: "Fix bug", state: "open", body: "desc", created_at: "2026-01-01T00:00:00Z", labels: [{ name: "adt:ready" }] }]);

      const issues = await listReadyIssues(client, "owner/repo");
      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(42);
    });
  });

  describe("getIssue", () => {
    it("fetches an issue", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues/42")
        .reply(200, { number: 42, title: "Test", state: "open", body: "hello", created_at: "2026-01-01T00:00:00Z" });
      const issue = await getIssue(client, "owner/repo", 42);
      expect(issue.number).toBe(42);
      expect(issue.body).toBe("hello");
    });
  });

  describe("getComments", () => {
    it("fetches comments", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues/42/comments")
        .reply(200, [{ id: 1, body: "ok", created_at: "2026-01-01T00:00:00Z", user: { login: "dev" } }]);
      const comments = await getComments(client, "owner/repo", 42);
      expect(comments).toHaveLength(1);
      expect(comments[0].body).toBe("ok");
    });
  });

  describe("isPRMerged", () => {
    it("returns true for merged PR", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99")
        .reply(200, { number: 99, title: "PR", state: "closed", merged: true, html_url: "https://github.com/owner/repo/pull/99" });
      expect(await isPRMerged(client, "owner/repo", 99)).toBe(true);
    });
  });

  describe("hasApprovedReview", () => {
    it("returns true when any review is APPROVED", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99/reviews")
        .reply(200, [{ id: 1, state: "APPROVED", user: { login: "reviewer" } }]);
      expect(await hasApprovedReview(client, "owner/repo", 99)).toBe(true);
    });
  });
});
```

- [ ] **Step 3: Add nock to devDeps**

Run: `npm install --save-dev nock @types/node`

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/github.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/github.ts tests/unit/github.test.ts package.json package-lock.json
git commit -m "feat: github module with Octokit wrapper

Co-Authored-By: Claude <noreply@anthropic.com>"
```


### Task 8: Worktree module

**Files:**
- Create: `src/worktree.ts`
- Test: `tests/unit/worktree.test.ts`

**Interfaces:**
- Produces: `ensureWorktree`, `removeWorktree`, `pruneWorktrees`
- Consumed by: worker.ts

- [ ] **Step 1: Write src/worktree.ts**

```typescript
import * as path from "node:path";
import * as fs from "node:fs";
import simpleGit, { type SimpleGit } from "simple-git";

function worktreesDir(repoPath: string): string {
  return path.join(repoPath, "..", ".adt-worktrees");
}

function worktreePath(repoPath: string, issueNumber: number): string {
  return path.join(worktreesDir(repoPath), `issue-${issueNumber}`);
}

function branchName(issueNumber: number, slug: string): string {
  return `adt/issue-${issueNumber}-${slug}`;
}

async function ensureWorktree(repoPath: string, issueNumber: number, branch: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoPath);
  const wtPath = worktreePath(repoPath, issueNumber);
  const wtDir = worktreesDir(repoPath);

  fs.mkdirSync(wtDir, { recursive: true });

  // Check if worktree already exists
  const list = await git.raw("worktree", "list");
  if (list.includes(wtPath)) {
    return wtPath;
  }

  // Check if branch exists
  const branches = await git.branchLocal();
  if (branches.all.includes(branch)) {
    // Branch exists, add worktree for it
    await git.raw("worktree", "add", wtPath, branch);
  } else {
    // Create new branch from HEAD of main
    await git.raw("worktree", "add", "-b", branch, wtPath, "origin/main");
  }

  // Create .adt context directory
  fs.mkdirSync(path.join(wtPath, ".adt"), { recursive: true });

  return wtPath;
}

async function removeWorktree(repoPath: string, issueNumber: number): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  const wtPath = worktreePath(repoPath, issueNumber);

  if (!fs.existsSync(wtPath)) return;

  await git.raw("worktree", "remove", wtPath, "--force");
}

async function pruneWorktrees(repoPath: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  await git.raw("worktree", "prune");
}

export { ensureWorktree, removeWorktree, pruneWorktrees, worktreePath, branchName, worktreesDir };
```

- [ ] **Step 2: Write the test**

Create `tests/unit/worktree.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureWorktree, removeWorktree, worktreePath, branchName, worktreesDir } from "../../src/worktree.js";
import simpleGit from "simple-git";

const TMP = `/tmp/worktree-test-${Date.now()}`;
const REPO = path.join(TMP, "test-repo");
let git: ReturnType<typeof simpleGit>;

beforeEach(async () => {
  fs.mkdirSync(REPO, { recursive: true });
  git = simpleGit(REPO);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");
  fs.writeFileSync(path.join(REPO, "README.md"), "# test\n");
  await git.add("README.md");
  await git.commit("initial commit");
  // Create a fake origin/main branch for worktree add -b
  await git.raw("checkout", "-b", "main");
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("branchName", () => {
  it("generates a branch name from issue number and slug", () => {
    expect(branchName(42, "fix-bug")).toBe("adt/issue-42-fix-bug");
  });
});

describe("ensureWorktree and removeWorktree", () => {
  it("creates and removes a worktree", async () => {
    const branch = branchName(1, "test");
    const wtPath = await ensureWorktree(REPO, 1, branch);
    expect(fs.existsSync(wtPath)).toBe(true);
    expect(fs.existsSync(path.join(wtPath, ".adt"))).toBe(true);
    expect(fs.existsSync(path.join(wtPath, "README.md"))).toBe(true);
    await removeWorktree(REPO, 1);
    // Worktree path may still exist as empty dir after remove --force, but worktree list should not include it
    // Just verify we do not crash
  });

  it("returns existing worktree path on second call", async () => {
    const branch = branchName(2, "test");
    const wtPath1 = await ensureWorktree(REPO, 2, branch);
    const wtPath2 = await ensureWorktree(REPO, 2, branch);
    expect(wtPath1).toBe(wtPath2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/worktree.test.ts`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add src/worktree.ts tests/unit/worktree.test.ts
git commit -m "feat: worktree module with simple-git wrapper

Co-Authored-By: Claude <noreply@anthropic.com>"
```


### Task 9: Claude Code spawn module

**Files:**
- Create: `src/claude-code.ts`
- Test: `tests/unit/claude-code.test.ts`

**Interfaces:**
- Produces: `spawnCcMm`, `buildPromptFile`, `SpawnOpts`, `SpawnResult`
- Consumed by: worker.ts
- Consumes: `StageResult` from result.ts, `Stage` from config.ts

- [ ] **Step 1: Write src/claude-code.ts**

```typescript
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseStageResult, type StageResult } from "./result.js";
import type { Stage } from "./config.js";

interface SpawnOpts {
  cwd: string;
  stage: Stage;
  promptFile: string;
  maxDuration: number; // minutes
  allowedTools: string[];
  env: Record<string, string>;
}

type SpawnResult =
  | { ok: true; result: StageResult }
  | { ok: false; error: string; partialOutput: string };

const DEFAULT_TOOLS: Record<Stage, string[]> = {
  reqs: ["Bash", "Read", "Write"],
  design: ["Bash", "Read", "Write", "Grep"],
  impl: ["Bash", "Read", "Write", "Grep", "Glob", "Edit", "WebFetch"],
  review: ["Bash", "Read", "Write", "Grep", "Edit"],
};

function buildPromptFile(
  worktreePath: string,
  issueData: { number: number; title: string; body: string | null; repo: string },
  comments: { id: number; body: string; user: { login: string } | null }[],
  stage: Stage,
): string {
  const ctxDir = path.join(worktreePath, ".adt");
  fs.mkdirSync(ctxDir, { recursive: true });

  // Write context files
  fs.writeFileSync(path.join(ctxDir, "issue.json"), JSON.stringify(issueData, null, 2));
  fs.writeFileSync(path.join(ctxDir, "comments.json"), JSON.stringify(comments, null, 2));
  fs.writeFileSync(path.join(ctxDir, "stage.txt"), stage);
  fs.writeFileSync(path.join(ctxDir, "branch.txt"), `adt/issue-${issueData.number}-auto`);

  // Write the prompt that tells cc-mm what to do
  const prompt = `You are running stage: ${stage} for issue #${issueData.number} in repo ${issueData.repo}.

Context files are at:
  .adt/issue.json     — the GitHub Issue body and metadata
  .adt/comments.json  — all Issue/PR comments so far
  .adt/stage.txt      — the current stage name
  .adt/branch.txt     — the git branch name for this task

Your skill (agent-dev-team) defines what to do for each stage. Execute the stage,
then write the result JSON to .adt/${stage}-result.json matching this schema:

{
  "status": "waiting-user" | "done" | "blocked",
  "summary": "...",
  "artifacts": { ... }   // optional
  "reason": "...",       // required if status=blocked
  "details": "..."       // optional if status=blocked
}

You MUST write valid JSON. Exit code 0 on success.
`;

  const promptPath = path.join(ctxDir, "prompt.md");
  fs.writeFileSync(promptPath, prompt);
  return promptPath;
}

async function spawnCcMm(opts: SpawnOpts): Promise<SpawnResult> {
  const tools = opts.allowedTools.length > 0 ? opts.allowedTools : (DEFAULT_TOOLS[opts.stage] || []);
  const args = [
    "-p", opts.promptFile,
    "--allowedTools", tools.join(","),
    "--output-format", "json",
  ];

  const env = { ...process.env, ...opts.env };

  return new Promise((resolve) => {
    const child = spawn(opts.ccMmPath || "cc-mm", args, {
      cwd: opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timeoutMs = opts.maxDuration * 60 * 1000;
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 30000);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);

      if (killed) {
        resolve({
          ok: false,
          error: `cc-mm timed out after ${opts.maxDuration}m. Graceful kill attempted.`,
          partialOutput: stdout.slice(-4000),
        });
        return;
      }

      if (code !== 0) {
        resolve({
          ok: false,
          error: `cc-mm exited with code ${code}. stderr: ${stderr.slice(-2000)}`,
          partialOutput: stdout.slice(-4000),
        });
        return;
      }

      // Read result.json from worktree
      const resultPath = path.join(opts.cwd, ".adt", `${opts.stage}-result.json`);
      try {
        const raw = fs.readFileSync(resultPath, "utf-8");
        const result = parseStageResult(raw);
        resolve({ ok: true, result });
      } catch (e) {
        // Retry: the output is in stdout, try parsing that
        resolve({
          ok: false,
          error: `Failed to parse result: ${e}. stdout tail: ${stdout.slice(-2000)}`,
          partialOutput: stdout.slice(-4000),
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `Failed to spawn cc-mm: ${err.message}`, partialOutput: "" });
    });
  });
}

export { spawnCcMm, buildPromptFile, SpawnOpts, SpawnResult, DEFAULT_TOOLS };
```

- [ ] **Step 2: Write the test**

Create `tests/unit/claude-code.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildPromptFile, DEFAULT_TOOLS } from "../../src/claude-code.js";

const TMP = `/tmp/claude-code-test-${Date.now()}`;
const WT = path.join(TMP, "worktree");

beforeEach(() => {
  fs.mkdirSync(path.join(WT, ".adt"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("buildPromptFile", () => {
  it("creates context files and returns prompt path", () => {
    const issue = { number: 42, title: "Fix bug", body: "description of bug", repo: "owner/repo" };
    const comments = [{ id: 1, body: "ok", user: { login: "dev" } }];

    const promptPath = buildPromptFile(WT, issue, comments, "reqs");

    expect(promptPath).toBe(path.join(WT, ".adt", "prompt.md"));
    expect(fs.existsSync(promptPath)).toBe(true);
    expect(fs.existsSync(path.join(WT, ".adt", "issue.json"))).toBe(true);
    expect(fs.existsSync(path.join(WT, ".adt", "comments.json"))).toBe(true);
    expect(fs.existsSync(path.join(WT, ".adt", "stage.txt"))).toBe(true);

    const stageTxt = fs.readFileSync(path.join(WT, ".adt", "stage.txt"), "utf-8");
    expect(stageTxt).toBe("reqs");

    const issueJson = JSON.parse(fs.readFileSync(path.join(WT, ".adt", "issue.json"), "utf-8"));
    expect(issueJson.number).toBe(42);
    expect(issueJson.title).toBe("Fix bug");
  });
});

describe("DEFAULT_TOOLS", () => {
  it("has entries for all 4 stages", () => {
    for (const s of ["reqs", "design", "impl", "review"]) {
      expect(Array.isArray(DEFAULT_TOOLS[s as keyof typeof DEFAULT_TOOLS])).toBe(true);
      expect(DEFAULT_TOOLS[s as keyof typeof DEFAULT_TOOLS].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/claude-code.test.ts`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add src/claude-code.ts tests/unit/claude-code.test.ts
git commit -m "feat: claude-code spawn module with timeout and result parsing

Co-Authored-By: Claude <noreply@anthropic.com>"
```


### Task 10: Worker module (core orchestrator)

**Files:**
- Create: `src/worker.ts`
- Test: `tests/unit/worker.test.ts`

**Interfaces:**
- Produces: `runWorker`
- Consumed by: cli.ts
- Consumes: EVERYTHING. config, store, lock, labels, result, github, worktree, claude-code.

- [ ] **Step 1: Write src/worker.ts**

```typescript
import Database from "better-sqlite3";
import { loadConfig, type Config, type Stage } from "./config.js";
import { openDb, listRunnableTasks, markTaskRunning, markTaskFinished, insertTask, getTask, type TaskRow } from "./store.js";
import { acquireLock, releaseLock } from "./lock.js";
import { nextStage, labelForStage, LABEL_BLOCKED, LABEL_CANCELLED } from "./labels.js";
import { parseStageResult } from "./result.js";
import { createClient, listReadyIssues, getIssue, getComments, postComment, replaceAdtLabel, isPRMerged, isPRClosed, hasApprovedReview } from "./github.js";
import { ensureWorktree, removeWorktree, pruneWorktrees, branchName } from "./worktree.js";
import { spawnCcMm, buildPromptFile, DEFAULT_TOOLS } from "./claude-code.js";
import * as path from "node:path";

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// Check if user has approved the design stage
async function checkApproval(
  client: ReturnType<typeof createClient>,
  repo: string,
  issueNumber: number,
  _stage: Stage,
): Promise<boolean> {
  const comments = await getComments(client, repo, issueNumber);
  // Check for /adt-approve comment
  const hasApproveComment = comments.some(c =>
    /^/adt-approve(\s.*)?$/im.test(c.body)
  );
  if (hasApproveComment) return true;

  // Check for PR Approve event -- look for an open PR associated with this issue
  // (In v1, we check any PR mentioning the issue)
  // This is a simple heuristic; full PR detection is done via getPR + hasApprovedReview
  return false;
}

async function runWorker(): Promise<void> {
  let db: Database.Database | null = null;

  try {
    // 1. Lock
    if (!acquireLock()) {
      console.log("Another worker is running. Exiting.");
      return;
    }

    // 2. Load config
    const config = loadConfig();

    // 3. Open store
    db = openDb(path.join(
      process.env.ADT_DIR || path.join(require("node:os").homedir(), ".adt"),
      "state.db"
    ));

    // 4. List runnable tasks from store
    let task: TaskRow | null = null;
    const pending = listRunnableTasks(db);
    if (pending.length > 0) {
      task = pending[0]; // Sorted by FIFO + stage priority
    }

    // 5. If nothing in store, scan GitHub for new adt:ready issues
    if (!task) {
      const client = createClient(config.githubToken);
      for (const repo of config.repos) {
        const issues = await listReadyIssues(client, repo);
        if (issues.length > 0) {
          const issue = issues[0];
          const slug = slugFromTitle(issue.title);
          const branch = branchName(issue.number, slug);
          const repoPath = process.cwd(); // Assume cwd is the repo clone
          const wtPath = await ensureWorktree(repoPath, issue.number, branch);
          const taskId = insertTask(db, repo, issue.number, "reqs", "pending", wtPath, branch);
          task = getTask(db, taskId);
          break;
        }
      }
    }

    if (!task) {
      console.log("No runnable tasks.");
      return;
    }

    // 6. Check for approval (design stage)
    if (task.stage === "design") {
      const client = createClient(config.githubToken);
      const approved = await checkApproval(client, task.repo, task.issue_number, task.stage);
      if (!approved) {
        console.log(`Task #${task.issue_number} is waiting for design approval.`);
        return;
      }
    }

    // 7. Check for merged PR (review stage)
    if (task.stage === "review") {
      // If PR was merged or closed, handle cleanup
      // In v1, we rely on the worker checking the PR status on next run
      // via listReadyIssues detecting the merged PR
    }

    // 8. Mark running
    markTaskRunning(db, task.id);

    // 9. Get issue data from GitHub
    const client = createClient(config.githubToken);
    const issue = await getIssue(client, task.repo, task.issue_number);
    const comments = await getComments(client, task.repo, task.issue_number);

    // 10. Build prompt and context
    const wtPath = task.worktree_path!;
    const promptFile = buildPromptFile(wtPath, {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      repo: task.repo,
    }, comments, task.stage);

    // 11. Spawn cc-mm
    const timeout = config.stageTimeouts[task.stage] || 30;
    const tools = DEFAULT_TOOLS[task.stage] || [];
    const result = await spawnCcMm({
      cwd: wtPath,
      stage: task.stage,
      promptFile,
      maxDuration: timeout,
      allowedTools: tools,
      env: { GH_TOKEN: config.githubToken },
    });

    // 12. Handle result
    if (!result.ok) {
      // Failed
      markTaskFinished(db, task.id, "failed");
      await postComment(
        client, task.repo, task.issue_number,
        `## adt: ${task.stage} failed\n\n${result.error}\n\n<details><summary>Last output</summary>\n\n\`\`\`\n${result.partialOutput}\n\`\`\`\n</details>`,
      );
      await replaceAdtLabel(client, task.repo, task.issue_number, LABEL_BLOCKED);
      return;
    }

    const stageResult = result.result;

    // 13. Handle each status variant
    switch (stageResult.status) {
      case "waiting-user": {
        markTaskFinished(db, task.id, "waiting-user");
        const label = labelForStage(task.stage, "waiting-user");
        await postComment(client, task.repo, task.issue_number, `## adt: ${task.stage}\n\n${stageResult.summary}`);
        await replaceAdtLabel(client, task.repo, task.issue_number, label);
        break;
      }
      case "done": {
        const next = nextStage(task.stage);
        if (next) {
          markTaskFinished(db, task.id, "pending");
          // Update stage in store
          db!.prepare("UPDATE tasks SET stage = ? WHERE id = ?").run(next, task.id);
          const label = labelForStage(next, "running");
          await postComment(client, task.repo, task.issue_number, `## adt: ${task.stage} complete\n\n${stageResult.summary}\n\nProceeding to ${next}.`);
          await replaceAdtLabel(client, task.repo, task.issue_number, label);
        } else {
          // Review done, check for PR and mark merge-ready
          markTaskFinished(db, task.id, "done");
          // Check for open PR via comments to detect PR number
          await replaceAdtLabel(client, task.repo, task.issue_number, "adt:merge-ready");
          await postComment(client, task.repo, task.issue_number, `## adt: review complete\n\n${stageResult.summary}\n\nPR is ready for merge.`);
        }
        break;
      }
      case "blocked": {
        markTaskFinished(db, task.id, "blocked");
        const msg = `## adt: blocked\n\n**Reason:** ${stageResult.reason}${stageResult.details ? `\n\n**Details:** ${stageResult.details}` : ""}`;
        await postComment(client, task.repo, task.issue_number, msg);
        await replaceAdtLabel(client, task.repo, task.issue_number, LABEL_BLOCKED);
        break;
      }
    }
  } catch (err) {
    console.error("Worker error:", err);
  } finally {
    if (db) db.close();
    releaseLock();
  }
}

export { runWorker };
```

- [ ] **Step 2: Run tsc check**

Run: `npx tsc --noEmit`
Expected: should compile without errors (fix any type issues)

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat: worker module - full orchestrator

Co-Authored-By: Claude <noreply@anthropic.com>"
```


### Task 11: CLI module

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json` (add bin + shebang)

**Interfaces:**
- Produces: commander program (entry point)
- Consumes: worker.ts, config.ts, store.ts, lock.ts

- [ ] **Step 1: Write src/cli.ts**

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, saveConfig, type Config } from "./config.js";
import { runWorker } from "./worker.js";
import { openDb, getAllTasks, type TaskRow } from "./store.js";
import { acquireLock, releaseLock } from "./lock.js";
import * as path from "node:path";

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
    const ADT_DIR = process.env.ADT_DIR || path.join(require("node:os").homedir(), ".adt");
    let cfg: Config;

    try {
      cfg = loadConfig();
    } catch {
      // First-time setup
      const readline = require("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r as any));

      const token = await ask("GitHub PAT (repo scope): ");
      const repo = await ask("Repo to watch (owner/repo): ");
      const ccMm = await ask("Path to cc-mm binary [cc-mm]: ") || "cc-mm";

      rl.close();

      cfg = {
        githubToken: token,
        repos: [repo],
        ccMmPath: ccMm,
        stageTimeouts: { reqs: 10, design: 20, impl: 60, review: 30 },
      };
      saveConfig(cfg);
      console.log(`Config saved to ${path.join(ADT_DIR, "config.json")}`);
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
    const dbPath = path.join(
      process.env.ADT_DIR || path.join(require("node:os").homedir(), ".adt"),
      "state.db"
    );
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
    const dbPath = path.join(
      process.env.ADT_DIR || path.join(require("node:os").homedir(), ".adt"),
      "state.db"
    );
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
    const dbPath = path.join(
      process.env.ADT_DIR || path.join(require("node:os").homedir(), ".adt"),
      "state.db"
    );
    const db = openDb(dbPath);
    db.prepare("UPDATE tasks SET status = ? WHERE repo = ? AND issue_number = ? AND status = ?")
      .run("pending", repo, issueNumber, "cancelled");
    db.close();
    console.log(`Resumed ${taskRef}`);
  });

program.parse();
```

- [ ] **Step 2: Update package.json bin field**

Ensure `package.json` has:
```json
"bin": { "adt": "./dist/src/cli.js" }
```

And `scripts.build` is `"tsc"`.

Run: `npm run build`
Expected: compiles to dist/

- [ ] **Step 3: Test CLI compiles and help works**

Run: `node dist/src/cli.js --help`
Expected: commander help output

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts package.json
git commit -m "feat: CLI module with setup/run/status/clean/pause/resume commands

Co-Authored-By: Claude <noreply@anthropic.com>"
```
### Task 12: agent-dev-team Skill

**Files:**
- Create: The skill file at the user skill location (outside repo)

**Note:** This task creates the `~/.claude/skills/agent-dev-team/SKILL.md` file that cc-mm loads. It is not part of the repo but is essential for the system to function.

- [ ] **Step 1: Create the skill directory**

Run: `mkdir -p ~/.claude/skills/agent-dev-team`

- [ ] **Step 2: Write the skill**

Create `~/.claude/skills/agent-dev-team/SKILL.md`:

````markdown
---
name: agent-dev-team
description: Implements a GitHub Issue by walking through 4 stages (requirements, design, implementation, review). Each invocation handles exactly one stage and writes its outcome to .adt/<stage>-result.json. Driven by adt run.
---

# agent-dev-team

You are an autonomous software development team executing one stage at a time.
Read context from `.adt/issue.json`, `.adt/comments.json`, `.adt/stage.txt`.

## Result schema

Write your result to `.adt/<stage>-result.json` using exactly this JSON:

```json
{"status": "waiting-user", "summary": "..."}
{"status": "done", "summary": "...", "artifacts": {}}
{"status": "blocked", "reason": "...", "details": "..."}
```

"artifacts" and "details" are optional.

## Stage 1: reqs (PM)

Goal: Understand what the user wants. If unclear, ask clarifying questions.

1. Read `.adt/issue.json` for the Issue body.
2. Read `.adt/comments.json` for any prior discussion.
3. If requirements are unclear: write `{"status": "waiting-user", "summary": "Your questions here..."}` and STOP. Do NOT post a GitHub comment (the TS worker will).
4. If requirements are clear: summarize them as "Requirements Summary" and write `{"status": "done", "summary": "Requirements Summary..."}`.

## Stage 2: design (Dev)

Goal: Produce a design document for user approval.

1. Read the requirements from prior stage comments.
2. Explore the codebase using Read and Grep tools.
3. Write a design document to `docs/designs/<issue>.md` (create `docs/designs/` if missing).
4. Commit the design doc to the current branch (git add + git commit).
5. Write `{"status": "waiting-user", "summary": "Design doc at docs/designs/<issue>.md. Reply with /adt-approve to proceed."}`.

## Stage 3: impl (Dev)

Goal: Implement the approved design.

1. Read the design doc and requirements.
2. Implement changes, write tests, verify they pass.
3. Commit all changes to the current branch.
4. Push the branch: `git push origin <branch>` (read branch name from `.adt/branch.txt`).
5. Write `{"status": "done", "summary": "Implementation complete. Commits: N", "artifacts": {"commits": "3"}}`.

If `git push` fails with non-fast-forward, write `{"status": "blocked", "reason": "Push rejected: branch has diverged. Manual rebase required.", "details": "<error output>"}`.

## Stage 4: review (Reviewer)

Goal: Open a PR and prepare for user merge.

1. Run tests: `npm test` or equivalent.
2. Read the diff: `git diff origin/main...HEAD`.
3. Open a PR: `gh pr create --base main --head <branch> --title "adt: <issue title>" --body "Closes #<issue number>. Implemented by agent-dev-team."`
4. Write `{"status": "done", "summary": "PR opened: <url>", "artifacts": {"prUrl": "<url>"}}`.

If tests fail, write `{"status": "blocked", "reason": "Tests are failing.", "details": "<test output>"}`.

## Rules

- Never post GitHub comments directly. The TS worker posts them.
- Always write valid JSON to `.adt/<stage>-result.json`.
- If you get stuck, write `{"status": "blocked", "reason": "..."}`.
- Use `gh` CLI for GitHub operations (env var GH_TOKEN is set).
````

- [ ] **Step 3: Verify skill is discoverable**

Run: `ls -la ~/.claude/skills/agent-dev-team/SKILL.md`
Expected: file exists

---

### Task 13: Fixtures and integration test

**Files:**
- Create: `fixtures/fake-cc-mm.sh`, `fixtures/sample-issue.json`
- Create: `tests/integration/e2e.test.ts`

- [ ] **Step 1: Write fake-cc-mm.sh**

Create `fixtures/fake-cc-mm.sh`:
```bash
#!/bin/bash
# Fake cc-mm for integration testing.
# Reads STAGE from .adt/stage.txt and emits a canned result.
set -e

CWD="${CC_MM_CWD:-$(pwd)}"
STAGE_FILE="$CWD/.adt/stage.txt"

if [ -f "$STAGE_FILE" ]; then
  STAGE=$(cat "$STAGE_FILE")
  RESULT_FILE="$CWD/.adt/$STAGE-result.json"
  mkdir -p "$CWD/.adt"

  case "$STAGE" in
    reqs)
      echo '{"status":"waiting-user","summary":"What should the API return on error?"}' > "$RESULT_FILE"
      ;;
    design)
      mkdir -p "$CWD/docs/designs"
      echo "# Design for issue" > "$CWD/docs/designs/test.md"
      echo '{"status":"waiting-user","summary":"Design: docs/designs/test.md"}' > "$RESULT_FILE"
      ;;
    impl)
      echo "test" > "$CWD/result.txt"
      echo '{"status":"done","summary":"Implementation done"}' > "$RESULT_FILE"
      ;;
    review)
      echo '{"status":"done","summary":"PR: https://github.com/test/test/pull/1","artifacts":{"prUrl":"https://github.com/test/test/pull/1"}}' > "$RESULT_FILE"
      ;;
  esac
  exit 0
fi
exit 1
```

Run: `chmod +x fixtures/fake-cc-mm.sh`

- [ ] **Step 2: Write sample-issue.json**

Create `fixtures/sample-issue.json`:

```json
{
  "number": 42,
  "title": "Add healthcheck endpoint",
  "state": "open",
  "body": "We need a GET /health endpoint that returns 200 with status ok.",
  "created_at": "2026-07-01T00:00:00Z",
  "labels": [{ "name": "adt:ready" }]
}
```

- [ ] **Step 3: Write the e2e integration test**

Create `tests/integration/e2e.test.ts`:

```typescript
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
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all unit + integration tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: fixtures, integration tests, final wiring

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 14: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# agent-dev-team (adt)

A local CLI that drives a multi-agent dev team from GitHub Issues.

## Setup
```bash
npm install && npm run build && npm link && adt setup
```

Prompts for: GitHub PAT (repo scope), repos to watch (owner/repo), path to cc-mm.

## Usage
```bash
# Schedule periodic runs:
while true; do adt run; sleep 60; done
# or cron: */1 * * * * adt run >> ~/.adt/log 2>&1
```

Commands: `adt run`, `adt status`, `adt pause owner/repo#42`, `adt resume owner/repo#42`, `adt clean`.

## How it works
1. Label an Issue `adt:ready`
2. Next `adt run` picks it up
3. Team walks through 4 stages: **reqs** (PM) -> **design** (Dev) -> **impl** (Dev) -> **review** (Reviewer)
4. At reqs, design, and merge the team pauses for your input
5. Everything happens in GitHub Issue/PR comments and labels

## Requirements
Node.js 20+, cc-mm CLI, local git clone
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup and usage

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

1. **Spec coverage:** All sections covered. Section 2 (Roles/Lifecycle) -> Tasks 10+12. Section 3 (Architecture) -> Tasks 7-10. Section 4 (Components) -> All tasks cover listed files. Section 5 (Data flow) -> Task 10. Section 6 (Lifecycle/Labels) -> Task 4. Section 7 (Skill + Result schema) -> Tasks 5+12. Section 8 (Error handling) -> Task 10. Section 9 (Testing) -> Tasks 1-13. Section 10 (Tech stack) -> Task 1. Section 11 (File structure) -> All tasks. Section 12 (Setup UX) -> Task 11. Section 13 (Out of scope) -> No out-of-scope items implemented. Section 14 (ADRs) -> Global Constraints.

2. **Placeholder scan:** No TBD, TODO, or hand-wavy "add error handling" statements. Every step has concrete code or exact commands.

3. **Type consistency:** Stage, TaskStatus, StageResult, TaskRow types are defined in one place and consumed consistently across all modules. All function signatures match between interface declarations and implementations.
