// Guard toolkit shared helpers. Zero dependencies; Node >= 20. Rendered verbatim into generated repos.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Exit-code contract: 0 pass, 1 the tool broke, 2 a policy/gate finding, 130 interrupted. */
export const EXIT = Object.freeze({ OK: 0, TOOL: 1, POLICY: 2, INTERRUPTED: 130 });

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'vendor',
  '.venv',
  '.tools',
  '.reports',
  'coverage',
]);

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (
        i + 1 < argv.length &&
        !argv[i + 1].startsWith('--') &&
        a !== '--update' &&
        !BOOLEAN_FLAGS.has(a)
      )
        flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}
const BOOLEAN_FLAGS = new Set([
  '--update',
  '--explain',
  '--json',
  '--require-actionlint',
  '--allow-missing',
  '--quiet',
  '--yes',
  '--dry-run',
]);

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walk(root, rel, out) {
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, r, out);
    else out.push(r);
  }
}

/**
 * Tracked + untracked-but-not-ignored files (POSIX, relative to root). Falls back to a directory walk
 * outside git. Files deleted in the worktree are dropped.
 */
export function listFiles(root) {
  const res = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  let files;
  if (res.status === 0) {
    files = [...new Set(res.stdout.split('\0').filter(Boolean))];
  } else {
    files = [];
    walk(root, '', files);
  }
  return files
    .filter((f) => {
      try {
        lstatSync(path.join(root, f));
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

export function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const TEXT_CACHE = new Map();
/** Reads a text file (null for binary, symlinks and unreadable files). */
export function readText(root, rel) {
  const key = `${root}\0${rel}`;
  if (TEXT_CACHE.has(key)) return TEXT_CACHE.get(key);
  let value = null;
  try {
    const abs = path.join(root, rel);
    if (!lstatSync(abs).isSymbolicLink()) {
      const buf = readFileSync(abs);
      value = isBinary(buf) ? null : buf.toString('utf8');
    }
  } catch {
    value = null;
  }
  TEXT_CACHE.set(key, value);
  return value;
}

export function readJson(root, rel, fallback) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) {
    if (fallback !== undefined) return fallback;
    throw new GuardToolError(`missing required file ${rel}`);
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new GuardToolError(`invalid JSON in ${rel}: ${e.message}`);
  }
}

/** Glob → RegExp supporting `**`, `*`, `?` and `{a,b}` on POSIX paths. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
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

export function matchesAny(file, globs) {
  return globs.some((g) => globToRegExp(g).test(file));
}

export class GuardToolError extends Error {}

/** Formats findings, prints them and returns the exit code (0 or 2). */
export function report(name, findings, { quiet = false } = {}) {
  if (findings.length === 0) {
    if (!quiet) process.stdout.write(`✔ ${name}: ok\n`);
    return EXIT.OK;
  }
  process.stdout.write(`✖ ${name}: ${findings.length} finding(s)\n`);
  for (const f of findings) process.stdout.write(`  - ${f}\n`);
  return EXIT.POLICY;
}

/**
 * Runs a guard's main function with the exit-code contract: thrown GuardToolError or any
 * unexpected error → 1; SIGINT → 130.
 */
export function runGuard(fn) {
  process.on('SIGINT', () => process.exit(EXIT.INTERRUPTED));
  Promise.resolve()
    .then(() => fn(parseArgs(process.argv.slice(2))))
    .then(
      (code) => (process.exitCode = code ?? EXIT.OK),
      (err) => {
        process.stderr.write(`guard error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = EXIT.TOOL;
      },
    );
}

/** True when this module is the process entry point. */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = new URL(importMetaUrl);
  return (
    path.resolve(entry) ===
    path.resolve(decodeURIComponent(self.pathname).replace(/^\/([A-Za-z]:)/, '$1'))
  );
}

/** Restrict to explicit files when given (lefthook passes staged files), else all repo files. */
export function selectFiles(root, positional) {
  if (positional.length > 0)
    return positional.map((p) => toPosix(path.relative(root, path.resolve(root, p))));
  return listFiles(root);
}
