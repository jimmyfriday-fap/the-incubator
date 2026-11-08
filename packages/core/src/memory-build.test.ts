import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeExec } from '@incubator/runtime';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';
import { DefaultsPrompter } from './prompter.js';
import { fakeAgentHandoff, fakePublishEngine } from './testing.js';

/** Plan 075: a new build with memory gets its scaffold before the code and its bootstrap after it. */

const combos = path.resolve(import.meta.dirname, '../../templates/fixtures/combos');

const NARRATIVE = 'Tallyho counts laps for swimmers. It is only for coaches';

function spec(): IncubatorSpec {
  const draft = JSON.parse(
    readFileSync(path.join(combos, 'node-lib.in-repo.package-release.json'), 'utf8'),
  ) as Record<string, unknown>;
  const project = { ...(draft['project'] as object), owner: { type: 'user', login: 'octo' } };
  return completeSpec({ ...draft, project }).spec;
}

const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });
const out = async (args: string[], cwd: string) => (await git(args, cwd)).stdout.trim();

beforeEach(() => {
  // Hermetic git, but with an identity: the memory commits need an author.
  const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'gitcfg ')), 'gitconfig');
  writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('FAKE_AGENT_MODE', 'edit');
  vi.stubEnv('FAKE_AGENT_SAVE_PROMPT', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function build(buildMemory?: { enabled: boolean }) {
  const h = fakePublishEngine({
    portfolio: true,
    handoff: fakeAgentHandoff(),
    // why: the self-tests run the seed's bash scripts and a real git hook, which the fake store does not have.
    memorySelfTests: false,
  });
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'memory build ')), 'my solution');
  const s0 = spec();
  s0.intent.narrative = NARRATIVE;
  const runId = h.engine.startFromSpec(s0, {
    kind: 'new',
    surface: 'test',
    dir,
    narrative: NARRATIVE,
    ...(buildMemory ? { buildMemory } : {}),
  });
  const state = await h.engine.advance(runId, new DefaultsPrompter());
  return { h, runId, dir, state };
}

describe('memory on a new build (plan 075)', () => {
  it('installs the skills, the session hook and the git hook itself, because the agent cannot write .claude/ or .git/', async () => {
    const { dir } = await build();
    for (const skill of ['write-memory', 'dream', 'memory-bootstrap'])
      expect(existsSync(path.join(dir, '.claude', 'skills', skill, 'SKILL.md'))).toBe(true);
    const settings = readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
    expect(settings).toContain('SessionEnd');
    expect(settings).toContain('.memory/hooks/session-end');
    // Committed on the build branch, not left for the owner.
    const tracked = await out(['ls-files', '.claude'], dir);
    expect(tracked).toContain('.claude/settings.json');
    expect(tracked).toContain('.claude/skills/write-memory/SKILL.md');
    expect(await out(['status', '--porcelain', '--', '.claude'], dir)).toBe('');
    const hook = readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(hook).toContain('.memory/hooks/pre-commit');
  });

  it('commits the scaffold before the code and the bootstrap after it, and reports both', async () => {
    const { h, runId, dir, state } = await build();
    expect(state.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    const subjects = (await out(['log', '--format=%s', '--reverse'], dir)).split('\n');
    const scaffoldAt = subjects.indexOf('mem(platform): scaffold memory infrastructure');
    expect(scaffoldAt).toBeGreaterThan(0); // after the publish commit, so the first commit of the build branch
    expect(subjects.at(-1)).toBe('mem(platform): bootstrap repo memory');
    // The scaffold came before the coding session, and the bootstrap after it.
    const types = h.engine
      .entries(runId)
      .map((e) => `${e.type}:${typeof e['step'] === 'string' ? e['step'] : ''}`);
    const at = (t: string) => types.indexOf(t);
    expect(at('step.ok:memory.scaffold')).toBeLessThan(at('step.ok:code.done'));
    expect(at('step.ok:code.done')).toBeGreaterThan(at('step.ok:memory.scaffold'));
    expect(at('step.ok:memory.bootstrap')).toBeGreaterThan(-1);
    expect(types.indexOf('handoff.result:')).toBeLessThan(at('step.ok:memory.scaffold'));
    // The scaffold seeded the owner's stated choice without "(unconfirmed)".
    const decisions = readFileSync(
      path.join(dir, '.memory', 'context', 'platform', 'decisions.md'),
      'utf8',
    );
    expect(decisions).toContain('Tallyho counts laps for swimmers');
    expect(decisions).not.toContain('(unconfirmed)');
    // The owner's build work is still uncommitted for the owner's own commit.
    expect(await out(['status', '--porcelain'], dir)).toContain('src/agent-work.txt');
    // The detail shows the plan, and the bootstrap report once it exists.
    const d = (await h.engine.finishDetail(runId))!;
    expect(d.memory).toMatchObject({ mode: 'repo', scaffolded: true, bootstrapped: true });
    expect(d.memory?.report).toContain('## Memory bootstrap report');
    // The coding session was told about the store.
    expect(h.engine.portfolioForRun(runId)?.memory).toMatchObject({ mode: 'repo' });
    const prompt = readFileSync(path.join(dir, '.incubator', 'state', 'coding-prompt.txt'), 'utf8');
    expect(prompt).toContain('Read its INDEX.md before you change any code');
    expect(prompt).toContain('Do not commit: the owner commits.');
  }, 240_000);

  it('makes no .memory/ and records mode none when the toggle is off', async () => {
    const { h, runId, dir, state } = await build({ enabled: false });
    expect(state.parked).toMatchObject({ state: 'COMMIT' });
    expect(existsSync(path.join(dir, '.memory'))).toBe(false);
    expect(h.engine.portfolioForRun(runId)?.memoryPlan).toMatchObject({ mode: 'none' });
    expect((await h.engine.finishDetail(runId))!.memory).toMatchObject({
      mode: 'none',
      scaffolded: false,
    });
  }, 240_000);

  it('parks when the memory session changes AGENTS.md, and commits nothing it should not', async () => {
    vi.stubEnv('FAKE_MEMORY_BUILD', 'agents');
    const { state } = await build();
    expect(state.parked).toMatchObject({ reason: 'memory_rules_broken' });
    expect(state.parked?.message).toContain('AGENTS.md');
  }, 240_000);

  it('parks when the memory session commits nothing', async () => {
    vi.stubEnv('FAKE_MEMORY_BUILD', 'nothing');
    const { state } = await build();
    expect(state.parked).toMatchObject({ reason: 'memory_rules_broken' });
    expect(state.parked?.message).toContain('nothing was committed');
  }, 240_000);
});
