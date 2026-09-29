#!/usr/bin/env node
// Resolves every action tag in packages/templates/actions-lock.json to its commit SHA
// (dereferencing annotated tags) via `git ls-remote`. Review the diff before committing.
import { readFileSync, writeFileSync } from 'node:fs';
import { EXIT, isMain } from './guard/lib/common.mjs';
import { run, which } from './guard/lib/proc.mjs';

const LOCK = 'packages/templates/actions-lock.json';

export function pickSha(lsRemote, tag) {
  const lines = lsRemote
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
  const deref = lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
  const direct = lines.find(([, ref]) => ref === `refs/tags/${tag}`);
  return (deref ?? direct)?.[0] ?? null;
}

async function main() {
  const git = which('git');
  if (!git) throw new Error('git not found');
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  for (const [name, entry] of Object.entries(lock.actions)) {
    const repo = name.split('/').slice(0, 2).join('/');
    const r = await run(
      git[0],
      [
        ...git[1],
        'ls-remote',
        '--tags',
        `https://github.com/${repo}`,
        `refs/tags/${entry.tag}`,
        `refs/tags/${entry.tag}^{}`,
      ],
      { capture: true },
    );
    const sha = pickSha(r.stdout, entry.tag);
    if (!sha) throw new Error(`${name}@${entry.tag}: tag not found`);
    if (sha !== entry.sha)
      process.stdout.write(`${name}@${entry.tag}: ${entry.sha || '(new)'} → ${sha}\n`);
    entry.sha = sha;
  }
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  return EXIT.OK;
}

if (isMain(import.meta.url)) {
  main().then(
    (c) => (process.exitCode = c),
    (e) => {
      process.stderr.write(`actions-refresh: ${e.message}\n`);
      process.exitCode = EXIT.TOOL;
    },
  );
}
