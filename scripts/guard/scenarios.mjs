#!/usr/bin/env node
// Scenario catalog parity + run-profile coverage:
//  - every scenario file is structurally valid and lives under its feature's directory;
//  - every feature in config/features.json meets the onboarding minimum
//    (1 happy, 2 validation, 1 fault) and every scenario directory is a registered feature;
//  - every run profile in config/run-profiles.json resolves to at least one scenario.
import { isMain, readJson, report, runGuard } from './lib/common.mjs';
import { ONBOARDING_MINIMUM, loadScenarios, selectForProfile } from './lib/scenario.mjs';

export function checkScenarios(root) {
  const findings = [];
  const { features } = readJson(root, 'config/features.json');
  const profilesCfg = readJson(root, 'config/run-profiles.json');
  const scenarios = loadScenarios(root, profilesCfg.scenarioDir ?? 'tests/scenarios');
  for (const s of scenarios) for (const e of s.errors) findings.push(`${s.file}: ${e}`);
  const ids = new Set(features.map((f) => f.id));
  for (const dir of new Set(scenarios.map((s) => s.dirFeature))) {
    if (!ids.has(dir))
      findings.push(`tests/scenarios/${dir}: not a registered feature in config/features.json`);
  }
  for (const f of features) {
    const mine = scenarios.filter((s) => s.data?.feature === f.id);
    for (const [tag, min] of Object.entries(ONBOARDING_MINIMUM)) {
      const n = mine.filter((s) => s.data.tags.includes(tag)).length;
      if (n < min) findings.push(`feature ${f.id}: needs ≥${min} "${tag}" scenario(s), has ${n}`);
    }
  }
  return { findings, scenarios, profilesCfg };
}

export function emptyProfiles(scenarios, profilesCfg) {
  return Object.entries(profilesCfg.profiles)
    .filter(([, p]) => selectForProfile(scenarios, p).length === 0)
    .map(([name]) => name);
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const { findings, scenarios, profilesCfg } = checkScenarios(process.cwd());
    for (const name of emptyProfiles(scenarios, profilesCfg))
      findings.push(`run profile "${name}" selects zero scenarios`);
    return report('scenarios', findings, { quiet: flags.quiet });
  });
}
