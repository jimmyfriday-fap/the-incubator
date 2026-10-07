import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubMethod, GitOps } from '@incubator/git';
import type { Capabilities, FakeLlmAdapter } from '@incubator/llm';
import { ToolError, nodeExec } from '@incubator/runtime';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';
import { DefaultsPrompter, NonInteractivePrompter, ScriptedPrompter } from './prompter.js';
import { enhanceFixtureDir, fakePublishEngine, hashTree, seedExistingRepo } from './testing.js';

const fakeAgent = path.resolve(import.meta.dirname, '../fixtures/handoff/fake-agent.mjs');
const combos = path.resolve(import.meta.dirname, '../../templates/fixtures/combos');
const analyzerFixtures = path.resolve(import.meta.dirname, '../../analyzer/fixtures');
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
const REQUEST = 'Kitchen staff need to export the orders list as a CSV file.';
const BUILD = 'incubator/build-20260501';
const ENHANCE = 'incubator/enhance-20260501';

const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });
const out = async (args: string[], cwd: string) => (await git(args, cwd)).stdout.trim();

function spec(): IncubatorSpec {
  const draft = JSON.parse(
    readFileSync(path.join(combos, 'node-lib.in-repo.package-release.json'), 'utf8'),
  ) as Record<string, unknown>;
  const project = { ...(draft['project'] as object), owner: { type: 'user', login: 'octo' } };
  return completeSpec({ ...draft, project }).spec;
}

type Harness = ReturnType<typeof fakePublishEngine>;
const harness = (llm?: Parameters<typeof fakePublishEngine>[0]): Harness =>
  fakePublishEngine({
    handoff: { exec: nodeExec, probe: () => Promise.resolve(agentCaps) },
    ...llm,
  });

/** A path that does not exist yet and contains a space, like a folder typed into the wizard. */
const freshFolder = () =>
  path.join(mkdtempSync(path.join(os.tmpdir(), 'new solution ')), 'my solution');

beforeEach(() => {
  // Hermetic git: no machine-wide identity, so "git does not know who you are" is reproducible.
  const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'gitcfg ')), 'gitconfig');
  writeFileSync(cfg, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('FAKE_AGENT_MODE', 'edit');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function setOwner(dir: string): Promise<void> {
  await git(['config', 'user.name', 'Owner Person'], dir);
  await git(['config', 'user.email', 'owner@example.invalid'], dir);
}

/** Starts a new-solution run in a folder and drives it to the commit request. */
async function newSolution(h: Harness, dir: string) {
  const runId = h.engine.startFromSpec(spec(), { kind: 'new', surface: 'test', dir });
  const s = await h.engine.advance(runId, new DefaultsPrompter());
  return { runId, s };
}

describe('new solution in a chosen folder', () => {
  it('renders into the folder, publishes, lets the agent code on a build branch, and stops for the commit', async () => {
    const h = harness();
    const dir = freshFolder();
    const { runId, s } = await newSolution(h, dir);
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    // The folder itself is the repository, with the way back to GitHub.
    expect(existsSync(path.join(dir, '.git'))).toBe(true);
    const ref = { owner: 'octo', name: 'tallyho' };
    expect(await out(['remote', 'get-url', 'origin'], dir)).toBe(h.github.remoteUrl(ref));
    // Scaffold on main (pushed); the agent worked on its own branch, nothing committed.
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).toBe(BUILD);
    expect(await h.github.getBranchSha(ref, 'main')).toBe(await out(['rev-parse', 'main'], dir));
    expect(await h.github.getBranchSha(ref, BUILD)).toBeNull();
    const status = await out(['status', '--porcelain'], dir);
    expect(status).toContain('src/agent-work.txt');
    expect(status).not.toContain('.incubator/state');
    // What the owner is shown.
    const d = (await h.engine.finishDetail(runId))!;
    expect(d).toMatchObject({
      stage: 'commit',
      branch: BUILD,
      identity: null,
      target: { reason: null },
    });
    expect(d.files.map((f) => f.path)).toContain('src/agent-work.txt');
    expect(d.agent).toMatchObject({
      verdict: 'ready',
      summary: 'Added src/agent-work.txt and ran the quick checks; all green.',
    });
    expect(d.message.split('\n')[0]).toBe('feat: build Tallyho');
    expect(d.message).toContain('Added src/agent-work.txt');
    // The workspace is never used for the owner's files and nothing was cleaned up.
    expect(hashTree(dir)['README.md']).toBeTruthy();
  });

  it('asks before every commit and push: git must know the owner, then commit, then push opens one PR', async () => {
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    h.engine.submitCommit(runId, { action: 'commit', message: 'feat: counter\n\nMy own words.' });
    let s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'no_git_identity' });
    expect(await out(['rev-list', '--count', 'main..HEAD'], dir)).toBe('0');
    await setOwner(dir);
    s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'PUSH', reason: 'needs_push' });
    // One commit, as the owner, with the owner's message and the run's trailer; nothing left over.
    expect(await out(['rev-list', '--count', 'main..HEAD'], dir)).toBe('1');
    expect(await out(['log', '-1', '--format=%an <%ae>'], dir)).toBe(
      'Owner Person <owner@example.invalid>',
    );
    const message = await out(['log', '-1', '--format=%B'], dir);
    expect(message).toContain('feat: counter\n\nMy own words.');
    expect(message).toContain(`Incubator-Run: ${runId}`);
    expect(await out(['status', '--porcelain'], dir)).toBe('');
    expect(h.github.repos.get('octo/tallyho')!.prs).toEqual([]);
    h.engine.submitPush(runId, 'push');
    s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.state).toBe('DONE');
    const prs = h.github.repos.get('octo/tallyho')!.prs;
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ head: BUILD, base: 'main' });
    expect(prs[0]!.body).toContain('Added src/agent-work.txt');
    expect(prs[0]!.body).toContain('src/agent-work.txt');
    expect(prs[0]!.body).toContain('approved this commit and push');
    expect(await h.github.getBranchSha({ owner: 'octo', name: 'tallyho' }, BUILD)).toBe(
      await out(['rev-parse', 'HEAD'], dir),
    );
    expect(h.engine.entries(runId).findLast((e) => e.type === 'finish.summary')).toMatchObject({
      pr: { number: 1 },
    });
  });

  it('lets the owner skip the push, or leave the changes uncommitted', async () => {
    const skip = harness();
    const dir = freshFolder();
    const a = await newSolution(skip, dir);
    await setOwner(dir);
    skip.engine.submitCommit(a.runId, { action: 'commit' });
    await skip.engine.resume(a.runId, new DefaultsPrompter());
    skip.engine.submitPush(a.runId, 'skip');
    expect((await skip.engine.resume(a.runId, new DefaultsPrompter())).state).toBe('DONE');
    expect(skip.github.calls.some((c) => c.method === 'openPr')).toBe(false);
    // The default message is the draft, with the agent's summary.
    expect(await out(['log', '-1', '--format=%B'], dir)).toContain('feat: build Tallyho');

    const leave = harness();
    const dir2 = freshFolder();
    const b = await newSolution(leave, dir2);
    leave.engine.submitCommit(b.runId, { action: 'leave' });
    expect((await leave.engine.resume(b.runId, new DefaultsPrompter())).state).toBe('DONE');
    expect(await out(['rev-list', '--count', 'main..HEAD'], dir2)).toBe('0');
    expect(await out(['status', '--porcelain'], dir2)).toContain('src/agent-work.txt');
  });

  it('finishes quietly when the agent changed nothing', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'idle');
    const h = harness();
    const { runId, s } = await newSolution(h, freshFolder());
    expect(s.state).toBe('DONE');
    expect(h.engine.entries(runId).findLast((e) => e.type === 'run.done')).toMatchObject({
      nothingToCommit: true,
    });
  });

  it('refuses a folder that already has files, before anything reaches GitHub, and never touches them', async () => {
    const h = harness();
    const dir = freshFolder();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'README.md'), 'my notes, not yours\n');
    const before = hashTree(dir);
    const { runId, s } = await newSolution(h, dir);
    expect(s.parked).toMatchObject({ reason: 'out_not_empty' });
    expect(hashTree(dir)).toEqual(before);
    expect(existsSync(path.join(dir, '.git'))).toBe(false);
    expect(h.github.calls.some((c) => c.method === 'createRepo')).toBe(false);
    // Emptying it is the owner's act; the run then continues.
    writeFileSync(path.join(dir, 'README.md'), '');
    mkdirSync(path.join(dir, 'x'));
    await import('node:fs').then((fs) => {
      fs.rmSync(path.join(dir, 'README.md'));
      fs.rmSync(path.join(dir, 'x'), { recursive: true });
    });
    const again = await h.engine.resume(runId, new DefaultsPrompter());
    expect(again.parked).toMatchObject({ reason: 'needs_commit' });
  });

  it('resumes after a crash that came after the scaffold was written', async () => {
    const h = harness();
    const dir = freshFolder();
    h.gitFaults.failAt = { method: 'init', when: 'before' };
    const runId = h.engine.startFromSpec(spec(), { kind: 'new', surface: 'test', dir });
    await expect(h.engine.advance(runId, new DefaultsPrompter())).rejects.toBeInstanceOf(ToolError);
    expect(existsSync(path.join(dir, 'README.md'))).toBe(true);
    const s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'needs_commit' });
  });
});

describe('rendering into a folder that a crashed render left behind', () => {
  async function publisher() {
    const { Publisher } = await import('./publish.js');
    const h = harness();
    const p = new Publisher({} as never);
    const result = (await import('./scaffold.js')).scaffoldSpec;
    const rendered = (await result(spec(), { validateOnly: true })).result;
    const ctx = (dir: string, steps: Record<string, { status: 'ok' }>) => {
      const recorded: string[] = [];
      return {
        recorded,
        ctx: {
          runId: 'r1',
          spec: spec(),
          workspace: path.join(dir, '..', 'unused'),
          localDir: dir,
          steps,
          record: (_t: string, f: { step: string }) => void recorded.push(f.step),
          clock: h.clock,
          log: h.engine as never,
        },
      };
    };
    return { p, rendered, ctx };
  }

  it('reuses a folder holding only files this render writes, once render.begin was journaled', async () => {
    const { p, rendered, ctx } = await publisher();
    const dir = freshFolder();
    mkdirSync(dir, { recursive: true });
    const first = rendered.files.get('README.md')!;
    writeFileSync(path.join(dir, 'README.md'), first.bytes);
    const { ctx: c, recorded } = ctx(dir, { 'render.begin': { status: 'ok' } });
    await p.render(c);
    expect(recorded).toEqual(expect.arrayContaining(['render.begin', 'render']));
    expect(existsSync(path.join(dir, 'package.json'))).toBe(true);
  });

  it('refuses the same folder when it holds anything else, or when no render.begin was journaled', async () => {
    const { p, rendered, ctx } = await publisher();
    const foreign = freshFolder();
    mkdirSync(foreign, { recursive: true });
    writeFileSync(path.join(foreign, 'README.md'), rendered.files.get('README.md')!.bytes);
    writeFileSync(path.join(foreign, 'mine.txt'), 'keep\n');
    await expect(
      p.render(ctx(foreign, { 'render.begin': { status: 'ok' } }).ctx as never),
    ).rejects.toMatchObject({ code: 'out_not_empty' });
    expect(readFileSync(path.join(foreign, 'mine.txt'), 'utf8')).toBe('keep\n');
    expect(existsSync(path.join(foreign, 'package.json'))).toBe(false);

    // Even a file with a rendered name is the owner's unless this run said it had begun.
    const theirs = freshFolder();
    mkdirSync(theirs, { recursive: true });
    writeFileSync(path.join(theirs, 'README.md'), 'my own readme\n');
    await expect(p.render(ctx(theirs, {}).ctx as never)).rejects.toMatchObject({
      code: 'out_not_empty',
    });
    expect(readFileSync(path.join(theirs, 'README.md'), 'utf8')).toBe('my own readme\n');
  });
});

/** Answers the two requests as they come, and resumes through injected crashes. */
async function drive(h: Harness, runId: string, dir: string, fault?: () => void) {
  let faulted = false;
  let s = await h.engine.advance(runId, new DefaultsPrompter());
  await setOwner(dir);
  for (let i = 0; i < 8 && !s.done; i++) {
    if (
      s.parked?.reason === 'needs_commit' &&
      !h.engine.entries(runId).some((e) => e.type === 'finish.approve')
    )
      h.engine.submitCommit(runId, { action: 'commit' });
    else if (
      s.parked?.reason === 'needs_push' &&
      !h.engine.entries(runId).some((e) => e.type === 'finish.push')
    )
      h.engine.submitPush(runId, 'push');
    if (!faulted && s.parked?.reason === 'needs_commit') {
      faulted = true;
      fault?.();
    }
    try {
      s = await h.engine.resume(runId, new DefaultsPrompter());
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      s = h.engine.state(runId);
    }
    // The push decision comes after the commit; inject the second-half faults once it is asked.
  }
  return s;
}

describe('the commit and push survive a crash at any step (ADR-010, ADR-023)', () => {
  const git2 = (['addAll', 'commit', 'status', 'headSha', 'push'] as const).flatMap((m) =>
    (['before', 'after'] as const).map((when) => ({ kind: 'git' as const, m, when })),
  );
  const gh = (['getRepo', 'openPr'] as const).flatMap((m) =>
    (['before', 'after'] as const).map((when) => ({ kind: 'github' as const, m, when })),
  );

  it.each([...git2, ...gh])(
    'one commit, one PR, nothing lost after a $kind failure $when $m',
    async ({ kind, m, when }) => {
      const h = harness();
      const dir = freshFolder();
      const runId = h.engine.startFromSpec(spec(), { kind: 'new', surface: 'test', dir });
      const s = await drive(h, runId, dir, () => {
        if (kind === 'git') h.gitFaults.failAt = { method: m as keyof GitOps, when };
        else h.github.failAt = { method: m as GitHubMethod, when };
      });
      expect(s.state).toBe('DONE');
      expect(await out(['rev-list', '--count', 'main..HEAD'], dir)).toBe('1');
      expect(await out(['status', '--porcelain'], dir)).toBe('');
      expect(h.github.repos.get('octo/tallyho')!.prs).toHaveLength(1);
      expect(await h.github.getBranchSha({ owner: 'octo', name: 'tallyho' }, BUILD)).toBe(
        await out(['rev-parse', 'HEAD'], dir),
      );
    },
  );
});

describe("update an existing solution in the owner's folder", () => {
  async function seeded(fixture = 'bare-node') {
    const h = harness({ llm: { dir: enhanceFixtureDir('export-orders') } });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      fixture,
      path.join(analyzerFixtures, fixture),
    );
    await setOwner(dir);
    return { h, ref, dir };
  }
  const start = (h: Harness, dir: string, ref: { owner: string; name: string }) =>
    h.engine.start({
      kind: 'enhance',
      repo: dir,
      repoRef: ref,
      dir,
      request: REQUEST,
      yes: true,
      surface: 'test',
    });

  it('delivers the plan onto a new branch in the folder, codes there, and never writes to the original branch', async () => {
    const { h, ref, dir } = await seeded();
    const mainBefore = await out(['rev-parse', 'main'], dir);
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).toBe(ENHANCE);
    expect(await out(['rev-parse', 'main'], dir)).toBe(mainBefore);
    // The plan and ticket are committed on the new branch; the agent's work is not committed yet.
    const tracked = await out(['ls-tree', '-r', '--name-only', 'HEAD'], dir);
    expect(tracked).toContain('docs/plans/001-enhance-20260501.md');
    expect(tracked).toContain('.incubator/tickets/E-export-orders.json');
    const status = await out(['status', '--porcelain'], dir);
    expect(status).toContain('src/agent-work.txt');
    expect(status).not.toContain('.incubator/state');
    expect(readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8')).toContain(
      '.incubator/state/',
    );
    expect(h.github.repos.get(`octo/${ref.name}`)!.prs).toEqual([]);
    const d = (await h.engine.finishDetail(runId))!;
    expect(d.target.repo).toEqual(ref);
    expect(d.message.split('\n')[0]).toBe(
      "feat: Export the day's orders as CSV from the existing /orders route",
    );

    h.engine.submitCommit(runId, { action: 'commit' });
    expect((await h.engine.resume(runId, new DefaultsPrompter())).parked).toMatchObject({
      reason: 'needs_push',
    });
    h.engine.submitPush(runId, 'push');
    expect((await h.engine.resume(runId, new DefaultsPrompter())).state).toBe('DONE');
    const prs = h.github.repos.get(`octo/${ref.name}`)!.prs;
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ head: ENHANCE, base: 'main' });
    // GitHub's main is untouched; the branch carries the delivery commit and the owner's commit.
    expect(await h.github.getBranchSha(ref, 'main')).toBe(mainBefore);
    const bare = path.join(h.github.root, ref.owner, `${ref.name}.git`);
    expect(
      (
        await git(['--git-dir', bare, 'rev-list', '--count', `main..${ENHANCE}`], dir)
      ).stdout.trim(),
    ).toBe('2');
  });

  it('refuses a folder with uncommitted work, and continues once it is clean', async () => {
    const { h, ref, dir } = await seeded();
    writeFileSync(path.join(dir, 'half-done.txt'), 'my work in progress\n');
    const before = hashTree(dir);
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'dirty_tree' });
    expect(hashTree(dir)).toEqual(before);
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).toBe('main');
    await import('node:fs').then((fs) => fs.rmSync(path.join(dir, 'half-done.txt')));
    expect((await h.engine.resume(runId, new DefaultsPrompter())).parked).toMatchObject({
      reason: 'needs_commit',
    });
  });

  it('parks at approval, touching nothing, when the folder has new commits since the scan (plan 025)', async () => {
    const { h, ref, dir } = await seeded();
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new NonInteractivePrompter());
    expect(s.parked).toMatchObject({ state: 'REVIEW' });
    writeFileSync(path.join(dir, 'later.txt'), 'the owner kept working\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'later'], dir);
    const head = await out(['rev-parse', 'HEAD'], dir);
    h.engine.approve(runId);
    const parked = await h.engine.advance(runId, new DefaultsPrompter());
    expect(parked.parked).toMatchObject({ state: 'APPROVED', reason: 'repo_moved' });
    expect(await out(['rev-parse', 'HEAD'], dir)).toBe(head);
    expect(await out(['branch', '--list', ENHANCE], dir)).toBe('');
    expect(await out(['status', '--porcelain'], dir)).toBe('');
  });

  it('parks, touching nothing, when uncommitted work appears in the folder between the scan and the delivery', async () => {
    const { h, ref, dir } = await seeded();
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new NonInteractivePrompter());
    expect(s.parked).toMatchObject({ state: 'REVIEW' });
    writeFileSync(path.join(dir, 'later.txt'), 'the owner kept working\n');
    const head = await out(['rev-parse', 'HEAD'], dir);
    h.engine.approve(runId);
    const parked = await h.engine.advance(runId, new DefaultsPrompter());
    expect(parked.parked).toMatchObject({ reason: 'folder_changed' });
    expect(await out(['rev-parse', 'HEAD'], dir)).toBe(head);
    expect(await out(['branch', '--list', ENHANCE], dir)).toBe('');
    expect(await out(['status', '--porcelain'], dir)).toBe('?? later.txt');
  });

  it('notices new commits, refuses to build on the old snapshot, and a refresh reads the folder again and asks to confirm the request (plan 025)', async () => {
    const h = harness({ llm: { dir: enhanceFixtureDir('refresh') } });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      'bare-node',
      path.join(analyzerFixtures, 'bare-node'),
    );
    await setOwner(dir);
    const runId = start(h, dir, ref);
    const waiting = new ScriptedPrompter({}, { approve: false, reason: 'owner is reading' });
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: false });
    const correction = 'Also let kitchen staff filter the export by date.';
    h.engine.requestChanges(runId, correction);
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    // The owner keeps working on the folder.
    const before = await out(['rev-parse', 'HEAD'], dir);
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'report.js'), 'export const report = () => [];\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'add a report'], dir);
    const head = await out(['rev-parse', 'HEAD'], dir);
    expect(await h.engine.repoMoved(runId)).toEqual({
      moved: true,
      recorded: before,
      current: head,
      branch: 'main',
      commits: 1,
    });
    // Approving does not build on the old snapshot.
    h.engine.approve(runId);
    const stopped = await h.engine.advance(runId, waiting);
    expect(stopped.parked).toMatchObject({
      state: 'APPROVED',
      reason: 'repo_moved',
      evidence: { recorded: before, current: head, commits: 1 },
    });
    expect(await out(['branch', '--list', ENHANCE], dir)).toBe('');
    // The refresh reads the folder again and asks to confirm the request, the correction included.
    await h.engine.refreshRepo(runId);
    const asked = await h.engine.advance(runId, waiting);
    const previous = `${REQUEST}\n\nCorrections you gave at review:\n- ${correction}`;
    expect(asked.parked).toMatchObject({
      state: 'REQUEST',
      reason: 'needs_request',
      evidence: { previous },
    });
    expect(h.engine.requestText(runId)).toBe('');
    expect(h.engine.previousRequest(runId)).toBe(previous);
    const scans = h.engine.entries(runId).filter((e) => e.type === 'enhance.scan');
    expect(scans).toHaveLength(2);
    expect(scans[1]!['hash']).not.toBe(scans[0]!['hash']);
    const draft = h.engine.draft(runId) as { existingRepo?: { baseSha?: string } };
    expect(draft.existingRepo?.baseSha).toBe(head);
    expect(h.engine.state(runId).steps['folder.base']?.data).toMatchObject({ head });
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: false, commits: 0 });
    // Confirming it drafts against the new scan; the old correction travels in the request text only.
    h.engine.submitRequest(runId, previous);
    expect((await h.engine.resume(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    const llm = h.llm as FakeLlmAdapter;
    expect(llm.calls.filter((c) => c.schemaName === 'AnalysisSummary')).toHaveLength(2);
    const turns = llm.calls.filter((c) => c.schemaName === 'DiscoveryTurn');
    expect(turns).toHaveLength(3);
    expect(turns[2]!.user).toContain('Corrections you gave at review:');
    expect(turns[2]!.user).not.toContain("## Owner's corrections at review");
    expect(llm.remaining).toBe(0);
    expect(h.engine.finalSpec(runId)!.intent.coreFeatures.map((f) => f.id)).toEqual([
      'export-orders',
      'export-filter',
    ]);
    // A second refresh sets aside the request confirmed since the first one, and keeps it to confirm again.
    await h.engine.refreshRepo(runId);
    expect(h.engine.requestText(runId)).toBe('');
    expect(h.engine.previousRequest(runId)).toBe(previous);
    expect(existsSync(path.join(h.store.runDir(runId), 'enhance', 'analysis-summary.md'))).toBe(
      false,
    );
  });

  it('notices a push to the GitHub repository of an update run outside a folder (plan 025)', async () => {
    const h = harness({ llm: { dir: enhanceFixtureDir('refresh') } });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      'bare-node',
      path.join(analyzerFixtures, 'bare-node'),
    );
    await setOwner(dir);
    const runId = h.engine.start({
      kind: 'enhance',
      repo: h.github.remoteUrl(ref),
      repoRef: ref,
      request: REQUEST,
      yes: true,
      noPublish: true,
      surface: 'test',
    });
    const waiting = new ScriptedPrompter({}, { approve: false, reason: 'owner is reading' });
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    const before = await out(['rev-parse', 'HEAD'], dir);
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: false, recorded: before });
    writeFileSync(path.join(dir, 'later.txt'), 'pushed by someone else\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'later'], dir);
    await git(['push', '-q', 'origin', 'HEAD:refs/heads/main'], dir);
    const head = await out(['rev-parse', 'HEAD'], dir);
    expect(await h.engine.repoMoved(runId)).toEqual({
      moved: true,
      recorded: before,
      current: head,
      branch: 'main',
      commits: null,
    });
    h.engine.approve(runId);
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({
      state: 'APPROVED',
      reason: 'repo_moved',
      evidence: { recorded: before, current: head, commits: null },
    });
  });

  it('refuses a refresh once the plan is being built, and on a run that is not an update (plan 025)', async () => {
    const { h, ref, dir } = await seeded();
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: false });
    await expect(h.engine.refreshRepo(runId)).rejects.toMatchObject({ code: 'too_late' });
    const other = h.engine.startFromSpec(spec(), {
      kind: 'new',
      surface: 'test',
      dir: freshFolder(),
    });
    await expect(h.engine.refreshRepo(other)).rejects.toMatchObject({ code: 'not_enhance' });
  });

  it('says there is nowhere to push when the folder has no GitHub origin, and ends committed locally', async () => {
    const { h, dir } = await seeded();
    await git(['remote', 'remove', 'origin'], dir);
    // No repoRef either: nothing says which GitHub repository this folder belongs to.
    const runId = h.engine.start({
      kind: 'enhance',
      repo: dir,
      dir,
      request: REQUEST,
      yes: true,
      surface: 'test',
    });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'needs_commit' });
    expect((await h.engine.finishDetail(runId))!.target).toMatchObject({ repo: null });
    h.engine.submitCommit(runId, { action: 'commit' });
    const done = await h.engine.resume(runId, new DefaultsPrompter());
    expect(done.state).toBe('DONE');
    expect(h.engine.entries(runId).findLast((e) => e.type === 'run.done')).toMatchObject({
      committedLocally: true,
    });
    expect(h.github.calls.some((c) => c.method === 'openPr')).toBe(false);
  });
});

describe("the decisions are the owner's", () => {
  it('rejects an answer when nothing is waiting for it', async () => {
    const h = harness();
    const { runId } = await newSolution(h, freshFolder());
    expect(() => h.engine.submitPush(runId, 'push')).toThrow('not waiting for a push decision');
    h.engine.submitCommit(runId, { action: 'leave' });
    await h.engine.resume(runId, new DefaultsPrompter());
    expect(() => h.engine.submitCommit(runId, { action: 'commit' })).toThrow(
      'not waiting for a commit decision',
    );
  });
});

describe('check commands on a repository the Incubator did not build (ADR-025)', () => {
  async function seeded(fixture: string) {
    const h = harness({ llm: { dir: enhanceFixtureDir('export-orders') } });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      fixture,
      path.join(analyzerFixtures, fixture),
    );
    await setOwner(dir);
    const runId = h.engine.start({
      kind: 'enhance',
      repo: dir,
      repoRef: ref,
      dir,
      request: REQUEST,
      yes: true,
      surface: 'test',
    });
    return { h, ref, dir, runId };
  }
  const launch = (h: Harness, runId: string) =>
    h.engine.entries(runId).findLast((e) => e.type === 'handoff.launch')!;
  const tools = (h: Harness, runId: string): string[] => {
    const argv = launch(h, runId)['argv'] as string[];
    return argv[argv.indexOf('--allowedTools') + 1]!.split(',');
  };

  it('proposes built-in commands that fit the repository, and runs none without approval', async () => {
    const { h, runId } = await seeded('flutter-app');
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(h.engine.proposedChecks(runId)).toEqual([
      {
        command: 'flutter analyze',
        what: 'Scans the Dart code for errors and style problems. It changes nothing.',
        why: 'pubspec.yaml: static analysis',
      },
      {
        command: 'flutter test',
        what: "Runs the project's automated tests.",
        why: 'test/: *_test.dart files',
      },
    ]);
    // `yes` is not an approval: the agent gets edit tools and read-only git, and nothing else.
    expect(h.engine.approvedChecks(runId)).toBeNull();
    expect(tools(h, runId)).toEqual([
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git status:*)',
      'Bash(git diff:*)',
    ]);
    expect(launch(h, runId)['checks']).toEqual({ mode: 'none', commands: [] });
    expect(
      h.engine.entries(runId).some((e) => e.type === 'step.warn' && e['step'] === 'code.checks'),
    ).toBe(true);
    expect((await h.engine.finishDetail(runId))!.agent).toMatchObject({
      checks: { mode: 'none', commands: [] },
    });
  });

  it('lets the agent run exactly what the owner approved', async () => {
    const { h, runId } = await seeded('flutter-app');
    expect(h.engine.submitChecks(runId, ['  flutter   analyze ', 'flutter test', ''])).toEqual([
      'flutter analyze',
      'flutter test',
    ]);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(tools(h, runId)).toEqual([
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(flutter analyze:*)',
      'Bash(flutter test:*)',
      'Bash(git status:*)',
      'Bash(git diff:*)',
    ]);
    expect(launch(h, runId)['checks']).toEqual({
      mode: 'approved',
      commands: ['flutter analyze', 'flutter test'],
    });
    expect((await h.engine.finishDetail(runId))!.agent).toMatchObject({
      checks: { mode: 'approved', commands: ['flutter analyze', 'flutter test'] },
    });
  });

  it('treats an empty approval as a decision, and refuses unsafe or late commands', async () => {
    const { h, runId } = await seeded('flutter-app');
    for (const bad of [
      'flutter test; rm -rf .',
      'flutter test && curl x',
      'bash',
      'git push',
      'flutter',
      'node -e x',
      'npm run test | cat',
      '../outside/run test',
      '/usr/bin/flutter test',
      'flutter test "a b"',
    ])
      expect(() => h.engine.submitChecks(runId, [bad]), bad).toThrow('check commands refused');
    expect(h.engine.approvedChecks(runId)).toBeNull();
    expect(h.engine.submitChecks(runId, [])).toEqual([]);
    expect(h.engine.approvedChecks(runId)).toEqual([]);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(launch(h, runId)['checks']).toEqual({ mode: 'none', commands: [] });
    // Once the agent has started, the list is closed.
    expect(() => h.engine.submitChecks(runId, ['flutter test'])).toThrow('already started coding');
  });

  it('covers a supported stack too: a repository without the Incubator gate is external', async () => {
    const { h, runId } = await seeded('bare-node');
    h.engine.submitChecks(runId, ['npm run test']);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(tools(h, runId)).toContain('Bash(npm run test:*)');
    expect(tools(h, runId).some((t) => t.includes('scripts/check.mjs'))).toBe(false);
  });

  it("puts the directory of an approved tool that PATH lacks in front of the agent's PATH", async () => {
    // Flutter is often unpacked under the home directory and never added to PATH.
    const home = mkdtempSync(path.join(os.tmpdir(), 'tools home '));
    const bin = path.join(home, 'flutter', 'bin');
    mkdirSync(bin, { recursive: true });
    const win = process.platform === 'win32';
    const file = path.join(bin, win ? 'flutter.bat' : 'flutter');
    writeFileSync(file, win ? '@echo off\r\n' : '#!/bin/sh\n');
    if (!win) chmodSync(file, 0o755);
    const seen: (Record<string, string | undefined> | undefined)[] = [];
    const h = fakePublishEngine({
      handoff: {
        exec: {
          ...nodeExec,
          run: (b, a, o) => {
            if (b === process.execPath) seen.push(o.env);
            return nodeExec.run(b, a, o);
          },
        },
        probe: () => Promise.resolve(agentCaps),
      },
      tools: { exec: { ...nodeExec, which: () => Promise.resolve(null) }, userHome: home },
      llm: { dir: enhanceFixtureDir('export-orders') },
    });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      'flutter-app',
      path.join(analyzerFixtures, 'flutter-app'),
    );
    await setOwner(dir);
    const runId = h.engine.start({
      kind: 'enhance',
      repo: dir,
      repoRef: ref,
      dir,
      request: REQUEST,
      yes: true,
      surface: 'test',
    });
    h.engine.submitChecks(runId, ['flutter analyze', 'flutter test']);
    await h.engine.advance(runId, new DefaultsPrompter());
    const env = seen.find((e) => e !== undefined)!;
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path')!;
    expect(env[key]!.split(path.delimiter)[0]!.toLowerCase()).toBe(bin.toLowerCase());
    expect(Object.keys(env).filter((k) => k.toLowerCase() === 'path')).toHaveLength(1);
  });

  it('leaves an Incubator-built repository on its own gate, whatever was approved', async () => {
    const h = harness();
    const dir = freshFolder();
    const { runId, s } = await newSolution(h, dir);
    expect(s.parked).toMatchObject({ state: 'COMMIT' });
    expect(tools(h, runId)).toEqual([
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(node scripts/check.mjs:*)',
      'Bash(node scripts/test-profile.mjs:*)',
      'Bash(node scripts/scaffold.mjs:*)',
      'Bash(git status:*)',
      'Bash(git diff:*)',
    ]);
    expect(launch(h, runId)['checks']).toEqual({ mode: 'gate', commands: [] });
    expect(() => h.engine.submitChecks(runId, ['npm run test'])).toThrow(
      'not an update of an existing repository',
    );
  });

  it('parks instead of launching an agent it cannot hold to the list', async () => {
    const h = fakePublishEngine({
      llm: { dir: enhanceFixtureDir('export-orders') },
      handoff: {
        exec: nodeExec,
        probe: () =>
          Promise.resolve({
            ...agentCaps,
            flags: { printMode: [fakeAgent, '-p'], streamJson: ['--output-format', 'stream-json'] },
          }),
      },
    });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      'flutter-app',
      path.join(analyzerFixtures, 'flutter-app'),
    );
    await setOwner(dir);
    const runId = h.engine.start({
      kind: 'enhance',
      repo: dir,
      repoRef: ref,
      dir,
      request: REQUEST,
      yes: true,
      surface: 'test',
    });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'CODE', reason: 'checks_unenforceable' });
    expect(h.engine.entries(runId).some((e) => e.type === 'handoff.launch')).toBe(false);
  });
});
