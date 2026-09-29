import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * The template packs travel inside the desktop app as one JSON archive: installers and the asar
 * packer silently drop dotfiles (`.github/`, `.gitignore`), which packs are full of. At startup the
 * app extracts the archive once per content hash into its data directory.
 */
export interface PacksArchive {
  version: 1;
  sha256: string;
  files: { path: string; data: string }[];
}

const SKIP = new Set([
  'node_modules',
  '__pycache__',
  '.venv',
  'vendor',
  '.pytest_cache',
  '.ruff_cache',
]);

function walk(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

/** Archives `packs/` plus the lock files beside it (`actions-lock.json`, `versions.json`). */
export function createArchive(templatesDir: string): PacksArchive {
  const files = [
    ...walk(path.join(templatesDir, 'packs')).map((p) => `packs/${p}`),
    'actions-lock.json',
    'versions.json',
  ].map((p) => ({ path: p, data: readFileSync(path.join(templatesDir, p)).toString('base64') }));
  const hash = createHash('sha256');
  for (const f of files) hash.update(f.path).update('\0').update(f.data).update('\0');
  return { version: 1, sha256: hash.digest('hex'), files };
}

/**
 * Extracts into `<cacheRoot>/<sha256>/` (atomically, via a temporary sibling) and returns its `packs`
 * directory. Paths are checked to stay inside the target; an existing extraction is reused.
 */
export function extractArchive(archive: PacksArchive, cacheRoot: string): string {
  if (archive.version !== 1 || !/^[0-9a-f]{64}$/.test(archive.sha256))
    throw new Error('unsupported packs archive');
  const target = path.join(cacheRoot, archive.sha256);
  const packs = path.join(target, 'packs');
  if (existsSync(path.join(target, '.complete'))) return packs;
  const tmp = `${target}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  for (const f of archive.files) {
    const abs = path.resolve(tmp, f.path);
    if (path.relative(tmp, abs).startsWith('..') || path.isAbsolute(f.path))
      throw new Error(`packs archive path escapes the target: ${f.path}`);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(f.data, 'base64'));
  }
  writeFileSync(path.join(tmp, '.complete'), archive.sha256);
  rmSync(target, { recursive: true, force: true });
  renameSync(tmp, target);
  // Older extractions are no longer referenced.
  for (const name of readdirSync(cacheRoot))
    if (name !== archive.sha256)
      rmSync(path.join(cacheRoot, name), { recursive: true, force: true });
  return packs;
}
