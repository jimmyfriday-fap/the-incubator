#!/usr/bin/env node
// Validates the shape of scanner outputs in scan-results/ before the policy gate reads them.
// A missing or malformed report is the tool breaking (exit 1), never a silent pass.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, runGuard } from './lib/common.mjs';

export const SHAPES = {
  semgrep: (r) =>
    r &&
    Array.isArray(r.results) &&
    Array.isArray(r.errors) &&
    r.results.every((x) => x.check_id && x.path && x.extra),
  trivy: (r) =>
    r &&
    typeof r === 'object' &&
    !Array.isArray(r) &&
    (r.Results === undefined || Array.isArray(r.Results)) &&
    'SchemaVersion' in r,
  gitleaks: (r) => Array.isArray(r) && r.every((x) => x.RuleID && 'File' in x),
};

export function validateResults(dir, tools) {
  const problems = [];
  for (const tool of tools) {
    const file = path.join(dir, `${tool}.json`);
    if (!existsSync(file)) {
      problems.push(`${tool}: ${file} is missing`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      problems.push(`${tool}: invalid JSON (${e.message})`);
      continue;
    }
    if (!SHAPES[tool]) problems.push(`${tool}: unknown tool`);
    else if (!SHAPES[tool](data)) problems.push(`${tool}: unexpected report shape`);
  }
  return problems;
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const dir = String(flags.dir ?? 'scan-results');
    const tools = String(flags.tools ?? 'semgrep,trivy,gitleaks').split(',');
    const problems = validateResults(dir, tools);
    if (problems.length) {
      for (const p of problems) process.stdout.write(`✖ ${p}\n`);
      return EXIT.TOOL;
    }
    process.stdout.write(`✔ scan results valid: ${tools.join(', ')}\n`);
    return EXIT.OK;
  });
}
