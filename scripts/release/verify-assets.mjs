#!/usr/bin/env node
// Post-release task: checks that dist artifacts for every desktop target exist before a release is
// announced. Runs in the release workflow after electron-builder (Phase 6); exit 2 when any is missing.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'apps/desktop/release');
const want = [/\.exe$/, /\.dmg$/, /\.AppImage$/];
const have = existsSync(dir) ? readdirSync(dir) : [];
const missing = want.filter((re) => !have.some((f) => re.test(f)));
if (missing.length) {
  process.stderr.write(`missing release assets in ${dir}: ${missing.map(String).join(', ')}\n`);
  process.exitCode = 2;
} else process.stdout.write(`release assets present: ${have.length} file(s)\n`);
