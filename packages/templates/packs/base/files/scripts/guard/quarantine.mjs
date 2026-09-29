#!/usr/bin/env node
// Flake quarantine: every entry needs testId, owner, reason, issue and an unexpired YYYY-MM-DD expiry.
import { isMain, readJson, report, runGuard } from './lib/common.mjs';

export function checkQuarantine(config, today = new Date().toISOString().slice(0, 10)) {
  const findings = [];
  if (!Array.isArray(config.entries))
    return ['config/flake-quarantine.json: "entries" must be an array'];
  const seen = new Set();
  config.entries.forEach((e, i) => {
    const where = `entry ${i} (${e.testId ?? '?'})`;
    for (const k of ['testId', 'owner', 'reason', 'issue']) {
      if (typeof e[k] !== 'string' || !e[k].trim()) findings.push(`${where}: ${k} is required`);
    }
    if (typeof e.expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires))
      findings.push(`${where}: expires must be YYYY-MM-DD`);
    else if (e.expires < today)
      findings.push(`${where}: expired on ${e.expires}; fix the test or renew with an owner`);
    if (seen.has(e.testId)) findings.push(`${where}: duplicate testId`);
    seen.add(e.testId);
  });
  return findings;
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const config = readJson(process.cwd(), 'config/flake-quarantine.json');
    const findings = checkQuarantine(config);
    if (findings.length === 0 && config.entries.length > 0) {
      process.stdout.write(
        `quarantined (still run, reported): ${config.entries.map((e) => e.testId).join(', ')}\n`,
      );
    }
    return report('quarantine', findings, { quiet: flags.quiet });
  });
}
