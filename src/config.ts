import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const ADT_DIR = process.env.ADT_DIR || path.join(os.homedir(), '.adt');
const CONFIG_PATH = path.join(ADT_DIR, 'config.json');

const DEFAULT_TIMEOUTS = { grill: 15, reqs: 10, design: 20, impl: 60, verify: 15, review: 30 } as const;

type Stage = 'grill' | 'reqs' | 'design' | 'impl' | 'verify' | 'review';

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

// GitHub token resolution — env-first, config-fallback. Order matches what the
// worker uses, so `adt doctor` validates reality. See design docs/designs/21.md §3.
function resolveToken(cfg: Config | null): string | null {
  return process.env.GITHUB_TOKEN
      || process.env.GH_TOKEN
      || (cfg?.githubToken ?? null);
}

function tokenSource(): 'env:GITHUB_TOKEN' | 'env:GH_TOKEN' | 'config' | null {
  if (process.env.GITHUB_TOKEN) return 'env:GITHUB_TOKEN';
  if (process.env.GH_TOKEN) return 'env:GH_TOKEN';
  return null;
}

// Read the raw config (if present) without throwing. Returns null when the
// file is missing or unparseable. Used by `doctor` checks that must keep going
// even before `setup` has run.
function tryReadConfig(): { ok: true; config: Config; raw: unknown } | { ok: false; error: string } {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ok: false, error: `no config at ${CONFIG_PATH} — run \`adt setup\`` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    return { ok: false, error: `config is not valid JSON: ${(e as Error).message}` };
  }
  const r = raw as Record<string, unknown>;
  if (!r.githubToken) return { ok: false, error: 'missing required field: githubToken' };
  if (!Array.isArray(r.repos)) return { ok: false, error: 'missing required field: repos' };
  if (typeof r.ccMmPath !== 'string') {
    // ccMmPath is optional (defaults to 'cc-mm'), but if provided must be a string
    r.ccMmPath = 'cc-mm';
  }
  return {
    ok: true,
    config: {
      githubToken: r.githubToken as string,
      repos: r.repos as string[],
      ccMmPath: r.ccMmPath as string,
      stageTimeouts: { ...DEFAULT_TIMEOUTS, ...(r.stageTimeouts as Partial<Record<Stage, number>> || {}) },
    },
    raw,
  };
}

export {
  loadConfig, saveConfig, resolveToken, tokenSource, tryReadConfig,
  Config, Stage, CONFIG_PATH, ADT_DIR, DEFAULT_TIMEOUTS,
};