#!/usr/bin/env node
// Thin launcher: the only place that calls process.exit.
import { liveIo, main } from '../dist/index.js';

const code = await main(process.argv.slice(2), liveIo());
// why: exit only after stdout has drained (pipe writes are asynchronous on Windows).
process.stdout.write('', () => process.exit(code));
