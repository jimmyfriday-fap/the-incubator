import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FakeLlmAdapter } from '@incubator/llm';
import {
  covers,
  changedPaths,
  FIXED_BY_PACKS,
  validateSemantics,
  validateSpec,
  type IncubatorSpec,
} from '@incubator/spec';
import { describe, expect, it } from 'vitest';
import { DefaultsPrompter, NonInteractivePrompter, ScriptedPrompter } from './prompter.js';
import { loadPrompt, parsePrompt } from './prompts.js';
import { discoveryFixtureDir, fakeEngine } from './testing.js';
import { Journal } from './journal.js';

const NARRATIVES = [
  'saas-web',
  'wp-plugin',
  'python-webhook',
  'ts-library',
  'ambiguous-one-liner',
] as const;
const narrative = (name: string) =>
  readFileSync(path.join(discoveryFixtureDir(name), 'narrative.md'), 'utf8').trim();
const NOT_DECISIONS = ['decisions', 'gapReport', 'intent.narrative', ...FIXED_BY_PACKS];

function unattributed(spec: IncubatorSpec): string[] {
  return changedPaths({}, spec)
    .filter((p) => !NOT_DECISIONS.some((k) => covers(k, p)))
    .filter((p) => !spec.decisions.some((d) => covers(d.key, p)));
}

async function run(name: string, prompter = new ScriptedPrompter()) {
  const h = fakeEngine({ dir: discoveryFixtureDir(name) });
  const runId = h.engine.start({
    kind: 'new',
    narrative: narrative(name),
    specOnly: true,
    surface: 'test',
  });
  const state = await h.engine.advance(runId, prompter);
  return { h, runId, state, spec: h.engine.draft(runId) as unknown as IncubatorSpec, prompter };
}

describe('discovery prompt', () => {
  it('ships the brief text, versioned and byte-pinned', () => {
    const p = loadPrompt('discovery');
    expect(p.name).toBe('discovery');
    expect(p.version).toBe('1.0.0');
    expect(p.body).toMatchSnapshot();
    expect(() => parsePrompt('no front matter')).toThrow();
    expect(() => parsePrompt('---\nname: x\nversion: one\n---\nbody')).toThrow(/semver/);
  });
});

describe.each(NARRATIVES)('narrative %s', (name) => {
  it('produces a schema-valid, semantically valid spec with every decision attributed', async () => {
    const { state, spec, prompter, h, runId } = await run(name);
    expect(state.state).toBe('DONE');
    expect(validateSpec(spec).issues).toEqual([]);
    expect(validateSemantics(spec)).toEqual([]);
    expect(unattributed(spec)).toEqual([]);
    for (const d of spec.decisions) expect(['user', 'inferred', 'default']).toContain(d.source);
    expect(prompter.asked.length).toBeLessThanOrEqual(2);
    for (const round of prompter.asked) expect(round.length).toBeLessThanOrEqual(5);
    expect((h.adapter as FakeLlmAdapter).remaining).toBe(0);
    expect(spec.intent.narrative).toBe(narrative(name));
    expect(h.engine.entries(runId).map((e) => e.type)).toContain('spec.approved');
  });
});

describe('clarification rules', () => {
  it('keeps at most five questions per round, ranked by impact', async () => {
    const { prompter, h, runId, spec } = await run('python-webhook');
    expect(prompter.asked.map((r) => r.map((q) => q.key))).toEqual([
      ['deploy.target', 'stack.database', 'testing.home', 'tracker.type', 'agents.primary'],
      ['security.policyGate', 'testing.e2e'],
    ]);
    const dropped = h.engine.entries(runId).find((e) => e.type === 'questions.dropped');
    expect(dropped?.['dropped']).toEqual([
      { key: 'testing.coverageThreshold', why: 'over the per-round limit' },
    ]);
    expect(spec.testing.coverageThreshold).toBe(80);
    expect(h.engine.entries(runId).filter((e) => e.type === 'llm.turn')).toHaveLength(2);
  });

  it('drops pack-fixed questions and retries once on invalid questions or unattributed values', async () => {
    const { prompter, h, runId, spec } = await run(
      'ambiguous-one-liner',
      new ScriptedPrompter({ 'project.name': 'Team Hub' }),
    );
    expect(prompter.asked[0]?.map((q) => q.key)).toEqual(['platform', 'project.name']);
    const turn = h.engine.entries(runId).find((e) => e.type === 'llm.turn');
    expect(turn?.['attempts']).toBe(2);
    expect(spec.project.name).toBe('Team Hub');
    expect(spec.decisions.find((d) => d.key === 'project.name')).toMatchObject({
      source: 'user',
      answer: 'Team Hub',
    });
    expect(spec.stack.pack).toBe('node-web');
  });

  it('records user answers as authoritative user decisions', async () => {
    const { spec } = await run(
      'saas-web',
      new ScriptedPrompter({ 'deploy.target': 'docker-host' }),
    );
    expect(spec.deploy.target).toBe('docker-host');
    expect(spec.deploy.staging.tailnetOnly).toBe(false);
    expect(spec.decisions.find((d) => d.key === 'deploy.target')?.source).toBe('user');
    expect(spec.decisions.filter((d) => d.source === 'inferred').length).toBeGreaterThan(3);
    expect(spec.decisions.filter((d) => d.source === 'default').length).toBeGreaterThan(5);
  });

  it('--yes accepts every recommended default without prompting a human', async () => {
    const prompter = new DefaultsPrompter();
    const { state, spec } = await run('saas-web', prompter as unknown as ScriptedPrompter);
    expect(state.state).toBe('DONE');
    expect(prompter.interactive).toBe(false);
    expect(spec.deploy.target).toBe('vps-tailscale');
    expect(spec.decisions.find((d) => d.key === 'deploy.target')?.source).toBe('default');
  });
});

describe('parking and resume', () => {
  it('parks at CLARIFY without a human, then resumes to a finished spec', async () => {
    const h = fakeEngine({ dir: discoveryFixtureDir('saas-web') });
    const runId = h.engine.start({
      kind: 'new',
      narrative: narrative('saas-web'),
      specOnly: true,
      surface: 'test',
    });
    const parked = await h.engine.advance(runId, new NonInteractivePrompter());
    expect(parked.state).toBe('PARKED');
    expect(parked.parked).toMatchObject({ state: 'CLARIFY', reason: 'needs_input' });
    const resumed = await h.engine.resume(runId, new ScriptedPrompter());
    expect(resumed.state).toBe('DONE');
    expect(h.engine.entries(runId).map((e) => e.type)).toEqual(
      expect.arrayContaining(['park', 'resume', 'answers', 'run.done']),
    );
  });

  it('parks when the LLM fails the schema twice, and resumes with another adapter', async () => {
    const bad = new FakeLlmAdapter([
      { schemaName: 'DiscoveryTurn', response: { $text: 'Sorry, here is a summary instead.' } },
      {
        schemaName: 'DiscoveryTurn',
        response: { draftSpec: { platform: 'mainframe' }, questions: [], done: true },
      },
    ]);
    const h = fakeEngine(bad);
    const runId = h.engine.start({
      kind: 'new',
      narrative: narrative('ts-library'),
      specOnly: true,
      surface: 'test',
    });
    const parked = await h.engine.advance(runId, new DefaultsPrompter());
    expect(parked.parked).toMatchObject({ state: 'DRAFT_SPEC', reason: 'llm_schema' });
    h.setAdapter(new FakeLlmAdapter({ dir: discoveryFixtureDir('ts-library') }));
    const done = await h.engine.resume(runId, new DefaultsPrompter(), { adapter: 'fake' });
    expect(done.state).toBe('DONE');
    expect(done.input.adapter).toBe('fake');
  });

  it('parks on review rejection and on an invalid edited spec; approve() accepts a valid edit', async () => {
    const h = fakeEngine({ dir: discoveryFixtureDir('ts-library') });
    const runId = h.engine.start({
      kind: 'new',
      narrative: narrative('ts-library'),
      specOnly: true,
      surface: 'test',
    });
    const parked = await h.engine.advance(
      runId,
      new ScriptedPrompter({}, { approve: false, reason: 'wrong name' }),
    );
    expect(parked.parked).toMatchObject({ state: 'REVIEW', reason: 'review_rejected' });
    const spec = h.engine.draft(runId) as unknown as IncubatorSpec;
    const bad = { ...spec, platform: 'web' as const };
    const res = await h.engine.resume(
      runId,
      new ScriptedPrompter({}, { approve: true, spec: bad }),
    );
    expect(res.parked?.reason).toBe('spec_invalid');
    const edited = { ...spec, project: { ...spec.project, name: 'semver-mini' } };
    const done = await h.engine.resume(
      runId,
      new ScriptedPrompter({}, { approve: true, spec: edited }),
    );
    expect(done.state).toBe('DONE');
    expect((h.engine.draft(runId) as unknown as IncubatorSpec).project.name).toBe('semver-mini');
  });

  it('repairs a torn journal line and resumes', async () => {
    const h = fakeEngine({ dir: discoveryFixtureDir('wp-plugin') });
    const runId = h.engine.start({
      kind: 'new',
      narrative: narrative('wp-plugin'),
      specOnly: true,
      surface: 'test',
    });
    const file = path.join(h.store.runDir(runId), 'journal.jsonl');
    appendFileSync(file, '{"seq": 99, "type": "state.en');
    expect(Journal.readFile(file).repaired).toBe(true);
    const journal = new Journal(file, h.clock);
    expect(journal.repaired).toBe(true);
    expect(Journal.readFile(file).repaired).toBe(false);
    const done = await h.engine.advance(runId, new ScriptedPrompter());
    expect(done.state).toBe('DONE');
  });

  it('journals interruptions and refuses unknown or invalid answers', async () => {
    const h = fakeEngine({ dir: discoveryFixtureDir('saas-web') });
    const runId = h.engine.start({ kind: 'new', narrative: 'x', specOnly: true, surface: 'test' });
    const { InterruptedError } = await import('@incubator/runtime');
    const interrupter = {
      interactive: true,
      ask: () => Promise.reject(new InterruptedError()),
      review: () => Promise.reject(new InterruptedError()),
    };
    await expect(h.engine.advance(runId, interrupter)).rejects.toBeInstanceOf(InterruptedError);
    expect(h.engine.entries(runId).at(-1)?.type).toBe('interrupted');
    const liar = {
      interactive: true,
      ask: () =>
        Promise.resolve([{ key: 'deploy.target', value: 'mars', source: 'user' as const }]),
      review: () => Promise.resolve({ approve: true as const }),
    };
    await expect(h.engine.advance(runId, liar)).rejects.toThrow(/not an option/);
  });
});

describe('recorded live fixture (claude-cli)', () => {
  it('replays a keyed real-model exchange to the same approved spec, byte for byte', async () => {
    const dir = discoveryFixtureDir('live-claude-bookclub');
    const h = fakeEngine({ dir });
    const runId = h.engine.start({
      kind: 'new',
      narrative: narrative('live-claude-bookclub'),
      specOnly: true,
      surface: 'test',
    });
    const state = await h.engine.advance(runId, new DefaultsPrompter());
    expect(state.state).toBe('DONE');
    const { serializeSpec } = await import('@incubator/spec');
    expect(serializeSpec(h.engine.draft(runId))).toBe(
      readFileSync(path.join(dir, 'expected-incubator.json'), 'utf8'),
    );
  });
});
