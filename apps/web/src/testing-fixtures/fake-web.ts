import { cpSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nodeExec } from '@incubator/runtime';
import { discoveryFixtureDir, fakePublishEngine } from '@incubator/core/testing';
import { startServer, type RunningServer } from '../server/server.js';

export const ANALYZER_FIXTURES = path.resolve(
  import.meta.dirname,
  '../../../../packages/analyzer/fixtures',
);

export type FakeHarness = ReturnType<typeof fakePublishEngine>;

/**
 * The web server on fakes only (test entry point; nothing here is reachable from the shipped CLI):
 * recorded discovery turns, an in-memory GitHub backed by bare repositories, real git, a passing
 * verifier and a fake tracker.
 */
export async function startFakeServer(
  opts: { discovery?: string; uiDir?: string; heartbeatMs?: number } = {},
): Promise<{ server: RunningServer; h: FakeHarness }> {
  const h = fakePublishEngine({ llm: { dir: discoveryFixtureDir(opts.discovery ?? 'saas-web') } });
  const server = await startServer({
    engine: h.engine,
    store: h.store,
    ...(opts.uiDir ? { uiDir: opts.uiDir } : {}),
    ...(opts.heartbeatMs ? { heartbeatMs: opts.heartbeatMs } : {}),
  });
  return { server, h };
}

/** An existing project in a local git repository whose origin is a repository on the fake GitHub. */
export async function seedAdoptRepo(
  h: FakeHarness,
  fixture: string,
): Promise<{ dir: string; ref: { owner: string; name: string } }> {
  const ref = { owner: 'octo', name: fixture };
  await h.github.createRepo({
    ...ref,
    ownerType: 'user',
    visibility: 'private',
    description: 'existing project',
  });
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'web-adopt-')), fixture);
  cpSync(path.join(ANALYZER_FIXTURES, fixture), dir, {
    recursive: true,
    filter: (s) => !s.endsWith('expected-gap-report.json'),
  });
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
    ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'existing'],
    ['remote', 'add', 'origin', h.github.remoteUrl(ref)],
    ['push', '-q', 'origin', 'HEAD:refs/heads/main'],
  ]) {
    const r = await nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  }
  return { dir, ref };
}

/** A logged-in API client for tests: exchanges the launch token for the session cookie and CSRF. */
export async function apiClient(server: RunningServer) {
  const boot = await fetch(server.url, { redirect: 'manual' });
  const cookie = boot.headers.get('set-cookie')!.split(';')[0]!;
  const base = { cookie, origin: server.origin };
  const session = (await (
    await fetch(`${server.origin}/api/session`, { headers: base })
  ).json()) as {
    csrf: string;
  };
  const headers = { ...base, 'x-incubator-csrf': session.csrf, 'content-type': 'application/json' };
  return {
    cookie,
    csrf: session.csrf,
    get: async <T = unknown>(p: string): Promise<{ status: number; body: T }> => {
      const r = await fetch(`${server.origin}${p}`, { headers: base });
      return { status: r.status, body: (await r.json()) as T };
    },
    post: async <T = unknown>(
      p: string,
      body: unknown = {},
    ): Promise<{ status: number; body: T }> => {
      const r = await fetch(`${server.origin}${p}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return { status: r.status, body: (r.status === 204 ? null : await r.json()) as T };
    },
  };
}
