import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  PolicyError,
  sha256Hex,
  type Clock,
  type Logger,
  type SecretString,
} from '@incubator/runtime';
import {
  missingScopes,
  type BranchProtection,
  type GitHubAdapter,
  type GitIdentity,
  type GitOps,
  type Label,
  type RepoRef,
  type ResolvedToken,
} from '@incubator/git';
import type { IncubatorSpec } from '@incubator/spec';
import type { TrackerAdapter } from '@incubator/tracker';
import { LOCK_PATH, writeTree, type RenderResult } from '@incubator/templates';
import { scaffoldSpec } from './scaffold.js';

export const UNSET = '__INCUBATOR_UNSET__';

export interface VerifyResult {
  ok: boolean;
  summary: string;
}

/** Dependencies of the SCAFFOLD → VERIFY → PUBLISH steps; every one has a fake for tests. */
export interface PublishDeps {
  resolveToken(): Promise<ResolvedToken | null>;
  github(token: SecretString): GitHubAdapter;
  git: GitOps;
  /** Runs the rendered repositories' own quick gate (install + `check quick`). */
  verify(dirs: { app: string; paired?: string }): Promise<VerifyResult>;
  /** `git config user.*` when set; the token's login with a noreply address otherwise. */
  identity?(): Promise<GitIdentity | null>;
  /** The remote tracker for HANDOFF (Leantime); local tickets need none. */
  tracker?(spec: IncubatorSpec): Promise<TrackerAdapter | null>;
}

export interface StepContext {
  runId: string;
  spec: IncubatorSpec;
  workspace: string;
  steps: Readonly<Record<string, { status: 'ok' | 'warn' | 'fail'; data?: unknown }>>;
  record(type: 'step.ok' | 'step.warn', fields: { step: string; data?: unknown }): void;
  clock: Clock;
  log: Logger;
  keep?: boolean;
}

export interface PublishSummary {
  repo: string;
  pairedRepo?: string;
  commit: string;
  variablesCreated: string[];
  secretsToSet: { name: string; repo: string; description: string }[];
  warnings: string[];
}

const LANE_COLORS: Record<string, string> = {
  workspace: 'c5def5',
  security: 'b60205',
  'support/existing': 'fbca04',
  testing: '0e8a16',
  infra: '5319e7',
  'enhancement/existing': '1d76db',
  'enhancement/new': '0052cc',
  'ui/fix': 'd93f0b',
  'ui/feature': 'e99695',
};

export function laneLabels(spec: IncubatorSpec): Label[] {
  return [
    { name: 'incubator', color: 'ededed', description: 'Created or tracked by the Incubator' },
    ...spec.lanes.workLanes.map((l) => ({
      name: `lane:${l}`,
      color: LANE_COLORS[l] ?? 'ededed',
      description: `Work lane ${l}`,
    })),
  ];
}

export function commitMessage(
  spec: IncubatorSpec,
  specHash: string,
  r: RenderResult,
  runId: string,
): string {
  return [
    `chore: scaffold ${spec.project.slug} from incubator.json`,
    '',
    `Incubator-Spec: ${specHash}`,
    `Incubator-Packs: ${r.packs.map((p) => `${p.manifest.id}@${p.manifest.version}`).join(', ')}`,
    `Incubator-Run: ${runId}`,
    '',
  ].join('\n');
}

export const runMarker = (runId: string): string => `incubator-run:${runId}`;

/** Workspace layout: `<runDir>/workspace/<slug>` and, for a paired tests repo, its sibling. */
export function workspaceDirs(
  workspace: string,
  spec: IncubatorSpec,
): { app: string; paired?: string } {
  const app = path.join(workspace, spec.project.slug);
  return spec.testing.home === 'paired-repo'
    ? {
        app,
        paired: path.join(workspace, spec.testing.pairedRepo?.name ?? `${spec.project.slug}-tests`),
      }
    : { app };
}

/**
 * The effectful steps of a run (TDD §7.1). Each step is check-then-act and journaled as `step.ok` or
 * `step.warn`, so a resumed run skips completed work and never repeats an effect.
 */
export class Publisher {
  #token: ResolvedToken | null = null;
  #gh: GitHubAdapter | null = null;
  #rendered: { key: string; result: RenderResult } | null = null;
  #warnings: string[] = [];

  constructor(private readonly deps: PublishDeps) {}

  private async step<T>(
    ctx: StepContext,
    id: string,
    act: () => Promise<T>,
    opts: { fatal?: boolean; skipIf?: () => Promise<boolean> } = {},
  ): Promise<T | undefined> {
    if (ctx.steps[id]?.status === 'ok' && (!opts.skipIf || (await opts.skipIf())))
      return ctx.steps[id]?.data as T;
    try {
      const data = await act();
      ctx.record('step.ok', { step: id, ...(data === undefined ? {} : { data }) });
      return data;
    } catch (e) {
      if (opts.fatal !== false) throw e;
      const reason = e instanceof Error ? e.message : String(e);
      ctx.log.warn(`${id}: ${reason}`);
      this.#warnings.push(`${id}: ${reason}`);
      ctx.record('step.warn', { step: id, data: { reason } });
      return undefined;
    }
  }

  private async github(): Promise<{ gh: GitHubAdapter; token: ResolvedToken }> {
    if (this.#gh && this.#token) return { gh: this.#gh, token: this.#token };
    const token = await this.deps.resolveToken();
    if (!token)
      throw new PolicyError(
        'no GitHub token: run `incubator auth set github`, `gh auth login`, or set GITHUB_TOKEN',
        { code: 'no_token' },
      );
    this.#token = token;
    this.#gh = this.deps.github(token.token);
    return { gh: this.#gh, token };
  }

  private ref(spec: IncubatorSpec, name = spec.project.slug): RepoRef {
    return { owner: spec.project.owner.login, name };
  }

  /** Token check (never journaled with a value) and the name check, before any render or verify work. */
  async preflight(ctx: StepContext): Promise<void> {
    const { gh, token } = await this.github();
    const info = await gh.tokenInfo();
    const missing = missingScopes(info.kind, info.scopes);
    if (missing.length)
      throw new PolicyError(
        `the GitHub token (${token.source}) lacks scope(s): ${missing.join(', ')}`,
        {
          code: 'token_scopes',
        },
      );
    ctx.record('step.ok', {
      step: 'token.resolve',
      data: { source: token.source, login: info.login, kind: info.kind },
    });
    if (!ctx.spec.project.owner.login)
      throw new PolicyError(
        'project.owner.login is empty; set the GitHub owner in incubator.json',
        { code: 'no_owner' },
      );
    for (const name of this.repoNames(ctx.spec)) {
      const existing = await gh.getRepo(this.ref(ctx.spec, name));
      if (existing && !existing.description.includes(runMarker(ctx.runId)))
        throw new PolicyError(`${ctx.spec.project.owner.login}/${name} already exists on GitHub`, {
          code: 'name_taken',
        });
    }
    ctx.record('step.ok', { step: 'repo.nameCheck' });
  }

  private repoNames(spec: IncubatorSpec): string[] {
    return spec.testing.home === 'paired-repo'
      ? [spec.project.slug, spec.testing.pairedRepo?.name ?? `${spec.project.slug}-tests`]
      : [spec.project.slug];
  }

  /** SCAFFOLD: render into the run's workspace (re-rendered unless the lock hash matches). */
  async render(ctx: StepContext): Promise<RenderResult> {
    const dirs = workspaceDirs(ctx.workspace, ctx.spec);
    const key = JSON.stringify(ctx.spec);
    if (this.#rendered?.key !== key)
      this.#rendered = {
        key,
        result: (await scaffoldSpec(ctx.spec, { validateOnly: true })).result,
      };
    const out = { result: this.#rendered.result };
    const want = { lock: sha256Hex(out.result.files.get(LOCK_PATH)!.bytes) };
    const done = ctx.steps['render'];
    const intact =
      done?.status === 'ok' &&
      (done.data as { lock?: string } | undefined)?.lock === want.lock &&
      existsSync(path.join(dirs.app, LOCK_PATH)) &&
      sha256Hex(readFileSync(path.join(dirs.app, LOCK_PATH))) === want.lock;
    if (!intact) {
      rmSync(ctx.workspace, { recursive: true, force: true });
      mkdirSync(ctx.workspace, { recursive: true });
      writeTree(out.result, dirs.app, {
        mode: 'fresh',
        force: true,
        ...(dirs.paired ? { pairedName: path.basename(dirs.paired) } : {}),
      });
      ctx.record('step.ok', { step: 'render', data: want });
    }
    return out.result;
  }

  /** VERIFY: the rendered repositories must pass their own quick gate (exit 2 otherwise). */
  async verify(ctx: StepContext): Promise<void> {
    const key = JSON.stringify(ctx.steps['render']?.data ?? null);
    if (
      ctx.steps['verify']?.status === 'ok' &&
      (ctx.steps['verify'].data as { render?: string })?.render === key
    )
      return;
    const r = await this.deps.verify(workspaceDirs(ctx.workspace, ctx.spec));
    if (!r.ok)
      throw new PolicyError(`the generated repository failed its own check: ${r.summary}`, {
        code: 'verify_failed',
      });
    ctx.record('step.ok', { step: 'verify', data: { render: key, summary: r.summary } });
  }

  /** PUBLISH: create, commit, push, branch, configure (best effort), clean up. */
  async publish(ctx: StepContext, rendered: RenderResult): Promise<PublishSummary> {
    const { gh, token } = await this.github();
    const spec = ctx.spec;
    const dirs = workspaceDirs(ctx.workspace, spec);
    const login =
      (ctx.steps['token.resolve']?.data as { login?: string } | undefined)?.login ??
      spec.project.owner.login;
    const identity = (await this.deps.identity?.()) ?? {
      name: login,
      email: `${login}@users.noreply.github.com`,
    };
    const specHash = rendered.lock.specHash;
    const staging = spec.lanes.branches.staging;
    const prod = spec.lanes.branches.prod;
    this.#warnings = [];
    const earlier = Object.entries(ctx.steps)
      .filter(([, v]) => v.status === 'warn')
      .map(([id, v]) => `${id}: ${(v.data as { reason?: string } | undefined)?.reason ?? ''}`);
    const repos: { key: string; dir: string; ref: RepoRef; paired: boolean }[] = [
      { key: '', dir: dirs.app, ref: this.ref(spec), paired: false },
      ...(dirs.paired
        ? [
            {
              key: 'paired.',
              dir: dirs.paired,
              ref: this.ref(spec, path.basename(dirs.paired)),
              paired: true,
            },
          ]
        : []),
    ];
    let commit = '';
    for (const r of repos) {
      await this.step(ctx, `${r.key}repo.create`, async () => {
        const have = await gh.getRepo(r.ref);
        if (have?.description.includes(runMarker(ctx.runId))) return { url: have.htmlUrl };
        const made = await gh.createRepo({
          ...r.ref,
          ownerType: spec.project.owner.type,
          visibility: spec.project.visibility,
          description: `${r.paired ? `Tests for ${spec.project.slug}` : spec.project.description.slice(0, 300)} (${runMarker(ctx.runId)})`,
        });
        return { url: made.htmlUrl };
      });
      const sha = await this.step(
        ctx,
        `${r.key}git.commit`,
        async () => {
          const head = await this.deps.git.headSha(r.dir);
          if (
            head &&
            (await this.deps.git.headMessage(r.dir))?.includes(`Incubator-Spec: ${specHash}`)
          )
            return head;
          if (!existsSync(path.join(r.dir, '.git'))) await this.deps.git.init(r.dir, staging);
          await this.deps.git.addAll(r.dir);
          const exec = Object.entries(rendered.lock.files)
            .filter(
              ([p, f]) =>
                f.mode === '0755' &&
                (r.paired ? p.startsWith('@paired/') : !p.startsWith('@paired/')),
            )
            .map(([p]) => (r.paired ? p.slice('@paired/'.length) : p));
          await this.deps.git.chmodX(r.dir, exec);
          return this.deps.git.commit(r.dir, commitMessage(spec, specHash, rendered, ctx.runId), {
            identity,
            date: ctx.clock.now().toISOString(),
          });
        },
        { skipIf: async () => (await this.deps.git.headSha(r.dir)) !== null },
      );
      if (!r.paired) commit = sha ?? '';
      const remote = gh.remoteUrl(r.ref);
      await this.step(ctx, `${r.key}git.push.main`, async () => {
        const local = await this.deps.git.headSha(r.dir);
        if (
          local &&
          (await this.deps.git.remoteSha(remote, `refs/heads/${staging}`, token.token, r.dir)) ===
            local
        )
          return { sha: local };
        await this.deps.git.push(r.dir, remote, `HEAD:refs/heads/${staging}`, token.token);
        return { sha: local };
      });
      if (!r.paired) {
        await this.step(ctx, 'branch.production', async () => {
          if ((await gh.getBranchSha(r.ref, prod)) === commit) return { sha: commit };
          await gh.createBranch(r.ref, prod, commit);
          return { sha: commit };
        });
      }
    }
    const app = repos[0]!.ref;
    await this.step(
      ctx,
      'configure.protection',
      async () => {
        const main: BranchProtection = {
          requiredChecks: ['gate'],
          requirePr: true,
          requiredApprovals: 0,
          allowForcePush: false,
          allowDeletion: false,
        };
        // why: promote-to-production merges into prod with the workflow token, so prod forbids only force-push and deletion.
        const prodRules: BranchProtection = {
          requiredChecks: [],
          requirePr: false,
          requiredApprovals: 0,
          allowForcePush: false,
          allowDeletion: false,
        };
        await gh.setBranchProtection(app, staging, main);
        await gh.setBranchProtection(app, prod, prodRules);
        return { branches: [staging, prod] };
      },
      { fatal: false },
    );
    await this.step(
      ctx,
      'configure.labels',
      async () => ({ created: await gh.ensureLabels(app, laneLabels(spec)) }),
      { fatal: false },
    );
    const vars = Object.fromEntries(
      rendered.settings.variables.filter((v) => v.target === 'app').map((v) => [v.name, UNSET]),
    );
    const created =
      (
        await this.step(
          ctx,
          'configure.variables',
          async () => ({ created: await gh.ensureVariables(app, vars) }),
          { fatal: false },
        )
      )?.created ?? [];
    if (!ctx.keep)
      await this.step(
        ctx,
        'cleanup',
        () => Promise.resolve(rmSync(ctx.workspace, { recursive: true, force: true })),
        { fatal: false },
      );
    const url = (ref: RepoRef) => `https://github.com/${ref.owner}/${ref.name}`;
    return {
      repo: url(app),
      ...(repos[1] ? { pairedRepo: url(repos[1].ref) } : {}),
      commit,
      variablesCreated: created,
      secretsToSet: rendered.settings.secrets.map((s) => ({
        name: s.name,
        repo: url(s.target === 'paired' && repos[1] ? repos[1].ref : app),
        description: s.description,
      })),
      warnings: [...new Set([...earlier, ...this.#warnings])],
    };
  }
}
