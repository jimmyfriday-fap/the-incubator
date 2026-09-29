import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PAIRED_PREFIX, LOCK_PATH, type RenderResult } from '@incubator/templates';
import type { Delta } from './report.js';

/**
 * What adopting would change (TDD §7.3), never touching the repository: rendered files that are
 * absent are created; identical ones are skipped; differing ones become `<file>.incubator-proposed`
 * unless the repository's own `.incubator/lock.json` already lists them (the user owns them now).
 * Paired tests-repository files are out of scope for adopt.
 */
export function planDelta(result: RenderResult, root: string): Delta {
  const lockFile = path.join(root, LOCK_PATH);
  const owned = new Set(
    existsSync(lockFile)
      ? Object.keys(
          (JSON.parse(readFileSync(lockFile, 'utf8')) as { files?: Record<string, unknown> })
            .files ?? {},
        )
      : [],
  );
  const delta: Delta = { create: [], proposed: [], identical: [], owned: [] };
  for (const f of result.files.values()) {
    if (f.path.startsWith(PAIRED_PREFIX)) continue;
    const abs = path.join(root, f.path);
    if (!existsSync(abs)) delta.create.push(f.path);
    else if (lstatSync(abs).isFile() && readFileSync(abs).equals(f.bytes))
      delta.identical.push(f.path);
    else if (owned.has(f.path) || f.path === LOCK_PATH) delta.owned.push(f.path);
    else delta.proposed.push(f.path);
  }
  return delta;
}

/** A repository is already compliant when adopting would add or propose nothing. */
export function isEmptyDelta(d: Delta): boolean {
  return d.create.length === 0 && d.proposed.length === 0;
}
