#!/usr/bin/env node
// Final CI gate: reads the `needs` context (NEEDS_JSON env) and fails unless every job succeeded.
import { EXIT, isMain, runGuard } from './lib/common.mjs';

export function evaluateNeeds(needs, allowSkipped = []) {
  const failures = [];
  for (const [job, info] of Object.entries(needs)) {
    const result = info?.result;
    if (result === 'success') continue;
    if (result === 'skipped' && allowSkipped.includes(job)) continue;
    failures.push(`${job}: ${result}`);
  }
  return failures;
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const raw = process.env.NEEDS_JSON;
    if (!raw) {
      process.stderr.write('NEEDS_JSON is not set\n');
      return EXIT.TOOL;
    }
    const allow =
      typeof flags['allow-skipped'] === 'string' ? flags['allow-skipped'].split(',') : [];
    const failures = evaluateNeeds(JSON.parse(raw), allow);
    if (failures.length) {
      process.stdout.write(`✖ gate: ${failures.join(', ')}\n`);
      return EXIT.POLICY;
    }
    process.stdout.write('✔ gate: all jobs succeeded\n');
    return EXIT.OK;
  });
}
