import path from 'node:path';
import { Engine, RunStore, createCommandVerifier, type PublishDeps } from '@incubator/core';
import {
  OctokitGitHub,
  createGitOps,
  resolveGitHubToken,
  type GitHubAdapter,
} from '@incubator/git';
import { LeantimeTracker } from '@incubator/tracker';
import type { IncubatorSpec } from '@incubator/spec';
import { createLlmRegistry, type LlmRegistry } from '@incubator/llm';
import {
  Logger,
  OsKeychain,
  consoleSink,
  incubatorHome,
  nodeExec,
  systemClock,
  type Clock,
  type Exec,
  type Keychain,
  type SecretString,
  SecretString as Secret,
  PolicyError,
} from '@incubator/runtime';
import { loadConfig, type IncubatorConfig } from './config.js';

export interface CliDeps {
  home: string;
  clock: Clock;
  exec: Exec;
  keychain: Keychain;
  log: Logger;
  config: IncubatorConfig;
  llm: LlmRegistry;
  store: RunStore;
  engine: Engine;
  /** GitHub client for a token (doctor's token check; publish uses the same factory). */
  github: (token: SecretString) => GitHubAdapter;
}

export type DepsFactory = (opts: { verbose: boolean; stderr: (t: string) => void }) => CliDeps;

/** Live wiring: OS keychain, real subprocesses, ~/.incubator. Tests inject their own factory. */
export const liveDeps: DepsFactory = ({ verbose, stderr }) => {
  const home = incubatorHome();
  const clock = systemClock;
  const config = loadConfig(home);
  const log = new Logger([
    consoleSink(verbose ? 'debug' : 'warn', {
      write: (t: string) => (stderr(String(t)), true),
    } as NodeJS.WritableStream),
  ]);
  const exec = nodeExec;
  const keychain = new OsKeychain();
  const llm = createLlmRegistry({
    exec,
    keychain,
    log,
    ...(config.llm ? { config: config.llm } : {}),
    ...(process.env['INCUBATOR_RECORD']
      ? { recordDir: path.resolve(process.env['INCUBATOR_RECORD']) }
      : {}),
  });
  const store = new RunStore(clock, home);
  const github = (token: SecretString): GitHubAdapter => new OctokitGitHub(token);
  const git = createGitOps(exec);
  const env = process.env;
  const publish: PublishDeps = {
    resolveToken: () => resolveGitHubToken({ keychain, exec, env }),
    github,
    git,
    verify: createCommandVerifier(exec),
    identity: async () => {
      const get = async (k: string) =>
        (await exec.run('git', ['config', '--get', k], { timeoutMs: 10_000 })).stdout.trim();
      const [name, email] = [await get('user.name'), await get('user.email')];
      return name && email ? { name, email } : null;
    },
    tracker: async (spec: IncubatorSpec) => {
      const lt = spec.tracker.leantime;
      if (spec.tracker.type !== 'leantime' || !lt?.baseUrl || lt.projectId === null) return null;
      const key =
        ((await keychain.available()) ? await keychain.get('incubator', 'leantime') : null) ??
        env['INCUBATOR_LEANTIME_TOKEN'];
      if (!key)
        throw new PolicyError(
          'no Leantime API key: incubator auth set leantime, or INCUBATOR_LEANTIME_TOKEN',
          { code: 'no_leantime_key' },
        );
      return new LeantimeTracker({
        baseUrl: lt.baseUrl,
        projectId: lt.projectId,
        apiKey: new Secret(key),
        ...(lt.statusMap ? { statusMap: lt.statusMap } : {}),
      });
    },
  };
  const engine = new Engine({
    publish,
    handoff: {
      exec,
      probe: async (id) =>
        (await llm.probeAll())[id] ?? {
          installed: false,
          flags: {},
          stdinPrompt: false,
          eligible: { discovery: false, analysis: false, handoff: false },
          reasons: ['unknown adapter'],
        },
    },
    store,
    clock,
    log,
    llm,
    ...(config.discovery?.timeoutMs ? { llmTimeoutMs: config.discovery.timeoutMs } : {}),
  });
  return { home, clock, exec, keychain, log, config, llm, store, engine, github };
};
