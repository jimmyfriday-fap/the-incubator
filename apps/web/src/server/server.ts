import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  IncubatorError,
  Logger,
  ParkError,
  PolicyError,
  ToolError,
  formatError,
} from '@incubator/runtime';
import {
  INCUBATOR_VERSION,
  type Engine,
  type FolderPurpose,
  type JournalEntry,
  type PortfolioProject,
  type RunStore,
  type Settings,
  type SettingsPatch as CoreSettingsPatch,
} from '@incubator/core';
import { STACK_CATALOG, type IncubatorSpec } from '@incubator/spec';
import type {
  ProjectBrief,
  ProjectCard,
  ProjectDetail,
  RepoStatus,
  RunDetail,
  RunListItem,
  SettingsView,
  StackInfo,
  StartRunBody,
} from '../api-types.js';
import { ConflictError, RunDriver } from './driver.js';
import { expectedOrigin } from './origin.js';
import { CSRF_HEADER, Guard, SECURITY_HEADERS, parseCookies } from './security.js';
import { specDiff } from './spec-diff.js';
import { defaultUiDir, readAsset, stampTheme } from './static.js';

/**
 * Things only the embedding host can do for the page (ADR-022). The renderer never reaches the
 * operating system itself: it asks over HTTP, behind the same token, Origin and CSRF checks as the rest.
 */
export interface HostCapabilities {
  /** Opens the operating system's folder dialog; null when the owner cancels. */
  pickFolder?: (purpose: FolderPurpose) => Promise<string | null>;
}

export interface ServerOptions {
  engine: Engine;
  store: RunStore;
  log?: Logger;
  host?: HostCapabilities;
  /** The Settings page; without it the page says settings are unavailable. */
  settings?: Settings;
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
  const text =
    s.input.kind === 'adopt' || s.input.kind === 'enhance'
      ? (s.input.repo ?? '')
      : (s.input.narrative ?? '');
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

  // why: closing the app must not leave a model call or the coding agent running with nobody watching.
  app.addHook('onClose', async () => {
    await driver.stopAll('shutdown');
  });

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
    capabilities: { pickFolder: Boolean(opts.host?.pickFolder) },
  }));

  // One dialog at a time: a second click while a dialog is open must not stack another.
  let picking = false;
  app.post<{ Body: { purpose: FolderPurpose } }>(
    '/api/folders/pick',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['purpose'],
          properties: { purpose: { enum: ['new', 'existing'] } },
        },
      },
    },
    async (req, reply) => {
      const pick = opts.host?.pickFolder;
      if (!pick) return reply.code(501).send({ error: 'this host cannot open a folder dialog' });
      if (picking) return reply.code(409).send({ error: 'a folder dialog is already open' });
      picking = true;
      try {
        return { path: await pick(req.body.purpose) };
      } catch (err) {
        return sendError(reply, err);
      } finally {
        picking = false;
      }
    },
  );

  app.post<{ Body: { path: string; purpose: FolderPurpose } }>(
    '/api/folders/inspect',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'purpose'],
          properties: {
            path: { type: 'string', maxLength: 2000 },
            purpose: { enum: ['new', 'existing'] },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        return await engine.inspectFolder(req.body.path, req.body.purpose);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // Retrieved stacks (ADR-027): the catalog, a recommendation for an idea, whether the stack's tool is
  // installed, and creating the project with the stack's own generator.
  app.get('/api/stacks', (): StackInfo[] =>
    STACK_CATALOG.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      summary: s.summary,
      platforms: [...s.platforms],
      ...(s.prerequisites?.[0] ? { install: s.prerequisites[0].install } : {}),
    })),
  );

  app.post<{ Body: { idea: string } }>(
    '/api/stacks/recommend',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['idea'],
          properties: { idea: { type: 'string', minLength: 1, maxLength: 4000 } },
        },
      },
    },
    async (req, reply) => {
      try {
        return await engine.stackRecommend(req.body.idea);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.post<{ Body: { stack: string } }>(
    '/api/stacks/probe',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['stack'],
          properties: { stack: { type: 'string', maxLength: 60 } },
        },
      },
    },
    async (req, reply) => {
      try {
        return await engine.stackProbe(req.body.stack);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.post<{ Body: { stack: string; dir: string; name: string; org?: string } }>(
    '/api/stacks/create',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['stack', 'dir', 'name'],
          properties: {
            stack: { type: 'string', maxLength: 60 },
            dir: { type: 'string', maxLength: 2000 },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            org: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        return await engine.stackCreate({ ...req.body, org: req.body.org ?? 'com.example' });
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // The portfolio (ADR-028): every project the Incubator has worked on, and the runs on each.
  const brief = (p: PortfolioProject): ProjectBrief => ({
    id: p.id,
    name: p.name,
    summary: p.summary,
    stack: p.stack,
    repo: { dir: p.repo.dir, url: p.repo.url },
    runCount: p.runs.length,
  });

  app.get('/api/portfolio', (): ProjectCard[] =>
    engine.portfolioList().map((p) => ({
      ...brief(p),
      origin: p.origin,
      updatedAt: p.updatedAt,
      latest: p.runs[0]
        ? {
            runId: p.runs[0].runId,
            kind: p.runs[0].kind,
            state: p.runs[0].state,
            done: p.runs[0].done,
            startedAt: p.runs[0].startedAt,
          }
        : null,
    })),
  );

  app.get<{ Params: { id: string } }>('/api/portfolio/:id', (req, reply): ProjectDetail | void => {
    const p = engine.portfolioGet(req.params.id);
    if (!p) return void reply.code(404).send({ error: 'no such project' });
    const onDisk = new Set(store.list());
    return {
      ...brief(p),
      origin: p.origin,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      repo: { dir: p.repo.dir, url: p.repo.url, remote: p.repo.remote },
      runs: p.runs.map((r) => ({ ...r, available: onDisk.has(r.runId) })),
    };
  });

  // Settings (ADR-029): what the next run will use, and the choices the owner can change. Accounts are shown
  // as a source only; a secret never travels over this API.
  const nullableString = (max: number) => ({ type: ['string', 'null'], maxLength: max });
  app.get('/api/settings', async (_req, reply): Promise<SettingsView | FastifyReply> => {
    if (!opts.settings) return reply.code(501).send({ error: 'settings are not available here' });
    try {
      return await opts.settings.view();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{ Body: CoreSettingsPatch }>(
    '/api/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            planning: {
              type: 'object',
              additionalProperties: false,
              properties: { tool: { type: 'string', maxLength: 30 }, model: nullableString(100) },
            },
            coding: {
              type: 'object',
              additionalProperties: false,
              properties: { agent: { type: 'string', maxLength: 30 }, model: nullableString(100) },
            },
            limits: {
              type: 'object',
              additionalProperties: false,
              properties: {
                timeoutSeconds: { type: ['number', 'null'] },
                gcDays: { type: ['number', 'null'] },
              },
            },
            toolPaths: {
              type: 'object',
              maxProperties: 20,
              additionalProperties: { type: 'string', maxLength: 1000 },
            },
          },
        },
      },
    },
    async (req, reply): Promise<SettingsView | FastifyReply> => {
      if (!opts.settings) return reply.code(501).send({ error: 'settings are not available here' });
      try {
        return await opts.settings.update(req.body);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.get('/api/runs', (): RunListItem[] =>
    store
      .list()
      .reverse()
      .slice(0, 200)
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
              repo: s.input.repo ?? null,
              repoRef: s.input.repoRef ? `${s.input.repoRef.owner}/${s.input.repoRef.name}` : null,
              dir: s.input.dir ?? null,
              cancelled: s.cancelled,
              project: ((p) => (p ? { id: p.id, name: p.name } : null))(
                engine.portfolioForRun(runId),
              ),
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
            kind: { enum: ['new', 'adopt', 'enhance'] },
            narrative: { type: 'string', maxLength: 20000 },
            request: { type: 'string', maxLength: 20000 },
            withGaps: { type: 'boolean' },
            dir: { type: 'string', minLength: 1, maxLength: 2000 },
            repo: { type: 'string', minLength: 1, maxLength: 2000 },
            repoRef: { type: 'string', maxLength: 200 },
            org: { type: 'boolean' },
            noPublish: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      if (b.kind === 'new') {
        if (!b.narrative?.trim())
          return reply.code(400).send({ error: 'describe the project first' });
        if (b.dir !== undefined) {
          const v = await engine.inspectFolder(b.dir, 'new');
          if (!v.ok) return reply.code(422).send({ error: v.problems.join(' '), evidence: v });
          return reply
            .code(202)
            .send({ runId: driver.start({ kind: 'new', narrative: b.narrative, dir: v.path }) });
        }
        return reply
          .code(202)
          .send({ runId: driver.start({ kind: 'new', narrative: b.narrative }) });
      }
      // An update names its folder in `dir`; the older adopt and URL forms name `repo`.
      let repo = b.repo;
      let dir: string | undefined;
      if (b.kind === 'enhance' && b.dir !== undefined) {
        const v = await engine.inspectFolder(b.dir, 'existing');
        if (!v.ok) return reply.code(422).send({ error: v.problems.join(' '), evidence: v });
        dir = v.path;
        repo = v.path;
      }
      if (!repo?.trim())
        return reply.code(400).send({ error: 'a repository URL or path is needed' });
      let repoRef: { owner: string; name: string } | undefined;
      if (b.repoRef) {
        const m = REPO_REF.exec(b.repoRef.trim());
        if (!m) return reply.code(400).send({ error: 'repository must be owner/name' });
        repoRef = { owner: m[1]!, name: m[2]! };
      }
      const runId = driver.start({
        kind: b.kind,
        repo: repo.trim(),
        ...(dir ? { dir } : {}),
        ...(repoRef ? { repoRef } : {}),
        ...(b.org ? { ownerType: 'org' as const } : {}),
        ...(b.noPublish ? { noPublish: true } : {}),
        ...(b.kind === 'enhance' && b.request?.trim() ? { request: b.request.trim() } : {}),
        ...(b.kind === 'enhance' && b.withGaps ? { withGaps: true } : {}),
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
    withRun(async (runId): Promise<RunDetail> => {
      const s = engine.state(runId);
      const st = driver.status(runId);
      return {
        runId,
        kind: s.input.kind,
        state: s.state,
        done: s.done,
        busy: st.busy,
        error: st.error ?? s.failure?.message ?? null,
        input: {
          ...(s.input.narrative !== undefined ? { narrative: s.input.narrative } : {}),
          ...(s.input.repo !== undefined ? { repo: s.input.repo } : {}),
          ...(s.input.repoRef ? { repoRef: s.input.repoRef } : {}),
          ...(s.input.dir !== undefined ? { dir: s.input.dir } : {}),
        },
        parked: s.parked,
        failure: s.failure,
        questions:
          s.state === 'PARKED' && s.parked?.state === 'CLARIFY' ? s.pendingQuestions : null,
        carriedQuestions: s.carriedQuestions,
        round: s.round,
        rev: s.rev,
        specComplete: engine.finalSpec(runId) !== null,
        publish: engine.publishSummary(runId),
        adopt: s.input.kind === 'adopt' ? engine.adoptSummary(runId) : null,
        enhance:
          s.input.kind === 'enhance'
            ? {
                ...engine.enhanceSummary(runId),
                request: engine.requestText(runId),
                checks: engine.checksDetail(runId),
              }
            : null,
        cancelled: s.cancelled,
        stopped: s.stopped,
        finish: await engine.finishDetail(runId),
        project: ((p) => (p ? brief(p) : null))(engine.portfolioForRun(runId)),
        models: engine.models(runId),
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

  app.get<{ Querystring: { retry?: string } }>(
    '/api/runs/:id/review-summary',
    withRun((runId, req: { query: { retry?: string } }) =>
      engine.reviewSummary(runId, { retry: req.query.retry === '1' }),
    ),
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

  app.post<{ Body: { narrative: string } }>(
    '/api/runs/:id/request',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['narrative'],
          properties: { narrative: { type: 'string', minLength: 1, maxLength: 20000 } },
        },
      },
    },
    withRun((runId, req: { body: { narrative: string } }) => {
      driver.request(runId, req.body.narrative);
      return { accepted: true };
    }),
  );

  // The owner's corrections at REVIEW (plan 021): only while the run waits at review.
  app.post<{ Body: { text: string } }>(
    '/api/runs/:id/changes',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } },
        },
      },
    },
    withRun((runId, req: { body: { text: string } }) => {
      driver.requestChanges(runId, req.body.text);
      return { accepted: true };
    }),
  );

  // Whether an update run's repository moved on since the run read it (plan 027). On a GitHub repository each call
  // asks GitHub (ls-remote), so the screens ask when the run settles, the page loads or the window regains focus,
  // never on a timer.
  app.get(
    '/api/runs/:id/repo-status',
    withRun((runId): Promise<RepoStatus> => engine.repoMoved(runId)),
  );

  // Reads an update run's repository again (plan 025): the owner then confirms what they asked for.
  app.post(
    '/api/runs/:id/refresh',
    withRun(async (runId) => {
      await driver.refresh(runId);
      return { accepted: true };
    }),
  );

  // The owner's decision on what the coding agent may run (ADR-025). An empty list is a decision.
  app.post<{ Body: { commands: string[] } }>(
    '/api/runs/:id/checks',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['commands'],
          properties: {
            commands: {
              type: 'array',
              maxItems: 32,
              items: { type: 'string', maxLength: 400 },
            },
          },
        },
      },
    },
    withRun((runId, req: { body: { commands: string[] } }) => ({
      commands: engine.submitChecks(runId, req.body.commands),
    })),
  );

  app.post<{ Body: { action: 'commit' | 'leave'; message?: string } }>(
    '/api/runs/:id/commit',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: { enum: ['commit', 'leave'] },
            message: { type: 'string', maxLength: 8000 },
          },
        },
      },
    },
    withRun((runId, req: { body: { action: 'commit' | 'leave'; message?: string } }) => {
      driver.commit(runId, req.body);
      return { accepted: true };
    }),
  );

  app.post<{ Body: { action: 'push' | 'skip' } }>(
    '/api/runs/:id/push',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: { action: { enum: ['push', 'skip'] } },
        },
      },
    },
    withRun((runId, req: { body: { action: 'push' | 'skip' } }) => {
      driver.push(runId, req.body.action);
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

  // Stop ends the work under way (the run stays resumable); cancel abandons the run for good.
  app.post(
    '/api/runs/:id/stop',
    withRun((runId) => {
      driver.stop(runId);
      return { stopping: true };
    }),
  );

  app.post<{ Body: { reason?: string } }>(
    '/api/runs/:id/cancel',
    {
      schema: {
        body: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: { reason: { type: 'string', maxLength: 200 } },
        },
      },
    },
    withRun(async (runId, req: { body?: { reason?: string } | null }) => {
      await driver.cancel(runId, req.body?.reason);
      return { cancelled: true };
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
  // why: browsers ask for /favicon.ico regardless of the page's icon link; answer without an error.
  app.get('/favicon.ico', (_req, reply) => reply.code(204).send());

  app.get('/*', (req, reply) => {
    const asset = readAsset(uiDir, req.url);
    if (!asset)
      return reply
        .code(404)
        .type('text/plain; charset=utf-8')
        .send('Not found. (Is the UI built? pnpm --filter @incubator/web build:ui)');
    // why: the app shell carries the owner's light or dark choice, so it paints in that theme at once (plan 033);
    // no-store, because the same address answers differently once the choice changes.
    if (asset.type.startsWith('text/html'))
      return reply
        .type(asset.type)
        .header('cache-control', 'no-store')
        .send(
          stampTheme(
            asset.body.toString('utf8'),
            parseCookies(req.headers.cookie)['incubator_theme'],
          ),
        );
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
  // why: the first start with the portfolio on files the runs already on disk, so earlier work shows at once.
  await opts.engine.portfolioBackfill();
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
