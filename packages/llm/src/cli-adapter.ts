import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ToolError, type Exec, type Logger } from '@incubator/runtime';
import { ProbeCache } from './probe-cache.js';
import type { Capabilities, CompleteRequest, LlmAdapter, LlmAdapterId, RawReply } from './types.js';

export interface CliAdapterOptions {
  id: Exclude<LlmAdapterId, 'anthropic-api' | 'fake'>;
  bin: string;
  exec: Exec;
  /** Environment variables the CLI needs for its own login; everything else is dropped. */
  authEnv?: readonly string[];
  model?: string;
  probeCache?: ProbeCache;
  log?: Logger;
}

export const CLI_BINARIES: Record<CliAdapterOptions['id'], string> = {
  'claude-cli': 'claude',
  'copilot-cli': 'copilot',
  'cursor-cli': 'cursor-agent',
};

export const CLI_AUTH_ENV: Record<CliAdapterOptions['id'], readonly string[]> = {
  'claude-cli': [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CONFIG_DIR',
    'XDG_CONFIG_HOME',
  ],
  'copilot-cli': ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN', 'XDG_CONFIG_HOME'],
  'cursor-cli': ['CURSOR_API_KEY', 'XDG_CONFIG_HOME'],
};

/** Unwraps CLI JSON envelopes such as `{ "type": "result", "result": "...", "total_cost_usd": 0.1 }`. */
export function unwrapCliOutput(stdout: string): RawReply {
  const trimmed = stdout.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { text: stdout };
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    const cost =
      typeof o['total_cost_usd'] === 'number'
        ? o['total_cost_usd']
        : typeof o['cost_usd'] === 'number'
          ? o['cost_usd']
          : undefined;
    const base: RawReply = cost === undefined ? {} : { costUsd: cost };
    if (typeof o['model'] === 'string') base.model = o['model'];
    if (o['is_error'] === true)
      throw new ToolError(
        `CLI reported an error: ${typeof o['result'] === 'string' ? o['result'] : 'unknown'}`,
      );
    for (const key of ['result', 'response', 'text', 'output']) {
      if (typeof o[key] === 'string') return { ...base, text: o[key] };
    }
    return { ...base, value: parsed };
  }
  return { value: parsed };
}

/**
 * Local agent CLI as an LLM (ADR-007): capabilities probed from `--help`, run with tools disabled
 * when possible, in an empty temp cwd, with an allowlisted environment and the prompt on stdin.
 */
export class CliAdapter implements LlmAdapter {
  readonly id: CliAdapterOptions['id'];
  #caps: Promise<Capabilities> | undefined;

  constructor(private readonly opts: CliAdapterOptions) {
    this.id = opts.id;
  }

  probe(): Promise<Capabilities> {
    this.#caps ??= (this.opts.probeCache ?? new ProbeCache()).get(this.opts.exec, this.opts.bin);
    return this.#caps;
  }

  async invoke(req: CompleteRequest): Promise<RawReply> {
    const caps = await this.probe();
    if (!caps.eligible.discovery) {
      throw new ToolError(`${this.id} cannot be used headless: ${caps.reasons.join('; ')}`, {
        code: 'adapter_ineligible',
      });
    }
    const f = caps.flags;
    const args = [...(f.printMode ?? []), ...(f.jsonOutput ?? []), ...(f.disableTools ?? [])];
    if (this.opts.model && f.model) args.push(f.model, this.opts.model);
    const contract = `Reply with only one JSON value that validates against this JSON Schema (${req.schemaName}):\n${JSON.stringify(req.schema)}`;
    let stdin = `${req.user}\n\n${contract}\n`;
    if (f.systemPrompt) args.push(f.systemPrompt, req.system);
    else stdin = `${req.system}\n\n---\n\n${stdin}`;
    const cwd = await mkdtemp(path.join(tmpdir(), 'incubator-llm-'));
    try {
      const env: Record<string, string | undefined> = {};
      for (const key of this.opts.authEnv ?? CLI_AUTH_ENV[this.id]) env[key] = process.env[key];
      const r = await this.opts.exec.run(this.opts.bin, args, {
        cwd,
        stdin,
        timeoutMs: req.timeoutMs,
        inheritEnv: false,
        env,
        ...(this.opts.log ? { log: this.opts.log.child({ adapter: this.id }) } : {}),
      });
      if (r.timedOut)
        throw new ToolError(`${this.id} timed out after ${req.timeoutMs} ms`, {
          code: 'llm_timeout',
        });
      if (r.code !== 0) {
        throw new ToolError(
          `${this.id} exited ${String(r.code)}: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`,
          {
            code: 'llm_exit',
          },
        );
      }
      return unwrapCliOutput(r.stdout);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}
