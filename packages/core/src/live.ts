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
import { ConfigStore, loadConfig, type IncubatorConfig } from './config.js';
import { Settings, type CredentialSource } from './settings.js';
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
  /** The Settings page and `incubator config`: read and save the configuration (ADR-029). */
  settings: Settings;
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
  // why: read on every use, so a setting saved from the page applies to the next run without a restart.
  const configStore = new ConfigStore(home, config);
  const log = opts.log;
  const exec = nodeExec;
  const keychain = new OsKeychain();
  const llm = createLlmRegistry({
    exec,
    keychain,
    log,
    config: () => configStore.get().llm,
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
    config: () => configStore.get(),
    store,
    clock,
    log,
    llm,
  });
  const credentials = async (): Promise<CredentialSource[]> => {
    const fromKeychain = async (account: string): Promise<boolean> =>
      (await keychain.available()) &&
      Boolean(await keychain.get('incubator', account).catch(() => null));
    const github = await resolveGitHubToken({ keychain, exec, env }).catch(() => null);
    return [
      { account: 'github', source: github?.source ?? null },
      {
        account: 'anthropic',
        source: (await fromKeychain('anthropic'))
          ? 'keychain'
          : env['ANTHROPIC_API_KEY']
            ? 'env'
            : null,
      },
      {
        account: 'leantime',
        source: (await fromKeychain('leantime'))
          ? 'keychain'
          : env['INCUBATOR_LEANTIME_TOKEN']
            ? 'env'
            : null,
      },
    ];
  };
  const settings = new Settings({ home, config: configStore, llm, keychain, credentials });
  return { home, clock, exec, keychain, config, llm, store, engine, github, settings };
}
