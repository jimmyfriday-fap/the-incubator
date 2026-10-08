import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

function makeWritable(p: string): void {
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) makeWritable(path.join(p, name));
    return;
  }
  if ((st.mode & 0o200) === 0) {
    try {
      chmodSync(p, st.mode | 0o200);
    } catch {
      // why: the removal below reports the real failure.
    }
  }
}

/**
 * Removes a directory tree, read-only files included. Git marks its pack files read-only, and the Node inside
 * Electron 44 (Node 24) fails `rmSync` on them with EPERM even with `force`, where Node 22 does not. So the
 * files are made writable first, and a short retry rides out a scanner holding a file for a moment.
 */
export function removeTree(dir: string): void {
  makeWritable(dir);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
