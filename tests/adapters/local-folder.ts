import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DefaultsPrompter } from '@incubator/core';
import {
  enhanceFixtureDir,
  fakeAgentHandoff,
  fakePublishEngine,
  hashTree,
  seedExistingRepo,
} from '@incubator/core/testing';
import { ToolError, exitCodeFor, nodeExec } from '@incubator/runtime';
import { completeSpec } from '@incubator/spec';
import type { FeatureAdapter } from './types.js';

interface Input {
  /** `new`: a solution in a fresh folder. `update`: the enhance flow in the owner's own folder. */
  mode: 'new' | 'update';
  /** Whether git knows the owner (default true). */
  identity?: boolean;
  /** The owner's answers once the run asks; absent means "not answered". */
  commit?: 'commit' | 'leave';
  push?: 'push' | 'skip';
  /** How the fake agent behaves (default `edit`: it writes a file and reports). */
  agent?: 'edit' | 'idle';
  /** Pre-existing files: `new` folder not empty, or `update` folder with uncommitted work. */
  preexisting?: boolean;
  /** `update`: the analyzer fixture to seed the folder from (default `bare-node`). */
  repo?: string;
  /** `update`: the check commands the owner approves; absent means they did not decide (ADR-025). */
  checks?: string[];
  /** Arms a one-shot git or GitHub failure right after the owner answers commit or push. */
  crash?: { at: 'commit' | 'push'; method: 'commit' | 'push' | 'openPr'; when: 'after' };
}
interface Out {
  state: string;
  exitCode: number;
  parkedState: string | null;
  parkedReason: string | null;
  resumes: number;
  prs: number;
  /** Commits on the working branch beyond the starting branch. */
  commits: number;
  branch: string | null;
  committedAs: string | null;
  changedFiles: string[];
  agentSummary: string | null;
  /** The owner's own files and starting branch are exactly as they were. */
  ownerWorkUntouched: boolean;
  githubRepoCreated: boolean;
  originalBranchUnchanged: boolean;
  stateDirTracked: boolean;
  /** What the agent could run: `gate`, `approved` or `none`; null when no agent was launched. */
  checksMode: string | null;
  /** The `Bash(...)` entries of the agent's allowed-tool list. */
  agentCommands: string[];
  /** Why the owner's check commands were refused, when they were. */
  checksRefused: string | null;
}

const combos = path.resolve(import.meta.dirname, '../../packages/templates/fixtures/combos');
const analyzerFixtures = path.resolve(import.meta.dirname, '../../packages/analyzer/fixtures');
const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });
const out = async (args: string[], cwd: string) => (await git(args, cwd)).stdout.trim();
const REQUEST = 'Kitchen staff need to export the orders list as a CSV file.';

const tree = (d: string) => (existsSync(d) ? hashTree(d) : {});

function newSpec() {
  const draft = JSON.parse(
    readFileSync(path.join(combos, 'node-lib.in-repo.package-release.json'), 'utf8'),
  ) as Record<string, unknown>;
  const project = { ...(draft['project'] as object), owner: { type: 'user', login: 'octo' } };
  return completeSpec({ ...draft, project }).spec;
}

/** Runs the engine with a hermetic git configuration and the fake agent in a chosen mode. */
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

/** The folder workflow (ADR-023): code in the owner's folder, then ask for the commit and the push. */
export const adapter: FeatureAdapter<Record<string, never>, Out> = {
  name: 'local-folder',
  seedContext: () => ({}),
  async runStage(stage) {
    const input = stage.input as unknown as Input;
    const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'scenario gitcfg ')), 'gitconfig');
    writeFileSync(
      cfg,
      input.identity === false
        ? ''
        : '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n',
    );
    return withEnv(
      {
        GIT_CONFIG_GLOBAL: cfg,
        GIT_CONFIG_NOSYSTEM: '1',
        FAKE_AGENT_MODE: input.agent ?? 'edit',
      },
      async () => {
        const h = fakePublishEngine({
          handoff: fakeAgentHandoff(),
          ...(input.mode === 'update' ? { llm: { dir: enhanceFixtureDir('export-orders') } } : {}),
        });
        let dir: string;
        let ref = { owner: 'octo', name: 'tallyho' };
        if (input.mode === 'update') {
          const seeded = await seedExistingRepo(
            h.github,
            'order-desk',
            path.join(analyzerFixtures, input.repo ?? 'bare-node'),
          );
          dir = seeded.dir;
          ref = seeded.ref;
          await git(['config', 'user.name', 'Owner Person'], dir);
          await git(['config', 'user.email', 'owner@example.invalid'], dir);
          if (input.identity === false) await git(['config', '--unset', 'user.name'], dir);
        } else {
          // A folder that does not exist yet and has a space in its name.
          dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'scenario folder ')), 'my solution');
        }
        if (input.preexisting) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, 'my-notes.txt'), 'mine, not yours\n');
        }
        const startBranch = existsSync(path.join(dir, '.git'))
          ? await out(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
          : null;
        const startSha = startBranch ? await out(['rev-parse', 'HEAD'], dir) : null;
        const before = tree(dir);
        const prompter = new DefaultsPrompter();
        const runId =
          input.mode === 'new'
            ? h.engine.startFromSpec(newSpec(), { kind: 'new', surface: 'test', dir })
            : h.engine.start({
                kind: 'enhance',
                repo: dir,
                repoRef: ref,
                dir,
                request: REQUEST,
                yes: true,
                surface: 'test',
              });
        let resumes = 0;
        let checksRefused: string | null = null;
        if (input.checks) {
          try {
            h.engine.submitChecks(runId, input.checks);
          } catch (e) {
            checksRefused = e instanceof Error ? e.message : String(e);
          }
        }
        const step = async (fn: () => Promise<ReturnType<typeof h.engine.state>>) => {
          try {
            return await fn();
          } catch (e) {
            if (!(e instanceof ToolError)) throw e;
            return h.engine.state(runId);
          }
        };
        try {
          let s = await step(() => h.engine.advance(runId, prompter));
          const resume = async () => {
            resumes++;
            return step(() => h.engine.resume(runId, prompter));
          };
          if (s.parked?.reason === 'needs_commit' && input.commit) {
            if (input.crash?.at === 'commit')
              h.gitFaults.failAt = { method: input.crash.method as 'commit', when: 'after' };
            h.engine.submitCommit(runId, { action: input.commit });
            s = await resume();
            while (
              input.crash?.at === 'commit' &&
              !s.done &&
              s.parked?.state !== 'PUSH' &&
              resumes < 4
            )
              s = await resume();
          }
          if (s.parked?.reason === 'needs_push' && input.push) {
            if (input.crash?.at === 'push') {
              if (input.crash.method === 'push')
                h.gitFaults.failAt = { method: 'push', when: 'after' };
              else h.github.failAt = { method: 'openPr', when: 'after' };
            }
            h.engine.submitPush(runId, input.push);
            s = await resume();
            while (input.crash?.at === 'push' && !s.done && resumes < 6) s = await resume();
          }
          const detail = await h.engine.finishDetail(runId);
          const tracked = existsSync(path.join(dir, '.git')) ? await out(['ls-files'], dir) : '';
          const baseRef = input.mode === 'new' ? 'main' : (startBranch ?? 'main');
          const commits = existsSync(path.join(dir, '.git'))
            ? Number(await out(['rev-list', '--count', `${baseRef}..HEAD`], dir).catch(() => '0'))
            : 0;
          const owned = { ...before };
          const now = tree(dir);
          const launch = h.engine.entries(runId).findLast((e) => e.type === 'handoff.launch');
          const argv = (launch?.['argv'] as string[] | undefined) ?? [];
          const toolList = argv[argv.indexOf('--allowedTools') + 1] ?? '';
          return {
            state: s.state,
            exitCode: s.state === 'PARKED' ? 2 : 0,
            parkedState: s.parked?.state ?? null,
            parkedReason: s.parked?.reason ?? null,
            resumes,
            prs: h.github.repos.get(`${ref.owner}/${ref.name}`)?.prs.length ?? 0,
            commits,
            branch: existsSync(path.join(dir, '.git'))
              ? await out(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
              : null,
            committedAs: commits ? await out(['log', '-1', '--format=%an <%ae>'], dir) : null,
            changedFiles: detail?.files.map((f) => f.path) ?? [],
            agentSummary: detail?.agent?.summary ?? null,
            ownerWorkUntouched: Object.entries(owned).every(([k, v]) => now[k] === v),
            githubRepoCreated: h.github.calls.some((c) => c.method === 'createRepo'),
            originalBranchUnchanged:
              !startBranch || (await out(['rev-parse', startBranch], dir)) === startSha,
            stateDirTracked: tracked.includes('.incubator/state/'),
            checksMode: (launch?.['checks'] as { mode?: string } | undefined)?.mode ?? null,
            agentCommands: launch ? toolList.split(',').filter((t) => t.startsWith('Bash(')) : [],
            checksRefused,
          };
        } catch (err) {
          return {
            state: 'ERROR',
            exitCode: exitCodeFor(err),
            parkedState: null,
            parkedReason: null,
            resumes,
            prs: 0,
            commits: 0,
            branch: null,
            committedAs: null,
            changedFiles: [],
            agentSummary: null,
            ownerWorkUntouched: JSON.stringify(tree(dir)) === JSON.stringify(before),
            githubRepoCreated: false,
            originalBranchUnchanged: true,
            stateDirTracked: false,
            checksMode: null,
            agentCommands: [],
            checksRefused,
          };
        } finally {
          if (input.mode === 'new') rmSync(path.dirname(dir), { recursive: true, force: true });
        }
      },
    );
  },
  captureOutput: (o) => o,
  validate(captured) {
    const o = captured as Out;
    const errors: string[] = [];
    // Whatever happens: the owner's files survive, their starting branch is not written, and the
    // run's private state never reaches a commit.
    if (!o.ownerWorkUntouched) errors.push('a file the owner had was changed or deleted');
    if (!o.originalBranchUnchanged) errors.push("the owner's starting branch was written to");
    if (o.stateDirTracked) errors.push('.incubator/state/ was committed');
    // An agent on a repository without the Incubator gate never gets a command nobody approved.
    if (
      o.checksMode === 'none' &&
      o.agentCommands.some((t) => !/^Bash\(git (status|diff):\*\)$/.test(t))
    )
      errors.push('the agent could run a command although none was approved');
    return errors;
  },
};
