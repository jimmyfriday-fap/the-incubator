import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const MAX_FILES = 5000;
export const MAX_BYTES = 1024 * 1024;
const SKIP = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'coverage',
  '.tools',
  '.reports',
]);

/**
 * Read-only view of a repository for detectors (TDD §7.3): a sorted POSIX file list (at most 5,000
 * files, skipping dependency and build directories) and lazy reads capped at 1 MiB. Symlinks are
 * listed but never followed or read, so repository content cannot point the analyzer elsewhere.
 */
export interface RepoView {
  readonly files: readonly string[];
  readonly truncated: boolean;
  has(file: string): boolean;
  read(file: string): string | null;
  glob(pattern: string): string[];
}

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
        .join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function viewFromFiles(files: Record<string, string>): RepoView {
  const list = Object.keys(files).sort();
  return {
    files: list,
    truncated: false,
    has: (f) => f in files,
    read: (f) => files[f] ?? null,
    glob: (p) => {
      const re = globToRegExp(p);
      return list.filter((f) => re.test(f));
    },
  };
}

export function viewFromDir(root: string): RepoView {
  const files: string[] = [];
  let truncated = false;
  const walk = (rel: string): void => {
    for (const name of readdirSync(path.join(root, rel)).sort()) {
      if (SKIP.has(name)) continue;
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path.join(root, r));
      if (st.isDirectory()) walk(r);
      else if (files.length >= MAX_FILES) truncated = true;
      else files.push(r);
    }
  };
  walk('');
  files.sort();
  const set = new Set(files);
  const cache = new Map<string, string | null>();
  return {
    files,
    truncated,
    has: (f) => set.has(f),
    read: (f) => {
      if (cache.has(f)) return cache.get(f)!;
      let v: string | null = null;
      const abs = path.join(root, f);
      if (set.has(f) && existsSync(abs) && !lstatSync(abs).isSymbolicLink()) {
        const buf = readFileSync(abs);
        v = buf.includes(0) ? null : buf.subarray(0, MAX_BYTES).toString('utf8');
      }
      cache.set(f, v);
      return v;
    },
    glob: (p) => {
      const re = globToRegExp(p);
      return files.filter((f) => re.test(f));
    },
  };
}
