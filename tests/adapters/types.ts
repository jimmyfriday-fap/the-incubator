import type { Scenario, Stage } from '../../scripts/guard/lib/scenario.mjs';

/** Per-feature adapter of the scenario contract layer (TDD §3.3). */
export interface FeatureAdapter<Ctx = unknown, Out = unknown> {
  name: string;
  seedContext(scenario: Scenario): Ctx | Promise<Ctx>;
  runStage(stage: Stage, ctx: Ctx, scenario: Scenario): Promise<Out>;
  captureOutput(out: Out, ctx: Ctx): unknown;
  /** Extra feature-specific checks beyond the declarative assertions. */
  validate(captured: unknown, stage: Stage): string[];
}
