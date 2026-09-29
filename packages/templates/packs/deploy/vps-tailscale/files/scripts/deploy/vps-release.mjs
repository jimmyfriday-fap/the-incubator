#!/usr/bin/env node
// VPS release management on the self-hosted runner: copies the build into a timestamped release
// directory, swaps the `current` symlink atomically, keeps the last N releases, and can roll back.
//   node scripts/deploy/vps-release.mjs --root <dir> --sha <sha> --from <build dir> [--keep 5]
//   node scripts/deploy/vps-release.mjs --root <dir> --rollback
import { cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, parseArgs } from '../guard/lib/common.mjs';

export function releaseName(date, sha) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}-${sha.slice(0, 7)}`;
}

export function listReleases(root) {
  const dir = path.join(root, 'releases');
  return existsSync(dir) ? readdirSync(dir).filter((d) => /^\d{14}-[0-9a-f]{7}$/.test(d)).sort() : [];
}

/** Atomic swap: write current.tmp, then rename over current. */
export function pointCurrent(root, release) {
  const tmp = path.join(root, 'current.tmp');
  rmSync(tmp, { force: true });
  symlinkSync(path.join('releases', release), tmp);
  renameSync(tmp, path.join(root, 'current'));
}

export function prune(root, keep) {
  const releases = listReleases(root);
  const current = existsSync(path.join(root, 'current')) ? path.basename(readlinkSync(path.join(root, 'current'))) : null;
  for (const r of releases.slice(0, Math.max(0, releases.length - keep))) {
    if (r !== current) rmSync(path.join(root, 'releases', r), { recursive: true, force: true });
  }
}

export function release(root, sha, from, keep, now = new Date()) {
  const name = releaseName(now, sha);
  mkdirSync(path.join(root, 'releases'), { recursive: true });
  cpSync(from, path.join(root, 'releases', name), { recursive: true });
  pointCurrent(root, name);
  prune(root, keep);
  return name;
}

export function rollback(root) {
  const releases = listReleases(root);
  const current = path.basename(readlinkSync(path.join(root, 'current')));
  const idx = releases.indexOf(current);
  if (idx <= 0) throw new Error('no previous release to roll back to');
  pointCurrent(root, releases[idx - 1]);
  return releases[idx - 1];
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = path.resolve(String(flags.root ?? ''));
  try {
    if (!flags.root) throw new Error('--root is required');
    if (flags.rollback) process.stdout.write(`rolled back to ${rollback(root)}\n`);
    else {
      if (!/^[0-9a-f]{7,40}$/.test(String(flags.sha ?? ''))) throw new Error('--sha is required');
      const name = release(root, String(flags.sha), path.resolve(String(flags.from ?? '.')), Number(flags.keep ?? 5));
      process.stdout.write(`released ${name}\n`);
    }
  } catch (e) {
    process.stderr.write(`vps-release: ${e.message}\n`);
    process.exitCode = EXIT.POLICY;
  }
}
