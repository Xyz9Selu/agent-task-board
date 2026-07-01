import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Config } from '../../src/config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Set ADT_DIR before importing config module
const testDir = path.join('/tmp', 'adt-config-test-' + Date.now());
process.env.ADT_DIR = testDir;

// Dynamic import to pick up env var
const configModule = await import('../../src/config.js');
const { loadConfig, saveConfig, CONFIG_PATH, DEFAULT_TIMEOUTS } = configModule;

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

  it('fills in default stageTimeouts when only partial keys are saved', () => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      githubToken: 't',
      repos: ['a/b'],
      ccMmPath: '/bin/cc-mm',
      stageTimeouts: { reqs: 5, impl: 45 },
    }));
    const loaded = loadConfig();
    expect(loaded.stageTimeouts.reqs).toBe(5);
    expect(loaded.stageTimeouts.design).toBe(DEFAULT_TIMEOUTS.design);
    expect(loaded.stageTimeouts.impl).toBe(45);
    expect(loaded.stageTimeouts.review).toBe(DEFAULT_TIMEOUTS.review);
  });

  it('defaults ccMmPath to cc-mm when not present in saved config', () => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      githubToken: 't',
      repos: ['a/b'],
      stageTimeouts: { reqs: 10, design: 20, impl: 60, review: 30 },
    }));
    const loaded = loadConfig();
    expect(loaded.ccMmPath).toBe('cc-mm');
  });
});
