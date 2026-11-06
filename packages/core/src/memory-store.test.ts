import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeExec } from '@incubator/runtime';
import {
  checkMemoryInput,
  manifestMembers,
  memoryStoreAllowedTools,
  memoryStoreFor,
  parseProposedManifest,
} from './memory.js';
import { DefaultsPrompter } from './prompter.js';
import { enhanceFixtureDir, fakeAgentHandoff, fakePublishEngine } from './testing.js';

const bareNode = path.resolve(import.meta.dirname, '../../analyzer/fixtures/bare-node');
const AGENTS = '# Agent instructions\n';

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
  const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'store gitcfg ')), 'gitconfig');
  writeFileSync(cfg, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('FAKE_AGENT_MODE', 'memory-store');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Two committed repositories side by side in one workspace folder. */
async function workspaceWith(names: string[]) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'store-ws-'));
  const dirs: string[] = [];
  for (const name of names) {
    const dir = path.join(workspace, name);
    mkdirSync(dir, { recursive: true });
    cpSync(bareNode, dir, {
      recursive: true,
      filter: (s: string) => !s.endsWith('expected-gap-report.json'),
    });
    writeFileSync(path.join(dir, 'AGENTS.md'), AGENTS);
    await git(['init', '-q', '-b', 'main'], dir);
    await git(['config', 'user.name', 'Owner Person'], dir);
    await git(['config', 'user.email', 'owner@example.invalid'], dir);
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'initial'], dir);
    dirs.push(dir);
  }
  return { workspace, dirs };
}

const start = (
  h: Harness,
  dirs: string[],
  extra: { storePolicy?: 'pr' | 'direct'; system?: string } = {},
) =>
  h.engine.start({
    kind: 'memory',
    dir: dirs[0]!,
    repo: dirs[0]!,
    surface: 'test',
    yes: true,
    memory: {
      system: extra.system ?? 'shop',
      isolationTerms: [],
      commitPolicy: 'auto',
      storeCommitPolicy: extra.storePolicy ?? 'pr',
      members: dirs.map((dir) => ({ dir, name: path.basename(dir) })),
    },
  });

describe('store mode: the manifest', () => {
  it('reads members from a system.yaml and the last yaml block of a message', () => {
    const yaml =
      'system: shop\nmembers:\n  - repo: api\n    path: ../api\n  - repo: web\nexcluded:\n  - repo: other\n';
    expect(manifestMembers(yaml)).toEqual(['api', 'web']);
    expect(parseProposedManifest(`text\n\`\`\`yaml\n${yaml}\`\`\`\nmore`)).toBe(yaml.trim());
    expect(parseProposedManifest('no block here')).toBeNull();
    expect(parseProposedManifest('```yaml\nsystem: x\n```')).toBeNull();
  });

  it('allows git only inside the named folders, and never a push', () => {
    const tools = memoryStoreAllowedTools(['/w/a', '/w/shop-memory'], 'install');
    expect(tools).toContain('Bash(git -C /w/a commit:*)');
    expect(tools).toContain('Bash(git -C /w/shop-memory init:*)');
    expect(tools.some((t) => /push|remote|clone/.test(t))).toBe(false);
    const discover = memoryStoreAllowedTools(['/w/a'], 'discover');
    expect(discover).not.toContain('Edit');
    expect(discover.some((t) => /commit|add/.test(t))).toBe(false);
  });

  it('follows .memory-link to the store', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'link-'));
    expect(memoryStoreFor(dir, '/recorded/store')).toBe('/recorded/store');
    writeFileSync(path.join(dir, '.memory-link'), 'system=s\nrepo=r\npath=../s-memory\n');
    expect(memoryStoreFor(dir, '/recorded/store')).toBe(
      path.resolve(dir, '../s-memory').replace(/\\/g, '/'),
    );
  });

  it('checks the members of a store-mode input', () => {
    const base = { system: 'shop', isolationTerms: [], commitPolicy: 'auto' as const };
    const m = (dir: string, name: string) => ({ dir, name });
    expect(() => checkMemoryInput({ ...base, members: [m('/w/a', 'a')] })).toThrow(/two or more/);
    expect(() => checkMemoryInput({ ...base, members: [m('/w/a', 'a'), m('/x/b', 'b')] })).toThrow(
      /side by side/,
    );
    expect(() => checkMemoryInput({ ...base, members: [m('/w/a', 'a'), m('/w/a2', 'a')] })).toThrow(
      /own kebab-case/,
    );
    expect(
      checkMemoryInput({ ...base, members: [m('/w/a', 'a'), m('/w/b', 'b')] }).members,
    ).toHaveLength(2);
  });
});

describe('store mode runs (plan 076)', () => {
  it('parks on the proposed manifest and writes nothing until the owner confirms it', async () => {
    const h = harness();
    const { workspace, dirs } = await workspaceWith(['api', 'web']);
    const runId = start(h, dirs);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_manifest' });
    const detail = h.engine.memoryDetail(runId)!;
    expect(detail.store).toMatchObject({ members: ['api', 'web'], awaitingManifest: true });
    expect(detail.store!.proposed).toContain('- repo: api');
    expect(detail.store!.proposed).toContain('- repo: web');
    expect(existsSync(path.join(workspace, 'shop-memory'))).toBe(false);
    for (const d of dirs) {
      expect(existsSync(path.join(d, '.memory-link'))).toBe(false);
      expect(await out(['status', '--porcelain'], d)).toBe('');
    }
    // Resuming without a confirmation parks again: the manifest is never auto-confirmed.
    const again = await h.engine.resume(runId, new DefaultsPrompter());
    expect(again.parked).toMatchObject({ reason: 'memory_manifest' });
    expect(existsSync(path.join(workspace, 'shop-memory'))).toBe(false);
  });

  it('builds the store, links every member and records the system once the manifest is confirmed', async () => {
    const h = harness();
    const { workspace, dirs } = await workspaceWith(['api', 'web']);
    const runId = start(h, dirs);
    await h.engine.advance(runId, new DefaultsPrompter());
    const proposed = h.engine.memoryDetail(runId)!.store!.proposed!;
    await h.engine.confirmMemoryManifest(runId, proposed);
    const s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.state).toBe('DONE');
    const store = path.join(workspace, 'shop-memory');
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], store)).toBe('memory/bootstrap');
    expect(readFileSync(path.join(store, 'system.yaml'), 'utf8')).toContain('- repo: web');
    for (const d of dirs) {
      expect(await out(['status', '--porcelain'], d)).toBe('');
      expect(existsSync(path.join(d, '.memory-link'))).toBe(true);
      expect(readFileSync(path.join(d, 'AGENTS.md'), 'utf8')).toBe(AGENTS);
      const project = await h.engine.portfolioFor(d);
      expect(project?.memory).toMatchObject({
        mode: 'member',
        system: 'shop',
        commitPolicy: 'direct',
      });
      expect(project?.memory?.store.replace(/\\/g, '/')).toBe(store.replace(/\\/g, '/'));
    }
    const systems = h.engine.memorySystems();
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ name: 'shop', storeCommitPolicy: 'pr', remote: null });
    expect(systems[0]!.members.map((x) => x.name)).toEqual(['api', 'web']);
    expect(h.engine.memoryDetail(runId)).toMatchObject({
      stage: 'done',
      verificationPassed: true,
      pushed: false,
      problems: [],
    });
  });

  it('links members on memory/link when they take pull requests', async () => {
    vi.stubEnv('FAKE_MEMORY_STORE_MEMBERS', 'pr');
    const h = harness();
    const { dirs } = await workspaceWith(['api', 'web']);
    const runId = start(h, dirs, { storePolicy: 'direct' });
    await h.engine.advance(runId, new DefaultsPrompter());
    await h.engine.confirmMemoryManifest(runId, h.engine.memoryDetail(runId)!.store!.proposed!);
    const s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.state).toBe('DONE');
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], dirs[0]!)).toBe('memory/link');
    expect((await h.engine.portfolioFor(dirs[0]!))?.memory?.commitPolicy).toBe('pr');
  });

  it('refuses a manifest that is not for this run, or that has fewer than two members', async () => {
    const h = harness();
    const { dirs } = await workspaceWith(['api', 'web']);
    const runId = start(h, dirs);
    await expect(
      h.engine.confirmMemoryManifest(runId, 'system: shop\nmembers:\n'),
    ).rejects.toMatchObject({
      code: 'not_waiting',
    });
    await h.engine.advance(runId, new DefaultsPrompter());
    await expect(
      h.engine.confirmMemoryManifest(runId, 'system: shop\nmembers:\n  - repo: api\n'),
    ).rejects.toMatchObject({ code: 'bad_manifest' });
    await expect(
      h.engine.confirmMemoryManifest(
        runId,
        'system: other\nmembers:\n  - repo: api\n  - repo: web\n',
      ),
    ).rejects.toMatchObject({ code: 'bad_manifest' });
    await expect(
      h.engine.confirmMemoryManifest(
        runId,
        'system: shop\nmembers:\n  - repo: api\n  - repo: ../elsewhere\n',
      ),
    ).rejects.toMatchObject({ code: 'bad_manifest' });
  });

  it('parks dirty_tree before the discovery when a member has uncommitted changes', async () => {
    const h = harness();
    const { dirs } = await workspaceWith(['api', 'web']);
    writeFileSync(path.join(dirs[1]!, 'half-done.txt'), 'work in progress\n');
    const s = await h.engine.advance(start(h, dirs), new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'dirty_tree' });
    expect(s.parked?.message).toContain('web');
  });

  it('parks when the store folder already exists', async () => {
    const h = harness();
    const { workspace, dirs } = await workspaceWith(['api', 'web']);
    mkdirSync(path.join(workspace, 'shop-memory'));
    const s = await h.engine.advance(start(h, dirs), new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_store_exists' });
  });

  it('parks memory_rules_broken when the agent edits a member AGENTS.md, and records nothing', async () => {
    vi.stubEnv('FAKE_MEMORY_STORE', 'agents');
    const h = harness();
    const { dirs } = await workspaceWith(['api', 'web']);
    const runId = start(h, dirs);
    await h.engine.advance(runId, new DefaultsPrompter());
    await h.engine.confirmMemoryManifest(runId, h.engine.memoryDetail(runId)!.store!.proposed!);
    const s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_rules_broken' });
    expect(s.parked?.message).toContain('AGENTS.md was changed');
    expect(h.engine.memorySystems()).toEqual([]);
    expect((await h.engine.portfolioFor(dirs[0]!))?.memory).toBeUndefined();
  });

  it('parks memory_verify_failed when the playbook reports a failed check', async () => {
    vi.stubEnv('FAKE_MEMORY_STORE', 'unverified');
    const h = harness();
    const { dirs } = await workspaceWith(['api', 'web']);
    const runId = start(h, dirs);
    await h.engine.advance(runId, new DefaultsPrompter());
    await h.engine.confirmMemoryManifest(runId, h.engine.memoryDetail(runId)!.store!.proposed!);
    const s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'memory_verify_failed' });
    expect(h.engine.memorySystems()).toEqual([]);
  });
});

describe('a new build can join a system the portfolio knows (plan 076)', () => {
  it('offers only systems with a store on disk, and picks member mode for one', async () => {
    const h = harness();
    const { dirs } = await workspaceWith(['api', 'web']);
    const runId = start(h, dirs);
    await h.engine.advance(runId, new DefaultsPrompter());
    await h.engine.confirmMemoryManifest(runId, h.engine.memoryDetail(runId)!.store!.proposed!);
    await h.engine.resume(runId, new DefaultsPrompter());
    const target = mkdtempSync(path.join(os.tmpdir(), 'new-build-'));
    const id = h.engine.start({
      kind: 'new',
      dir: target,
      surface: 'test',
      yes: true,
      narrative: 'A tiny tool for the shop.',
      buildMemory: { enabled: true, system: 'shop' },
    });
    const plan = h.engine.entries(id).find((e) => e.type === 'memory.plan') as
      { plan?: { mode: string; system?: string } } | undefined;
    expect(plan?.plan).toMatchObject({ mode: 'member', system: 'shop' });
    expect(() =>
      h.engine.start({
        kind: 'new',
        dir: mkdtempSync(path.join(os.tmpdir(), 'new-build-')),
        surface: 'test',
        yes: true,
        narrative: 'x',
        buildMemory: { enabled: true, system: 'nonesuch' },
      }),
    ).toThrow(/no memory store is known/);
  });
});
