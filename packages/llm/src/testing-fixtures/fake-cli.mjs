#!/usr/bin/env node
// A stand-in agent CLI for adapter tests. Behaviour comes from files next to this script.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('9.9.9 (Fake Agent)\n');
  process.exit(0);
}
if (args.includes('--help')) {
  process.stdout.write(readFileSync(path.join(here, 'help.txt'), 'utf8'));
  process.exit(0);
}
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
    process.exit(3);
  }
  if (mode === 'hang') setTimeout(() => {}, 60_000);
  else process.stdout.write(readFileSync(path.join(here, 'reply.txt'), 'utf8'));
});
