#!/usr/bin/env node
// Fails closed when a test run collected zero tests (vitest JSON or JUnit XML report).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, runGuard } from './lib/common.mjs';

export function countTests(text, format) {
  if (format === 'vitest-json') return JSON.parse(text).numTotalTests ?? 0;
  if (format === 'junit') {
    // why: count test cases, not suite totals; PHPUnit nests <testsuite> elements, so summing
    // every suite's `tests` attribute counts each test once per nesting level.
    const cases = text.match(/<testcase\b/g)?.length ?? 0;
    if (cases > 0) return cases;
    const suites = /<testsuites[^>]*\btests="(\d+)"/.exec(text);
    return suites ? Number(suites[1]) : 0;
  }
  throw new Error(`unknown report format ${format}`);
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const report = flags.report;
    const format = flags.format ?? 'vitest-json';
    const min = Number(flags.min ?? 1);
    const abs = path.resolve(process.cwd(), String(report));
    if (!report || !existsSync(abs)) {
      process.stdout.write(`✖ tests-collected: report ${report} not found (did the suite run?)\n`);
      return EXIT.POLICY;
    }
    const n = countTests(readFileSync(abs, 'utf8'), format);
    if (n < min) {
      process.stdout.write(`✖ tests-collected: ${n} test(s) collected, need ≥ ${min}\n`);
      return EXIT.POLICY;
    }
    process.stdout.write(`✔ tests-collected: ${n}\n`);
    return EXIT.OK;
  });
}
