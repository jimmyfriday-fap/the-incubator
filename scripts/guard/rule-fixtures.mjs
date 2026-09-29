#!/usr/bin/env node
// Every local Semgrep rule (security/rules/<id>.yml) must fire on security/fixtures/<id>/bad.*
// and stay silent on security/fixtures/<id>/good.*.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, report, runGuard } from './lib/common.mjs';
import { run } from './lib/proc.mjs';
import { toolCommand } from './lib/tools.mjs';

export async function checkRuleFixtures(root, semgrep) {
  const findings = [];
  const rules = readdirSync(path.join(root, 'security', 'rules'))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  if (rules.length === 0) return ['security/rules: no local rules'];
  for (const ruleFile of rules) {
    const id = ruleFile.replace(/\.ya?ml$/, '');
    const dir = path.join('security', 'fixtures', id);
    let fixtures;
    try {
      fixtures = readdirSync(path.join(root, dir));
    } catch {
      findings.push(`${id}: missing fixture directory ${dir}`);
      continue;
    }
    const bad = fixtures.filter((f) => f.startsWith('bad.'));
    const good = fixtures.filter((f) => f.startsWith('good.'));
    if (!bad.length || !good.length) findings.push(`${id}: needs bad.* and good.* fixtures`);
    const r = await run(
      semgrep[0],
      [
        ...semgrep[1],
        'scan',
        '--config',
        path.join('security', 'rules', ruleFile),
        '--json',
        '--metrics',
        'off',
        '--disable-version-check',
        '--quiet',
        ...[...bad, ...good].map((f) => path.join(dir, f)),
      ],
      { cwd: root, capture: true },
    );
    if (r.code !== 0 && r.code !== 1)
      throw new Error(`semgrep failed on ${id}: ${r.stderr.slice(0, 400)}`);
    const results = JSON.parse(r.stdout).results ?? [];
    const hits = (f) => results.filter((x) => path.basename(x.path) === f).length;
    for (const f of bad) if (hits(f) === 0) findings.push(`${id}: did not fire on ${dir}/${f}`);
    for (const f of good) if (hits(f) > 0) findings.push(`${id}: false positive on ${dir}/${f}`);
  }
  return findings;
}

if (isMain(import.meta.url)) {
  runGuard(async ({ flags }) => {
    const root = process.cwd();
    const semgrep = toolCommand(root, 'semgrep');
    if (!semgrep) {
      if (process.platform === 'win32') {
        process.stdout.write(
          'SKIPPED rule-fixtures: Semgrep has no supported Windows build; the security-scan workflow runs them on Linux.\n',
        );
        return EXIT.OK;
      }
      process.stderr.write('semgrep not found (run: node scripts/tools-fetch.mjs)\n');
      return EXIT.TOOL;
    }
    return report('rule-fixtures', await checkRuleFixtures(root, semgrep), { quiet: flags.quiet });
  });
}
