// A lock file that survives crashes: it holds the owner's pid, and a lock whose owner is gone is taken over.
import { randomUUID } from 'node:crypto';
import { linkSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

export async function withLock(file, fn, { poll = 250 } = {}) {
  // Publish a fully written owner atomically. A crash between open('wx') and write()
  // otherwise leaves an empty lock that no waiter can identify as stale.
  const owner = `${file}.${process.pid}.${randomUUID()}.owner`;
  writeFileSync(owner, String(process.pid), { flag: 'wx' });
  try {
    for (;;) {
      try {
        linkSync(owner, file);
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
  } finally {
    rmSync(owner, { force: true });
  }
}
