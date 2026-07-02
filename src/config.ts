import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const ADT_DIR = process.env.ADT_DIR || path.join(os.homedir(), '.adt');
const CONFIG_PATH = path.join(ADT_DIR, 'config.json');

const DEFAULT_TIMEOUTS = { grill: 15, reqs: 10, design: 20, impl: 60, review: 30 } as const;

type Stage = 'grill' | 'reqs' | 'design' | 'impl' | 'review';

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
