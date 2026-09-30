import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GitHubMethod, GitOps } from '@incubator/git';
import { ToolError, nodeExec } from '@incubator/runtime';
import { completeSpec } from '@incubator/spec';
import { render, writeTree } from '@incubator/templates';
import type { RepoScan } from '@incubator/analyzer';
import type { Capabilities } from '@incubator/llm';
import { DefaultsPrompter } from './prompter.js';
import { loadPrompt } from './prompts.js';
import {
  featureIssues,
  nextPlanNumber,
  resolveTargets,
  sanitizeRequest,
  ticketId,
} from './enhance.js';
import { enhanceFixtureDir, fakePublishEngine, hashTree, seedExistingRepo } from './testing.js';

const fixtures = path.resolve(import.meta.dirname, '../../analyzer/fixtures');
const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });
const BRANCH = 'incubator/enhance-20260501';
const REQUEST = 'Kitchen staff need to export the orders list as a CSV file at the end of the day.';

const hashes = hashTree;

type Harness = ReturnType<typeof fakePublishEngine>;

const seed = (h: Harness, name: string, from: string | ((dir: string) => Promise<void>)) =>
  seedExistingRepo(h.github, name, from);

const engineFor = (fixture: string, opts: Parameters<typeof fakePublishEngine>[0] = {}) =>
  fakePublishEngine({ llm: { dir: enhanceFixtureDir(fixture) }, ...opts });

function start(
  h: Harness,
  repo: string,
  ref: { owner: string; name: string },
  extra: Partial<Parameters<Harness['engine']['start']>[0]> = {},
) {
  return h.engine.start({
    kind: 'enhance',
    repo,
    repoRef: ref,
    request: REQUEST,
    yes: true,
    surface: 'test',
    ...extra,
  });
}

const workspace = (h: Harness, runId: string) =>
  path.join(h.store.runDir(runId), 'workspace', 'repo');

async function branchFiles(h: Harness, name: string, range: string) {
  const bare = path.join(h.github.root, 'octo', `${name}.git`);
  const r = await git(['--git-dir', bare, 'diff', '--name-status', range], h.home);
  return r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t') as [string, string]);
}

describe('enhance', () => {
  it('delivers the plan, ticket, design brief, request and scan without touching a file', async () => {
    const h = engineFor('export-orders');
    const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const before = hashes(dir);
    const runId = start(h, dir, ref, { noPublish: true });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.state).toBe('DONE');
    const ws = workspace(h, runId);
    const tree = readdirSync(ws, { recursive: true, withFileTypes: false }).map((p) =>
      String(p).split(path.sep).join('/'),
    );
    for (const f of [
      'docs/plans/001-enhance-20260501.md',
      '.incubator/tickets/E-export-orders.json',
      '.incubator/enhance/20260501/design-export-orders.md',
      '.incubator/enhance/20260501/scan-report.md',
      '.incubator/enhance/20260501/request.md',
      '.incubator/lanes/enhancement/existing/design.md',
      '.incubator/lanes/enhancement/existing/enrich.md',
    ])
      expect(tree, f).toContain(f);
    // The request is grounded in the scan: the /orders route is the target.
    const plan = readFileSync(path.join(ws, 'docs/plans/001-enhance-20260501.md'), 'utf8');
    expect(plan).toContain('**Step 1:** Export the day');
    expect(plan).toContain('- Target: src/server.js');
    for (const h2 of [
      '## Executor preamble',
      '## Touched files and markers',
      '## Acceptance commands',
      '## Drift and hallucination guardrails',
      '## Review rounds',
    ])
      expect(plan).toContain(h2);
    const brief = readFileSync(
      path.join(ws, '.incubator/enhance/20260501/design-export-orders.md'),
      'utf8',
    );
    expect(brief).toContain('`E-export-orders`');
    expect(brief).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(
      JSON.parse(readFileSync(path.join(ws, '.incubator/tickets/E-export-orders.json'), 'utf8')),
    ).toMatchObject({
      id: 'E-export-orders',
      lane: 'enhancement/existing',
      state: 'TAGGED_TO_RELEASE',
      plan: 'docs/plans/001-enhance-20260501.md',
    });
    expect(
      readFileSync(path.join(ws, '.incubator/enhance/20260501/scan-report.md'), 'utf8'),
    ).toMatch(/^Scanned \d+ of \d+ files/);
    // Additions only, on the enhance branch, and the source checkout is untouched.
    const changes = (await git(['diff', '--name-status', 'main..HEAD'], ws)).stdout
      .trim()
      .split('\n')
      .map((l) => l.split('\t')[0]);
    expect(new Set(changes)).toEqual(new Set(['A']));
    expect((await git(['rev-parse', '--abbrev-ref', 'HEAD'], ws)).stdout.trim()).toBe(BRANCH);
    expect(hashes(dir)).toEqual(before);
    expect(h.github.calls.some((c) => c.method === 'openPr')).toBe(false);
    expect(h.engine.enhanceSummary(runId)).toMatchObject({
      noop: null,
      plan: { planPath: 'docs/plans/001-enhance-20260501.md' },
    });
  });

  it('opens one pull request whose body says what it is and how much was scanned', async () => {
    const h = engineFor('export-orders');
    const { ref } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, h.github.remoteUrl(ref), ref);
    expect((await h.engine.advance(runId, new DefaultsPrompter())).state).toBe('DONE');
    const pr = h.github.repos.get('octo/bare-node')!.prs;
    expect(pr).toHaveLength(1);
    expect(pr[0]).toMatchObject({
      head: BRANCH,
      base: 'main',
      title: 'Enhancement plan: order-desk',
    });
    expect(pr[0]!.body).toContain('_Generated by the Incubator.');
    expect(pr[0]!.body).toContain('not verified');
    expect(pr[0]!.body).toContain('> Kitchen staff need to export');
    expect(pr[0]!.body).toMatch(/Scanned \d+ of \d+ files/);
    expect(pr[0]!.body).not.toContain('Optional: canonical pattern gaps');
    expect(new Set((await branchFiles(h, 'bare-node', `main..${BRANCH}`)).map(([s]) => s))).toEqual(
      new Set(['A']),
    );
    expect(h.engine.enhanceSummary(runId).pr).toEqual({
      number: 1,
      url: 'https://github.com/octo/bare-node/pull/1',
    });
  });

  it('keeps canonical gaps out unless asked, and puts them in a second commit when asked', async () => {
    const h = engineFor('export-orders');
    const { ref } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, h.github.remoteUrl(ref), ref, { withGaps: true });
    expect((await h.engine.advance(runId, new DefaultsPrompter())).state).toBe('DONE');
    const bare = path.join(h.github.root, 'octo', 'bare-node.git');
    const log = await git(['--git-dir', bare, 'log', '--format=%s', `main..${BRANCH}`], h.home);
    expect(log.stdout.trim().split('\n')).toEqual([
      'chore: adopt the Incubator canonical pattern (optional)',
      'chore: add the enhancement plan for 1 request(s)',
    ]);
    const first = await git(
      ['--git-dir', bare, 'show', '--name-only', '--format=', `${BRANCH}~1`],
      h.home,
    );
    const second = await git(
      ['--git-dir', bare, 'show', '--name-only', '--format=', BRANCH],
      h.home,
    );
    expect(first.stdout).toContain('docs/plans/001-enhance-20260501.md');
    expect(first.stdout).not.toContain('CLAUDE.md');
    expect(second.stdout).toContain('CLAUDE.md');
    expect(second.stdout).not.toContain('docs/plans/001-enhance-20260501.md');
    const body = h.github.repos.get('octo/bare-node')!.prs[0]!.body;
    expect(body).toContain('## Optional: canonical pattern gaps');
    expect(body).toContain('# Incubator gap report');
    expect(new Set((await branchFiles(h, 'bare-node', `main..${BRANCH}`)).map(([s]) => s))).toEqual(
      new Set(['A']),
    );
  });

  it('parks for the change request, then continues once it is submitted', async () => {
    const h = engineFor('export-orders');
    const { ref } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = h.engine.start({
      kind: 'enhance',
      repo: h.github.remoteUrl(ref),
      repoRef: ref,
      yes: true,
      noPublish: true,
      surface: 'test',
    });
    let s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'REQUEST', reason: 'needs_request' });
    expect(() => h.engine.submitRequest(runId, '  \n ')).toThrow(/describe what you want/);
    h.engine.submitRequest(runId, `${REQUEST}‮`);
    s = await h.engine.resume(runId, new DefaultsPrompter());
    expect(s.state).toBe('DONE');
    expect(h.engine.requestText(runId)).toBe(REQUEST);
    expect(() => h.engine.submitRequest(runId, 'again')).toThrow(/not waiting/);
  });

  it('says so when there is nothing to change', async () => {
    const h = engineFor('no-features');
    const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, dir, ref);
    expect((await h.engine.advance(runId, new DefaultsPrompter())).state).toBe('DONE');
    expect(h.engine.enhanceSummary(runId)).toMatchObject({ noop: 'no_features', plan: null });
    expect(h.github.calls.some((c) => c.method === 'openPr')).toBe(false);
    expect(
      (await git(['rev-parse', '--abbrev-ref', 'HEAD'], workspace(h, runId))).stdout.trim(),
    ).toBe('main');
  });

  it('is a no-op when this plan was already delivered on the same day', async () => {
    const turn = JSON.parse(
      readFileSync(path.join(enhanceFixtureDir('export-orders'), '01-DiscoveryTurn.json'), 'utf8'),
    ) as never;
    // One scripted turn per run: the fake model replays its turns in order.
    const h = fakePublishEngine({ llm: [turn, turn] });
    const { ref } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const first = start(h, h.github.remoteUrl(ref), ref);
    expect((await h.engine.advance(first, new DefaultsPrompter())).state).toBe('DONE');
    // "Merge" the enhance branch, then ask again: a fresh run clones the merged repository.
    const bare = path.join(h.github.root, 'octo', 'bare-node.git');
    await git(['--git-dir', bare, 'update-ref', 'refs/heads/main', BRANCH], h.home);
    const again = start(h, h.github.remoteUrl(ref), ref);
    expect((await h.engine.advance(again, new DefaultsPrompter())).state).toBe('DONE');
    expect(h.engine.enhanceSummary(again)).toMatchObject({ noop: 'already_delivered', plan: null });
    expect(h.github.repos.get('octo/bare-node')!.prs).toHaveLength(1);
  });

  it('delivers only the new request on a repository that already has features', async () => {
    const h = engineFor('gift-notes');
    const spec = completeSpec(
      JSON.parse(readFileSync(path.join(fixtures, 'compliant/incubator.json'), 'utf8')) as never,
    ).spec;
    const { ref } = await seed(h, 'tallyho', async (dir) => {
      writeTree(await render(spec), dir, { mode: 'fresh' });
    });
    const runId = start(h, h.github.remoteUrl(ref), ref, {
      noPublish: true,
      request: 'Buyers want to add a gift note.',
    });
    expect((await h.engine.advance(runId, new DefaultsPrompter())).state).toBe('DONE');
    const ws = workspace(h, runId);
    const tickets = readdirSync(path.join(ws, '.incubator/tickets')).sort();
    expect(tickets).toContain('E-gift-notes.json');
    expect(tickets).toContain('F-counter.json');
    expect(h.engine.enhanceSummary(runId).plan!.features.map((f) => f.id)).toEqual(['gift-notes']);
    const design = readFileSync(
      path.join(ws, '.incubator/enhance/20260501/design-gift-notes.md'),
      'utf8',
    );
    expect(design).toContain('`enhancement/new`');
  });

  it('parks when the model strays outside the enhancement lanes or outside intent', async () => {
    for (const fixture of ['bad-lane', 'outside-intent']) {
      const h = engineFor(fixture);
      const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
      const runId = start(h, dir, ref);
      const s = await h.engine.advance(runId, new DefaultsPrompter());
      expect(s.parked, fixture).toMatchObject({ reason: 'llm_schema' });
    }
  });

  it('parks on a repository with no supported stack', async () => {
    const h = engineFor('export-orders');
    const { ref, dir } = await seed(h, 'notes', async (d) => {
      cpSync(path.join(fixtures, 'compliant'), d, { recursive: true });
      const { rmSync, writeFileSync } = await import('node:fs');
      rmSync(path.join(d, 'incubator.json'));
      writeFileSync(path.join(d, 'README.md'), '# notes\n');
    });
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'no_stack' });
  });

  it('hands the delivered plan and its own tickets to the agent', async () => {
    const agentCaps: Capabilities = {
      installed: true,
      path: process.execPath,
      version: '1.0.0',
      flags: { printMode: ['agent.mjs', '-p'], streamJson: ['--output-format', 'stream-json'] },
      stdinPrompt: true,
      eligible: { discovery: true, analysis: true, handoff: true },
      reasons: [],
    };
    const h = engineFor('export-orders', {
      handoff: { exec: nodeExec, probe: () => Promise.resolve(agentCaps) },
    });
    const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, dir, ref, { noPublish: true });
    await h.engine.advance(runId, new DefaultsPrompter());
    const prep = await h.engine.prepareHandoff(runId);
    expect(prep.plan.planPath).toBe(
      path.join(workspace(h, runId), 'docs', 'plans', '001-enhance-20260501.md'),
    );
    expect(prep.plan.cwd).toBe(workspace(h, runId));
    expect(prep.ticket).toBe('E-export-orders');
    expect(prep.prompt).toContain('**Step 1:** Export the day');
    // A run that delivered nothing has nothing to hand off.
    const none = engineFor('no-features', {
      handoff: { exec: nodeExec, probe: () => Promise.resolve(agentCaps) },
    });
    const s2 = await seed(none, 'bare-node', path.join(fixtures, 'bare-node'));
    const r2 = start(none, s2.dir, s2.ref);
    await none.engine.advance(r2, new DefaultsPrompter());
    await expect(none.engine.prepareHandoff(r2)).rejects.toThrow('delivered nothing');
  });
});

describe('enhance helpers', () => {
  it('ships the enhance prompt versioned and byte-pinned', () => {
    const p = loadPrompt('enhance');
    expect(p.name).toBe('enhance');
    expect(p.version).toBe('1.0.0');
    expect(p.body).toMatchSnapshot();
  });

  it('checks lanes and feature ids in model output', () => {
    const turn = (lane: string, id = 'new-thing') => ({
      intent: { coreFeatures: [{ id, summary: 's', lane }] },
    });
    expect(featureIssues(turn('enhancement/new'), [])).toEqual([]);
    expect(featureIssues(turn('security'), []).map((i) => i.code)).toEqual(['lane.enhancement']);
    expect(featureIssues(turn('enhancement/new', 'old'), ['old']).map((i) => i.code)).toEqual([
      'feature.duplicate',
    ]);
  });

  it('numbers plans after the highest existing one', () => {
    expect(nextPlanNumber([])).toBe('001');
    expect(
      nextPlanNumber(['docs/plans/000-bootstrap.md', 'docs/plans/007-x.md', 'README.md']),
    ).toBe('008');
  });

  it('cleans requests: keeps lines, drops control and bidi characters, caps length', () => {
    expect(sanitizeRequest('a\u0000b\r\nc‮  \n')).toBe('a b\nc');
    expect(sanitizeRequest('x'.repeat(50), 10)).toHaveLength(10);
    expect(ticketId({ id: 'foo' })).toBe('E-foo');
  });

  it('resolves targets by word match and returns none when nothing matches', () => {
    const scan = {
      routes: [{ method: 'GET', path: '/orders', file: 'src/server.js', framework: 'node' }],
      commands: [],
      dataModel: [{ name: 'invoices', file: 'db/001.sql', kind: 'sql-table' }],
      entryPoints: [],
      modules: [{ dir: 'src/billing', files: 2, languages: ['JavaScript'] }],
    } as unknown as RepoScan;
    expect(resolveTargets(scan, { id: 'export-orders', summary: 'Export orders as CSV' })).toEqual([
      'src/server.js',
    ]);
    expect(resolveTargets(scan, { id: 'billing-fix', summary: 'Fix invoice totals' })).toEqual([
      'src/billing/',
      'db/001.sql',
    ]);
    expect(resolveTargets(scan, { id: 'zzz', summary: 'unrelated' })).toEqual([]);
  });
});

describe('enhance resumes after a crash at any step (ADR-010, ADR-020)', () => {
  const gitPoints = (
    ['checkoutNewBranch', 'addAll', 'commit', 'diffNameStatus', 'push'] as const
  ).flatMap((m) =>
    (['before', 'after'] as const).map((when) => ({ kind: 'git' as const, m, when })),
  );
  const githubPoints = (['getRepo', 'openPr'] as const).flatMap((m) =>
    (['before', 'after'] as const).map((when) => ({ kind: 'github' as const, m, when })),
  );

  it.each([...gitPoints, ...githubPoints])(
    'two commits, one PR, additions only after a $kind failure $when $m',
    async ({ kind, m, when }) => {
      const h = engineFor('export-orders');
      const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
      const before = hashes(dir);
      if (kind === 'git') h.gitFaults.failAt = { method: m as keyof GitOps, when };
      else h.github.failAt = { method: m as GitHubMethod, when };
      // withGaps exercises both commits, so every step runs twice and a crash can hit either part.
      const runId = start(h, h.github.remoteUrl(ref), ref, { withGaps: true });
      let s = h.engine.state(runId);
      for (let i = 0; i < 4 && !s.done; i++) {
        try {
          s =
            i === 0
              ? await h.engine.advance(runId, new DefaultsPrompter())
              : await h.engine.resume(runId, new DefaultsPrompter());
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
        }
        s = h.engine.state(runId);
      }
      expect(s.state).toBe('DONE');
      expect(h.github.repos.get('octo/bare-node')!.prs).toHaveLength(1);
      const bare = path.join(h.github.root, 'octo', 'bare-node.git');
      const count = await git(
        ['--git-dir', bare, 'rev-list', '--count', `main..${BRANCH}`],
        h.home,
      );
      expect(count.stdout.trim()).toBe('2');
      expect(
        new Set((await branchFiles(h, 'bare-node', `main..${BRANCH}`)).map(([st]) => st)),
      ).toEqual(new Set(['A']));
      expect(existsSync(path.join(dir, 'docs'))).toBe(false);
      expect(hashes(dir)).toEqual(before);
    },
  );
});
