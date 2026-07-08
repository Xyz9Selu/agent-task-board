import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Set ADT_DIR before importing config / doctor modules
const testDir = path.join('/tmp', 'adt-doctor-test-' + Date.now());
process.env.ADT_DIR = testDir;

// Clear any pre-existing GH tokens so tests can control them
delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;

const configModule = await import('../../src/config.js');
const doctorModule = await import('../../src/doctor.js');
const { checkConfig, checkToken, checkRepos, checkCcMm, checkLabels, runDoctor } = doctorModule;
const { resolveToken, tryReadConfig } = configModule;

const BASE = 'https://api.github.com';

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
  nock.cleanAll();
  // reset env for each test
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
});

afterEach(() => {
  nock.cleanAll();
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
});

function writeConfig(overrides: Record<string, unknown> = {}) {
  const cfg = {
    githubToken: 'ghp_test',
    repos: ['owner/repo'],
    ccMmPath: '/bin/true',
    stageTimeouts: { grill: 15, reqs: 10, design: 20, impl: 60, verify: 15, review: 30 },
    ...overrides,
  };
  fs.writeFileSync(path.join(testDir, 'config.json'), JSON.stringify(cfg));
}

describe('resolveToken', () => {
  it('returns GITHUB_TOKEN env when set', () => {
    process.env.GITHUB_TOKEN = 'from-gh';
    expect(resolveToken(null)).toBe('from-gh');
  });

  it('falls back to GH_TOKEN when GITHUB_TOKEN is unset', () => {
    process.env.GH_TOKEN = 'from-gh-token';
    expect(resolveToken(null)).toBe('from-gh-token');
  });

  it('prefers GITHUB_TOKEN over GH_TOKEN', () => {
    process.env.GITHUB_TOKEN = 'primary';
    process.env.GH_TOKEN = 'secondary';
    expect(resolveToken(null)).toBe('primary');
  });

  it('falls back to config.githubToken when env unset', () => {
    expect(resolveToken({ githubToken: 'cfg', repos: [], ccMmPath: '', stageTimeouts: { grill: 15, reqs: 10, design: 20, impl: 60, verify: 15, review: 30 } })).toBe('cfg');
  });

  it('returns null when nothing is available', () => {
    expect(resolveToken(null)).toBe(null);
  });
});

describe('tryReadConfig', () => {
  it('returns ok:false when file missing', () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    const r = tryReadConfig();
    expect(r.ok).toBe(false);
  });

  it('returns ok:false on malformed JSON', () => {
    fs.writeFileSync(path.join(testDir, 'config.json'), '{not-json');
    const r = tryReadConfig();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/);
  });

  it('returns ok:false when githubToken missing', () => {
    fs.writeFileSync(path.join(testDir, 'config.json'), JSON.stringify({ repos: ['a/b'], ccMmPath: '/bin/true' }));
    const r = tryReadConfig();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/githubToken/);
  });

  it('returns ok:true on a valid config', () => {
    writeConfig();
    const r = tryReadConfig();
    expect(r.ok).toBe(true);
  });
});

describe('checkConfig', () => {
  it('fails when config file is missing', async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    const r = await checkConfig();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no config at/);
  });

  it('passes on valid config', async () => {
    writeConfig();
    const r = await checkConfig();
    expect(r.ok).toBe(true);
  });

  it('fails on malformed JSON', async () => {
    fs.writeFileSync(path.join(testDir, 'config.json'), '{this is broken');
    const r = await checkConfig();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not valid JSON/);
  });

  it('fails when githubToken missing', async () => {
    fs.writeFileSync(path.join(testDir, 'config.json'), JSON.stringify({ repos: ['a/b'], ccMmPath: '/bin/true' }));
    const r = await checkConfig();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/githubToken/);
  });

  it('fails when repos contains malformed entries', async () => {
    fs.writeFileSync(path.join(testDir, 'config.json'), JSON.stringify({
      githubToken: 't', repos: ['no-slash-here'], ccMmPath: '/bin/true',
    }));
    const r = await checkConfig();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/invalid repo/);
  });
});

describe('checkToken', () => {
  it('uses GITHUB_TOKEN env when set (overrides config)', async () => {
    process.env.GITHUB_TOKEN = 'env-token';
    writeConfig();
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE).get('/user').reply(200, { login: 'octocat' });

    const r = await checkToken(cfg.config);
    expect(r.ok).toBe(true);
  });

  it('uses GH_TOKEN as secondary env', async () => {
    process.env.GH_TOKEN = 'fallback-token';
    writeConfig();
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE).get('/user').reply(200, { login: 'octocat' });

    const r = await checkToken(cfg.config);
    expect(r.ok).toBe(true);
  });

  it('fails when no token available anywhere', async () => {
    // Write a config without nocking GitHub — we want this to fail.
    // But first, prove env fallback to config works.
    writeConfig();
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE).get('/user').reply(200, { login: 'octocat' });
    const r = await checkToken(cfg.config);
    expect(r.ok).toBe(true); // falls back to config.githubToken = 'ghp_test'
    nock.cleanAll();

    // Now strip the config file entirely — no env, no config → fail
    fs.rmSync(path.join(testDir, 'config.json'));
    const r2 = await checkToken(null);
    expect(r2.ok).toBe(false);
    expect(r2.detail).toMatch(/no GitHub token/);
  });

  it('fails on 401', async () => {
    writeConfig();
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE).get('/user').reply(401, { message: 'Bad credentials' });

    const r = await checkToken(cfg.config);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/401/);
  });

  it('passes on 200', async () => {
    writeConfig();
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE).get('/user').reply(200, { login: 'octocat' });

    const r = await checkToken(cfg.config);
    expect(r.ok).toBe(true);
  });
});

describe('checkRepos', () => {
  it('passes when all repos respond 200', async () => {
    writeConfig({ repos: ['owner/one', 'owner/two'] });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE).get('/repos/owner/one').reply(200, { full_name: 'owner/one' });
    nock(BASE).get('/repos/owner/two').reply(200, { full_name: 'owner/two' });

    const r = await checkRepos(cfg.config);
    expect(r.ok).toBe(true);
    expect(r.subItems?.every(s => s.startsWith('✓'))).toBe(true);
  });

  it('fails when one repo 404s', async () => {
    writeConfig({ repos: ['owner/one', 'owner/two'] });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE).get('/repos/owner/one').reply(200, { full_name: 'owner/one' });
    nock(BASE).get('/repos/owner/two').reply(404, { message: 'Not Found' });

    const r = await checkRepos(cfg.config);
    expect(r.ok).toBe(false);
    expect(r.subItems?.some(s => s.includes('404'))).toBe(true);
  });

  it('fails when repos is empty', async () => {
    writeConfig({ repos: [] });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;
    const r = await checkRepos(cfg.config);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no repos configured/);
  });

  it('skips when no config', async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    const r = await checkRepos(null);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no config/);
  });
});

describe('checkCcMm', () => {
  it('passes when ccMmPath is an executable file', async () => {
    // Use /bin/true which exists on most systems and is executable
    writeConfig({ ccMmPath: '/bin/true' });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    const r = await checkCcMm(cfg.config);
    expect(r.ok).toBe(true);
  });

  it('fails when explicit path is not executable', async () => {
    const nonExec = path.join(testDir, 'not-exec');
    fs.writeFileSync(nonExec, '#!/bin/sh\necho hi\n', { mode: 0o644 });
    writeConfig({ ccMmPath: nonExec });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    const r = await checkCcMm(cfg.config);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not executable/);
  });

  it('fails when explicit path does not exist', async () => {
    writeConfig({ ccMmPath: '/nonexistent/path/cc-mm-xyz' });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    const r = await checkCcMm(cfg.config);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not found/);
  });

  it('resolves a bare command via PATH', async () => {
    // Create a temp dir with an executable shim
    const binDir = path.join(testDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const shim = path.join(binDir, 'cc-mm-test-shim');
    fs.writeFileSync(shim, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ''}`;

    try {
      writeConfig({ ccMmPath: 'cc-mm-test-shim' });
      const cfg = tryReadConfig();
      expect(cfg.ok).toBe(true);
      if (!cfg.ok) return;

      const r = await checkCcMm(cfg.config);
      expect(r.ok).toBe(true);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it('fails when bare command not on PATH', async () => {
    // Ensure PATH is something that definitely doesn't have it
    writeConfig({ ccMmPath: 'definitely-not-on-path-xyz-123' });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    const r = await checkCcMm(cfg.config);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not found/);
  });

  it('handles missing config by using the default', async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    // With no config, defaults to 'cc-mm' which is likely not on PATH.
    // Use PATH that excludes the dev environment.
    const oldPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      const r = await checkCcMm(null);
      expect(r.ok).toBe(false);
    } finally {
      process.env.PATH = oldPath;
    }
  });
});

describe('checkLabels', () => {
  it('passes when one repo has the full label set', async () => {
    const labels = await import('../../src/labels.js');
    const allLabels = labels.ALL_ADT_LABELS.map(name => ({ name }));

    writeConfig({ repos: ['owner/one', 'owner/two'] });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE)
      .get('/repos/owner/one/labels')
      .query({ per_page: 100 })
      .reply(200, allLabels);
    nock(BASE)
      .get('/repos/owner/two/labels')
      .query({ per_page: 100 })
      .reply(200, [{ name: 'bug' }]); // partial

    const r = await checkLabels(cfg.config);
    expect(r.ok).toBe(true);
  });

  it('fails when no repo has the full set', async () => {
    writeConfig({ repos: ['owner/one'] });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;

    nock(BASE)
      .get('/repos/owner/one/labels')
      .query({ per_page: 100 })
      .reply(200, [{ name: 'bug' }]); // missing everything

    const r = await checkLabels(cfg.config);
    expect(r.ok).toBe(false);
    expect(r.subItems?.some(s => s.includes('missing'))).toBe(true);
  });

  it('fails when repos is empty', async () => {
    writeConfig({ repos: [] });
    const cfg = tryReadConfig();
    expect(cfg.ok).toBe(true);
    if (!cfg.ok) return;
    const r = await checkLabels(cfg.config);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no repos/);
  });

  it('skips when no config', async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    const r = await checkLabels(null);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no config/);
  });
});

describe('runDoctor', () => {
  it('returns 0 and prints All checks passed when everything is healthy', async () => {
    const labels = await import('../../src/labels.js');
    const allLabels = labels.ALL_ADT_LABELS.map(name => ({ name }));

    writeConfig({ ccMmPath: '/bin/true' });
    nock(BASE).get('/user').reply(200, { login: 'octocat' });
    nock(BASE).get('/repos/owner/repo').reply(200, { full_name: 'owner/repo' });
    nock(BASE)
      .get('/repos/owner/repo/labels')
      .query(true)
      .reply(200, allLabels);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await runDoctor();
      expect(code).toBe(0);
      const allLines = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allLines).toMatch(/All checks passed\./);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('returns 1 when a check fails', async () => {
    writeConfig({ ccMmPath: '/bin/true' });
    nock(BASE).get('/user').reply(200, { login: 'octocat' });
    nock(BASE).get('/repos/owner/repo').reply(404, { message: 'Not Found' });
    // labels can be anything since repos fails first — but we still need to mock them
    nock(BASE)
      .get('/repos/owner/repo/labels')
      .query(true)
      .reply(200, []);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await runDoctor();
      expect(code).toBe(1);
      const allLines = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allLines).toMatch(/Some checks failed\./);
    } finally {
      logSpy.mockRestore();
    }
  });
});