import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FixedClock,
  Logger,
  MemoryKeychain,
  MemorySink,
  SecretString,
  ToolError,
  nodeExec,
  type Exec,
  sha256Hex,
} from '@incubator/runtime';
import { FakeGitHub, createGitOps, type GitOps } from '@incubator/git';
import { FakeTracker } from '@incubator/tracker';
import {
  FakeLlmAdapter,
  loadFixtures,
  type Capabilities,
  type FixtureTurn,
  type LlmAdapter,
  type LlmRegistry,
} from '@incubator/llm';
import type { ConfigStore } from './config.js';
import { Engine, type EngineDeps } from './engine.js';
import { Portfolio } from './portfolio.js';
import { Settings } from './settings.js';
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

/**
 * The fixture turns of `dir`, plus a stock ReviewSummary turn when the fixtures have none: the review
 * screen asks for a plain-English brief, and a run's warnings should stay the ones a test expects.
 */
export function turnsWithReviewSummary(dir: string): FixtureTurn[] {
  const turns = loadFixtures(dir);
  if (turns.some((t) => t.schemaName === 'ReviewSummary')) return turns;
  return [
    ...turns,
    {
      schemaName: 'ReviewSummary',
      note: 'stock brief, so the review screen has one',
      response: {
        headline: 'This run will carry out the plan below.',
        changes: ['Carry out the planned changes.'],
        approach:
          'A coding assistant makes the edits in a working copy. Nothing changes in your repository until you approve and later choose to commit.',
        notIncluded: [],
        watchFor: [],
      },
    },
  ];
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
          model: '--model',
          // As the real claude CLI: the allowed-tool list is how approved checks are enforced.
          allowedTools: '--allowedTools',
        },
        stdinPrompt: true,
        eligible: { discovery: true, analysis: true, handoff: true },
        reasons: [],
      }),
  };
}

/**
 * Settings over stand-in tools: `claude` installed (and able to plan, code and take a model), `copilot` not
 * installed, no keychain and one account from the environment. For the Settings page in the web tests.
 */
export function fakeSettings(home: string, config: ConfigStore): Settings {
  const caps = (installed: boolean, model: boolean): Capabilities => ({
    installed,
    ...(installed ? { version: 'fake 1.0' } : {}),
    flags: model ? { model: '--model' } : {},
    stdinPrompt: true,
    eligible: { discovery: installed, analysis: installed, handoff: installed },
    reasons: installed ? [] : ['not installed'],
  });
  const llm = {
    adapters: new Map(),
    probeAll: () =>
      Promise.resolve({
        'claude-cli': caps(true, true),
        'copilot-cli': caps(false, false),
        'cursor-cli': caps(false, false),
        'anthropic-api': {
          ...caps(true, false),
          eligible: { discovery: true, analysis: true, handoff: false },
        },
      }),
    select: (_purpose: string, preferred?: string) =>
      Promise.resolve({ id: preferred ?? config.get().llm?.preferred ?? 'claude-cli' }),
  } as unknown as LlmRegistry;
  return new Settings({
    home,
    config,
    llm,
    keychain: new MemoryKeychain(),
    credentials: () =>
      Promise.resolve([
        { account: 'github', source: 'env' },
        { account: 'anthropic', source: null },
        { account: 'leantime', source: null },
      ]),
  });
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
        'countBetween',
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
    /** Stand-ins for a stack's own tool (retrieved stacks, ADR-027). */
    tools?: EngineDeps['tools'];
    /** The live configuration (Settings, ADR-029). */
    config?: EngineDeps['config'];
    /** The portfolio (ADR-028): off unless a test asks for it, so no marker file appears in a delivery. */
    portfolio?: boolean;
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
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.config ? { config: opts.config } : {}),
    ...(opts.portfolio ? { portfolio: new Portfolio(home, () => clock.now().toISOString()) } : {}),
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
    /** The LLM adapter the run uses (a FakeLlmAdapter when built from fixtures). */
    llm,
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

/**
 * A stand-in for a stack's own tool (`flutter`), so no test needs the real one: it answers `--version` and
 * `create` in-process, writes what `flutter create` writes, and records every call. `installed: false`
 * makes the tool missing; `fail` makes the generator fail, or leave the project incomplete.
 */
export function fakeStackTools(
  opts: { installed?: boolean; fail?: 'create' | 'version' | 'incomplete' } = {},
): {
  tools: NonNullable<EngineDeps['tools']>;
  calls: { bin: string; args: string[]; cwd?: string }[];
} {
  const calls: { bin: string; args: string[]; cwd?: string }[] = [];
  const exec: Exec = {
    which: (name) =>
      Promise.resolve(
        name === 'flutter' && opts.installed !== false
          ? { path: path.join(tmpdir(), 'fake-sdk', 'flutter'), kind: 'native' as const }
          : null,
      ),
    run: (bin, args, o) => {
      calls.push({ bin, args: [...args], ...(o.cwd ? { cwd: o.cwd } : {}) });
      const done = (code: number, stdout = '', stderr = '') =>
        Promise.resolve({ code, signal: null, stdout, stderr, timedOut: false });
      if (args[0] === '--version')
        return opts.fail === 'version'
          ? done(1, '', 'Flutter SDK is broken')
          : done(0, 'Flutter 3.99.0 • channel stable\nFramework • fake\n');
      if (args[0] === 'create' && o.cwd) {
        if (opts.fail === 'create') return done(1, '', 'cannot create here');
        const files: Record<string, string> = {
          'pubspec.yaml':
            'name: fake_app\ndependencies:\n  flutter:\n    sdk: flutter\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
          'analysis_options.yaml': 'include: package:flutter_lints/flutter.yaml\n',
          'lib/main.dart': 'void main() {}\n',
          'test/widget_test.dart': 'void main() {}\n',
          '.gitignore': 'build/\n.dart_tool/\n',
        };
        for (const [rel, body] of Object.entries(files)) {
          if (opts.fail === 'incomplete' && rel === 'lib/main.dart') continue;
          const abs = path.join(o.cwd, ...rel.split('/'));
          mkdirSync(path.dirname(abs), { recursive: true });
          writeFileSync(abs, body);
        }
        return done(0, 'All done!\n');
      }
      return done(1, '', `unexpected call: ${args.join(' ')}`);
    },
  };
  return { tools: { exec, userHome: mkdtempSync(path.join(tmpdir(), 'home-')) }, calls };
}
