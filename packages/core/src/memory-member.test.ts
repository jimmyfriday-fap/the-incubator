import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeExec } from '@incubator/runtime';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';
import { HOOKS_GITATTRIBUTES } from './memory-install.js';
import { memoryMemberPrompt, proposeMemberManifest } from './memory.js';
import { DefaultsPrompter } from './prompter.js';
import { enhanceFixtureDir, fakeAgentHandoff, fakePublishEngine } from './testing.js';

/** Plan 077: Add member. One more repository joins a system whose store already exists. */

const bareNode = path.resolve(import.meta.dirname, '../../analyzer/fixtures/bare-node');
const combos = path.resolve(import.meta.dirname, '../../templates/fixtures/combos');
const AGENTS = '# Agent instructions\n';

const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });
const out = async (args: string[], cwd: string) => (await git(args, cwd)).stdout.trim();

type Harness = ReturnType<typeof fakePublishEngine>;
const harness = (): Harness =>
  fakePublishEngine({
    handoff: fakeAgentHandoff(),
    portfolio: true,
    memorySelfTests: false,
    llm: { dir: enhanceFixtureDir('export-orders') },
  });

beforeEach(() => {
  const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'member gitcfg ')), 'gitconfig');
  writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('FAKE_AGENT_MODE', 'memory-store');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function repoIn(workspace: string, name: string): Promise<string> {
  const dir = path.join(workspace, name);
  mkdirSync(dir, { recursive: true });
  cpSync(bareNode, dir, {
    recursive: true,
    filter: (s: string) => !s.endsWith('expected-gap-report.json'),
  });
  writeFileSync(path.join(dir, 'AGENTS.md'), AGENTS);
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['add', '-A'], dir);
  await git(['commit', '-q', '-m', 'initial'], dir);
  return dir;
}

/** A system "shop" of api and web with its store installed, plus a third repository `jobs` beside them. */
async function shopSystem() {
  const h = harness();
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'member-ws-'));
  const api = await repoIn(workspace, 'api');
  const web = await repoIn(workspace, 'web');
  const jobs = await repoIn(workspace, 'jobs');
  const runId = h.engine.start({
    kind: 'memory',
    dir: api,
    repo: api,
    surface: 'test',
    yes: true,
    memory: {
      system: 'shop',
      isolationTerms: [],
      commitPolicy: 'auto',
      storeCommitPolicy: 'direct',
      members: [
        { dir: api, name: 'api' },
        { dir: web, name: 'web' },
      ],
    },
  });
  await h.engine.advance(runId, new DefaultsPrompter());
  await h.engine.confirmMemoryManifest(
    runId,
    'system: shop\nseed_version: 1.0.1\nstore_repo: shop-memory\nmembers:\n  - repo: api\n    path: ../api\n    role: member\n  - repo: web\n    path: ../web\n    role: member\n',
  );
  expect((await h.engine.resume(runId, new DefaultsPrompter())).state).toBe('DONE');
  return { h, workspace, api, web, jobs, store: path.join(workspace, 'shop-memory') };
}

const joinRun = (h: Harness, dir: string, system = 'shop') =>
  h.engine.start({
    kind: 'memory',
    dir,
    repo: dir,
    surface: 'test',
    yes: true,
    memory: { system, isolationTerms: [], commitPolicy: 'auto', joinSystem: system },
  });

describe('the member manifest', () => {
  it('adds one entry to the members list and leaves the rest alone', () => {
    const yaml =
      'system: shop\nmembers:\n  - repo: api\n    path: ../api\n    role: member\nexcluded:\n  - repo: other\n    reason: separate\n';
    const out2 = proposeMemberManifest(yaml, 'jobs', '../jobs');
    expect(out2).toContain(
      '  - repo: api\n    path: ../api\n    role: member\n  - repo: jobs\n    path: ../jobs',
    );
    expect(out2.indexOf('- repo: jobs')).toBeLessThan(out2.indexOf('excluded:'));
    expect(() => proposeMemberManifest('system: shop\n', 'jobs', '../jobs')).toThrow(
      /members list/,
    );
  });

  it('names the new member, the store and the phase in the prompt', () => {
    const p = memoryMemberPrompt({
      phase: 'link',
      system: 'shop',
      repo: 'jobs',
      repoDir: '/w/jobs',
      store: '/w/shop-memory',
      seed: '/seed',
      terms: ['x-api'],
      today: '2026-11-06',
      storeCommitPolicy: 'pr',
      manifest: 'system: shop\nmembers:\n  - repo: jobs\n',
    });
    expect(p).toContain('PHASE: link');
    expect(p).toContain('NEW_MEMBER: jobs');
    expect(p).toContain('STORE_DIR: /w/shop-memory');
    expect(p).toContain('Adding a member later');
    expect(p).toContain('ISOLATION_TERMS: x-api');
  });
});

describe('Add member on an existing repository (plan 077)', () => {
  it('shows the updated system.yaml first, writes nothing before it is confirmed, then links the repository', async () => {
    const { h, workspace, jobs, store } = await shopSystem();
    const headBefore = await out(['rev-parse', 'HEAD'], store);
    const runId = joinRun(h, jobs);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_manifest' });
    const d = h.engine.memoryDetail(runId)!;
    expect(d.store).toMatchObject({ awaitingManifest: true, members: ['jobs'] });
    expect(d.store!.proposed).toContain('- repo: api');
    expect(d.store!.proposed).toContain('- repo: web');
    expect(d.store!.proposed).toContain('- repo: jobs');
    expect(existsSync(path.join(jobs, '.memory-link'))).toBe(false);
    expect(await out(['rev-parse', 'HEAD'], store)).toBe(headBefore);
    // Resuming alone never confirms it.
    expect((await h.engine.resume(runId, new DefaultsPrompter())).parked).toMatchObject({
      reason: 'memory_manifest',
    });
    await h.engine.confirmMemoryManifest(runId, d.store!.proposed!);
    const done = await h.engine.resume(runId, new DefaultsPrompter());
    expect(done.state).toBe('DONE');
    expect(await out(['rev-parse', 'HEAD'], store)).not.toBe(headBefore);
    expect(await out(['status', '--porcelain'], store)).toBe('');
    expect(await out(['status', '--porcelain'], jobs)).toBe('');
    expect(readFileSync(path.join(jobs, '.claude', 'hooks', '.gitattributes'), 'utf8')).toBe(
      HOOKS_GITATTRIBUTES,
    );
    expect(
      (await out(['ls-files', '-s', '.claude/hooks/memory-session-end'], jobs)).startsWith(
        '100755',
      ),
    ).toBe(true);
    expect(await out(['ls-files', '.claude/settings.local.json'], jobs)).toBe('');
    expect(readFileSync(path.join(jobs, 'AGENTS.md'), 'utf8')).toBe(AGENTS);
    expect(readFileSync(path.join(store, 'system.yaml'), 'utf8')).toContain('- repo: jobs');
    const project = await h.engine.portfolioFor(jobs);
    expect(project?.memory).toMatchObject({
      mode: 'member',
      system: 'shop',
      commitPolicy: 'direct',
    });
    const system = h.engine.memorySystems().find((x) => x.name === 'shop')!;
    expect(system.members.map((x) => x.name).sort()).toEqual(['api', 'jobs', 'web']);
    expect(existsSync(path.join(workspace, 'shop-memory', 'context', 'projects', 'jobs'))).toBe(
      true,
    );
  }, 240_000);

  it('refuses a manifest that drops or adds a member', async () => {
    const { h, jobs } = await shopSystem();
    const runId = joinRun(h, jobs);
    await h.engine.advance(runId, new DefaultsPrompter());
    const wrong = (extra: string) =>
      `system: shop\nmembers:\n  - repo: api\n  - repo: jobs\n${extra}`;
    await expect(h.engine.confirmMemoryManifest(runId, wrong(''))).rejects.toMatchObject({
      code: 'bad_manifest',
    });
    await expect(
      h.engine.confirmMemoryManifest(runId, wrong('  - repo: web\n  - repo: stranger\n')),
    ).rejects.toMatchObject({ code: 'bad_manifest' });
    await expect(
      h.engine.confirmMemoryManifest(
        runId,
        'system: other\nmembers:\n  - repo: api\n  - repo: web\n  - repo: jobs\n',
      ),
    ).rejects.toMatchObject({ code: 'bad_manifest' });
  }, 240_000);

  it('refuses a system the portfolio does not know, and a repository that is already a member', async () => {
    const { h, api, jobs } = await shopSystem();
    expect(() => joinRun(h, jobs, 'nonesuch')).toThrow(/no memory store is known/);
    const runId = joinRun(h, api);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked?.reason).toMatch(/memory_present|memory_installed/);
  }, 240_000);

  it('parks memory_rules_broken when the agent edits AGENTS.md, and records nothing', async () => {
    const { h, jobs } = await shopSystem();
    vi.stubEnv('FAKE_MEMORY_STORE', 'agents');
    const runId = joinRun(h, jobs);
    await h.engine.advance(runId, new DefaultsPrompter());
    await h.engine.confirmMemoryManifest(runId, h.engine.memoryDetail(runId)!.store!.proposed!);
    const s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_rules_broken' });
    expect(s.parked?.message).toContain('AGENTS.md was changed');
    expect((await h.engine.portfolioFor(jobs))?.memory).toBeUndefined();
    expect(h.engine.memorySystems().find((x) => x.name === 'shop')!.members).toHaveLength(2);
  }, 240_000);
});

describe('a new build that joins a system (plan 077)', () => {
  function spec(): IncubatorSpec {
    const draft = JSON.parse(
      readFileSync(path.join(combos, 'node-lib.in-repo.package-release.json'), 'utf8'),
    ) as Record<string, unknown>;
    const project = { ...(draft['project'] as object), owner: { type: 'user', login: 'octo' } };
    const s = completeSpec({ ...draft, project }).spec;
    s.intent.narrative = 'Tallyho counts laps for swimmers. It is only for coaches';
    return s;
  }

  it('links first, parks for the manifest, and fills the store after the code', async () => {
    const { h, store } = await shopSystem();
    vi.stubEnv('FAKE_AGENT_MODE', 'edit');
    vi.stubEnv('FAKE_AGENT_SAVE_PROMPT', '1');
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'member build ')), 'tallyho');
    const runId = h.engine.startFromSpec(spec(), {
      kind: 'new',
      surface: 'test',
      dir,
      narrative: 'Tallyho counts laps for swimmers. It is only for coaches',
      buildMemory: { enabled: true, system: 'shop' },
    });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_manifest' });
    const d = h.engine.memoryDetail(runId)!;
    expect(d.store).toMatchObject({ awaitingManifest: true });
    expect(d.store!.proposed).toContain('- repo: tallyho');
    expect(existsSync(path.join(dir, '.memory-link'))).toBe(false);
    await h.engine.confirmMemoryManifest(runId, d.store!.proposed!);
    const after = await h.engine.resume(runId, new DefaultsPrompter());
    expect(after.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    // The link is committed before the code, and the store was filled after it.
    const types = h.engine
      .entries(runId)
      .map((e) => `${e.type}:${typeof e['step'] === 'string' ? e['step'] : ''}`);
    const at = (t: string) => types.indexOf(t);
    expect(at('step.ok:memory.member.link')).toBeGreaterThan(-1);
    expect(at('step.ok:memory.member.link')).toBeLessThan(at('step.ok:code.done'));
    expect(at('step.ok:memory.member.bootstrap')).toBeGreaterThan(at('step.ok:memory.member.link'));
    expect(existsSync(path.join(dir, '.memory-link'))).toBe(true);
    expect(existsSync(path.join(dir, '.memory'))).toBe(false);
    expect(await out(['status', '--porcelain'], dir)).toContain('src/agent-work.txt');
    expect(existsSync(path.join(store, 'context', 'projects', 'tallyho', 'status.md'))).toBe(true);
    const detail = (await h.engine.finishDetail(runId))!;
    expect(detail.memory).toMatchObject({ mode: 'member', scaffolded: true, bootstrapped: true });
    expect(h.engine.portfolioForRun(runId)?.memory).toMatchObject({
      mode: 'member',
      system: 'shop',
    });
    const prompt = readFileSync(path.join(dir, '.incubator', 'state', 'coding-prompt.txt'), 'utf8');
    expect(prompt).toContain('Read its INDEX.md before you change any code');
  }, 360_000);
});
