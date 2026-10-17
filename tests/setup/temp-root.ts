// Unit-suite hygiene (plan 063): all temp folders of a run live under one folder, removed when the run ends.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STALE_MS = 2 * 60 * 60 * 1000;

/** Vitest global setup: points the temp folder of every test process at a per-run folder and returns its removal. */
export default function setup(): () => void {
  const parent = path.join(os.tmpdir(), 'incubator-tests');
  mkdirSync(parent, { recursive: true });
  // why: a run that crashed never reached its teardown; only folders in this parent are ever removed.
  for (const name of readdirSync(parent)) {
    const stale = path.join(parent, name);
    try {
      if (Date.now() - statSync(stale).mtimeMs > STALE_MS)
        rmSync(stale, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // a folder another run still holds is left for the next time
    }
  }
  const root = mkdtempSync(path.join(parent, 'run-'));
  process.env['TEMP'] = root;
  process.env['TMP'] = root;
  process.env['TMPDIR'] = root;
  return () => {
    rmSync(root, { recursive: true, force: true, maxRetries: 2 });
  };
}
