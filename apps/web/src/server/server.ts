import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  IncubatorError,
  Logger,
  ParkError,
  PolicyError,
  ToolError,
  formatError,
} from '@incubator/runtime';
import { INCUBATOR_VERSION, type Engine, type JournalEntry, type RunStore } from '@incubator/core';
import type { IncubatorSpec } from '@incubator/spec';
import type { RunDetail, RunListItem, StartRunBody } from '../api-types.js';
import { ConflictError, RunDriver } from './driver.js';
import { expectedOrigin } from './origin.js';
import { CSRF_HEADER, Guard, SECURITY_HEADERS } from './security.js';
import { specDiff } from './spec-diff.js';
import { defaultUiDir, readAsset } from './static.js';

export interface ServerOptions {
  engine: Engine;
  store: RunStore;
  log?: Logger;
  /** The built UI; defaults to this package's dist/ui. */
  uiDir?: string;
  /** Fixed launch token (tests); a random 32-byte token otherwise. */
  token?: string;
  /** SSE keep-alive interval. */
  heartbeatMs?: number;
}

export interface WebApp {
  app: FastifyInstance;
  guard: Guard;
  driver: RunDriver;
}

const REPO_REF = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

function statusFor(err: unknown): number {
  if (err instanceof ConflictError) return 409;
  if (err instanceof ParkError) return 422;
  if (err instanceof ToolError && err.code === 'no_run') return 404;
  if (err instanceof ToolError && err.code === 'bad_run_id') return 400;
  if (err instanceof PolicyError) return 422;
  return 500;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const status = statusFor(err);
  const body: Record<string, unknown> = {
    error: err instanceof IncubatorError ? err.message : formatError(err),
  };
  if (err instanceof ParkError && err.evidence !== undefined) body['evidence'] = err.evidence;
  return reply.code(status).send(body);
}

function title(engine: Engine, runId: string): string {
  const s = engine.state(runId);
  const text = s.input.kind === 'adopt' ? (s.input.repo ?? '') : (s.input.narrative ?? '');
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Builds the app without listening (tests use `inject`); `startServer` binds it to loopback. */
export function createApp(opts: ServerOptions): WebApp {
  const { engine, store } = opts;
  const log = opts.log ?? new Logger([]);
  const guard = new Guard(opts.token);
  const driver = new RunDriver(engine, log);
  const uiDir = opts.uiDir ?? defaultUiDir();
  const app = Fastify({ logger: false, forceCloseConnections: true, bodyLimit: 1024 * 1024 });

  app.addHook('onRequest', async (req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) void reply.header(k, v);
    const verdict = guard.check({
      method: req.method,
      path: req.url.split('?')[0]!,
      query: req.query as Record<string, unknown>,
      headers: req.headers,
    });
    if (verdict.kind === 'deny') return reply.code(verdict.status).send({ error: verdict.error });
    if (verdict.kind === 'bootstrap')
      return reply
        .header('set-cookie', verdict.cookie)
        .header('cache-control', 'no-store')
        .redirect('/', 302);
    (req as unknown as { session: string }).session = verdict.session;
    if (req.url.startsWith('/api/')) void reply.header('cache-control', 'no-store');
  });

  app.get('/api/session', (req) => ({
    csrf: guard.csrfFor((req as unknown as { session: string }).session),
    version: INCUBATOR_VERSION,
  }));

  app.get('/api/runs', (): RunListItem[] =>
    store
      .list()
      .reverse()
      .slice(0, 50)
      .flatMap((runId) => {
        try {
          const s = engine.state(runId);
          return [
            {
              runId,
              kind: s.input.kind,
              state: s.state,
              done: s.done,
              parked: s.parked?.reason ?? null,
              title: title(engine, runId),
            },
          ];
        } catch {
          return [];
        }
      }),
  );

  app.post<{ Body: StartRunBody }>(
    '/api/runs',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: {
            kind: { enum: ['new', 'adopt'] },
            narrative: { type: 'string', maxLength: 20000 },
            repo: { type: 'string', minLength: 1, maxLength: 2000 },
            repoRef: { type: 'string', maxLength: 200 },
            org: { type: 'boolean' },
            noPublish: { type: 'boolean' },
          },
        },
      },
    },
    (req, reply) => {
      const b = req.body;
      if (b.kind === 'new') {
        if (!b.narrative?.trim())
          return reply.code(400).send({ error: 'describe the project first' });
        return reply
          .code(202)
          .send({ runId: driver.start({ kind: 'new', narrative: b.narrative }) });
      }
      if (!b.repo?.trim())
        return reply.code(400).send({ error: 'a repository URL or path is needed' });
      let repoRef: { owner: string; name: string } | undefined;
      if (b.repoRef) {
        const m = REPO_REF.exec(b.repoRef.trim());
        if (!m) return reply.code(400).send({ error: 'repository must be owner/name' });
        repoRef = { owner: m[1]!, name: m[2]! };
      }
      const runId = driver.start({
        kind: 'adopt',
        repo: b.repo.trim(),
        ...(repoRef ? { repoRef } : {}),
        ...(b.org ? { ownerType: 'org' as const } : {}),
        ...(b.noPublish ? { noPublish: true } : {}),
      });
      return reply.code(202).send({ runId });
    },
  );

  const withRun =
    <T>(fn: (runId: string, req: T) => unknown) =>
    async (req: T & { params: unknown }, reply: FastifyReply) => {
      try {
        const out = await fn((req.params as { id: string }).id, req);
        return out === undefined ? reply.code(204).send() : out;
      } catch (err) {
        return sendError(reply, err);
      }
    };

  app.get(
    '/api/runs/:id',
    withRun((runId): RunDetail => {
      const s = engine.state(runId);
      const st = driver.status(runId);
      return {
        runId,
        kind: s.input.kind,
        state: s.state,
        done: s.done,
        busy: st.busy,
        error: st.error,
        input: {
          ...(s.input.narrative !== undefined ? { narrative: s.input.narrative } : {}),
          ...(s.input.repo !== undefined ? { repo: s.input.repo } : {}),
          ...(s.input.repoRef ? { repoRef: s.input.repoRef } : {}),
        },
        parked: s.parked,
        questions:
          s.state === 'PARKED' && s.parked?.state === 'CLARIFY' ? s.pendingQuestions : null,
        round: s.round,
        rev: s.rev,
        specComplete: engine.finalSpec(runId) !== null,
        publish: engine.publishSummary(runId),
        adopt: s.input.kind === 'adopt' ? engine.adoptSummary(runId) : null,
      };
    }),
  );

  app.get(
    '/api/runs/:id/revisions',
    withRun((runId) => engine.revisions(runId)),
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/runs/:id/spec-diff',
    withRun((runId, req: { query: { from?: string; to?: string } }) => {
      const revs = engine.revisions(runId).map((r) => r.rev);
      const last = revs.at(-1) ?? 0;
      const num = (v: string | undefined, d: number) => {
        const n = v === undefined ? d : Number(v);
        if (!Number.isInteger(n) || (n !== 0 && !revs.includes(n)))
          throw new PolicyError(`no spec revision ${v}`, { code: 'bad_revision' });
        return n;
      };
      const to = num(req.query.to, last);
      const from = num(req.query.from, Math.max(0, to - 1));
      const read = (r: number) => (r === 0 ? {} : engine.specRevision(runId, r));
      return { from, to, changes: specDiff(read(from), read(to)), spec: read(to) };
    }),
  );

  app.get(
    '/api/runs/:id/tree',
    withRun(async (runId) => {
      const p = await engine.preview(runId);
      if (!p) throw new ConflictError('the spec is not complete yet; the tree appears at REVIEW');
      return p;
    }),
  );

  app.get<{ Querystring: { path?: string } }>(
    '/api/runs/:id/file',
    withRun(async (runId, req: { query: { path?: string } }) => {
      const p = req.query.path ?? '';
      const bytes = await engine.previewFile(runId, p);
      if (!bytes) throw new ToolError(`no rendered file ${p}`, { code: 'no_run' });
      const binary = bytes.includes(0);
      return { path: p, binary, text: binary ? null : bytes.toString('utf8') };
    }),
  );

  app.post<{ Body: { answers: { key: string; value: string }[] } }>(
    '/api/runs/:id/answers',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['answers'],
          properties: {
            answers: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['key', 'value'],
                properties: {
                  key: { type: 'string', maxLength: 200 },
                  value: { type: 'string', maxLength: 2000 },
                },
              },
            },
          },
        },
      },
    },
    withRun((runId, req: { body: { answers: { key: string; value: string }[] } }) => {
      driver.answer(runId, req.body.answers);
      return { accepted: true };
    }),
  );

  app.post<{ Body: { spec?: IncubatorSpec } }>(
    '/api/runs/:id/approve',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { spec: { type: 'object' } },
        },
      },
    },
    withRun((runId, req: { body: { spec?: IncubatorSpec } | undefined }) => {
      driver.approve(runId, req.body?.spec);
      return { accepted: true };
    }),
  );

  for (const route of ['resume', 'publish'])
    app.post(
      `/api/runs/:id/${route}`,
      withRun((runId) => {
        driver.resume(runId);
        return { accepted: true };
      }),
    );

  app.post(
    '/api/runs/:id/handoff',
    withRun(async (runId) => {
      const { plan, ticket } = await engine.prepareHandoff(runId);
      return { bin: plan.bin, argv: plan.argv, cwd: plan.cwd, ceilings: plan.ceilings, ticket };
    }),
  );

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', (req, reply) => {
    const runId = req.params.id;
    let entries: JournalEntry[];
    try {
      entries = engine.entries(runId);
    } catch (err) {
      return sendError(reply, err);
    }
    const lastHeader = req.headers['last-event-id'];
    let last = Number(Array.isArray(lastHeader) ? lastHeader[0] : (lastHeader ?? 0)) || 0;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    const send = (e: JournalEntry) => {
      if (e.seq <= last) return;
      last = e.seq;
      res.write(`id: ${e.seq}\nevent: entry\ndata: ${JSON.stringify(e)}\n\n`);
    };
    // why: replay and subscribe in one synchronous block, so no journal entry falls in between.
    for (const e of entries) send(e);
    const offEntry = engine.on((ev) => {
      if (ev.runId === runId) send(ev.entry);
    });
    const offStatus = driver.on((s) => {
      if (s.runId === runId) res.write(`event: status\ndata: ${JSON.stringify(s)}\n\n`);
    });
    res.write(`event: status\ndata: ${JSON.stringify(driver.status(runId))}\n\n`);
    const beat = setInterval(() => res.write(': keep-alive\n\n'), opts.heartbeatMs ?? 15_000);
    req.raw.on('close', () => {
      clearInterval(beat);
      offEntry();
      offStatus();
    });
  });

  app.get('/api/*', (_req, reply) => reply.code(404).send({ error: 'not found' }));

  app.get('/*', (req, reply) => {
    const asset = readAsset(uiDir, req.url);
    if (!asset)
      return reply
        .code(404)
        .type('text/plain; charset=utf-8')
        .send('Not found. (Is the UI built? pnpm --filter @incubator/web build:ui)');
    return reply.type(asset.type).send(asset.body);
  });

  app.setErrorHandler((err: { statusCode?: number; message: string }, _req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) log.error(`web server error: ${err.message}`);
    return reply.code(status).send({ error: status === 500 ? 'internal error' : err.message });
  });

  return { app, guard, driver };
}

export interface RunningServer extends WebApp {
  /** Loopback origin, e.g. http://127.0.0.1:52341 */
  origin: string;
  /** The launch URL with the single-use token (hand it to the browser, never log it). */
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Binds 127.0.0.1 on a random free port (TDD §9.1). */
export async function startServer(opts: ServerOptions & { port?: number }): Promise<RunningServer> {
  const web = createApp(opts);
  await web.app.listen({ host: '127.0.0.1', port: opts.port ?? 0 });
  const addr = web.app.server.address();
  if (!addr || typeof addr === 'string') throw new ToolError('the server did not bind a TCP port');
  web.guard.port = addr.port;
  const origin = expectedOrigin(addr.port);
  return {
    ...web,
    origin,
    port: addr.port,
    url: `${origin}/?t=${web.guard.launchToken!}`,
    close: () => web.app.close(),
  };
}

export { CSRF_HEADER };
