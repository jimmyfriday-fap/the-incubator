import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '@incubator/llm';
import { PolicyError, nodeExec } from '@incubator/runtime';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';
import { resolveMemoryDestination } from './memory-destination.js';
import { DefaultsPrompter } from './prompter.js';
import { fakePublishEngine } from './testing.js';

describe('resolveMemoryDestination (plan 074)', () => {
  const dir = 'some folder';
  it('gives a new build with a folder its own store by default', () => {
    expect(resolveMemoryDestination({ kind: 'new', dir }, [])).toMatchObject({ mode: 'repo' });
    expect(
      resolveMemoryDestination({ kind: 'new', dir, buildMemory: { enabled: true } }, []),
    ).toMatchObject({ mode: 'repo' });
  });

  it('records the owner turning memory off', () => {
    const plan = resolveMemoryDestination(
      { kind: 'new', dir, buildMemory: { enabled: false } },
      [],
    );
    expect(plan?.mode).toBe('none');
    expect(plan?.reason).toContain('turned memory off');
  });

  it('joins a known system, and refuses one it does not know', () => {
    expect(
      resolveMemoryDestination(
        { kind: 'new', dir, buildMemory: { enabled: true, system: 'backshack' } },
        ['backshack'],
      ),
    ).toMatchObject({ mode: 'member', system: 'backshack' });
    expect(() =>
      resolveMemoryDestination(
        { kind: 'new', dir, buildMemory: { enabled: true, system: 'ghost' } },
        ['backshack'],
      ),
    ).toThrow(PolicyError);
  });

  it('plans nothing for runs that have no coding session or are not new builds', () => {
    expect(resolveMemoryDestination({ kind: 'new' }, [])).toBeNull();
    expect(resolveMemoryDestination({ kind: 'memory', dir }, [])).toBeNull();
    expect(resolveMemoryDestination({ kind: 'enhance' }, [])).toBeNull();
  });

  it('records target mode, with a reason, for code inside an existing repository (row 3)', () => {
    const plan = resolveMemoryDestination({ kind: 'enhance', dir }, []);
    expect(plan).toMatchObject({ mode: 'target' });
    expect(plan?.reason).toContain('existing repository');
    expect(plan?.reason).toContain('no new store');
  });

  it('records target mode for a Backshack tool build, which has its own memory (row 3)', () => {
    const plan = resolveMemoryDestination(
      { kind: 'enhance', dir, stack: 'backshack-tool', buildMemory: { enabled: true } },
      ['backshack'],
    );
    expect(plan).toMatchObject({ mode: 'target' });
    expect(plan?.reason).toContain('Backshack');
  });

  it('keeps target mode even when the owner turned the new-build toggle off', () => {
    expect(
      resolveMemoryDestination({ kind: 'enhance', dir, buildMemory: { enabled: false } }, []),
    ).toMatchObject({ mode: 'target' });
  });
});

const fakeAgent = path.resolve(import.meta.dirname, '../fixtures/handoff/fake-agent.mjs');
const combos = path.resolve(import.meta.dirname, '../../templates/fixtures/combos');
const agentCaps: Capabilities = {
  installed: true,
  path: process.execPath,
  version: '1',
  flags: {
    printMode: [fakeAgent, '-p'],
    streamJson: ['--output-format', 'stream-json'],
    allowedTools: '--allowedTools',
  },
  stdinPrompt: true,
  eligible: { discovery: true, analysis: true, handoff: true },
  reasons: [],
};

function spec(): IncubatorSpec {
  const draft = JSON.parse(
    readFileSync(path.join(combos, 'node-lib.in-repo.package-release.json'), 'utf8'),
  ) as Record<string, unknown>;
  const project = { ...(draft['project'] as object), owner: { type: 'user', login: 'octo' } };
  return completeSpec({ ...draft, project }).spec;
}

describe('the memory plan of a new build (plan 074)', () => {
  beforeEach(() => {
    const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'gitcfg ')), 'gitconfig');
    writeFileSync(cfg, '');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('FAKE_AGENT_MODE', 'edit');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const run = async (buildMemory?: { enabled: boolean }) => {
    const h = fakePublishEngine({
      portfolio: true,
      handoff: { exec: nodeExec, probe: () => Promise.resolve(agentCaps) },
    });
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'new solution ')), 'my solution');
    const runId = h.engine.startFromSpec(spec(), {
      kind: 'new',
      surface: 'test',
      dir,
      ...(buildMemory ? { buildMemory } : {}),
    });
    await h.engine.advance(runId, new DefaultsPrompter());
    return { h, runId };
  };

  it('journals the plan before any code is generated and records it on the project', async () => {
    const { h, runId } = await run();
    const types = h.engine.entries(runId).map((e) => e.type);
    expect(types.indexOf('memory.plan')).toBeGreaterThan(types.indexOf('run.start'));
    expect(types.indexOf('memory.plan')).toBeLessThan(types.indexOf('state.enter'));
    expect(h.engine.portfolioForRun(runId)?.memoryPlan).toMatchObject({ mode: 'repo' });
    expect(h.engine.portfolioForRun(runId)?.memory).toBeUndefined();
  }, 120_000);

  it('records memory.mode none when the toggle is off', async () => {
    const { h, runId } = await run({ enabled: false });
    expect(h.engine.portfolioForRun(runId)?.memoryPlan).toMatchObject({ mode: 'none' });
  }, 120_000);
});
