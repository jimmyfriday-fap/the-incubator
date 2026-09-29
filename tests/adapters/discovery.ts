import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DefaultsPrompter, NonInteractivePrompter } from '@incubator/core';
import { discoveryFixtureDir, fakeEngine } from '@incubator/core/testing';
import { CliAdapter, FakeLlmAdapter, type FixtureTurn } from '@incubator/llm';
import { exitCodeFor, nodeExec } from '@incubator/runtime';
import type { IncubatorSpec } from '@incubator/spec';
import type { FeatureAdapter } from './types.js';

interface Ctx {
  /** A fixture directory name, inline turns, or 'live-claude-cli'. */
  fixtures: string | FixtureTurn[];
}
interface Out {
  state: string;
  exitCode: number;
  parkedReason: string | null;
  spec: IncubatorSpec | null;
  questionsAsked: number[];
}

/** Drives the discovery engine with a fake (or, for `live` scenarios, the real claude CLI) adapter. */
export const adapter: FeatureAdapter<Ctx, Out> = {
  name: 'discovery',
  seedContext: (s) => ({ fixtures: (s.seed['fixtures'] as Ctx['fixtures'] | undefined) ?? [] }),
  async runStage(stage, ctx) {
    const input = (stage.input ?? {}) as { narrative?: string; fixtureDir?: string; yes?: boolean };
    const llm =
      ctx.fixtures === 'live-claude-cli'
        ? new CliAdapter({ id: 'claude-cli', bin: 'claude', exec: nodeExec })
        : typeof ctx.fixtures === 'string'
          ? new FakeLlmAdapter({ dir: discoveryFixtureDir(ctx.fixtures) })
          : new FakeLlmAdapter(ctx.fixtures);
    const h = fakeEngine(llm);
    const narrative =
      input.narrative ??
      (typeof ctx.fixtures === 'string' && ctx.fixtures !== 'live-claude-cli'
        ? readFileSync(path.join(discoveryFixtureDir(ctx.fixtures), 'narrative.md'), 'utf8').trim()
        : '');
    const runId = h.engine.start({ kind: 'new', narrative, specOnly: true, surface: 'test' });
    const prompter = input.yes === false ? new NonInteractivePrompter() : new DefaultsPrompter();
    try {
      const state = await h.engine.advance(runId, prompter);
      const asked = h.engine
        .entries(runId)
        .filter((e) => e.type === 'questions')
        .map((e) => (e['questions'] as unknown[]).length);
      return {
        state: state.state,
        exitCode: state.state === 'PARKED' ? 2 : 0,
        parkedReason: state.parked?.reason ?? null,
        spec: state.state === 'DONE' ? (h.engine.draft(runId) as unknown as IncubatorSpec) : null,
        questionsAsked: asked,
      };
    } catch (err) {
      return {
        state: 'ERROR',
        exitCode: exitCodeFor(err),
        parkedReason: null,
        spec: null,
        questionsAsked: [],
      };
    }
  },
  captureOutput: (out) => out,
  validate(captured) {
    const out = captured as Out;
    const errors: string[] = [];
    if (out.questionsAsked.some((n) => n > 5)) errors.push('more than 5 questions in a round');
    if (out.questionsAsked.length > 2) errors.push('more than 2 rounds');
    if (
      out.spec &&
      out.spec.decisions.some((d) => !['user', 'inferred', 'default'].includes(d.source))
    )
      errors.push('unattributed decision');
    return errors;
  },
};
