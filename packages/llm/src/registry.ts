import path from 'node:path';
import {
  SecretString,
  ToolError,
  incubatorHome,
  type Exec,
  type Keychain,
  type Logger,
} from '@incubator/runtime';
import { AnthropicApiAdapter, type Effort } from './anthropic.js';
import { CLI_BINARIES, CliAdapter } from './cli-adapter.js';
import { RecordingAdapter } from './fake.js';
import { ProbeCache } from './probe-cache.js';
import type { Capabilities, LlmAdapter, LlmAdapterId } from './types.js';

export interface LlmConfig {
  preferred?: LlmAdapterId;
  anthropic?: { model?: string; effort?: Effort; fallbacks?: boolean };
  cliModel?: string;
}

/** The settings, or a function that returns the current ones, so a saved change applies to the next call. */
export type LlmConfigSource = LlmConfig | (() => LlmConfig | undefined);

export interface LlmRegistry {
  adapters: ReadonlyMap<LlmAdapterId, LlmAdapter>;
  probeAll(): Promise<Record<string, Capabilities>>;
  /** First eligible adapter for the purpose, honouring an explicit or configured preference. */
  select(
    purpose: 'discovery' | 'analysis' | 'handoff',
    preferred?: LlmAdapterId,
  ): Promise<LlmAdapter>;
}

export const SELECTION_ORDER: readonly LlmAdapterId[] = [
  'claude-cli',
  'copilot-cli',
  'cursor-cli',
  'anthropic-api',
];

/** Resolves the Anthropic key: keychain first, then ANTHROPIC_API_KEY. Never from a file. */
export function anthropicKeySource(
  keychain: Keychain,
  env: NodeJS.ProcessEnv = process.env,
): () => Promise<SecretString | null> {
  return async () => {
    const fromKeychain = await keychain.get('incubator', 'anthropic').catch(() => null);
    if (fromKeychain) return new SecretString(fromKeychain);
    const fromEnv = env['ANTHROPIC_API_KEY'];
    return fromEnv ? new SecretString(fromEnv) : null;
  };
}

/** One adapter that cannot be probed (e.g. a shim that needs a shell) must not abort the whole registry. */
async function safeProbe(adapter: LlmAdapter): Promise<Capabilities> {
  try {
    return await adapter.probe();
  } catch (e) {
    if (!(e instanceof ToolError)) throw e;
    return {
      installed: true,
      flags: {},
      stdinPrompt: false,
      eligible: { discovery: false, analysis: false, handoff: false },
      reasons: [e.message],
    };
  }
}

export function createLlmRegistry(deps: {
  exec: Exec;
  keychain: Keychain;
  config?: LlmConfigSource;
  log?: Logger;
  extra?: LlmAdapter[];
  env?: NodeJS.ProcessEnv;
  /** Record every exchange as keyed fixtures into this directory (`INCUBATOR_RECORD`). */
  recordDir?: string;
}): LlmRegistry {
  const config = (): LlmConfig | undefined =>
    typeof deps.config === 'function' ? deps.config() : deps.config;
  const cache = new ProbeCache(path.join(incubatorHome(deps.env), 'cache', 'probe.json'));
  const adapters = new Map<LlmAdapterId, LlmAdapter>();
  for (const id of ['claude-cli', 'copilot-cli', 'cursor-cli'] as const) {
    adapters.set(
      id,
      new CliAdapter({
        id,
        bin: CLI_BINARIES[id],
        exec: deps.exec,
        probeCache: cache,
        model: () => config()?.cliModel,
        ...(deps.log ? { log: deps.log } : {}),
      }),
    );
  }
  adapters.set(
    'anthropic-api',
    new AnthropicApiAdapter({
      apiKey: anthropicKeySource(deps.keychain, deps.env),
      ...config()?.anthropic,
    }),
  );
  for (const a of deps.extra ?? []) adapters.set(a.id, a);

  return {
    adapters,
    async probeAll() {
      const out: Record<string, Capabilities> = {};
      for (const [id, a] of adapters) out[id] = await safeProbe(a);
      return out;
    },
    async select(purpose, preferred) {
      const wanted = preferred ?? config()?.preferred;
      const order = wanted ? [wanted] : [...SELECTION_ORDER];
      const rejected: string[] = [];
      for (const id of order) {
        const adapter = adapters.get(id);
        if (!adapter) {
          rejected.push(`${id}: unknown adapter`);
          continue;
        }
        const caps = await safeProbe(adapter);
        if (caps.eligible[purpose])
          return deps.recordDir ? new RecordingAdapter(adapter, deps.recordDir) : adapter;
        rejected.push(`${id}: ${caps.reasons.join('; ') || 'not eligible'}`);
      }
      throw new ToolError(
        `no LLM adapter is available for ${purpose}:\n  ${rejected.join('\n  ')}\nRun \`incubator doctor\` for details.`,
        {
          code: 'no_llm_adapter',
        },
      );
    },
  };
}
