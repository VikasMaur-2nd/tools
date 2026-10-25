// A lock file that survives crashes: it holds the owner's pid, and a lock whose owner is gone is taken over.
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

export async function withLock(file, fn, { poll = 250 } = {}) {
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0;
      try {
        pid = Number(readFileSync(file, 'utf8'));
      } catch {}
      if (pid && !alive(pid)) rmSync(file, { force: true });
      else await new Promise((r) => setTimeout(r, poll));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(file, { force: true });
  }
}
