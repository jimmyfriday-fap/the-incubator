import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { globalRedactor, ParkError, type Exec } from '@incubator/runtime';
import type { Capabilities, LlmAdapterId } from '@incubator/llm';
import type { IncubatorSpec } from '@incubator/spec';
import { loadPrompt } from './prompts.js';

export type HandoffAgent = 'claude' | 'copilot' | 'cursor';

export const AGENT_ADAPTERS: Record<HandoffAgent, LlmAdapterId> = {
  claude: 'claude-cli',
  copilot: 'copilot-cli',
  cursor: 'cursor-cli',
};

export interface Ceilings {
  turns: number;
  toolCalls: number;
  minutes: number;
  usd: number;
}

export interface HandoffPlan {
  agent: HandoffAgent;
  bin: string;
  argv: string[];
  cwd: string;
  planPath: string;
  ceilings: Ceilings;
  /** Ceilings this adapter cannot enforce from its stream (reported, never silently dropped). */
  unenforceable: (keyof Ceilings)[];
}

/**
 * What a headless agent may run without asking: file edits plus the repository's own gates and
 * read-only git. Committing, pushing and promoting stay with the owner (ADR-017, ADR-023): the run asks
 * for the commit once the agent has stopped.
 */
export const HANDOFF_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(node scripts/check.mjs:*)',
  'Bash(node scripts/test-profile.mjs:*)',
  'Bash(node scripts/scaffold.mjs:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
];

/** Headless argv from probed capabilities: print mode, streaming JSON, and max turns when offered. */
export function buildHandoffArgv(caps: Capabilities, ceilings: Ceilings): string[] {
  const f = caps.flags;
  if (!f.printMode || !f.streamJson)
    throw new ParkError(
      'handoff_unsupported',
      'this CLI has no headless streaming mode (print + stream-json)',
    );
  return [
    ...f.printMode,
    ...f.streamJson,
    ...(f.verbose ? [f.verbose] : []),
    ...(f.maxTurns ? [f.maxTurns, String(ceilings.turns)] : []),
    ...(f.acceptEdits ?? []),
    ...(f.allowedTools ? [f.allowedTools, HANDOFF_ALLOWED_TOOLS.join(',')] : []),
  ];
}

export function handoffPrompt(planText: string): string {
  return `${loadPrompt('handoff').body}\n\n${planText.trim()}\n`;
}

/**
 * Counts turns, tool calls and cost from a stream-json event stream (Claude-style `assistant`
 * messages with `tool_use` blocks and a final `result` with `total_cost_usd`; other CLIs that emit
 * the same shapes are covered, anything else leaves the minutes ceiling in charge).
 */
export class CeilingMonitor {
  turns = 0;
  toolCalls = 0;
  costUsd: number | null = null;
  tripped: string | null = null;
  /** The last assistant text block seen (a fallback when the stream has no `result` text). */
  lastText: string | null = null;
  /** The final `result` text of the stream, when the agent sent one. */
  resultText: string | null = null;
  #buf = '';

  constructor(
    private readonly ceilings: Ceilings,
    private readonly turnsByFlag: boolean,
  ) {}

  feed(chunk: string): string | null {
    this.#buf += chunk;
    let i: number;
    while ((i = this.#buf.indexOf('\n')) >= 0) {
      const line = this.#buf.slice(0, i).trim();
      this.#buf = this.#buf.slice(i + 1);
      if (line) this.event(line);
    }
    return this.tripped;
  }

  private event(line: string): void {
    let e: {
      type?: string;
      message?: { content?: { type?: string; text?: unknown }[] };
      result?: unknown;
      total_cost_usd?: number;
      cost_usd?: number;
    };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      return;
    }
    if (e.type === 'assistant') {
      this.turns++;
      const blocks = e.message?.content ?? [];
      this.toolCalls += blocks.filter((c) => c.type === 'tool_use').length;
      const text = blocks.find(
        (c) => c.type === 'text' && typeof c.text === 'string' && c.text.trim(),
      );
      if (text) this.lastText = String(text.text);
    }
    if (e.type === 'result' && typeof e.result === 'string' && e.result.trim())
      this.resultText = e.result;
    const cost = e.total_cost_usd ?? e.cost_usd;
    if (typeof cost === 'number') this.costUsd = cost;
    if (this.tripped) return;
    if (!this.turnsByFlag && this.turns > this.ceilings.turns)
      this.tripped = `turns ${this.turns} > ${this.ceilings.turns}`;
    else if (this.toolCalls > this.ceilings.toolCalls)
      this.tripped = `tool calls ${this.toolCalls} > ${this.ceilings.toolCalls}`;
    else if (this.costUsd !== null && this.costUsd > this.ceilings.usd)
      this.tripped = `cost $${this.costUsd} > $${this.ceilings.usd}`;
  }
}

export interface HandoffOutcome {
  exitCode: number | null;
  turns: number;
  toolCalls: number;
  costUsd: number | null;
  tripped: string | null;
  ticketState: string | null;
  /** What the agent said at the end: its result text, else its last message. Cleaned and capped. */
  summary: string | null;
}

/** Agent text is data: control and bidi characters removed, lines kept, length capped. */
export function cleanAgentText(text: string | null, max = 4000): string | null {
  if (!text) return null;
  const t = text
    .replace(/\r\n?/g, '\n')
    .replace(AGENT_TEXT_CONTROL, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
/* eslint-disable no-control-regex -- why: control characters are exactly what is stripped. */
const AGENT_TEXT_CONTROL =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
/* eslint-enable no-control-regex */

/** A live progress report from a running agent: counters and a short cleaned snippet of its latest text. */
export interface HandoffProgress {
  turns: number;
  toolCalls: number;
  costUsd: number | null;
  snippet: string | null;
}

/**
 * The active ticket for the Stop hook: the first feature ticket not yet READY_FOR_TEST. Enhance
 * runs pass their own ticket ids (`E-<id>`); otherwise every feature's `F-<id>` is considered.
 */
export function activeTicket(
  repo: string,
  spec: IncubatorSpec,
  ids: readonly string[] = spec.intent.coreFeatures.map((f) => `F-${f.id}`),
): string | null {
  for (const id of ids) {
    const file = path.join(repo, '.incubator', 'tickets', `${id}.json`);
    if (!existsSync(file)) return id;
    const t = JSON.parse(readFileSync(file, 'utf8')) as { state?: string };
    if (t.state !== 'READY_FOR_TEST' && t.state !== 'TEST_PASSED' && t.state !== 'DEPLOYED')
      return id;
  }
  return null;
}

export function ticketState(repo: string, id: string): string | null {
  const file = path.join(repo, '.incubator', 'tickets', `${id}.json`);
  return existsSync(file)
    ? ((JSON.parse(readFileSync(file, 'utf8')) as { state?: string }).state ?? null)
    : null;
}

/**
 * Runs the agent CLI headless in the repository clone, bounded by the run ceilings. Output is
 * redacted into `logFile`. A tripped ceiling kills the process tree and parks the run with evidence.
 */
export async function launchHandoff(
  exec: Exec,
  plan: HandoffPlan,
  prompt: string,
  opts: {
    logFile: string;
    ticket: string | null;
    onEvent?: (line: string) => void;
    /** Called when the counters or the latest text change (at most once per assistant turn). */
    onProgress?: (p: HandoffProgress) => void;
  },
): Promise<HandoffOutcome> {
  mkdirSync(path.dirname(opts.logFile), { recursive: true });
  if (opts.ticket) {
    mkdirSync(path.join(plan.cwd, '.incubator', 'state'), { recursive: true });
    writeFileSync(path.join(plan.cwd, '.incubator', 'state', 'active-ticket'), `${opts.ticket}\n`);
  }
  const monitor = new CeilingMonitor(
    plan.ceilings,
    plan.argv.includes(String(plan.ceilings.turns)),
  );
  const abort = new AbortController();
  let reported = -1;
  const r = await exec.run(plan.bin, plan.argv, {
    cwd: plan.cwd,
    stdin: prompt,
    timeoutMs: plan.ceilings.minutes * 60_000,
    signal: abort.signal,
    onStdout: (chunk) => {
      appendFileSync(opts.logFile, globalRedactor.redact(chunk));
      opts.onEvent?.(chunk);
      if (monitor.feed(chunk) && !abort.signal.aborted) abort.abort();
      if (opts.onProgress && monitor.turns > 0 && monitor.turns !== reported) {
        reported = monitor.turns;
        opts.onProgress({
          turns: monitor.turns,
          toolCalls: monitor.toolCalls,
          costUsd: monitor.costUsd,
          snippet: cleanAgentText(monitor.lastText, 300),
        });
      }
    },
    onStderr: (chunk) => appendFileSync(opts.logFile, globalRedactor.redact(chunk)),
  });
  const tripped = monitor.tripped ?? (r.timedOut ? `minutes > ${plan.ceilings.minutes}` : null);
  return {
    exitCode: r.code,
    turns: monitor.turns,
    toolCalls: monitor.toolCalls,
    costUsd: monitor.costUsd,
    tripped,
    ticketState: opts.ticket ? ticketState(plan.cwd, opts.ticket) : null,
    summary: cleanAgentText(monitor.resultText ?? monitor.lastText),
  };
}
