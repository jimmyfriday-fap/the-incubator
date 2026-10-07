import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_GITHUB_TOKEN } from '@incubator/core/testing';
import { nodeExec } from '@incubator/runtime';
import type {
  FolderCheck,
  LogEntry,
  ProjectCard,
  ProjectDetail,
  Question,
  RepoStatus,
  ReviewSummaryResponse,
  RunDetail,
  RunListItem,
  SettingsView,
  SpecChange,
  TreeFile,
} from '../api-types.js';
import { apiClient, seedAdoptRepo, startFakeServer } from '../testing-fixtures/fake-web.js';
import type { RunningServer } from './server.js';
import { Guard, parseCookies, safeEqual } from './security.js';
import { specDiff } from './spec-diff.js';
import { readAsset, resolveAsset } from './static.js';

const open: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

async function boot(opts: Parameters<typeof startFakeServer>[0] = {}) {
  const r = await startFakeServer(opts);
  open.push(r.server);
  return { ...r, api: await apiClient(r.server) };
}

async function until(
  api: Awaited<ReturnType<typeof apiClient>>,
  runId: string,
  pred: (d: RunDetail) => boolean,
): Promise<RunDetail> {
  let last: RunDetail | null = null;
  for (let i = 0; i < 400; i++) {
    last = (await api.get<RunDetail>(`/api/runs/${runId}`)).body;
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `run ${runId} never reached the expected state; last seen: ${JSON.stringify({
      state: last?.state,
      busy: last?.busy,
      parked: last?.parked,
      error: last?.error,
    })}`,
  );
}

describe('request security', () => {
  it('rejects a missing token, a used token, a bad cookie, a wrong Origin or Host, and a missing CSRF header', async () => {
    const { server, api } = await boot();
    const o = server.origin;
    // No session at all: 401 for the app shell and the API.
    expect((await fetch(`${o}/`)).status).toBe(401);
    expect((await fetch(`${o}/api/runs`)).status).toBe(401);
    // The launch token is single use.
    expect((await fetch(server.url, { redirect: 'manual' })).status).toBe(401);
    expect((await fetch(`${o}/?t=wrong`, { redirect: 'manual' })).status).toBe(401);
    // A forged cookie.
    expect(
      (await fetch(`${o}/api/runs`, { headers: { cookie: 'inc_session=forged' } })).status,
    ).toBe(401);
    // A wrong Origin, on reads that carry one and on every write.
    expect(
      (
        await fetch(`${o}/api/runs`, {
          headers: { cookie: api.cookie, origin: 'http://evil.example' },
        })
      ).status,
    ).toBe(403);
    const post = (headers: Record<string, string>) =>
      fetch(`${o}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ kind: 'new', narrative: 'x' }),
      });
    expect((await post({ cookie: api.cookie, 'x-incubator-csrf': api.csrf })).status).toBe(403); // no Origin
    expect(
      (
        await post({
          cookie: api.cookie,
          origin: `http://localhost:${server.port}`,
          'x-incubator-csrf': api.csrf,
        })
      ).status,
    ).toBe(403);
    // Missing and wrong CSRF headers.
    expect((await post({ cookie: api.cookie, origin: o })).status).toBe(403);
    expect((await post({ cookie: api.cookie, origin: o, 'x-incubator-csrf': 'nope' })).status).toBe(
      403,
    );
    // A DNS-rebinding Host.
    const rebound = await server.app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: { host: `evil.example:${server.port}`, cookie: api.cookie },
    });
    expect(rebound.statusCode).toBe(403);
    // And the happy path, with the security headers and no CORS.
    expect((await fetch(`${o}/favicon.ico`, { headers: { cookie: api.cookie } })).status).toBe(204);
    const ok = await fetch(`${o}/api/runs`, { headers: { cookie: api.cookie } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sets an HttpOnly SameSite=Strict cookie and redirects the token away', async () => {
    const { server } = await startFakeServer();
    open.push(server);
    const r = await fetch(server.url, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    expect(r.headers.get('set-cookie')).toMatch(
      /^inc_session=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/$/,
    );
  });

  it('guard and cookie helpers', () => {
    const g = new Guard('tok');
    const req = (h: Record<string, string>, method = 'GET', p = '/api/runs', query = {}) => ({
      method,
      path: p,
      query,
      headers: h,
    });
    expect(g.check(req({ host: '127.0.0.1:1' })).kind).toBe('deny'); // port not bound yet
    g.port = 9;
    const b = g.check(req({ host: '127.0.0.1:9' }, 'GET', '/', { t: 'tok' }));
    expect(b.kind).toBe('bootstrap');
    expect(g.launchToken).toBeNull();
    expect(parseCookies('a=1; inc_session=x=y; a=2')).toEqual({ a: '1', inc_session: 'x=y' });
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('greenfield over the API', () => {
  it('discovers, clarifies, reviews, previews and publishes to DONE', async () => {
    const { api, h } = await boot();
    expect((await api.post('/api/runs', { kind: 'new', narrative: '  ' })).status).toBe(400);
    const start = await api.post<{ runId: string }>('/api/runs', {
      kind: 'new',
      narrative: 'Stockroom: stock tracking for cafés.',
    });
    expect(start.status).toBe(202);
    const { runId } = start.body;
    let d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.reason).toBe('needs_input');
    const qs = d.questions!;
    expect(qs.length).toBeGreaterThan(0);
    // The tree only exists once the spec is complete.
    expect((await api.get(`/api/runs/${runId}/tree`)).status).toBe(409);
    expect((await api.post(`/api/runs/${runId}/approve`)).status).toBe(409);
    expect(
      (await api.post(`/api/runs/${runId}/answers`, { answers: [{ key: 'nope', value: 'x' }] }))
        .status,
    ).toBe(409);
    const answer = (q: Question) => ({
      key: q.key,
      value: q.options.find((o) => o.recommended)!.value,
    });
    expect((await api.post(`/api/runs/${runId}/answers`, { answers: qs.map(answer) })).status).toBe(
      200,
    );
    d = await until(
      api,
      runId,
      (x) => !x.busy && x.state === 'PARKED' && x.parked?.state !== 'CLARIFY',
    );
    expect(d.parked).toMatchObject({ state: 'REVIEW', reason: 'needs_review' });

    const revs = (await api.get<{ rev: number; final: boolean }[]>(`/api/runs/${runId}/revisions`))
      .body;
    expect(revs.at(-1)!.final).toBe(true);
    const diff = (
      await api.get<{ changes: SpecChange[]; spec: { project: { slug: string } } }>(
        `/api/runs/${runId}/spec-diff`,
      )
    ).body;
    expect(diff.changes.length).toBeGreaterThan(0);
    expect(diff.spec.project.slug).toBe('stockroom');
    expect((await api.get(`/api/runs/${runId}/spec-diff?from=999`)).status).toBe(422);

    const tree = (await api.get<{ files: TreeFile[] }>(`/api/runs/${runId}/tree`)).body;
    expect(tree.files.map((f) => f.path)).toContain('CLAUDE.md');
    const file = await api.get<{ text: string }>(`/api/runs/${runId}/file?path=CLAUDE.md`);
    expect(file.body.text).toContain('Stockroom');
    expect((await api.get(`/api/runs/${runId}/file?path=../../etc/passwd`)).status).toBe(404);

    // An invalid edited spec is refused and the run stays at REVIEW.
    const bad = await api.post<{ error: string }>(`/api/runs/${runId}/approve`, {
      spec: { project: {} },
    });
    expect(bad.status).toBe(422);
    const spec = diff.spec as unknown as { project: { owner: { type: string; login: string } } };
    spec.project.owner = { type: 'user', login: 'octo' };
    expect((await api.post(`/api/runs/${runId}/approve`, { spec })).status).toBe(200);
    d = await until(api, runId, (x) => !x.busy && (x.done || x.state === 'PARKED'));
    expect(d.error).toBeNull();
    expect(d.state).toBe('DONE');
    expect(d.publish?.repo).toBe('https://github.com/octo/stockroom');
    expect(h.github.repos.has('octo/stockroom')).toBe(true);

    const runs = (await api.get<RunListItem[]>('/api/runs')).body;
    expect(runs[0]).toMatchObject({ runId, kind: 'new', state: 'DONE', done: true });
    expect((await api.post(`/api/runs/${runId}/resume`)).status).toBe(409);
    expect((await api.get('/api/runs/not-a-run')).status).toBe(400);
    expect((await api.get('/api/runs/20260501-120000-aaaaaa')).status).toBe(404);
    expect((await api.get('/api/nope')).status).toBe(404);
  });
});

describe('brownfield over the API', () => {
  it('adopts a repository through a pull request and shows delta statuses', async () => {
    const { api, h } = await boot();
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    expect(
      (await api.post('/api/runs', { kind: 'adopt', repo: dir, repoRef: 'not a ref' })).status,
    ).toBe(400);
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'adopt',
        repo: dir,
        repoRef: 'octo/bare-node',
      })
    ).body;
    let d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.state).toBe('REVIEW');
    const tree = (await api.get<{ files: TreeFile[] }>(`/api/runs/${runId}/tree`)).body;
    const byPath = new Map(tree.files.map((f) => [f.path, f.status]));
    expect(byPath.get('CLAUDE.md')).toBe('create');
    expect(byPath.get('package.json')).toBe('proposed');
    expect(tree.files.some((f) => f.path.startsWith('@paired/'))).toBe(false);
    expect((await api.post(`/api/runs/${runId}/approve`)).status).toBe(200);
    d = await until(api, runId, (x) => !x.busy && (x.done || x.state === 'PARKED'));
    expect(d.parked).toBeNull();
    expect(d.state).toBe('DONE');
    expect(d.adopt?.pr?.url).toBe('https://github.com/octo/bare-node/pull/1');
    expect(d.adopt?.report).toContain('# Incubator gap report');
  });
});

describe('enhance over the API', () => {
  const REQUEST = 'Kitchen staff need to export the orders list as a CSV file.';

  it('scans, asks what to change, previews the delivery and opens the pull request', async () => {
    const { api, h } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    expect((await api.post('/api/runs', { kind: 'enhance' })).status).toBe(400);
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
      })
    ).body;
    let d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked).toMatchObject({ state: 'REQUEST', reason: 'needs_request' });
    expect(d.enhance?.scanReport).toMatch(/^Scanned \d+ of \d+ files/);
    expect(d.enhance?.request).toBe('');
    // An empty answer is refused; a real one continues the run to REVIEW.
    expect((await api.post(`/api/runs/${runId}/request`, { narrative: '   ' })).status).toBe(422);
    expect((await api.post(`/api/runs/${runId}/request`, { narrative: REQUEST })).status).toBe(200);
    d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.state).toBe('REVIEW');
    expect(d.enhance?.request).toBe(REQUEST);
    const tree = (await api.get<{ files: TreeFile[] }>(`/api/runs/${runId}/tree`)).body;
    const byPath = new Map(tree.files.map((f) => [f.path, f.status]));
    expect(byPath.get('docs/plans/001-enhance-20260501.md')).toBe('create');
    expect(byPath.get('.incubator/tickets/E-export-orders.json')).toBe('create');
    expect(byPath.has('CLAUDE.md')).toBe(false); // gaps are opt-in
    const file = (
      await api.get<{ text: string }>(
        `/api/runs/${runId}/file?path=${encodeURIComponent('docs/plans/001-enhance-20260501.md')}`,
      )
    ).body;
    expect(file.text).toContain('**Step 1:** Export the day');
    // The request route only answers a run that is waiting for it.
    expect((await api.post(`/api/runs/${runId}/request`, { narrative: 'again' })).status).toBe(409);
    expect((await api.post(`/api/runs/${runId}/approve`)).status).toBe(200);
    d = await until(api, runId, (x) => !x.busy && (x.done || x.state === 'PARKED'));
    expect(d.state).toBe('DONE');
    expect(d.enhance?.pr?.url).toBe('https://github.com/octo/bare-node/pull/1');
    expect(d.enhance?.plan?.features.map((f) => f.id)).toEqual(['export-orders']);
    expect(d.adopt).toBeNull();
  });

  it('files the run under a project, lists it, recognises the folder again, and keeps the history (ADR-028)', async () => {
    const { api, h } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    expect((await api.get<ProjectCard[]>('/api/portfolio')).body).toEqual([]);
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
      })
    ).body;
    const d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.state).toBe('REVIEW');
    expect(d.project).toMatchObject({
      name: path.basename(dir),
      runCount: 1,
      repo: { dir, url: 'https://github.com/octo/bare-node' },
    });
    const cards = (await api.get<ProjectCard[]>('/api/portfolio')).body;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: d.project!.id,
      origin: 'existing',
      runCount: 1,
      latest: { runId, kind: 'enhance', state: 'PARKED', done: false },
    });
    const detail = (await api.get<ProjectDetail>(`/api/portfolio/${d.project!.id}`)).body;
    expect(detail.runs).toEqual([
      expect.objectContaining({ runId, request: REQUEST, state: 'PARKED', available: true }),
    ]);
    const listed = (await api.get<RunListItem[]>('/api/runs')).body;
    expect(listed.find((r) => r.runId === runId)?.project).toEqual({
      id: d.project!.id,
      name: d.project!.name,
    });
    expect((await api.get('/api/portfolio/nope')).status).toBe(404);
    // The folder is recognised before another run starts; one that was never part of it is not.
    const known = (
      await api.post<FolderCheck>('/api/folders/inspect', { path: dir, purpose: 'existing' })
    ).body;
    expect(known.project).toEqual({ id: d.project!.id, name: d.project!.name });
    const other = await seedAdoptRepo(h, 'flutter-app');
    const fresh = (
      await api.post<FolderCheck>('/api/folders/inspect', { path: other.dir, purpose: 'existing' })
    ).body;
    expect(fresh.project).toBeNull();
  });

  it('takes the owner corrections at review and comes back with a new plan and brief (plan 021)', async () => {
    const { api, h } = await boot({ enhance: 'review-changes' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    // A run that is not at review refuses corrections.
    const waiting = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
      })
    ).body.runId;
    await until(api, waiting, (x) => !x.busy && x.parked?.reason === 'needs_request');
    expect((await api.post(`/api/runs/${waiting}/changes`, { text: 'x' })).status).toBe(409);

    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
      })
    ).body;
    const first = await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    expect((await api.post(`/api/runs/${runId}/changes`, { text: '   ' })).status).toBe(422);
    expect((await api.post(`/api/runs/${runId}/changes`, {})).status).toBe(400);
    const sent = await api.post(`/api/runs/${runId}/changes`, {
      text: 'Also let kitchen staff filter the export by date.',
    });
    expect(sent.status).toBe(200);
    const second = await until(
      api,
      runId,
      (x) => !x.busy && x.parked?.state === 'REVIEW' && x.rev > first.rev,
    );
    expect(second.parked?.state).toBe('REVIEW');
    const spec = (
      await api.get<{ spec: { intent: { coreFeatures: { id: string }[] } } }>(
        `/api/runs/${runId}/spec-diff`,
      )
    ).body.spec;
    expect(spec.intent.coreFeatures.map((f) => f.id)).toEqual(['export-orders', 'export-filter']);
    let brief = (await api.get<ReviewSummaryResponse>(`/api/runs/${runId}/review-summary`)).body;
    for (let i = 0; i < 100 && brief.status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 25));
      brief = (await api.get<ReviewSummaryResponse>(`/api/runs/${runId}/review-summary`)).body;
    }
    expect(brief).toMatchObject({
      status: 'ready',
      summary: { headline: expect.stringContaining('filtered by date') as string },
    });
  });

  it("says when an update run's repository moved on, and a refresh reads it again and asks to confirm the request (plan 027)", async () => {
    const { api, h } = await boot({ enhance: 'refresh' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
      })
    ).body;
    await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    const before = (await api.get<RepoStatus>(`/api/runs/${runId}/repo-status`)).body;
    expect(before).toMatchObject({ moved: false });
    const git = (args: string[]) => nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 });
    writeFileSync(path.join(dir, 'later.txt'), 'later\n');
    await git(['add', '-A']);
    await git([
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-q',
      '-m',
      'later',
    ]);
    const moved = (await api.get<RepoStatus>(`/api/runs/${runId}/repo-status`)).body;
    expect(moved).toMatchObject({ moved: true, recorded: before.recorded, commits: 1 });
    expect((await api.post(`/api/runs/${runId}/refresh`)).status).toBe(200);
    const asked = await until(api, runId, (x) => !x.busy && x.parked?.reason === 'needs_request');
    expect(asked.parked?.evidence).toEqual({ previous: REQUEST });
    expect(asked.enhance?.request).toBe('');
    expect(asked.carriedQuestions).toBe(false);
    const after = (await api.get<RepoStatus>(`/api/runs/${runId}/repo-status`)).body;
    expect(after).toMatchObject({ moved: false, recorded: moved.current });
    expect((await api.get('/api/runs/20200101-000000-aaaaaa/repo-status')).status).toBe(404);
  });

  it('marks the earlier questions asked again after a refresh as carried (plan 027)', async () => {
    const { api, h } = await boot({ enhance: 'refresh-questions' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
      })
    ).body;
    const first = await until(api, runId, (x) => !x.busy && x.parked?.state === 'CLARIFY');
    expect(first.carriedQuestions).toBe(false);
    const answers = first.questions!.map((q) => ({
      key: q.key,
      value: q.options.find((o) => o.recommended)!.value,
    }));
    expect((await api.post(`/api/runs/${runId}/answers`, { answers })).status).toBe(200);
    await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    const git = (args: string[]) => nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 });
    writeFileSync(path.join(dir, 'later.txt'), 'later\n');
    await git(['add', '-A']);
    await git([
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-q',
      '-m',
      'later',
    ]);
    expect((await api.post(`/api/runs/${runId}/refresh`)).status).toBe(200);
    await until(api, runId, (x) => !x.busy && x.parked?.reason === 'needs_request');
    expect((await api.post(`/api/runs/${runId}/request`, { narrative: REQUEST })).status).toBe(200);
    const again = await until(api, runId, (x) => !x.busy && x.parked?.state === 'CLARIFY');
    expect(again).toMatchObject({ round: 0, carriedQuestions: true });
    expect(again.questions?.map((q) => q.key)).toEqual(answers.map((a) => a.key));
  });

  it('serves a plain-English review summary at REVIEW, and says what the scan found', async () => {
    const { api, h } = await boot({ enhance: 'review-summary' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
        noPublish: true,
      })
    ).body;
    const d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.state).toBe('REVIEW');
    expect(d.enhance?.stack).toMatchObject({ packed: true });
    type Res = { status: string; summary?: { headline: string; changes: string[] } };
    let res = (await api.get<Res>(`/api/runs/${runId}/review-summary`)).body;
    for (let i = 0; i < 100 && res.status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      res = (await api.get<Res>(`/api/runs/${runId}/review-summary`)).body;
    }
    expect(res.status).toBe('ready');
    expect(res.summary?.headline).toBe(
      'Buyers will be able to add a gift note when they check out.',
    );
    expect(res.summary?.changes).toHaveLength(1);
  });

  it('says the summary is unavailable before the plan is complete', async () => {
    const { api, h } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
      })
    ).body;
    await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect((await api.get<{ status: string }>(`/api/runs/${runId}/review-summary`)).body).toEqual({
      status: 'unavailable',
    });
  });

  it('takes the request with the start call, and lists the repository for "Enhance"', async () => {
    const { api, h } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
        withGaps: true,
        noPublish: true,
      })
    ).body;
    let d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.state).toBe('REVIEW');
    const tree = (await api.get<{ files: TreeFile[] }>(`/api/runs/${runId}/tree`)).body;
    expect(tree.files.find((f) => f.path === 'CLAUDE.md')?.status).toBe('create');
    expect((await api.post(`/api/runs/${runId}/approve`)).status).toBe(200);
    d = await until(api, runId, (x) => !x.busy && (x.done || x.state === 'PARKED'));
    expect(d.state).toBe('DONE');
    expect(d.enhance?.pr).toBeUndefined();
    expect(d.enhance?.plan?.gaps?.create).toContain('CLAUDE.md');
    const list = (await api.get<RunListItem[]>('/api/runs')).body;
    expect(list[0]).toMatchObject({ runId, kind: 'enhance', repo: dir, repoRef: 'octo/bare-node' });
  });
});

describe('folders, coding, and the commit and push requests over the API', () => {
  const tmpDir = (name: string) =>
    path.join(mkdtempSync(path.join(os.tmpdir(), `${name} `)), 'proj');
  const git = (args: string[], cwd: string) =>
    nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });

  beforeEach(() => {
    const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'webcfg ')), 'gitconfig');
    writeFileSync(cfg, '');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('FAKE_AGENT_MODE', 'edit');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('offers the folder dialog only when the host has one, one dialog at a time', async () => {
    const none = await boot();
    expect(
      (await none.api.get<{ capabilities: { pickFolder: boolean } }>('/api/session')).body
        .capabilities,
    ).toEqual({
      pickFolder: false,
    });
    expect((await none.api.post('/api/folders/pick', { purpose: 'new' })).status).toBe(501);

    let release: (p: string | null) => void = () => undefined;
    const asked: string[] = [];
    const { api } = await boot({
      host: {
        pickFolder: (purpose) => {
          asked.push(purpose);
          return new Promise((r) => (release = r));
        },
      },
    });
    expect(
      (await api.get<{ capabilities: { pickFolder: boolean } }>('/api/session')).body.capabilities
        .pickFolder,
    ).toBe(true);
    expect((await api.post('/api/folders/pick', { purpose: 'nope' })).status).toBe(400);
    const first = api.post<{ path: string | null }>('/api/folders/pick', { purpose: 'existing' });
    await vi.waitFor(() => expect(asked).toEqual(['existing']));
    expect((await api.post('/api/folders/pick', { purpose: 'new' })).status).toBe(409);
    release('/chosen/folder');
    expect((await first).body.path).toBe('/chosen/folder');
    const cancelled = api.post<{ path: string | null }>('/api/folders/pick', { purpose: 'new' });
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    release(null);
    expect((await cancelled).body.path).toBeNull();
  });

  it('explains a folder before a run starts', async () => {
    const { api } = await boot();
    const check = async (p: string, purpose: 'new' | 'existing') =>
      (await api.post<FolderCheck>('/api/folders/inspect', { path: p, purpose })).body;
    const fresh = tmpDir('inspect');
    expect(await check(fresh, 'new')).toMatchObject({ ok: true, exists: false });
    expect((await check('relative/path', 'new')).ok).toBe(false);
    expect((await check(path.dirname(fresh), 'existing')).problems.join(' ')).toContain(
      'not a git repository',
    );
    expect((await api.post('/api/folders/inspect', { path: fresh })).status).toBe(400);
  });

  it('a new solution in a chosen folder: discovery, review, publish, coding, then the owner commits and pushes', async () => {
    const { api, h } = await boot();
    const dir = tmpDir('web new');
    mkdirSync(path.dirname(dir), { recursive: true });
    writeFileSync(path.join(path.dirname(dir), 'x.txt'), '');
    // A folder that already has files is refused up front, with the reason.
    const busy = await api.post<{ error: string }>('/api/runs', {
      kind: 'new',
      narrative: 'Stockroom: stock tracking for cafés.',
      dir: path.dirname(dir),
    });
    expect(busy.status).toBe(422);
    expect(busy.body.error).toContain('not empty');

    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'new',
        narrative: 'Stockroom: stock tracking for cafés.',
        dir,
      })
    ).body;
    const first = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    const answer = (q: Question) => ({
      key: q.key,
      value: q.options.find((o) => o.recommended)!.value,
    });
    await api.post(`/api/runs/${runId}/answers`, { answers: first.questions!.map(answer) });
    await until(
      api,
      runId,
      (x) => !x.busy && x.state === 'PARKED' && x.parked?.state !== 'CLARIFY',
    );
    const spec = (
      await api.get<{ spec: { project: { owner: unknown } } }>(`/api/runs/${runId}/spec-diff`)
    ).body.spec;
    spec.project.owner = { type: 'user', login: 'octo' };
    await api.post(`/api/runs/${runId}/approve`, { spec });
    // The agent codes, then the run waits for the owner.
    let d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.error).toBeNull();
    expect(d.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(d.input.dir).toBe(dir);
    expect(d.finish).toMatchObject({
      stage: 'commit',
      branch: expect.stringContaining('incubator/build-') as string,
    });
    expect(d.finish!.files.map((f) => f.path)).toContain('src/agent-work.txt');
    expect(d.finish!.agent?.summary).toContain('Added src/agent-work.txt');
    expect(d.finish!.message.split('\n')[0]).toBe('feat: build Stockroom');
    // Answers are checked: nothing is waiting for a push yet.
    expect((await api.post(`/api/runs/${runId}/push`, { action: 'push' })).status).toBe(409);
    expect((await api.post(`/api/runs/${runId}/commit`, { action: 'sell' })).status).toBe(400);
    // Git must know who the owner is.
    await api.post(`/api/runs/${runId}/commit`, {
      action: 'commit',
      message: 'feat: stock tracking\n\nMine.',
    });
    d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.reason).toBe('no_git_identity');
    await git(['config', 'user.name', 'Owner Person'], dir);
    await git(['config', 'user.email', 'owner@example.invalid'], dir);
    await api.post(`/api/runs/${runId}/resume`);
    d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked).toMatchObject({ state: 'PUSH', reason: 'needs_push' });
    expect(d.finish).toMatchObject({
      stage: 'push',
      commit: { branch: expect.any(String) as string },
    });
    expect(d.finish!.files).toEqual([]);
    expect(d.finish!.target.repo).toEqual({ owner: 'octo', name: 'stockroom' });
    await api.post(`/api/runs/${runId}/push`, { action: 'push' });
    d = await until(api, runId, (x) => !x.busy && (x.done || x.state === 'PARKED'));
    expect(d.state).toBe('DONE');
    expect(d.finish?.pr?.url).toBe('https://github.com/octo/stockroom/pull/1');
    expect(h.github.repos.get('octo/stockroom')!.prs).toHaveLength(1);
    expect(existsSync(path.join(dir, '.git'))).toBe(true);
  });

  it('stops the coding agent on request, keeps what it wrote, then cancels the run for good', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'slow');
    const { api, h } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        dir,
        repoRef: 'octo/bare-node',
        request: 'Kitchen staff need to export the orders list as a CSV file.',
      })
    ).body;
    await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    // Nothing is running at review: there is nothing to stop.
    expect((await api.post(`/api/runs/${runId}/stop`)).status).toBe(409);
    await api.post(`/api/runs/${runId}/approve`);
    await until(
      api,
      runId,
      (x) => x.busy && x.finish?.stage === 'coding' && x.finish.progress !== null,
    );

    expect((await api.post<{ stopping: boolean }>(`/api/runs/${runId}/stop`)).body).toEqual({
      stopping: true,
    });
    let d = await until(api, runId, (x) => !x.busy);
    // The stop is not an error, and it is said who asked for it.
    expect(d.error).toBeNull();
    expect(d.stopped).toEqual({ by: 'owner', state: 'COMMIT' });
    expect(d.done).toBe(false);

    // Resumed, the run asks what to do with the half-finished work, and says the agent was stopped.
    await api.post(`/api/runs/${runId}/resume`);
    d = await until(api, runId, (x) => !x.busy && x.parked?.reason === 'needs_commit');
    expect(d.stopped).toBeNull();
    expect(d.finish?.agent?.verdict).toBe('stopped');
    expect(d.finish!.files.map((f) => f.path)).toContain('src/agent-partial.txt');
    expect(d.models.find((m) => m.job === 'coding')?.model).toBe('fake-agent-model');

    // Cancel ends it for good, touches no file, and cannot be undone by resuming.
    expect((await api.post(`/api/runs/${runId}/cancel`, { reason: 'not needed' })).status).toBe(
      200,
    );
    d = (await api.get<RunDetail>(`/api/runs/${runId}`)).body;
    expect(d).toMatchObject({ cancelled: true, done: true, busy: false });
    expect(existsSync(path.join(dir, 'src', 'agent-partial.txt'))).toBe(true);
    expect((await api.post(`/api/runs/${runId}/resume`)).status).toBe(409);
    expect((await api.post(`/api/runs/${runId}/cancel`)).status).toBe(409);
    expect((await api.post(`/api/runs/${runId}/stop`)).status).toBe(409);
    const listed = (await api.get<RunListItem[]>('/api/runs')).body;
    expect(listed.find((r) => r.runId === runId)?.cancelled).toBe(true);
    expect((await api.get<ProjectCard[]>('/api/portfolio')).body[0]?.latest).toMatchObject({
      state: 'CANCELLED',
      done: true,
    });
  });

  it('cancelling a run that is working stops it first, and closing the server stops what is running', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'slow');
    const { api, h } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        dir,
        repoRef: 'octo/bare-node',
        request: 'Kitchen staff need to export the orders list as a CSV file.',
      })
    ).body;
    await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    await api.post(`/api/runs/${runId}/approve`);
    await until(
      api,
      runId,
      (x) => x.busy && x.finish?.stage === 'coding' && x.finish.progress !== null,
    );
    expect((await api.post(`/api/runs/${runId}/cancel`)).status).toBe(200);
    expect((await api.get<RunDetail>(`/api/runs/${runId}`)).body).toMatchObject({
      cancelled: true,
      busy: false,
    });
  });

  it('closing the server stops what is running, and the journal says it was the app', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'slow');
    const { api, h, server } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        dir,
        repoRef: 'octo/bare-node',
        request: 'Kitchen staff need to export the orders list as a CSV file.',
      })
    ).body;
    await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    await api.post(`/api/runs/${runId}/approve`);
    await until(
      api,
      runId,
      (x) => x.busy && x.finish?.stage === 'coding' && x.finish.progress !== null,
    );
    await server.close();
    expect(h.engine.state(runId).stopped?.by).toBe('shutdown');
    expect(h.engine.activeRuns()).toEqual([]);
  });

  it("an update in the owner's folder is refused while it has uncommitted work", async () => {
    const { api, h } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    writeFileSync(path.join(dir, 'half-done.txt'), 'wip\n');
    const refused = await api.post<{ error: string }>('/api/runs', {
      kind: 'enhance',
      dir,
      request: 'x',
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toContain('uncommitted change');
    await import('node:fs').then((fs) => fs.rmSync(path.join(dir, 'half-done.txt')));
    await git(['config', 'user.name', 'Owner Person'], dir);
    await git(['config', 'user.email', 'owner@example.invalid'], dir);
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        dir,
        repoRef: 'octo/bare-node',
        request: 'Kitchen staff need to export the orders list as a CSV file.',
      })
    ).body;
    let d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.state).toBe('REVIEW');
    await api.post(`/api/runs/${runId}/approve`);
    d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(d.finish!.branch).toBe('incubator/enhance-20260501');
    expect(d.finish!.target.repo).toEqual({ owner: 'octo', name: 'bare-node' });
    await api.post(`/api/runs/${runId}/commit`, { action: 'leave' });
    d = await until(api, runId, (x) => !x.busy && (x.done || x.state === 'PARKED'));
    expect(d.state).toBe('DONE');
    expect(d.finish?.commit).toMatchObject({ left: true });
    expect((await git(['status', '--porcelain'], dir)).stdout).toContain('src/agent-work.txt');
  });
});

describe('run events (SSE)', () => {
  it('replays the journal, resumes after Last-Event-ID and streams status; the token never appears', async () => {
    const { server, api, h } = await boot({ heartbeatMs: 20 });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'adopt',
        repo: dir,
        repoRef: 'octo/bare-node',
      })
    ).body;
    await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    const read = async (headers: Record<string, string>) => {
      const ac = new AbortController();
      const r = await fetch(`${server.origin}/api/runs/${runId}/events`, {
        headers: { cookie: api.cookie, ...headers },
        signal: ac.signal,
      });
      expect(r.headers.get('content-type')).toContain('text/event-stream');
      const reader = r.body!.getReader();
      let text = '';
      while (!text.includes(': keep-alive'))
        text += new TextDecoder().decode((await reader.read()).value);
      ac.abort();
      return text;
    };
    const all = await read({});
    const ids = [...all.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBe(1);
    expect(all).toContain('event: status');
    const entries = [...all.matchAll(/^data: (\{.*\})$/gm)].map(
      (m) => JSON.parse(m[1]!) as LogEntry,
    );
    expect(entries.some((e) => e.type === 'park')).toBe(true);
    const tail = await read({ 'last-event-id': String(ids.at(-2)) });
    expect([...tail.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]))).toEqual([ids.at(-1)]);
    expect(all).not.toContain(FAKE_GITHUB_TOKEN);
    expect(all).not.toContain(server.url.split('t=')[1]);
  });
});

describe('helpers', () => {
  it('diffs specs by JSON pointer', () => {
    expect(specDiff({ a: { b: 1, c: [1] }, 'x/y': 1 }, { a: { b: 2, c: [1], d: 'n' } })).toEqual([
      { pointer: '/a/b', op: 'replace', before: 1, after: 2 },
      { pointer: '/a/d', op: 'add', after: 'n' },
      { pointer: '/x~1y', op: 'remove', before: 1 },
    ]);
    expect(specDiff({}, { a: 1 })).toEqual([{ pointer: '/a', op: 'add', after: 1 }]);
  });

  it('serves UI assets confined to the UI directory', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ui-'));
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    writeFileSync(path.join(root, 'assets', 'app.js'), 'x');
    writeFileSync(path.join(path.dirname(root), 'secret.txt'), 's');
    expect(resolveAsset(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveAsset(root, '/../secret.txt')).toBeNull();
    expect(resolveAsset(root, '/%2e%2e/secret.txt')).toBeNull();
    expect(resolveAsset(root, '/%E0%A4%A')).toBeNull();
    expect(readAsset(root, '/runs/abc')?.type).toBe('text/html; charset=utf-8');
    expect(readAsset(root, '/assets/missing.js')).toBeNull();
    expect(readAsset(path.join(root, 'none'), '/')).toBeNull();
  });
});

describe('retrieved stacks over the API (ADR-027)', () => {
  const stackFixtures = path.resolve(
    import.meta.dirname,
    '../../../../packages/core/fixtures/stacks/flutter-create',
  );
  const emptyDir = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'stack ')), 'club');

  beforeEach(() => {
    const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'webcfg ')), 'gitconfig');
    writeFileSync(cfg, '');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists the catalog and says whether the stack’s tool is installed', async () => {
    const { api } = await boot();
    const list = (await api.get<{ id: string; kind: string; install?: string }[]>('/api/stacks'))
      .body;
    expect(
      list
        .filter((s) => s.kind === 'built-in')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['node-lib', 'node-web', 'python-service', 'wordpress']);
    expect(list.find((s) => s.id === 'flutter')).toMatchObject({
      kind: 'retrieved',
      install: 'https://docs.flutter.dev/get-started/install',
    });
    expect(
      (await api.post<{ ok: boolean; version: string }>('/api/stacks/probe', { stack: 'flutter' }))
        .body,
    ).toMatchObject({ ok: true, version: 'Flutter 3.99.0 • channel stable' });
    // A built-in stack has no generator to probe.
    expect(
      (await api.post('/api/stacks/probe', { stack: 'node-web' })).status,
    ).toBeGreaterThanOrEqual(400);
    const missing = await boot({ stacks: { installed: false } });
    expect(
      (
        await missing.api.post<{ ok: boolean; reason: string }>('/api/stacks/probe', {
          stack: 'flutter',
        })
      ).body,
    ).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('recommends a stack from the catalog for an idea', async () => {
    const { api } = await boot({ fixtureDir: stackFixtures });
    const r = (
      await api.post<{ status: string; recommendation: { stack: string; reasons: string[] } }>(
        '/api/stacks/recommend',
        { idea: 'A club event sign-up app for phones and the web' },
      )
    ).body;
    expect(r.status).toBe('ready');
    expect(r.recommendation.stack).toBe('flutter');
    expect((await api.post('/api/stacks/recommend', { idea: '' })).status).toBe(400);
  });

  it('creates the project with the generator, commits it, then plans the idea as an update', async () => {
    const { api, stackCalls } = await boot({ fixtureDir: stackFixtures });
    const dir = emptyDir();
    // The wizard asks for a recommendation first (the first recorded turn).
    await api.post('/api/stacks/recommend', { idea: 'A club event sign-up app' });
    const made = (
      await api.post<{ status: string; commit: string; files: number }>('/api/stacks/create', {
        stack: 'flutter',
        dir,
        name: 'Club Events',
      })
    ).body;
    expect(made).toMatchObject({ status: 'created', files: 5 });
    expect(stackCalls.find((c) => c.args[0] === 'create')?.args).toContain('club_events');
    expect(stackCalls.find((c) => c.args[0] === 'create')?.args).toContain('com.example');
    const git = await nodeExec.run('git', ['log', '--format=%s'], { cwd: dir, timeoutMs: 30_000 });
    expect(git.stdout.trim()).toBe('chore: flutter create');

    // The owner's idea is the change request; the existing update workflow takes over.
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        dir,
        request: 'A club event sign-up app: list events, sign up, and see who is coming.',
      })
    ).body;
    const d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.parked?.state).toBe('REVIEW');
    expect(d.enhance?.stack).toMatchObject({ label: 'Dart/Flutter', packed: false });
    expect(d.enhance?.checks?.proposed.map((c) => c.command)).toEqual([
      'flutter analyze',
      'flutter test',
    ]);
  });

  it('refuses a folder that already holds files, and says when the tool is missing', async () => {
    const { api, stackCalls } = await boot({ stacks: { installed: false } });
    const dir = emptyDir();
    const r = (
      await api.post<{ status: string; probe: { install: string } }>('/api/stacks/create', {
        stack: 'flutter',
        dir,
        name: 'Club',
      })
    ).body;
    expect(r.status).toBe('missing');
    expect(r.probe.install).toBe('https://docs.flutter.dev/get-started/install');
    expect(existsSync(dir)).toBe(false);
    expect(stackCalls).toEqual([]);

    const full = emptyDir();
    mkdirSync(full, { recursive: true });
    writeFileSync(path.join(full, 'mine.txt'), 'mine');
    const refused = await api.post('/api/stacks/create', {
      stack: 'flutter',
      dir: full,
      name: 'Club',
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(readFileSync(path.join(full, 'mine.txt'), 'utf8')).toBe('mine');
  });
});

describe('settings over the API (ADR-029)', () => {
  it('shows what the next run uses, saves a choice, refuses a bad one, and never carries a secret', async () => {
    const { api, h, server } = await boot();
    const first = (await api.get<SettingsView>('/api/settings')).body;
    expect(first.effective.planning).toEqual({ tool: 'claude-cli', model: null });
    expect(first.adapters.map((a) => a.id)).toContain('claude-cli');
    expect(first.credentials.find((c) => c.account === 'github')).toEqual({
      account: 'github',
      source: 'env',
    });
    // Only a source is ever shown: no value of any account appears in the body.
    expect(JSON.stringify(first)).not.toContain(FAKE_GITHUB_TOKEN);

    const saved = await api.put<SettingsView>('/api/settings', {
      planning: { model: 'opus' },
      coding: { agent: 'claude', model: 'claude-sonnet-5-5' },
      limits: { gcDays: 7 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.chosen.coding).toEqual({ agent: 'claude', model: 'claude-sonnet-5-5' });
    expect(saved.body.effective.planning).toEqual({ tool: 'claude-cli', model: 'opus' });
    const file = JSON.parse(readFileSync(path.join(h.home, 'config.json'), 'utf8')) as unknown;
    expect(file).toEqual({
      llm: { cliModel: 'opus' },
      agents: { primary: 'claude', model: 'claude-sonnet-5-5' },
      gc: { days: 7 },
    });

    // A bad id and unknown keys are refused, and the file is unchanged.
    for (const body of [
      { coding: { model: '--evil' } },
      { toolPaths: { flutter: 'relative' } },
      { limits: { gcDays: 0 } },
    ]) {
      const r = await api.put<{ error: string }>('/api/settings', body);
      expect([400, 422], JSON.stringify(body)).toContain(r.status);
    }
    expect(JSON.parse(readFileSync(path.join(h.home, 'config.json'), 'utf8'))).toEqual(file);
    // A key the page does not know is dropped by the schema, not written.
    expect((await api.put('/api/settings', { nonsense: true })).status).toBe(200);
    expect(JSON.parse(readFileSync(path.join(h.home, 'config.json'), 'utf8'))).toEqual(file);

    // The same guard as every other change: no CSRF header, no write.
    const noCsrf = await fetch(`${server.origin}/api/settings`, {
      method: 'PUT',
      headers: { cookie: api.cookie, origin: server.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ limits: { gcDays: 1 } }),
    });
    expect(noCsrf.status).toBe(403);
  });

  it('lists which tool and model did the work of a run', async () => {
    const { api, h } = await boot({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: 'Kitchen staff need to export the orders list as a CSV file.',
      })
    ).body;
    const d = await until(api, runId, (x) => !x.busy && x.state === 'PARKED');
    expect(d.models.map((m) => m.job).sort()).toEqual(['analysis', 'planning']);
  });
});
