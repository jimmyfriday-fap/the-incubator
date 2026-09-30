import path from 'node:path';
import {
  discoveryFixtureDir,
  enhanceFixtureDir,
  fakePublishEngine,
  seedExistingRepo,
} from '@incubator/core/testing';
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
  opts: { discovery?: string; enhance?: string; uiDir?: string; heartbeatMs?: number } = {},
): Promise<{ server: RunningServer; h: FakeHarness }> {
  // One fake model per server: recorded turns for a new project, or for an enhancement request.
  const h = fakePublishEngine({
    llm: {
      dir: opts.enhance
        ? enhanceFixtureDir(opts.enhance)
        : discoveryFixtureDir(opts.discovery ?? 'saas-web'),
    },
  });
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
  return seedExistingRepo(h.github, fixture, path.join(ANALYZER_FIXTURES, fixture));
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
