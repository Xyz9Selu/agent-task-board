import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const ADT_DIR = process.env.ADT_DIR || path.join(os.homedir(), '.adt');
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
