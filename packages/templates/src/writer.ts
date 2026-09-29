import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  writeSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { PolicyError, resolveInside, sha256Hex } from '@incubator/runtime';
import { PAIRED_PREFIX, type RenderResult } from './render.js';

export type WriteMode = 'fresh' | 'no-overwrite';

export interface WriteReport {
  written: string[];
  identical: string[];
  proposed: string[];
  roots: { app: string; paired?: string };
}

/** Where `@paired/` files go: a sibling directory named after the tests repository. */
export function pairedRoot(outDir: string, pairedName: string): string {
  return path.join(path.dirname(path.resolve(outDir)), pairedName);
}

function isEmptyDir(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/**
 * Writes a render result. `fresh` refuses a non-empty target unless `force`; `no-overwrite` never
 * opens an existing file for writing: identical files are skipped, differing ones become
 * `<file>.incubator-proposed` (brownfield, TDD §7.3).
 */
export function writeTree(
  result: RenderResult,
  outDir: string,
  opts: { mode: WriteMode; force?: boolean; pairedName?: string },
): WriteReport {
  const app = path.resolve(outDir);
  const paired = opts.pairedName ? pairedRoot(outDir, opts.pairedName) : undefined;
  const hasPaired = [...result.files.keys()].some((k) => k.startsWith(PAIRED_PREFIX));
  if (hasPaired && !paired)
    throw new PolicyError('render has a paired tests repository but no pairedName was given');
  if (opts.mode === 'fresh' && !opts.force) {
    for (const dir of [app, ...(hasPaired && paired ? [paired] : [])]) {
      if (!isEmptyDir(dir))
        throw new PolicyError(`${dir} is not empty (use --force to write into it)`, {
          code: 'out_not_empty',
        });
    }
  }
  const report: WriteReport = {
    written: [],
    identical: [],
    proposed: [],
    roots: { app, ...(hasPaired && paired ? { paired } : {}) },
  };
  for (const f of result.files.values()) {
    const isPaired = f.path.startsWith(PAIRED_PREFIX);
    const root = isPaired ? paired! : app;
    const rel = isPaired ? f.path.slice(PAIRED_PREFIX.length) : f.path;
    let target = resolveInside(root, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    if (opts.mode === 'no-overwrite' && existsSync(target)) {
      if (sha256Hex(readFileSync(target)) === sha256Hex(f.bytes)) {
        report.identical.push(f.path);
        continue;
      }
      target = `${target}.incubator-proposed`;
      report.proposed.push(f.path);
    } else report.written.push(f.path);
    // why: 'wx' fails if the file exists, so no-overwrite can never clobber (the proposed file included).
    const fd = openSync(
      target,
      opts.mode === 'no-overwrite' ? 'wx' : 'w',
      f.mode === '0755' ? 0o755 : 0o644,
    );
    try {
      writeSync(fd, f.bytes);
    } finally {
      closeSync(fd);
    }
    if (process.platform !== 'win32') chmodSync(target, f.mode === '0755' ? 0o755 : 0o644);
  }
  return report;
}

/** `scaffold --dry-run`: one line per file with its short hash and owning pack. */
export function describeTree(result: RenderResult): string[] {
  return [...result.files.values()].map(
    (f) => `${sha256Hex(f.bytes).slice(0, 12)}  ${f.mode}  ${f.pack.padEnd(22)} ${f.path}`,
  );
}
