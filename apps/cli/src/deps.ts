import path from 'node:path';
import { Engine, RunStore } from '@incubator/core';
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
  const engine = new Engine({
    store,
    clock,
    log,
    llm,
    ...(config.discovery?.timeoutMs ? { llmTimeoutMs: config.discovery.timeoutMs } : {}),
  });
  return { home, clock, exec, keychain, log, config, llm, store, engine };
};
