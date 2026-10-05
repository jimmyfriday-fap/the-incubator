import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError } from '@incubator/runtime';
import type { LlmConfig } from '@incubator/llm';

export interface IncubatorConfig {
  llm?: LlmConfig;
  gc?: { days?: number };
  discovery?: { timeoutMs?: number };
  /** Where a tool lives when it is not on PATH, by tool name (for example `flutter`). Absolute paths only. */
  toolPaths?: Record<string, string>;
}

/** `~/.incubator/config.json` (optional). Unknown keys are kept; malformed JSON is a policy error. */
export function loadConfig(home: string): IncubatorConfig {
  const file = path.join(home, 'config.json');
  if (!existsSync(file)) return {};
  try {
    const cfg: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg))
      throw new Error('not an object');
    return cfg;
  } catch (e) {
    throw new PolicyError(`invalid ${file}: ${e instanceof Error ? e.message : String(e)}`, {
      code: 'bad_config',
    });
  }
}
