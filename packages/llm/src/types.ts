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
  /** Stops the call: the process or request is cancelled and the call rejects with `InterruptedError`. */
  signal?: AbortSignal;
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
    /** Flag fixing which tools exist at all in a headless session (e.g. `--tools Read,Edit,Bash`), so an unlisted tool such as PowerShell is gone, not just unapproved. */
    availableTools?: string;
    /** Flag choosing which settings files a headless session reads (e.g. `--setting-sources project,local`), so the owner's own user-level hooks cannot rewrite the session's commands. */
    settingSources?: string;
    /** Flag that loads no MCP servers except those given on the command line (`--strict-mcp-config`), so the owner's account connectors are not offered to a headless session. */
    strictMcp?: string;
    /** Flag giving the agent another directory it may read (plan 071: the memory seed copy). */
    addDir?: string;
    /** Flag choosing the agent's reasoning effort (plan 071). */
    effort?: string;
  };
  stdinPrompt: boolean;
  eligible: { discovery: boolean; analysis: boolean; handoff: boolean };
  reasons: string[];
}

export interface LlmAdapter {
  readonly id: LlmAdapterId;
  probe(): Promise<Capabilities>;
  /** Forgets what `probe()` remembered and probes again, so an updated tool shows its new version. */
  reprobe?(): Promise<Capabilities>;
  /** Returns the raw reply; `complete()` in gate.ts adds validation, retry and parking. */
  invoke(req: CompleteRequest): Promise<RawReply>;
}
