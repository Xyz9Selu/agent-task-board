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
    const result = acquireLock();
    expect(result).toBe(false);
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
