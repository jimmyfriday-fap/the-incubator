#!/usr/bin/env node
// Thin launcher: the only place that calls process.exit.
import { liveIo, main } from '../dist/index.js';

// Ctrl+C stops the work under way (the model call or the coding agent) and the journal says so; a second
// Ctrl+C, or one when nothing is running, exits at once with 130. `ui` has its own graceful shutdown.
const control = {};
let hits = 0;
process.on('SIGINT', () => {
  if (!control.stop) return;
  hits++;
  if (control.stop() === 0 || hits > 1) process.exit(130);
  process.stderr.write('\nStopping… (press Ctrl+C again to exit now)\n');
});
const code = await main(process.argv.slice(2), liveIo(), undefined, control);
// why: exit only after stdout has drained (pipe writes are asynchronous on Windows).
process.stdout.write('', () => process.exit(code));
