#!/usr/bin/env node
// Fails on absolute machine paths (drive letters, /home/<user>/, /Users/<user>/, UNC shares).
// A line containing "abs-path-lint: allow" is exempt; config/abs-path.json may exempt whole files
// (for example tests of path handling) with a stated reason.
import {
  isMain,
  matchesAny,
  readJson,
  readText,
  report,
  runGuard,
  selectFiles,
} from './lib/common.mjs';

const PATTERNS = [
  [/(?<![A-Za-z0-9_])[A-Za-z]:(\\{1,2})[A-Za-z0-9_. -]+\1/, 'Windows drive path'],
  [
    /(?<![A-Za-z0-9_])[A-Za-z]:\/(?:Users|Program Files|Windows|dev|src|code|work)\//i,
    'Windows drive path',
  ],
  [/(?<![\w.~$-])\/(?:home|Users)\/[A-Za-z0-9_.-]+\//, 'home directory path'],
  [/(?<![\w\\])\\\\[A-Za-z0-9_.-]+\\[A-Za-z0-9$_.-]+/, 'UNC path'],
];

export function allowedFiles(root) {
  const cfg = readJson(root, 'config/abs-path.json', { allow: [] });
  for (const a of cfg.allow)
    if (!a.reason) throw new Error(`config/abs-path.json: ${a.glob} needs a reason`);
  return cfg.allow.map((a) => a.glob);
}

export function findAbsolutePaths(root, files, allow = allowedFiles(root)) {
  const findings = [];
  for (const f of files) {
    if (matchesAny(f, allow)) continue;
    const text = readText(root, f);
    if (text === null) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('abs-path-lint: allow')) return;
      for (const [re, label] of PATTERNS) {
        const m = re.exec(line);
        if (m) {
          findings.push(`${f}:${i + 1}: ${label}: ${m[0].slice(0, 60)}`);
          break;
        }
      }
    });
  }
  return findings;
}

if (isMain(import.meta.url)) {
  runGuard(({ positional, flags }) => {
    const root = process.cwd();
    return report('abs-path', findAbsolutePaths(root, selectFiles(root, positional)), {
      quiet: flags.quiet,
    });
  });
}
