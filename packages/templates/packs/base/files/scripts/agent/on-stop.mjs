#!/usr/bin/env node
// Stop hook (ADR-017): run check:quick. Green → mark the active ticket READY_FOR_TEST.
// Red → record a remediation and exit 2, which vetoes the stop so the agent keeps fixing.
// After MAX_VETOES consecutive vetoes the stop is allowed and the ticket is parked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain } from '../guard/lib/common.mjs';
import { run } from '../guard/lib/proc.mjs';
import { activeTicket, addRemediation, transition } from './tracker.mjs';

export const MAX_VETOES = 3;

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), 2000);
    process.stdin.on('data', (b) => (data += b));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on('error', () => resolve(data));
  });
}

export function decide(checkCode, vetoes) {
  if (checkCode === 0) return { action: 'ready', vetoes: 0 };
  if (vetoes + 1 > MAX_VETOES) return { action: 'park', vetoes: 0 };
  return { action: 'veto', vetoes: vetoes + 1 };
}

async function main() {
  const root = process.cwd();
  const input = await readStdin();
  let hookActive;
  try {
    hookActive = Boolean(JSON.parse(input || '{}').stop_hook_active);
  } catch {
    hookActive = false;
  }
  const stateDir = path.join(root, '.incubator', 'state');
  mkdirSync(stateDir, { recursive: true });
  const counterFile = path.join(stateDir, 'stop-vetoes.json');
  const vetoes = existsSync(counterFile)
    ? (JSON.parse(readFileSync(counterFile, 'utf8')).count ?? 0)
    : 0;
  const check = await run(process.execPath, ['scripts/check.mjs', 'quick'], {
    cwd: root,
    capture: true,
  });
  const d = decide(check.code, vetoes);
  writeFileSync(counterFile, `${JSON.stringify({ count: d.vetoes, hookActive })}\n`);
  const ticket = activeTicket(root);
  if (d.action === 'ready') {
    if (ticket)
      await transition(root, ticket, 'READY_FOR_TEST').catch((e) =>
        process.stderr.write(`tracker: ${e.message}\n`),
      );
    return EXIT.OK;
  }
  const tail = (check.stdout.split('── check')[1] ?? check.stdout).slice(-1500);
  await addRemediation(root, ticket, {
    kind: 'check-failed',
    command: 'check:quick',
    exit: check.code,
    excerpt: tail,
  });
  if (d.action === 'park') {
    if (ticket) await transition(root, ticket, 'PARKED').catch(() => undefined);
    process.stderr.write(
      `check:quick still failing after ${MAX_VETOES} vetoes; stopping and parking.\n`,
    );
    return EXIT.OK;
  }
  process.stderr.write(
    `check:quick failed (veto ${d.vetoes}/${MAX_VETOES}). Fix it before stopping:\n── check${tail}\n`,
  );
  return EXIT.POLICY;
}

if (isMain(import.meta.url)) {
  main().then(
    (c) => (process.exitCode = c),
    (e) => {
      process.stderr.write(`on-stop hook error: ${e.message}\n`);
      process.exitCode = EXIT.TOOL;
    },
  );
}
