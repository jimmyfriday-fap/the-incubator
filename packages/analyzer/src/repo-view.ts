import { existsSync, lstatSync, readFileSync, readdirSync, type Stats } from 'node:fs';
import path from 'node:path';

export const MAX_FILES = 5000;
export const MAX_BYTES = 1024 * 1024;
/** Hard stop for counting entries, so a hostile tree cannot make the walk itself unbounded. */
export const WALK_CAP = 50_000;
const EXAMPLES = 3;
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
  // Build and cache directories of ecosystems without a pack (ADR-024).
  '.dart_tool',
  '.pub-cache',
  '.gradle',
  '.symlinks',
  'Pods',
  'DerivedData',
]);

/** Other checkouts of the same project that agent tools keep inside it; not part of the project. */
const SKIP_PATHS = ['.claude/worktrees'];

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
  /** What the view could not show the detectors, and why (ADR-021). Deterministic. */
  stats(): ViewStats;
}

/** Why a file or directory was not (fully) visible. */
export type SkipReason =
  'ignored-dir' | 'over-file-cap' | 'walk-cap' | 'binary' | 'over-byte-cap' | 'symlink';

export interface SkipGroup {
  reason: SkipReason;
  /** Directories for `ignored-dir`, files for every other reason. */
  count: number;
  /** A few repository-relative paths, sorted. */
  examples: string[];
}

export interface ViewStats {
  /** Files seen outside ignored directories. A lower bound when `totalIsLowerBound`. */
  total: number;
  totalIsLowerBound: boolean;
  /** Files in `RepoView.files`. */
  listed: number;
  /** Listed files whose full text was readable. */
  scanned: number;
  skipped: SkipGroup[];
  /** The caps in force, so a report can say what "over the cap" meant. */
  caps: { maxFiles: number; maxBytes: number };
}

export interface ViewOptions {
  maxFiles?: number;
  maxBytes?: number;
  walkCap?: number;
  /** Test seam: lets tests model symlinks without creating any. */
  lstat?: (p: string) => Pick<Stats, 'isDirectory' | 'isSymbolicLink' | 'size'>;
}

const ORDER: SkipReason[] = [
  'ignored-dir',
  'over-file-cap',
  'walk-cap',
  'symlink',
  'binary',
  'over-byte-cap',
];

class Skips {
  private readonly map = new Map<SkipReason, { count: number; examples: string[] }>();
  add(reason: SkipReason, example: string, n = 1): void {
    const g = this.map.get(reason) ?? { count: 0, examples: [] };
    g.count += n;
    if (g.examples.length < EXAMPLES) g.examples.push(example);
    this.map.set(reason, g);
  }
  groups(): SkipGroup[] {
    return ORDER.filter((r) => this.map.has(r)).map((reason) => {
      const g = this.map.get(reason)!;
      return { reason, count: g.count, examples: [...g.examples].sort().slice(0, EXAMPLES) };
    });
  }
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

export function viewFromFiles(
  files: Record<string, string>,
  opts: Pick<ViewOptions, 'maxBytes'> = {},
): RepoView {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
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
    stats: () => {
      const skips = new Skips();
      let scanned = 0;
      for (const f of list) {
        const text = files[f]!;
        if (text.includes('\0')) skips.add('binary', f);
        else if (Buffer.byteLength(text) > maxBytes) skips.add('over-byte-cap', f);
        else scanned++;
      }
      return {
        total: list.length,
        totalIsLowerBound: false,
        listed: list.length,
        scanned,
        skipped: skips.groups(),
        caps: { maxFiles: MAX_FILES, maxBytes },
      };
    },
  };
}

export function viewFromDir(root: string, opts: ViewOptions = {}): RepoView {
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const walkCap = opts.walkCap ?? WALK_CAP;
  const lstat = opts.lstat ?? ((p: string) => lstatSync(p));
  const files: string[] = [];
  const skips = new Skips();
  const symlinks = new Set<string>();
  const sizes = new Map<string, number>();
  let seen = 0;
  let truncated = false;
  let lowerBound = false;
  const walk = (rel: string): void => {
    for (const name of readdirSync(path.join(root, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (lowerBound) return;
      if (SKIP.has(name) || SKIP_PATHS.some((p) => r === p || r.endsWith(`/${p}`))) {
        // `lstat` decides whether it is a directory: an ignored *file* is simply not listed.
        if (lstat(path.join(root, r)).isDirectory()) skips.add('ignored-dir', r);
        continue;
      }
      const st = lstat(path.join(root, r));
      if (st.isDirectory()) walk(r);
      else {
        if (seen >= walkCap) {
          lowerBound = true;
          skips.add('walk-cap', r);
          return;
        }
        seen++;
        if (files.length >= maxFiles) {
          truncated = true;
          skips.add('over-file-cap', r);
        } else {
          files.push(r);
          sizes.set(r, st.size);
          if (st.isSymbolicLink()) symlinks.add(r);
        }
      }
    }
  };
  walk('');
  files.sort();
  const set = new Set(files);
  const cache = new Map<string, string | null>();
  const read = (f: string): string | null => {
    if (cache.has(f)) return cache.get(f)!;
    let v: string | null = null;
    const abs = path.join(root, f);
    if (set.has(f) && existsSync(abs) && !symlinks.has(f) && !lstat(abs).isSymbolicLink()) {
      const buf = readFileSync(abs);
      v = buf.includes(0) ? null : buf.subarray(0, maxBytes).toString('utf8');
    }
    cache.set(f, v);
    return v;
  };
  let stats: ViewStats | null = null;
  return {
    files,
    truncated,
    has: (f) => set.has(f),
    read,
    glob: (p) => {
      const re = globToRegExp(p);
      return files.filter((f) => re.test(f));
    },
    stats: () => {
      if (stats) return stats;
      // Classification needs the bytes for binaries, so it reads every listed file once (cached).
      const classified = new Skips();
      let scanned = 0;
      for (const f of files) {
        if (symlinks.has(f)) classified.add('symlink', f);
        else if (read(f) === null) classified.add('binary', f);
        else if ((sizes.get(f) ?? 0) > maxBytes) classified.add('over-byte-cap', f);
        else scanned++;
      }
      const all = new Map<SkipReason, SkipGroup>();
      for (const g of [...skips.groups(), ...classified.groups()]) all.set(g.reason, g);
      stats = {
        total: seen,
        totalIsLowerBound: lowerBound,
        listed: files.length,
        scanned,
        skipped: ORDER.filter((r) => all.has(r)).map((r) => all.get(r)!),
        caps: { maxFiles, maxBytes },
      };
      return stats;
    },
  };
}
