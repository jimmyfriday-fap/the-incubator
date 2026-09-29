#!/usr/bin/env node
// Contract files (schemas, agent profile, scoring weights) are SHA-256 pinned in contracts.lock.json.
// `--update` re-pins (a human-only action per the agent profile).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, listFiles, matchesAny, readJson, report, runGuard } from './lib/common.mjs';

export function hashContract(root, rel) {
  const text = readFileSync(path.join(root, rel), 'utf8').replace(/\r\n?/g, '\n');
  return createHash('sha256').update(text).digest('hex');
}

export function pinnedFiles(root) {
  const { pinned } = readJson(root, 'config/contracts.json');
  return listFiles(root).filter((f) => matchesAny(f, pinned));
}

export function checkPins(root) {
  const lock = readJson(root, 'contracts.lock.json', { files: {} });
  const findings = [];
  const current = pinnedFiles(root);
  for (const f of current) {
    const want = lock.files[f];
    if (!want)
      findings.push(`${f}: contract file is not pinned (run the contracts:pin human-only action)`);
    else if (want !== hashContract(root, f)) findings.push(`${f}: content does not match its pin`);
  }
  for (const f of Object.keys(lock.files)) {
    if (!current.includes(f)) findings.push(`${f}: pinned but missing`);
  }
  return findings;
}

export function updatePins(root) {
  const files = {};
  for (const f of pinnedFiles(root)) files[f] = hashContract(root, f);
  writeFileSync(path.join(root, 'contracts.lock.json'), `${JSON.stringify({ files }, null, 2)}\n`);
  return Object.keys(files).length;
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const root = process.cwd();
    if (flags.update) {
      process.stdout.write(`pinned ${updatePins(root)} contract file(s)\n`);
      return EXIT.OK;
    }
    return report('contracts-pin', checkPins(root), { quiet: flags.quiet });
  });
}
