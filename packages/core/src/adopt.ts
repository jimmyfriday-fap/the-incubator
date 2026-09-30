import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, sha256Hex, type Clock } from '@incubator/runtime';
import type { GitIdentity, RepoRef } from '@incubator/git';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';
import { PAIRED_PREFIX, render, writeTree, type RenderResult } from '@incubator/templates';
import {
  analyze,
  draftFromAnalysis,
  gapReport,
  isEmptyDelta,
  planDelta,
  renderGapReport,
  summarizeGaps,
  viewFromDir,
  type Analysis,
  type Delta,
  type GapItem,
} from '@incubator/analyzer';
import type { PublishDeps } from './publish.js';

/** `owner/name` from a GitHub https or ssh URL (other hosts are not publish targets). */
export function parseGitHubRef(url: string): RepoRef | null {
  const m =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  return m ? { owner: m[1]!, name: m[2]! } : null;
}

export const ADOPT_BRANCH_PREFIX = 'incubator/adopt-';

export const adoptBranch = (clock: Clock): string =>
  `${ADOPT_BRANCH_PREFIX}${clock.now().toISOString().slice(0, 10).replace(/-/g, '')}`;

export interface AdoptContext {
  runId: string;
  workspace: string;
  clock: Clock;
  record(type: 'step.ok' | 'step.warn', fields: { step: string; data?: unknown }): void;
  steps: Readonly<Record<string, { status: string; data?: unknown }>>;
}

export interface Acquired {
  dir: string;
  ref: RepoRef | null;
}

/**
 * Brownfield adoption (TDD §7.3). The source is never modified: URLs are cloned and local paths are
 * cloned locally into the run workspace. Only new files are written; conflicts become
 * `<file>.incubator-proposed`, and the commit is checked to contain additions only.
 */
export class Adopter {
  constructor(private readonly deps: PublishDeps) {}

  async acquire(ctx: AdoptContext, repo: string, ref?: RepoRef): Promise<Acquired> {
    const dir = path.join(ctx.workspace, 'repo');
    const done = ctx.steps['adopt.acquire'];
    if (done?.status === 'ok' && existsSync(path.join(dir, '.git')))
      return { dir, ref: (done.data as { ref: RepoRef | null }).ref };
    rmSync(ctx.workspace, { recursive: true, force: true });
    mkdirSync(ctx.workspace, { recursive: true });
    const local = !/^[a-z]+:\/\//i.test(repo) && !repo.startsWith('git@');
    let origin = repo;
    if (local) {
      const src = path.resolve(repo);
      if (!existsSync(path.join(src, '.git')))
        throw new PolicyError(`${src} is not a git repository (adopt needs one to branch from)`, {
          code: 'not_git',
        });
      origin = (await this.deps.git.remoteGetUrl(src)) ?? src;
      await this.deps.git.clone(src, dir);
    } else {
      const token = await this.deps.resolveToken();
      await this.deps.git.clone(repo, dir, token ? { token: token.token } : {});
    }
    const resolved = ref ?? parseGitHubRef(origin);
    ctx.record('step.ok', { step: 'adopt.acquire', data: { ref: resolved, local } });
    return { dir, ref: resolved };
  }

  /** Detectors, gap report and the spec (the repo's own incubator.json when it has one). */
  inspect(
    dir: string,
    owner: IncubatorSpec['project']['owner'],
    repoName: string,
  ): { analysis: Analysis; items: GapItem[]; spec: IncubatorSpec } {
    const view = viewFromDir(dir);
    const analysis = analyze(view);
    const items = gapReport(view, analysis.stack?.pack ?? null);
    const spec = analysis.hasSpec
      ? completeSpec(JSON.parse(readFileSync(path.join(dir, 'incubator.json'), 'utf8')) as never)
          .spec
      : draftFromAnalysis(analysis, { repoName, owner }).spec;
    return { analysis, items, spec };
  }

  /**
   * Renders the spec and plans the delta. On a replay (`prior` is what the first pass journaled) the
   * planned lists are reused: the workspace may already hold this run's own files, and planning
   * again would call them "identical" and report the repository as already compliant.
   */
  async plan(
    dir: string,
    spec: IncubatorSpec,
    prior?: { create: string[]; proposed: string[] },
  ): Promise<{ result: RenderResult; delta: Delta }> {
    const result = await render(spec);
    if (prior)
      return {
        result,
        delta: { create: prior.create, proposed: prior.proposed, identical: [], owned: [] },
      };
    return { result, delta: planDelta(result, dir) };
  }

  /**
   * Writes only the delta (new files and proposals), commits on the adopt branch and proves it added
   * only. Safe to replay after a crash at any point: a commit that already carries this run's
   * trailer is verified and adopted instead of being made again (ADR-010, ADR-020).
   */
  async commit(
    ctx: AdoptContext,
    dir: string,
    result: RenderResult,
    delta: Delta,
    identity: GitIdentity,
  ): Promise<string> {
    const done = ctx.steps['adopt.commit'];
    if (done?.status === 'ok') return (done.data as { sha: string }).sha;
    const head = (await this.deps.git.headSha(dir))!;
    const branch = await this.deps.git.currentBranch(dir);
    // The commit landed but its journal entry did not: take it as it is, after re-proving it.
    if (
      branch?.startsWith(ADOPT_BRANCH_PREFIX) &&
      (await this.deps.git.headMessage(dir))?.includes(`Incubator-Run: ${ctx.runId}`)
    )
      return this.prove(ctx, dir, `${head}^`, head, branch);
    // A replay finds this run's own earlier proposals on disk; the writer rightly refuses to touch
    // them ('wx'), so the ones that are already byte-identical are left out of this pass.
    const proposals = delta.proposed.filter((p) => {
      const file = result.files.get(p);
      const mine = path.join(dir, ...`${p}.incubator-proposed`.split('/'));
      return !(file && existsSync(mine) && sha256Hex(readFileSync(mine)) === sha256Hex(file.bytes));
    });
    const keep = new Set([...delta.create, ...proposals]);
    const subset: RenderResult = {
      ...result,
      files: new Map(
        [...result.files].filter(([p]) => keep.has(p) && !p.startsWith(PAIRED_PREFIX)),
      ),
    };
    const target = adoptBranch(ctx.clock);
    // The branch may already be checked out if a crash hit between checkout and commit.
    if (branch !== target) await this.deps.git.checkoutNewBranch(dir, target);
    writeTree(subset, dir, { mode: 'no-overwrite' });
    await this.deps.git.addAll(dir);
    const sha = await this.deps.git.commit(
      dir,
      `chore: adopt the Incubator canonical pattern\n\n${delta.create.length} file(s) added, ${delta.proposed.length} proposed as *.incubator-proposed.\n\nIncubator-Run: ${ctx.runId}\n`,
      { identity, date: ctx.clock.now().toISOString() },
    );
    return this.prove(ctx, dir, head, sha, target);
  }

  /** Proves the commit only adds files, then journals it (with the branch it is on). */
  private prove(
    ctx: AdoptContext,
    dir: string,
    base: string,
    sha: string,
    branch: string,
  ): Promise<string> {
    return proveAdditions(this.deps, ctx, { dir, base, sha, branch, step: 'adopt.commit' });
  }

  /** Pushes the run's branch and opens the pull request; replay-safe at both steps. */
  async publish(
    ctx: AdoptContext,
    dir: string,
    ref: RepoRef,
    body: string,
    defaultBranch?: string,
    opts: { prefix?: string; commitStep?: string; title?: string; fallbackBranch?: string } = {},
  ): Promise<{ number: number; url: string }> {
    const prefix = opts.prefix ?? 'adopt';
    const done = ctx.steps[`${prefix}.pr`];
    if (done?.status === 'ok') return done.data as { number: number; url: string };
    const token = await this.deps.resolveToken();
    if (!token) throw new PolicyError(`no GitHub token for ${prefix}`, { code: 'no_token' });
    const gh = this.deps.github(token.token);
    // The branch the commit actually landed on: a run resumed after midnight must not rename it.
    const branch =
      (ctx.steps[opts.commitStep ?? 'adopt.commit']?.data as { branch?: string } | undefined)
        ?.branch ??
      opts.fallbackBranch ??
      adoptBranch(ctx.clock);
    if (ctx.steps[`${prefix}.push`]?.status !== 'ok') {
      await this.deps.git.push(dir, gh.remoteUrl(ref), `HEAD:refs/heads/${branch}`, token.token);
      ctx.record('step.ok', { step: `${prefix}.push`, data: { branch } });
    }
    const base = defaultBranch ?? (await gh.getRepo(ref))?.defaultBranch ?? 'main';
    const pr = await gh.openPr(ref, {
      head: branch,
      base,
      title: opts.title ?? 'Adopt the Incubator canonical pattern',
      body,
    });
    ctx.record('step.ok', { step: `${prefix}.pr`, data: pr });
    return pr;
  }
}

/**
 * Proves a commit only adds files (Brief §9: no existing file is ever modified), then journals it
 * under `step` together with the branch it is on. Shared by adopt and enhance.
 */
export async function proveAdditions(
  deps: Pick<PublishDeps, 'git'>,
  ctx: AdoptContext,
  c: { dir: string; base: string; sha: string; branch: string; step: string },
): Promise<string> {
  const changes = await deps.git.diffNameStatus(c.dir, c.base, c.sha);
  const modified = changes.filter(([st]) => st !== 'A');
  if (modified.length)
    throw new PolicyError(
      `${c.step.split('.')[0]} would modify existing files: ${modified.map(([, p]) => p).join(', ')}`,
      { code: 'adopt_modified' },
    );
  ctx.record('step.ok', {
    step: c.step,
    data: { sha: c.sha, base: c.base, added: changes.length, branch: c.branch },
  });
  return c.sha;
}

export interface AdoptReport {
  analysis: Analysis;
  items: GapItem[];
  delta: Delta;
  markdown: string;
  summary: ReturnType<typeof summarizeGaps>;
}

export function adoptReport(analysis: Analysis, items: GapItem[], delta: Delta): AdoptReport {
  return {
    analysis,
    items,
    delta,
    markdown: renderGapReport(analysis, items, delta),
    summary: summarizeGaps(items),
  };
}

export function writeReport(runDir: string, report: AdoptReport): string {
  const file = path.join(runDir, 'adopt', 'gap-report.md');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, report.markdown);
  return file;
}

export { isEmptyDelta };
