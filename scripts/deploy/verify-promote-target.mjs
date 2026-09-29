#!/usr/bin/env node
// Rollback safety: the target must be the most recent promote merge on the production branch
// (a commit carrying a "Promote-Run:" trailer). Exit 2 otherwise.
//   node scripts/deploy/verify-promote-target.mjs --sha <sha> [--branch production]
import { EXIT, isMain, parseArgs } from '../guard/lib/common.mjs';
import { run, which } from '../guard/lib/proc.mjs';

export function latestPromote(logText) {
  // Records are separated by \x1e; each is "<sha>\x1f<body>".
  for (const rec of logText.split('\x1e')) {
    const [sha, body] = rec.trim().split('\x1f');
    if (sha && /^Promote-Run:/m.test(body ?? '')) return sha;
  }
  return null;
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const target = String(flags.sha ?? '');
  const branch = String(flags.branch ?? 'production');
  const git = which('git');
  if (!git || !/^[0-9a-f]{7,40}$/.test(target)) {
    process.stderr.write('usage: verify-promote-target.mjs --sha <sha> [--branch production]\n');
    process.exitCode = EXIT.POLICY;
  } else {
    const r = await run(
      git[0],
      [
        ...git[1],
        'log',
        '--first-parent',
        '--format=%H%x1f%B%x1e',
        '-n',
        '200',
        `origin/${branch}`,
      ],
      { capture: true },
    );
    if (r.code !== 0) {
      process.stderr.write(`git log failed: ${r.stderr}\n`);
      process.exitCode = EXIT.TOOL;
    } else {
      const latest = latestPromote(r.stdout);
      if (latest && latest.startsWith(target)) {
        process.stdout.write(`✔ ${target} is the latest promote merge on ${branch}\n`);
      } else {
        process.stderr.write(
          `✖ refusing rollback: latest promote merge on ${branch} is ${latest ?? '(none)'}, not ${target}\n`,
        );
        process.exitCode = EXIT.POLICY;
      }
    }
  }
}
