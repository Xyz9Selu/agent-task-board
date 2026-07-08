import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import { resolveToken, tryReadConfig, CONFIG_PATH, type Config } from './config.js';
import { ALL_ADT_LABELS } from './labels.js';

// Promise.race helper that rejects with a TimeoutError after ms.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
  subItems?: string[];
}

type Check = () => Promise<CheckResult>;

// ---- checkConfig -----------------------------------------------------------

async function checkConfig(): Promise<CheckResult> {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { name: 'config', ok: false, detail: `no config at ${CONFIG_PATH} — run \`adt setup\`` };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  } catch (e) {
    return { name: 'config', ok: false, detail: `could not read config: ${(e as Error).message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { name: 'config', ok: false, detail: `config is not valid JSON: ${(e as Error).message}` };
  }
  const r = parsed as Record<string, unknown>;
  if (!r.githubToken || typeof r.githubToken !== 'string') {
    return { name: 'config', ok: false, detail: 'missing required field: githubToken' };
  }
  if (!Array.isArray(r.repos)) {
    return { name: 'config', ok: false, detail: 'missing required field: repos' };
  }
  for (const repo of r.repos) {
    if (typeof repo !== 'string' || !/^[^/]+\/[^/]+$/.test(repo)) {
      return { name: 'config', ok: false, detail: `invalid repo in repos[]: ${JSON.stringify(repo)} (expected "owner/name")` };
    }
  }
  if (r.ccMmPath !== undefined && typeof r.ccMmPath !== 'string') {
    return { name: 'config', ok: false, detail: 'ccMmPath must be a string' };
  }
  return { name: 'config', ok: true };
}

// ---- checkToken ------------------------------------------------------------

async function checkToken(cfg: Config | null): Promise<CheckResult> {
  const token = resolveToken(cfg);
  if (!token) {
    return { name: 'token', ok: false, detail: 'no GitHub token found in env or config' };
  }
  const client = new Octokit({ auth: token });
  try {
    await withTimeout(
      client.rest.users.getAuthenticated().then(r => r.data),
      4000,
      'token check',
    );
    return { name: 'token', ok: true };
  } catch (e: any) {
    if (e?.status === 401) {
      return { name: 'token', ok: false, detail: 'token rejected by GitHub (401) — token may be expired or missing scopes' };
    }
    if (e?.message?.includes('timed out')) {
      return { name: 'token', ok: false, detail: 'GitHub did not respond within 4s' };
    }
    if (e?.status) {
      return { name: 'token', ok: false, detail: `GitHub error: ${e.status} ${e.message ?? ''}`.trim() };
    }
    return { name: 'token', ok: false, detail: `GitHub error: ${(e as Error).message}` };
  }
}

// ---- checkRepos ------------------------------------------------------------

async function checkOneRepo(client: Octokit, repo: string): Promise<{ ok: boolean; detail?: string }> {
  const [owner, name] = repo.split('/');
  try {
    await withTimeout(
      client.rest.repos.get({ owner, repo: name }),
      4000,
      `repo ${repo}`,
    );
    return { ok: true };
  } catch (e: any) {
    if (e?.status === 404) return { ok: false, detail: 'repo not found or no access (404)' };
    if (e?.status === 403) return { ok: false, detail: 'rate limited or forbidden (403)' };
    if (e?.message?.includes('timed out')) return { ok: false, detail: 'request timed out' };
    if (e?.status) return { ok: false, detail: `GitHub error: ${e.status} ${e.message ?? ''}`.trim() };
    return { ok: false, detail: (e as Error).message };
  }
}

async function checkRepos(cfg: Config | null): Promise<CheckResult> {
  if (!cfg) {
    return { name: 'repos', ok: false, detail: 'no config — skipping repo check' };
  }
  if (!cfg.repos || cfg.repos.length === 0) {
    return { name: 'repos', ok: false, detail: 'no repos configured — run `adt setup --add owner/repo`' };
  }
  const token = resolveToken(cfg) ?? '';
  const client = new Octokit({ auth: token });
  const subItems: string[] = [];
  const results = await Promise.all(cfg.repos.map(r => checkOneRepo(client, r)));
  cfg.repos.forEach((repo, i) => {
    const r = results[i];
    const mark = r.ok ? '✓' : '✗';
    subItems.push(`${mark} ${repo}${r.detail ? ` — ${r.detail}` : ''}`);
  });
  const allOk = results.every(r => r.ok);
  return {
    name: 'repos',
    ok: allOk,
    detail: allOk ? undefined : `${results.filter(r => !r.ok).length} of ${results.length} repos unreachable`,
    subItems,
  };
}

// ---- checkCcMm -------------------------------------------------------------

function which(exec: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('which', [exec], (err, stdout) => {
      if (err) return resolve(null);
      const out = stdout.toString().trim().split('\n')[0].trim();
      resolve(out || null);
    });
  });
}

async function checkCcMm(cfg: Config | null): Promise<CheckResult> {
  const value = cfg?.ccMmPath ?? 'cc-mm';
  let resolved: string | null;
  if (value.includes('/')) {
    resolved = value;
  } else {
    try {
      resolved = await withTimeout(which(value), 2000, 'which');
    } catch {
      resolved = null;
    }
  }
  if (!resolved) {
    return {
      name: 'ccMm',
      ok: false,
      detail: value.includes('/')
        ? `cc-mm not found at ${value} — install it or update ccMmPath in config`
        : 'cc-mm not found on PATH — install it or set ccMmPath in config',
    };
  }
  if (!fs.existsSync(resolved)) {
    return {
      name: 'ccMm',
      ok: false,
      detail: `cc-mm not found at ${resolved} — install it or update ccMmPath in config`,
    };
  }
  try {
    const stat = fs.statSync(resolved);
    if ((stat.mode & 0o111) === 0) {
      return { name: 'ccMm', ok: false, detail: `cc-mm not executable at ${resolved}` };
    }
  } catch (e) {
    return { name: 'ccMm', ok: false, detail: `could not stat cc-mm: ${(e as Error).message}` };
  }
  return { name: 'ccMm', ok: true };
}

// ---- checkLabels -----------------------------------------------------------

async function checkOneRepoLabels(client: Octokit, repo: string): Promise<{ present: Set<string>; missing: string[] }> {
  const [owner, name] = repo.split('/');
  try {
    const data = await withTimeout(
      client.paginate(client.rest.issues.listLabelsForRepo, { owner, repo: name, per_page: 100 }, (r: any) => r.data),
      4000,
      `labels for ${repo}`,
    );
    const flat: any[] = Array.isArray(data) ? data : data.flatMap((page: any) => page.data);
    const present = new Set<string>(flat.map((l: any) => l.name));
    const missing = ALL_ADT_LABELS.filter(l => !present.has(l));
    return { present, missing };
  } catch {
    // Network/timeout error — treat as missing all
    return { present: new Set(), missing: [...ALL_ADT_LABELS] };
  }
}

async function checkLabels(cfg: Config | null): Promise<CheckResult> {
  if (!cfg) {
    return { name: 'labels', ok: false, detail: 'no config — skipping label check' };
  }
  if (!cfg.repos || cfg.repos.length === 0) {
    return { name: 'labels', ok: false, detail: 'no repos to check labels against' };
  }
  const token = resolveToken(cfg) ?? '';
  const client = new Octokit({ auth: token });
  const perRepo = await Promise.all(cfg.repos.map(r => checkOneRepoLabels(client, r)));
  const subItems: string[] = [];
  let anyComplete = false;
  let allErrored = true;
  cfg.repos.forEach((repo, i) => {
    const { present, missing } = perRepo[i];
    if (missing.length === 0 && present.size > 0) {
      anyComplete = true;
      allErrored = false;
      subItems.push(`✓ ${repo}: ${present.size}/${ALL_ADT_LABELS.length} labels present`);
    } else if (present.size === 0) {
      subItems.push(`✗ ${repo}: could not fetch labels`);
    } else {
      allErrored = false;
      subItems.push(`✗ ${repo}: ${ALL_ADT_LABELS.length - missing.length}/${ALL_ADT_LABELS.length} labels — missing: ${missing.join(', ')}`);
    }
  });
  if (allErrored) {
    return { name: 'labels', ok: false, detail: 'could not fetch labels from any repo', subItems };
  }
  if (anyComplete) {
    return { name: 'labels', ok: true, subItems };
  }
  return {
    name: 'labels',
    ok: false,
    detail: 'no repo has the full label set',
    subItems,
  };
}

// ---- runner ----------------------------------------------------------------

// Structured report returned by collectReport and rendered by either printer.
interface DoctorReport {
  ok: boolean;
  exitCode: number;
  checks: CheckResult[];
}

// Collect every check's result without printing. The runner then renders the
// report in the requested format. Splitting collection from rendering keeps
// the JSON path deterministic (one JSON document on stdout) and makes the
// report trivially testable.
async function collectReport(): Promise<DoctorReport> {
  const cfgResult = tryReadConfig();
  const cfg: Config | null = cfgResult.ok ? cfgResult.config : null;

  // Run the checks. Most are independent — but the config check feeds into
  // every other check, so we share the parsed config across them. The repo
  // and label checks are already parallelized internally via Promise.all.
  const checks: CheckResult[] = [];
  checks.push(await checkConfig());
  checks.push(await checkToken(cfg));
  checks.push(await checkRepos(cfg));
  checks.push(await checkCcMm(cfg));
  checks.push(await checkLabels(cfg));

  const allOk = checks.every(r => r.ok);
  return {
    ok: allOk,
    exitCode: allOk ? 0 : 1,
    checks,
  };
}

function printHuman(report: DoctorReport): void {
  const nameWidth = Math.max(...report.checks.map(r => r.name.length));
  for (const r of report.checks) {
    const mark = r.ok ? '✓' : '✗';
    const label = r.ok ? 'ok' : (r.detail ?? 'failed');
    console.log(`${mark} ${r.name.padEnd(nameWidth)}  ${label}`);
    if (r.subItems) {
      for (const s of r.subItems) console.log(`    ${s}`);
    }
  }
  console.log('');
  console.log(report.ok ? 'All checks passed.' : 'Some checks failed. See above.');
}

function printJson(report: DoctorReport): void {
  // Single JSON document on stdout, pretty-printed for human inspection but
  // still stable enough to pipe through `jq`. Exit code is included so a
  // caller can recover the run's outcome from stdout alone.
  console.log(JSON.stringify(report, null, 2));
}

type Format = 'json' | 'human';

interface RunDoctorOptions {
  format?: Format;
}

async function runDoctor(opts: RunDoctorOptions = {}): Promise<number> {
  const format: Format = opts.format ?? 'human';
  const report = await collectReport();
  if (format === 'json') {
    printJson(report);
  } else {
    printHuman(report);
  }
  return report.exitCode;
}

export {
  runDoctor,
  collectReport,
  printHuman,
  printJson,
  checkConfig, checkToken, checkRepos, checkCcMm, checkLabels,
  CheckResult, DoctorReport, Format, RunDoctorOptions,
};