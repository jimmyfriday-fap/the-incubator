export const LLM_ADAPTER_IDS = [
  'claude-cli',
  'copilot-cli',
  'cursor-cli',
  'anthropic-api',
  'fake',
] as const;
export type LlmAdapterId = (typeof LLM_ADAPTER_IDS)[number];

export function isLlmAdapterId(value: string): value is LlmAdapterId {
  return (LLM_ADAPTER_IDS as readonly string[]).includes(value);
}

export type JsonSchema = Record<string, unknown>;

export interface CompleteRequest {
  /** Stable name of the output schema (fixture keys, logs). */
  schemaName: string;
  schema: JsonSchema;
  system: string;
  user: string;
  /** Version of the prompt that produced `system` (fixture keys). */
  promptVersion: string;
  timeoutMs: number;
}

/** One raw model reply, before schema validation. */
export interface RawReply {
  /** Model text (JSON expected somewhere inside) or an already-parsed value. */
  text?: string;
  value?: unknown;
  costUsd?: number;
  model?: string;
}

export interface Capabilities {
  installed: boolean;
  path?: string;
  version?: string;
  /** Argument lists for each capability, as probed from `--help`. */
  flags: {
    printMode?: string[];
    jsonOutput?: string[];
    streamJson?: string[];
    disableTools?: string[];
    maxTurns?: string;
    model?: string;
    systemPrompt?: string;
    /** Extra flag some CLIs need to stream JSON in print mode. */
    verbose?: string;
    /** Lets a headless handoff edit files without prompting (e.g. `--permission-mode acceptEdits`). */
    acceptEdits?: string[];
    /** Flag taking an allow-list of tools/commands for a headless handoff. */
    allowedTools?: string;
  };
  stdinPrompt: boolean;
  eligible: { discovery: boolean; analysis: boolean; handoff: boolean };
  reasons: string[];
}

export interface LlmAdapter {
  readonly id: LlmAdapterId;
  probe(): Promise<Capabilities>;
  /** Returns the raw reply; `complete()` in gate.ts adds validation, retry and parking. */
  invoke(req: CompleteRequest): Promise<RawReply>;
}
