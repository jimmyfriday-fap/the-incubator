import { homedir } from 'node:os';
import path from 'node:path';
import { PolicyError } from './errors.js';

/** `$INCUBATOR_HOME` or `~/.incubator`. Never a hard-coded absolute path. */
export function incubatorHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['INCUBATOR_HOME'];
  return override && override.length > 0
    ? path.resolve(override)
    : path.join(homedir(), '.incubator');
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/').replace(/\\/g, '/');
}

function isAbsoluteAnywhere(p: string): boolean {
  return path.posix.isAbsolute(p) || path.win32.isAbsolute(p) || /^[A-Za-z]:/.test(p);
}

/**
 * Resolves a relative, POSIX-or-Windows style path under `root` and refuses anything that escapes it
 * (absolute paths, drive letters, `..` traversal). Returns the native absolute path.
 */
export function resolveInside(root: string, relative: string): string {
  if (relative.includes('\0')) throw new PolicyError('path contains NUL', { code: 'path_escape' });
  if (isAbsoluteAnywhere(relative)) {
    throw new PolicyError(`absolute path not allowed: ${relative}`, { code: 'path_escape' });
  }
  const normalized = path.posix.normalize(relative.replace(/\\/g, '/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new PolicyError(`path escapes root: ${relative}`, { code: 'path_escape' });
  }
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, ...normalized.split('/'));
  const rel = path.relative(rootAbs, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PolicyError(`path escapes root: ${relative}`, { code: 'path_escape' });
  }
  return target;
}
