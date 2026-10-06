import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError } from '@incubator/runtime';
import type { LlmConfig } from '@incubator/llm';

export interface IncubatorConfig {
  llm?: LlmConfig;
  /** The coding agent: which CLI, and which model it is asked for (ADR-029). Absent: the spec decides. */
  agents?: { primary?: 'claude' | 'copilot' | 'cursor'; model?: string };
  gc?: { days?: number };
  discovery?: { timeoutMs?: number };
  /** Where a tool lives when it is not on PATH, by tool name (for example `flutter`). Absolute paths only. */
  toolPaths?: Record<string, string>;
}

/**
 * A model id reaches a command line, so it is a plain token: letters, digits and `. _ : -`, starting with a
 * letter or digit (threat T6). It never goes through a shell.
 */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

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

/**
 * The live configuration: read from disk on every call, so a change saved from the Settings page applies to
 * the next run without a restart. A file that cannot be read keeps the last good copy, and writes are atomic
 * (a temporary file, then a rename) with mode 0600.
 */
export class ConfigStore {
  readonly file: string;
  #last: IncubatorConfig;

  constructor(
    private readonly home: string,
    initial?: IncubatorConfig,
  ) {
    this.file = path.join(home, 'config.json');
    this.#last = initial ?? loadConfig(home);
  }

  get(): IncubatorConfig {
    try {
      this.#last = loadConfig(this.home);
    } catch {
      // why: a hand-edit mistake must not stop a run that is already under way.
    }
    return this.#last;
  }

  /** Applies a change to the stored configuration and saves it. A change that throws saves nothing. */
  update(change: (config: IncubatorConfig) => void): IncubatorConfig {
    const next = structuredClone(loadConfig(this.home));
    change(next);
    mkdirSync(this.home, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.#last = next;
    return next;
  }
}
