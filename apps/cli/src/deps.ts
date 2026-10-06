import {
  createLiveEngine,
  type Engine,
  type IncubatorConfig,
  type RunStore,
  type Settings,
} from '@incubator/core';
import type { GitHubAdapter } from '@incubator/git';
import type { LlmRegistry } from '@incubator/llm';
import {
  Logger,
  consoleSink,
  type Clock,
  type Exec,
  type Keychain,
  type SecretString,
} from '@incubator/runtime';

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
  /** Read and save the configuration (the Settings page, `incubator config`). */
  settings?: Settings;
  /** GitHub client for a token (doctor's token check; publish uses the same factory). */
  github: (token: SecretString) => GitHubAdapter;
  /** Tests: resolves to stop long-running commands (`ui`) instead of waiting for a signal. */
  stop?: Promise<unknown>;
}

export type DepsFactory = (opts: { verbose: boolean; stderr: (t: string) => void }) => CliDeps;

/** Live wiring: OS keychain, real subprocesses, ~/.incubator. Tests inject their own factory. */
export const liveDeps: DepsFactory = ({ verbose, stderr }) => {
  const log = new Logger([
    consoleSink(verbose ? 'debug' : 'warn', {
      write: (t: string) => (stderr(String(t)), true),
    } as NodeJS.WritableStream),
  ]);
  return { ...createLiveEngine({ log }), log };
};
