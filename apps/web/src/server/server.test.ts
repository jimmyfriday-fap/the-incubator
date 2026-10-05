import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_GITHUB_TOKEN } from '@incubator/core/testing';
import { nodeExec } from '@incubator/runtime';
import type {
  FolderCheck,
  LogEntry,
  Question,
  RunDetail,
  RunListItem,
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
