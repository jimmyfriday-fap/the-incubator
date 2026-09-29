import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, type Clock } from '@incubator/runtime';
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

export const adoptBranch = (clock: Clock): string =>
  `incubator/adopt-${clock.now().toISOString().slice(0, 10).replace(/-/g, '')}`;

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

  async plan(dir: string, spec: IncubatorSpec): Promise<{ result: RenderResult; delta: Delta }> {
    const result = await render(spec);
    return { result, delta: planDelta(result, dir) };
  }

  /** Writes only the delta (new files and proposals), commits on the adopt branch and proves it added only. */
  async commit(
    ctx: AdoptContext,
    dir: string,
    result: RenderResult,
    delta: Delta,
    identity: GitIdentity,
  ): Promise<string> {
    const done = ctx.steps['adopt.commit'];
    if (done?.status === 'ok') return (done.data as { sha: string }).sha;
    const base = (await this.deps.git.headSha(dir))!;
    const keep = new Set([...delta.create, ...delta.proposed]);
    const subset: RenderResult = {
      ...result,
      files: new Map(
        [...result.files].filter(([p]) => keep.has(p) && !p.startsWith(PAIRED_PREFIX)),
      ),
    };
    await this.deps.git.checkoutNewBranch(dir, adoptBranch(ctx.clock));
    writeTree(subset, dir, { mode: 'no-overwrite' });
    await this.deps.git.addAll(dir);
    const sha = await this.deps.git.commit(
      dir,
      `chore: adopt the Incubator canonical pattern\n\n${delta.create.length} file(s) added, ${delta.proposed.length} proposed as *.incubator-proposed.\n\nIncubator-Run: ${ctx.runId}\n`,
      { identity, date: ctx.clock.now().toISOString() },
    );
    const changes = await this.deps.git.diffNameStatus(dir, base, sha);
    const modified = changes.filter(([st]) => st !== 'A');
    if (modified.length)
      throw new PolicyError(
        `adopt would modify existing files: ${modified.map(([, p]) => p).join(', ')}`,
        { code: 'adopt_modified' },
      );
    ctx.record('step.ok', { step: 'adopt.commit', data: { sha, base, added: changes.length } });
    return sha;
  }

  async publish(
    ctx: AdoptContext,
    dir: string,
    ref: RepoRef,
    body: string,
    defaultBranch?: string,
  ): Promise<{ number: number; url: string }> {
    const done = ctx.steps['adopt.pr'];
    if (done?.status === 'ok') return done.data as { number: number; url: string };
    const token = await this.deps.resolveToken();
    if (!token) throw new PolicyError('no GitHub token for adopt', { code: 'no_token' });
    const gh = this.deps.github(token.token);
    const branch = adoptBranch(ctx.clock);
    if (ctx.steps['adopt.push']?.status !== 'ok') {
      await this.deps.git.push(dir, gh.remoteUrl(ref), `HEAD:refs/heads/${branch}`, token.token);
      ctx.record('step.ok', { step: 'adopt.push', data: { branch } });
    }
    const base = defaultBranch ?? (await gh.getRepo(ref))?.defaultBranch ?? 'main';
    const pr = await gh.openPr(ref, {
      head: branch,
      base,
      title: 'Adopt the Incubator canonical pattern',
      body,
    });
    ctx.record('step.ok', { step: 'adopt.pr', data: pr });
    return pr;
  }
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
