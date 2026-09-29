#!/usr/bin/env node
// SessionStart hook: install dependencies with the lockfile, then run check:quick.
// Always exits 0 so a session is never blocked; the summary tells the agent what state it is in.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMain } from '../guard/lib/common.mjs';
import { run, which } from '../guard/lib/proc.mjs';

export function installCommand(root) {
  if (existsSync(path.join(root, 'pnpm-lock.yaml')))
    return ['pnpm', ['install', '--frozen-lockfile']];
  if (existsSync(path.join(root, 'package-lock.json'))) return ['npm', ['ci']];
  if (existsSync(path.join(root, 'composer.lock')))
    return ['composer', ['install', '--no-interaction']];
  if (existsSync(path.join(root, 'uv.lock'))) return ['uv', ['sync', '--frozen']];
  return null;
}

async function main() {
  const root = process.cwd();
  const lines = [];
  const install = installCommand(root);
  if (install) {
    const bin = which(install[0]);
    if (!bin) lines.push(`install: ${install[0]} not on PATH — dependencies not installed`);
    else {
      const r = await run(bin[0], [...bin[1], ...install[1]], { cwd: root, capture: true });
      lines.push(
        `install (${install[0]}): ${r.code === 0 ? 'ok' : `failed (exit ${r.code})\n${r.stderr.slice(-1500)}`}`,
      );
    }
  }
  const check = await run(process.execPath, ['scripts/check.mjs', 'quick'], {
    cwd: root,
    capture: true,
  });
  const summary = check.stdout.split('── check')[1] ?? check.stdout.slice(-2000);
  lines.push(`check:quick exit ${check.code}${summary ? `\n── check${summary}` : ''}`);
  if (check.code !== 0)
    lines.push('check:quick is RED: fix it before making other changes (verification loop).');
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (isMain(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      process.stdout.write(`session-start hook error: ${e.message}\n`);
      process.exit(0);
    },
  );
}
