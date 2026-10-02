import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FixedClock,
  Logger,
  MemorySink,
  SecretString,
  ToolError,
  nodeExec,
  sha256Hex,
} from '@incubator/runtime';
import { FakeGitHub, createGitOps, type GitOps } from '@incubator/git';
import { FakeTracker } from '@incubator/tracker';
import { FakeLlmAdapter, type FixtureTurn, type LlmAdapter } from '@incubator/llm';
import { Engine, type EngineDeps } from './engine.js';
import { RunStore } from './store.js';
import type { VerifyResult } from './publish.js';

/** Test harness: an engine on a temp INCUBATOR_HOME with a fake LLM. */
export function fakeEngine(llm: LlmAdapter | FixtureTurn[] | { dir: string }) {
  const home = mkdtempSync(path.join(tmpdir(), 'incubator-home-'));
  const clock = new FixedClock('2026-05-01T12:00:00Z');
  const sink = new MemorySink();
  const log = new Logger([sink], {}, undefined, clock);
  let adapter = 'invoke' in llm ? llm : new FakeLlmAdapter(llm);
  const store = new RunStore(clock, home);
  const engine = new Engine({ store, clock, log, llm: { select: () => Promise.resolve(adapter) } });
  return {
    engine,
    store,
    home,
    clock,
    sink,
    get adapter() {
      return adapter;
    },
    setAdapter(a: LlmAdapter) {
      adapter = a;
    },
  };
}

export function enhanceFixtureDir(name: string): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'fixtures',
    'enhance',
    name,
  );
}

/** The stand-in agent CLI (packages/core/fixtures/handoff/fake-agent.mjs); FAKE_AGENT_MODE picks its behaviour. */
export function fakeAgentPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'fixtures',
    'handoff',
    'fake-agent.mjs',
  );
}

/** A handoff dependency that runs the fake agent through the real process runner. */
export function fakeAgentHandoff(): NonNullable<EngineDeps['handoff']> {
  return {
    exec: nodeExec,
    probe: () =>
      Promise.resolve({
        installed: true,
        path: process.execPath,
        version: 'fake',
        flags: {
          printMode: [fakeAgentPath(), '-p'],
          streamJson: ['--output-format', 'stream-json'],
        },
        stdinPrompt: true,
        eligible: { discovery: true, analysis: true, handoff: true },
        reasons: [],
      }),
  };
}

export function discoveryFixtureDir(name: string): string {
  // why: fileURLToPath decodes %20 and drive letters; a raw URL pathname breaks under
  // "The Incubator.app" (macOS) or any directory with a space.
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'fixtures',
    'discovery',
    name,
  );
}

/** GitOps with injectable failures (before or after the effect), for resume tests. */
export function faultyGit(inner: GitOps) {
  const state: {
    failAt: { method: keyof GitOps; when: 'before' | 'after' } | null;
    calls: string[];
  } = {
    failAt: null,
    calls: [],
  };
  const wrap = <K extends keyof GitOps>(method: K): GitOps[K] =>
    (async (...args: unknown[]) => {
      state.calls.push(method);
      const f = state.failAt?.method === method ? state.failAt : null;
      if (f?.when === 'before') {
        state.failAt = null;
        throw new ToolError(`injected failure before git ${method}`);
      }
      const out = await (inner[method] as (...a: unknown[]) => Promise<unknown>).apply(inner, args);
      if (f?.when === 'after') {
        state.failAt = null;
        throw new ToolError(`injected failure after git ${method}`);
      }
      return out;
    }) as GitOps[K];
  const git = Object.fromEntries(
    (
      [
        'init',
        'addAll',
        'chmodX',
        'commit',
        'headSha',
        'headMessage',
        'push',
        'remoteSha',
        'clone',
        'checkoutNewBranch',
        'currentBranch',
        'diffNameStatus',
        'remoteGetUrl',
        'remotes',
        'status',
        'fetch',
        'checkout',
        'remoteAdd',
        'identity',
      ] as const
    ).map((m) => [m, wrap(m)]),
  ) as unknown as GitOps;
  return { git, state };
}

export const FAKE_GITHUB_TOKEN = 'ghp_fake_token_for_tests_0123456789';

/** An engine wired to a fake GitHub (bare repositories), real git and a scripted verifier. */
export function fakePublishEngine(
  opts: {
    verify?: () => VerifyResult;
    github?: ConstructorParameters<typeof FakeGitHub>[1];
    handoff?: EngineDeps['handoff'];
    /** Discovery turns for greenfield runs (default: no LLM). */
    llm?: LlmAdapter | FixtureTurn[] | { dir: string };
  } = {},
) {
  const home = mkdtempSync(path.join(tmpdir(), 'incubator-home-'));
  const clock = new FixedClock('2026-05-01T12:00:00Z');
  const sink = new MemorySink();
  const log = new Logger([sink], {}, undefined, clock);
  const store = new RunStore(clock, home);
  const github = new FakeGitHub(nodeExec, opts.github ?? {});
  const { git, state: gitFaults } = faultyGit(createGitOps(nodeExec));
  let verifyCalls = 0;
  const verifyFaults = { failNext: false };
  const tracker = new FakeTracker();
  // why: one adapter for the whole run, so fixture turns advance round by round.
  const llm = opts.llm && ('invoke' in opts.llm ? opts.llm : new FakeLlmAdapter(opts.llm));
  const engine = new Engine({
    store,
    clock,
    log,
    llm: {
      select: () =>
        llm ? Promise.resolve(llm) : Promise.reject(new ToolError('no LLM in publish tests')),
    },
    ...(opts.handoff ? { handoff: opts.handoff } : {}),
    publish: {
      resolveToken: () =>
        Promise.resolve({ token: new SecretString(FAKE_GITHUB_TOKEN), source: 'env' as const }),
      github: () => github,
      git,
      verify: () => {
        verifyCalls++;
        if (verifyFaults.failNext) {
          verifyFaults.failNext = false;
          return Promise.reject(new ToolError('injected verify crash'));
        }
        return Promise.resolve(opts.verify?.() ?? { ok: true, summary: 'check quick: ok (fake)' });
      },
      identity: () => Promise.resolve({ name: 'Incubator Test', email: 'test@example.invalid' }),
      tracker: () => Promise.resolve(tracker),
    },
  });
  return {
    engine,
    store,
    home,
    clock,
    sink,
    github,
    gitFaults,
    verifyFaults,
    tracker,
    verifyCalls: () => verifyCalls,
  };
}

/** Every file under `dir` (except `.git`) as `relative path → sha256`, for before/after comparisons. */
export function hashTree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    if (name === '.git') continue;
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(dir, r)).isDirectory()) Object.assign(out, hashTree(dir, r));
    else out[r] = sha256Hex(readFileSync(path.join(dir, r)));
  }
  return out;
}

/**
 * Puts a directory (copied from `from`, or built by it) into a git repository whose origin is a new
 * repository on the fake GitHub, with `main` pushed: the starting point of an adopt or enhance run.
 */
export async function seedExistingRepo(
  github: FakeGitHub,
  name: string,
  from: string | ((dir: string) => Promise<void>),
  owner = 'octo',
): Promise<{ ref: { owner: string; name: string }; dir: string }> {
  const ref = { owner, name };
  await github.createRepo({
    ...ref,
    ownerType: 'user',
    visibility: 'private',
    description: 'existing project',
  });
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'existing-src-')), name);
  if (typeof from === 'string')
    cpSync(from, dir, { recursive: true, filter: (s) => !s.endsWith('expected-gap-report.json') });
  else await from(dir);
  const git = async (args: string[]): Promise<void> => {
    const r = await nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 });
    if (r.code !== 0) throw new ToolError(`git ${args.join(' ')} failed: ${r.stderr}`);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['add', '-A']);
  await git([
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.invalid',
    'commit',
    '-q',
    '-m',
    'existing',
  ]);
  await git(['remote', 'add', 'origin', github.remoteUrl(ref)]);
  await git(['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  return { ref, dir };
}
