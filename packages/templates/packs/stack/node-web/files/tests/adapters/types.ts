import type { Scenario, Stage } from '../../scripts/guard/lib/scenario.mjs';

/** Per-feature adapter of the scenario contract layer. */
export interface FeatureAdapter<Ctx = unknown, Out = unknown> {
  name: string;
  seedContext(scenario: Scenario): Ctx | Promise<Ctx>;
  runStage(stage: Stage, ctx: Ctx, scenario: Scenario): Promise<Out>;
  captureOutput(out: Out, ctx: Ctx): unknown;
  validate(captured: unknown, stage: Stage): string[];
}
