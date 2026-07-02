import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const ADT_DIR = process.env.ADT_DIR || path.join(os.homedir(), '.adt');

function acquireLock(): boolean {
  fs.mkdirSync(ADT_DIR, { recursive: true });
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
    return false; // Another process holds the lock
  }
  fs.writeFileSync(pidFile, String(process.pid));
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
}

export { acquireLock, releaseLock };
