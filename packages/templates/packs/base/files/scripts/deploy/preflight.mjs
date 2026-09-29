#!/usr/bin/env node
// Deploy preflight: every required setting must be present and not a placeholder. Exit 2 names the
// missing ones, so an unset secret fails as a clear gate instead of a confusing deploy error.
//   node scripts/deploy/preflight.mjs --require NAME,NAME
import { EXIT, isMain, parseArgs } from '../guard/lib/common.mjs';

export const PLACEHOLDER = '__INCUBATOR_UNSET__';

export function missingSettings(names, env) {
  return names.filter((n) => !env[n] || env[n] === PLACEHOLDER);
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const names = String(flags.require ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = missingSettings(names, process.env);
  if (missing.length) {
    process.stderr.write(
      `✖ preflight: set these repository secrets/variables first: ${missing.join(', ')} (see DEPLOY.md)\n`,
    );
    process.exitCode = EXIT.POLICY;
  } else process.stdout.write(`✔ preflight: ${names.length} setting(s) present\n`);
}
