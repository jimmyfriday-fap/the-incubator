import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixtures } from '@incubator/llm';
import { nodeExec } from '@incubator/runtime';
import { memoryConsumptionLine } from './memory.js';
import { DefaultsPrompter } from './prompter.js';
import {
  enhanceFixtureDir,
  fakeAgentHandoff,
  fakePublishEngine,
  seedExistingRepo,
} from './testing.js';

const bareNode = path.resolve(import.meta.dirname, '../../analyzer/fixtures/bare-node');
const AGENTS = '# Agent instructions\n';
const REQUEST = 'Kitchen staff need to export the orders list as a CSV file.';

const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });
const out = async (args: string[], cwd: string) => (await git(args, cwd)).stdout.trim();

type Harness = ReturnType<typeof fakePublishEngine>;
const harness = (): Harness =>
  fakePublishEngine({
    handoff: fakeAgentHandoff(),
    portfolio: true,
    llm: { dir: enhanceFixtureDir('export-orders') },
  });

beforeEach(() => {
  // Hermetic git: no machine-wide identity; each folder gets the owner's identity below.
  const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'memory gitcfg ')), 'gitconfig');
  writeFileSync(cfg, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('FAKE_AGENT_MODE', 'memory');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** An existing solution with an AGENTS.md, on the fake GitHub; its file:// origin is not a GitHub address. */
async function seeded(h: Harness) {
  const { ref, dir } = await seedExistingRepo(h.github, 'shop', (d) => {
    cpSync(bareNode, d, {
      recursive: true,
      filter: (s: string) => !s.endsWith('expected-gap-report.json'),
    });
    writeFileSync(path.join(d, 'AGENTS.md'), AGENTS);
    return Promise.resolve();
  });
  await git(['config', 'user.name', 'Owner Person'], dir);
  await git(['config', 'user.email', 'owner@example.invalid'], dir);
  return { ref, dir };
}

const start = (
  h: Harness,
  dir: string,
  extra: { policy?: 'auto' | 'pr' | 'direct'; repoRef?: { owner: string; name: string } } = {},
) =>
  h.engine.start({
    kind: 'memory',
    dir,
    repo: dir,
    ...(extra.repoRef ? { repoRef: extra.repoRef } : {}),
    surface: 'test',
    yes: true,
    memory: { system: 'shop', isolationTerms: ['other-app'], commitPolicy: extra.policy ?? 'pr' },
  });

describe('Add memory runs (plan 071)', () => {
  it('installs memory locally when the folder has no GitHub origin, and records it on the project', async () => {
    const h = harness();
    const { dir } = await seeded(h);
    const runId = start(h, dir);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.state).toBe('DONE');
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).toBe('memory/bootstrap');
    expect(await out(['status', '--porcelain'], dir)).toBe('');
    expect(existsSync(path.join(dir, '.memory', 'INDEX.md'))).toBe(true);
    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe(AGENTS);
    const m = h.engine.memoryDetail(runId)!;
    expect(m).toMatchObject({
      stage: 'done',
      policy: 'pr',
      branch: 'memory/bootstrap',
      verificationPassed: true,
      pushed: false,
      problems: [],
    });
    expect(m.report).toContain('## Memory bootstrap report');
    expect(m.target.repo).toBeNull();
    expect(h.engine.portfolioForRun(runId)?.memory).toMatchObject({
      mode: 'repo',
      system: 'shop',
      store: '.memory/',
      commitPolicy: 'pr',
    });
    expect(h.github.repos.get('octo/shop')!.prs).toHaveLength(0);
  });

  it('commits on the current branch under the direct policy', async () => {
    const h = harness();
    const { dir } = await seeded(h);
    const runId = start(h, dir, { policy: 'direct' });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.state).toBe('DONE');
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).toBe('main');
    expect(h.engine.memoryDetail(runId)).toMatchObject({ policy: 'direct', branch: 'main' });
  });

  it('parks dirty_tree before anything runs', async () => {
    const h = harness();
    const { dir } = await seeded(h);
    writeFileSync(path.join(dir, 'half-done.txt'), 'work in progress\n');
    const s = await h.engine.advance(start(h, dir), new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'dirty_tree' });
    expect(existsSync(path.join(dir, '.memory'))).toBe(false);
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).toBe('main');
  });

  it('parks memory_installed for a solution that already has memory, and memory_present for a folder with .memory/', async () => {
    const h = harness();
    const { dir } = await seeded(h);
    expect((await h.engine.advance(start(h, dir), new DefaultsPrompter())).state).toBe('DONE');
    const again = await h.engine.advance(start(h, dir), new DefaultsPrompter());
    expect(again.parked).toMatchObject({ reason: 'memory_installed' });
    // Another Incubator home knows nothing of the install, but the folder itself shows it.
    const other = harness();
    const present = await other.engine.advance(start(other, dir), new DefaultsPrompter());
    expect(present.parked).toMatchObject({ reason: 'memory_present' });
  });

  it('parks memory_rules_broken when AGENTS.md changed, and pushes nothing', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'memory-agents');
    const h = harness();
    const { ref, dir } = await seeded(h);
    const runId = start(h, dir, { repoRef: ref });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_rules_broken' });
    const m = h.engine.memoryDetail(runId)!;
    expect(m.stage).toBe('checks');
    expect(m.problems).toContain('AGENTS.md was changed (it never may be)');
    expect(m.pushed).toBe(false);
    expect(h.github.repos.get('octo/shop')!.prs).toHaveLength(0);
  });

  it('parks memory_verify_failed when the playbook verification did not all pass', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'memory-unverified');
    const h = harness();
    const { dir } = await seeded(h);
    const runId = start(h, dir);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_verify_failed' });
    const m = h.engine.memoryDetail(runId)!;
    expect(m.verificationPassed).toBe(false);
    expect(m.problems).toEqual([]);
    expect(m.pushed).toBe(false);
  });

  it('asks before pushing, then opens one pull request for the pr policy', async () => {
    const h = harness();
    const { ref, dir } = await seeded(h);
    const runId = start(h, dir, { repoRef: ref });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'needs_push' });
    expect(h.github.repos.get('octo/shop')!.prs).toHaveLength(0);
    h.engine.submitPush(runId, 'push');
    expect((await h.engine.resume(runId, new DefaultsPrompter())).state).toBe('DONE');
    const prs = h.github.repos.get('octo/shop')!.prs;
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ head: 'memory/bootstrap' });
    expect(h.engine.memoryDetail(runId)).toMatchObject({ pushed: true, stage: 'done' });
  });

  it('starts a later update run on a memory-enabled solution with the memory line (spec section 6)', async () => {
    // Two update runs share one engine: the second asks for its own discovery turn (the analysis is reused).
    const [analysis, discovery] = loadFixtures(enhanceFixtureDir('export-orders'));
    const h = fakePublishEngine({
      handoff: fakeAgentHandoff(),
      portfolio: true,
      llm: [analysis!, discovery!, discovery!],
    });
    const { ref, dir } = await seeded(h);
    const enhance = () =>
      h.engine.start({
        kind: 'enhance',
        repo: dir,
        repoRef: ref,
        request: REQUEST,
        noPublish: true,
        yes: true,
        surface: 'test',
      });
    const before = enhance();
    await h.engine.advance(before, new DefaultsPrompter());
    expect((await h.engine.prepareHandoff(before)).prompt).not.toContain('has a memory store');
    expect((await h.engine.advance(start(h, dir), new DefaultsPrompter())).state).toBe('DONE');
    const after = enhance();
    await h.engine.advance(after, new DefaultsPrompter());
    expect(h.engine.portfolioForRun(after)?.memory?.store).toBe('.memory/');
    expect(
      (await h.engine.prepareHandoff(after)).prompt.startsWith(memoryConsumptionLine('.memory/')),
    ).toBe(true);
  });
});
