import os from 'node:os';
import path from 'node:path';
import {
  OctokitGitHub,
  createGitOps,
  resolveGitHubToken,
  type GitHubAdapter,
} from '@incubator/git';
import { LeantimeTracker } from '@incubator/tracker';
import type { IncubatorSpec } from '@incubator/spec';
import { Portfolio } from './portfolio.js';
import { createLlmRegistry, type LlmRegistry } from '@incubator/llm';
import {
  OsKeychain,
  PolicyError,
  SecretString,
  incubatorHome,
  nodeExec,
  systemClock,
  type Clock,
  type Exec,
  type Keychain,
  type Logger,
} from '@incubator/runtime';
import { loadConfig, type IncubatorConfig } from './config.js';
import { Engine } from './engine.js';
import type { PublishDeps } from './publish.js';
import { RunStore } from './store.js';
import { createCommandVerifier } from './verify.js';

export interface LiveEngine {
  home: string;
  clock: Clock;
  exec: Exec;
  keychain: Keychain;
  config: IncubatorConfig;
  llm: LlmRegistry;
  store: RunStore;
  engine: Engine;
  github: (token: SecretString) => GitHubAdapter;
}

/**
 * The real wiring shared by the CLI, the web server and the desktop app: OS keychain, real
 * subprocesses, `~/.incubator`, Octokit, the Leantime tracker and the probed LLM adapters.
 */
export function createLiveEngine(opts: {
  log: Logger;
  home?: string;
  env?: NodeJS.ProcessEnv;
}): LiveEngine {
  const env = opts.env ?? process.env;
  const home = opts.home ?? incubatorHome();
  const clock = systemClock;
  const config = loadConfig(home);
  const log = opts.log;
  const exec = nodeExec;
  const keychain = new OsKeychain();
  const llm = createLlmRegistry({
    exec,
    keychain,
    log,
    ...(config.llm ? { config: config.llm } : {}),
    ...(env['INCUBATOR_RECORD'] ? { recordDir: path.resolve(env['INCUBATOR_RECORD']) } : {}),
  });
  const store = new RunStore(clock, home);
  const github = (token: SecretString): GitHubAdapter => new OctokitGitHub(token);
  const publish: PublishDeps = {
    resolveToken: () => resolveGitHubToken({ keychain, exec, env }),
    github,
    git: createGitOps(exec),
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
        apiKey: new SecretString(key),
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
    portfolio: new Portfolio(home),
    tools: {
      exec,
      userHome: os.homedir(),
      ...(config.toolPaths ? { toolPaths: config.toolPaths } : {}),
    },
    store,
    clock,
    log,
    llm,
    ...(config.discovery?.timeoutMs ? { llmTimeoutMs: config.discovery.timeoutMs } : {}),
  });
  return { home, clock, exec, keychain, config, llm, store, engine, github };
}
