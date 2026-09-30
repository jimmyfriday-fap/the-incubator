import { mkdtempSync } from 'node:fs';
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
