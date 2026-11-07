import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DefaultsPrompter } from '@incubator/core';
import {
  enhanceFixtureDir,
  fakeAgentHandoff,
  fakePublishEngine,
  seedExistingRepo,
} from '@incubator/core/testing';
import { exitCodeFor, nodeExec } from '@incubator/runtime';
import type { FeatureAdapter } from './types.js';

interface Input {
  /** The fake agent's mode (packages/core/fixtures/handoff/fake-agent.mjs). */
  agent?: 'memory' | 'memory-agents' | 'memory-unverified' | 'idle' | 'edit';
  system?: string;
  policy?: 'auto' | 'pr' | 'direct';
  /** Leave uncommitted work in the folder before the run. */
  dirty?: boolean;
  /** Name the GitHub repository, so a passing install asks about the push. */
  github?: boolean;
  /** An update (enhance) run in the folder instead of an Add memory run: it records target mode (ADR-032). */
  update?: boolean;
  /** `update` only: the repository already keeps its memory (committed), so no offer is made. */
  hasMemory?: boolean;
}
interface Out {
  state: string;
  exitCode: number;
  parkedReason: string | null;
  branch: string | null;
  memoryInstalled: boolean;
  agentsUntouched: boolean;
  prs: number;
  problems: string[];
  /** `update` only: the destination the run recorded, and whether it offered Add memory. */
  memoryMode: string | null;
  memoryOffered: boolean;
}

const bareNode = path.resolve(import.meta.dirname, '../../packages/analyzer/fixtures/bare-node');
const AGENTS = '# Agent instructions\n';
const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}

/** Add memory (plan 071, ADR-031): the agent installs and commits; the Incubator checks; the owner pushes. */
export const adapter: FeatureAdapter<Record<string, never>, Out> = {
  name: 'add-memory',
  seedContext: () => ({}),
  async runStage(stage) {
    const input = (stage.input ?? {}) as Input;
    const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'scenario gitcfg ')), 'gitconfig');
    writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
    return withEnv(
      {
        GIT_CONFIG_GLOBAL: cfg,
        GIT_CONFIG_NOSYSTEM: '1',
        FAKE_AGENT_MODE: input.agent ?? 'memory',
      },
      async () => {
        const h = fakePublishEngine({
          handoff: fakeAgentHandoff(),
          portfolio: true,
          ...(input.update ? { llm: { dir: enhanceFixtureDir('export-orders') } } : {}),
        });
        const { ref, dir } = await seedExistingRepo(h.github, 'shop', (d) => {
          cpSync(bareNode, d, {
            recursive: true,
            filter: (s: string) => !s.endsWith('expected-gap-report.json'),
          });
          writeFileSync(path.join(d, 'AGENTS.md'), AGENTS);
          return Promise.resolve();
        });
        if (input.hasMemory) {
          mkdirSync(path.join(dir, '.memory'), { recursive: true });
          writeFileSync(path.join(dir, '.memory', 'INDEX.md'), '# Index\n');
          await git(['add', '.memory/INDEX.md'], dir);
          await git(['commit', '-m', 'mem: add memory'], dir);
        }
        if (input.dirty) writeFileSync(path.join(dir, 'half-done.txt'), 'work in progress\n');
        const installed = () => existsSync(path.join(dir, '.memory', 'memory.conf'));
        const agentsUntouched = () => readFileSync(path.join(dir, 'AGENTS.md'), 'utf8') === AGENTS;
        const prs = () => h.github.repos.get('octo/shop')!.prs.length;
        try {
          const runId = input.update
            ? h.engine.start({
                kind: 'enhance',
                repo: dir,
                repoRef: ref,
                dir,
                request: 'Kitchen staff need to export the orders list as a CSV file.',
                yes: true,
                surface: 'test',
              })
            : h.engine.start({
                kind: 'memory',
                dir,
                repo: dir,
                ...(input.github ? { repoRef: ref } : {}),
                surface: 'test',
                yes: true,
                memory: {
                  system: input.system ?? 'shop',
                  isolationTerms: ['other-app'],
                  commitPolicy: input.policy ?? 'pr',
                },
              });
          const s = await h.engine.advance(runId, new DefaultsPrompter());
          const finish = input.update ? await h.engine.finishDetail(runId) : null;
          return {
            memoryMode: finish?.memory?.mode ?? null,
            memoryOffered: (finish?.memory?.note ?? '').includes('Add memory'),
            state: s.state,
            exitCode: s.state === 'PARKED' ? 2 : 0,
            parkedReason: s.parked?.reason ?? null,
            branch: (await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).stdout.trim(),
            memoryInstalled: installed(),
            agentsUntouched: agentsUntouched(),
            prs: prs(),
            problems: h.engine.memoryDetail(runId)?.problems ?? [],
          };
        } catch (err) {
          return {
            state: 'ERROR',
            exitCode: exitCodeFor(err),
            parkedReason: null,
            branch: null,
            memoryInstalled: installed(),
            agentsUntouched: agentsUntouched(),
            prs: prs(),
            problems: [],
            memoryMode: null,
            memoryOffered: false,
          };
        }
      },
    );
  },
  captureOutput: (out) => out,
  validate(captured) {
    const out = captured as Out;
    const errors: string[] = [];
    // Whatever happens, no pull request is opened before the owner decides the push.
    if (out.prs !== 0) errors.push('a pull request was opened without the owner deciding the push');
    return errors;
  },
};
