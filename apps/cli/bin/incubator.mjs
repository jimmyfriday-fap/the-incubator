#!/usr/bin/env node
// Thin launcher: the only place that calls process.exit.
import { main } from '../dist/index.js';

const code = await main(process.argv.slice(2), {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
});
process.exit(code);
