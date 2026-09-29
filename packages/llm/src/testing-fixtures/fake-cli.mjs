#!/usr/bin/env node
// A stand-in agent CLI for adapter tests. Behaviour comes from files next to this script.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
// why: process.exit() right after a pipe write can drop output on Windows; set exitCode instead.
if (args.includes('--version')) process.stdout.write('9.9.9 (Fake Agent)\n');
else if (args.includes('--help'))
  process.stdout.write(readFileSync(path.join(here, 'help.txt'), 'utf8'));
else readPrompt();

function readPrompt() {
  let stdin = '';
  process.stdin.on('data', (b) => (stdin += b));
  process.stdin.on('end', () => {
    writeFileSync(
      path.join(here, 'last-call.json'),
      JSON.stringify({
        args,
        cwd: process.cwd(),
        cwdEntries: readdirSync(process.cwd()),
        envKeys: Object.keys(process.env),
        stdin,
      }),
    );
    const mode = readFileSync(path.join(here, 'mode.txt'), 'utf8').trim();
    if (mode === 'fail') {
      process.stderr.write('boom: not logged in\n');
      process.exitCode = 3;
      return;
    }
    if (mode === 'hang') setTimeout(() => {}, 60_000);
    else process.stdout.write(readFileSync(path.join(here, 'reply.txt'), 'utf8'));
  });
}
