// Scenario contract layer: every tests/scenarios/<feature>/*.json runs through tests/adapters/<feature>.ts.
// INCUBATOR_SCENARIO_TAGS (set by `node scripts/test-profile.mjs <name>`) narrows the set.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAssertion, loadScenarios } from '../scripts/guard/lib/scenario.mjs';
import type { FeatureAdapter } from './adapters/types.js';

const root = path.resolve(import.meta.dirname, '..');
const wanted = (process.env['INCUBATOR_SCENARIO_TAGS'] ?? '*').split(',').filter(Boolean);
const live = process.env['INCUBATOR_LIVE'] === '1';
const scenarios = loadScenarios(root).filter(
  (s) => s.data && (wanted.includes('*') || s.data.tags.some((t) => wanted.includes(t))),
);

describe('scenario contract layer', () => {
  it('found scenarios to run', () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  for (const s of scenarios) {
    const scenario = s.data!;
    if (scenario.status === 'todo') {
      it.todo(`${scenario.feature}/${scenario.id}`);
      continue;
    }
    it.skipIf(scenario.tags.includes('live') && !live)(`${scenario.feature}/${scenario.id}`, async () => {
      expect(s.errors).toEqual([]);
      const mod = (await import(`./adapters/${scenario.feature}.ts`)) as { adapter: FeatureAdapter };
      const ctx = await mod.adapter.seedContext(scenario);
      for (const stage of scenario.stages) {
        const captured = mod.adapter.captureOutput(await mod.adapter.runStage(stage, ctx, scenario), ctx);
        const failures = [
          ...stage.assertions.map((a) => evaluateAssertion(captured, a)).filter((f) => f !== null),
          ...mod.adapter.validate(captured, stage),
        ];
        expect(failures, `${s.file} stage ${stage.name}`).toEqual([]);
      }
    });
  }
});
