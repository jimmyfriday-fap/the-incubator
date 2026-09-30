import { existsSync } from 'node:fs';
import path from 'node:path';
import { DefaultsPrompter, NonInteractivePrompter } from '@incubator/core';
import {
  enhanceFixtureDir,
  fakePublishEngine,
  hashTree,
  seedExistingRepo,
} from '@incubator/core/testing';
import { ToolError, exitCodeFor, nodeExec } from '@incubator/runtime';
import type { FixtureTurn } from '@incubator/llm';
import type { FeatureAdapter } from './types.js';

interface Ctx {
  /** An enhance fixture directory name, or inline turns. */
  fixtures: string | FixtureTurn[];
  /** The analyzer fixture repository to enhance. */
  repo: string;
}
interface Crash {
  kind: 'git' | 'github';
  method: string;
  when: 'before' | 'after';
}
interface Out {
  state: string;
  exitCode: number;
  parkedReason: string | null;
  noop: string | null;
  resumes: number;
  prs: number;
  commits: number;
  addedOnly: boolean;
  sourceUntouched: boolean;
  features: string[];
  files: string[];
  /** plan-lint findings for the delivered plan file (empty when it conforms). */
  planLint: string[];
}

const planLintScript = path.resolve(import.meta.dirname, '../../scripts/guard/plan-lint.mjs');
const analyzerFixtures = path.resolve(import.meta.dirname, '../../packages/analyzer/fixtures');
const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });

/** Runs the repository's own plan-lint guard inside the delivered workspace, as a generated repo would. */
async function lintDelivered(cwd: string): Promise<string[]> {
  const r = await nodeExec.run(process.execPath, [planLintScript], { cwd, timeoutMs: 30_000 });
  return r.code === 0 ? [] : [`${r.stdout}${r.stderr}`.trim()];
}

/** Drives an enhance run against a seeded repository on the fake GitHub, with optional crash injection. */
export const adapter: FeatureAdapter<Ctx, Out> = {
  name: 'enhance-existing',
  seedContext: (s) => ({
    fixtures: (s.seed['fixtures'] as Ctx['fixtures'] | undefined) ?? [],
    repo: (s.seed['repo'] as string | undefined) ?? 'bare-node',
  }),
  async runStage(stage, ctx) {
    const input = (stage.input ?? {}) as {
      request?: string;
      noPublish?: boolean;
      withGaps?: boolean;
      yes?: boolean;
      crash?: Crash;
    };
    const h = fakePublishEngine({
      llm:
        typeof ctx.fixtures === 'string' ? { dir: enhanceFixtureDir(ctx.fixtures) } : ctx.fixtures,
    });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      ctx.repo,
      path.join(analyzerFixtures, ctx.repo),
    );
    const before = hashTree(dir);
    type GitMethod = NonNullable<typeof h.gitFaults.failAt>['method'];
    type GhMethod = NonNullable<typeof h.github.failAt>['method'];
    if (input.crash?.kind === 'git')
      h.gitFaults.failAt = { method: input.crash.method as GitMethod, when: input.crash.when };
    if (input.crash?.kind === 'github')
      h.github.failAt = { method: input.crash.method as GhMethod, when: input.crash.when };
    const runId = h.engine.start({
      kind: 'enhance',
      repo: h.github.remoteUrl(ref),
      repoRef: ref,
      ...(input.request ? { request: input.request } : {}),
      ...(input.noPublish ? { noPublish: true } : {}),
      ...(input.withGaps ? { withGaps: true } : {}),
      yes: input.yes !== false,
      surface: 'test',
    });
    const prompter = input.yes === false ? new NonInteractivePrompter() : new DefaultsPrompter();
    let resumes = 0;
    try {
      let s = await h.engine.advance(runId, prompter).catch((e: unknown) => {
        if (!(e instanceof ToolError) || !input.crash) throw e;
        return h.engine.state(runId);
      });
      for (; input.crash && !s.done && resumes < 4; resumes++) {
        s = await h.engine.resume(runId, prompter).catch((e: unknown) => {
          if (!(e instanceof ToolError)) throw e;
          return h.engine.state(runId);
        });
      }
      const summary = h.engine.enhanceSummary(runId);
      const ws = path.join(h.store.runDir(runId), 'workspace', 'repo');
      const commits = Number((await git(['rev-list', '--count', 'main..HEAD'], ws)).stdout.trim());
      const changes = (await git(['diff', '--name-status', 'main..HEAD'], ws)).stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t') as [string, string]);
      const planPath = summary.plan?.planPath ?? null;
      const planFile = planPath ? path.join(ws, ...planPath.split('/')) : null;
      return {
        state: s.state,
        exitCode: s.state === 'PARKED' ? 2 : 0,
        parkedReason: s.parked?.reason ?? null,
        noop: summary.noop,
        resumes,
        prs: h.github.repos.get(`octo/${ctx.repo}`)!.prs.length,
        commits,
        addedOnly: changes.every(([st]) => st === 'A'),
        sourceUntouched: JSON.stringify(hashTree(dir)) === JSON.stringify(before),
        features: summary.plan?.features.map((f) => f.id) ?? [],
        files: changes.map(([, p]) => p),
        planLint: planFile && existsSync(planFile) ? await lintDelivered(ws) : [],
      };
    } catch (err) {
      return {
        state: 'ERROR',
        exitCode: exitCodeFor(err),
        parkedReason: null,
        noop: null,
        resumes,
        prs: 0,
        commits: 0,
        addedOnly: true,
        sourceUntouched: JSON.stringify(hashTree(dir)) === JSON.stringify(before),
        features: [],
        files: [],
        planLint: [],
      };
    }
  },
  captureOutput: (out) => out,
  validate(captured) {
    const out = captured as Out;
    const errors: string[] = [];
    // Whatever happens, the owner's checkout is never touched and a branch only ever adds files.
    if (!out.sourceUntouched) errors.push('the source repository was modified');
    if (!out.addedOnly) errors.push('the enhance branch modifies or deletes an existing file');
    return errors;
  },
};
