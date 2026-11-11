import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { globalRedactor, ParkError, type Exec } from '@incubator/runtime';
import type { Capabilities, LlmAdapterId } from '@incubator/llm';
import type { IncubatorSpec } from '@incubator/spec';
import { MODEL_ID } from './config.js';
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
  /** Dollars at list price. The agent reports its cost only in its final message, so this stops nothing mid-run. */
  usd: number;
  /**
   * Tokens the agent may process: input + output + cache writes + cache reads, counted reply by reply as the
   * stream arrives, so it stops a run mid-way. Absent or 0 means no cap. It is a proxy for plan usage, not dollars.
   */
  tokens?: number;
}

/** The ceilings the owner may set in `~/.incubator/config.json` (`agents.ceilings`). Unset keeps the spec's value. */
export type OwnerCeilings = Partial<Record<keyof Ceilings, number>>;

/**
 * The ceilings a run is held to. The owner's own choice wins over the spec (as the coding model does, ADR-029);
 * a value that is not a positive number is ignored, and for `tokens` an explicit 0 turns the cap off.
 * `tokenDefault` is the cap a run gets when the owner set none (a Backshack build, ADR-030).
 */
export function resolveCeilings(
  spec: { turns: number; toolCalls: number; minutes: number; usd: number },
  owner: unknown,
  defaults: { turns: number; toolCalls: number; minutes: number; usd: number },
  tokenDefault = 0,
): Ceilings {
  const o = (owner !== null && typeof owner === 'object' ? owner : {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  const pick = (key: keyof typeof spec): number => {
    const own = num(o[key]);
    if (own !== undefined && own > 0) return own;
    return spec[key] > 0 ? spec[key] : defaults[key];
  };
  const tokens = num(o['tokens']) ?? tokenDefault;
  return {
    turns: pick('turns'),
    toolCalls: pick('toolCalls'),
    minutes: pick('minutes'),
    usd: pick('usd'),
    ...(tokens > 0 ? { tokens } : {}),
  };
}

/** What a run processed, by kind. `total` is the sum the token cap is measured against. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

const count = (n: number): string => n.toLocaleString('en-US');

export interface HandoffPlan {
  agent: HandoffAgent;
  bin: string;
  argv: string[];
  cwd: string;
  planPath: string;
  ceilings: Ceilings;
  /** The model the owner asked for (Settings); absent means the tool's own default. */
  model?: string;
  /** Added to the agent's environment: the directory of a tool the owner approved but PATH lacks. */
  env?: Record<string, string>;
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

/**
 * Headless argv from probed capabilities: print mode, streaming JSON, and max turns when offered. `extra`
 * (plan 071): directories the agent may also read, and a reasoning effort. Effort is left out when the CLI
 * has no flag for it; the caller reports that (`effortApplied`).
 */
export function buildHandoffArgv(
  caps: Capabilities,
  ceilings: Ceilings,
  tools: readonly string[] = HANDOFF_ALLOWED_TOOLS,
  model?: string,
  extra: {
    addDirs?: readonly string[];
    effort?: string;
    available?: readonly string[];
    isolateSettings?: boolean;
  } = {},
): string[] {
  const f = caps.flags;
  if (extra.addDirs?.length && !f.addDir)
    throw new ParkError(
      'add_dir_unsupported',
      'this CLI cannot be given another directory to read, so it cannot be handed the memory seed',
    );
  if (model !== undefined) {
    if (!MODEL_ID.test(model))
      throw new ParkError(
        'bad_model',
        `"${model}" is not a model id (letters, digits and . _ : -)`,
      );
    if (!f.model)
      throw new ParkError(
        'model_unsupported',
        `this CLI has no flag for choosing a model, so "${model}" cannot be used: clear the coding model in Settings`,
      );
  }
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
    ...(model !== undefined && f.model ? [f.model, model] : []),
    ...(extra.effort !== undefined && f.effort ? [f.effort, extra.effort] : []),
    // why: `--add-dir` takes several values, so it is always followed by another flag.
    ...(extra.addDirs?.length && f.addDir ? [f.addDir, ...extra.addDirs] : []),
    // why: `--allowedTools` only pre-approves; an unlisted tool (PowerShell on Windows) still exists. `--tools` removes it.
    ...(extra.available?.length && f.availableTools
      ? [f.availableTools, extra.available.join(',')]
      : []),
    // why: the owner's user-level hooks (a PreToolUse hook that wraps Bash commands) make every allow-listed command
    // unverifiable, so a memory session reads only the project's and the local settings (acceptance build 3).
    ...(extra.isolateSettings && f.settingSources ? [f.settingSources, 'project,local'] : []),
    ...(f.acceptEdits ?? []),
    ...(f.allowedTools ? [f.allowedTools, tools.join(',')] : []),
  ];
}

/**
 * The agent's prompt. `external` is a repository the Incubator did not build (ADR-025): another
 * prompt, with the check commands the owner approved (possibly none) spelled out. `backshack` is the
 * Backshack Build Contract (ADR-030), given only on a `backshack-tool` run: it follows the plan, verbatim.
 */
export function handoffPrompt(
  planText: string,
  external?: { checks: readonly string[] },
  backshack?: { contract: string },
): string {
  const contract = backshack
    ? `\n${loadPrompt('handoff-backshack').body}\n\n${backshack.contract.trim()}\n`
    : '';
  if (!external) return `${loadPrompt('handoff').body}\n\n${planText.trim()}\n${contract}`;
  const checks = external.checks.length
    ? external.checks.map((c) => `- \`${c}\``).join('\n')
    : '(none: run no commands)';
  return `${loadPrompt('handoff-external').body}\n\n## Approved check commands\n\n${checks}\n\n## Executor plan\n\n${planText.trim()}\n${contract}`;
}

/** A part of the coding work already committed by the engine (plan 036). */
export interface CodePart {
  part: number;
  sha: string;
  tripped: string | null;
}

/** The section added to the prompt of a continuing part: what the earlier parts committed (plan 036). */
export function continuationText(c: {
  part: number;
  max: number;
  base: string | null;
  earlier: readonly CodePart[];
  /** A continued run (plan 037): the commit the earlier coding session's work ends at. */
  before?: { sha: string; since: string | null; tripped: string | null };
  /** Plan 042: the requests not done yet, and the checks that failed when the Incubator ran them. */
  remaining?: readonly { id: string; summary: string }[];
  failing?: readonly { command: string; tail: string }[];
}): string {
  const list = c.earlier
    .map(
      (e) =>
        `- part ${e.part}: commit ${e.sha.slice(0, 12)}${e.tripped ? ` (stopped at ${e.tripped})` : ''}`,
    )
    .join('\n');
  const since = c.base ? ` since ${c.base.slice(0, 12)}` : '';
  if (c.before && c.earlier.length === 0) {
    const why = c.before.tripped ? ` (it stopped at ${c.before.tripped})` : '';
    const from = c.before.since ? ` since ${c.before.since.slice(0, 12)}` : '';
    return `## Continuing: part ${c.part} of up to ${c.max}\n\n${loadPrompt('handoff-continue').body}\n\nThe earlier coding session's work is committed on this branch${from}; it ends at commit ${c.before.sha.slice(0, 12)}${why}.\n${leftText(c)}`;
  }
  return `## Continuing: part ${c.part} of up to ${c.max}\n\n${loadPrompt('handoff-continue').body}\n\nEarlier parts, committed on this branch${since}:\n\n${list}\n${leftText(c)}`;
}

/** Plan 042: what the previous part left: requests whose tickets are not marked, and checks that failed. */
function leftText(c: {
  remaining?: readonly { id: string; summary: string }[];
  failing?: readonly { command: string; tail: string }[];
}): string {
  const parts: string[] = [];
  if (c.remaining?.length)
    parts.push(
      `These requests are not done yet: their tickets are not marked READY_FOR_TEST.\n\n${c.remaining.map((r) => `- ${r.id}: ${r.summary}`).join('\n')}`,
    );
  if (c.failing?.length)
    parts.push(
      `When you stopped, the Incubator ran the approved commands and these failed:\n\n${c.failing
        .map(
          (f) =>
            `- ${f.command}:\n${f.tail
              .split('\n')
              .map((l) => `    ${l}`)
              .join('\n')}`,
        )
        .join('\n\n')}`,
    );
  return parts.length ? `\n${parts.join('\n\n')}\n` : '';
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
  /** The model the agent says it is using (its `system` init event). */
  model: string | null = null;
  #buf = '';
  /** The replies already counted as turns (plan 035). */
  #replies = new Set<string>();
  /** The latest usage of each reply, so a reply that arrives as several events is counted once. */
  #usageById = new Map<string, Usage4>();
  #sum: Usage4 = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  /** The totals the agent reports in its final `result` event: exact, where the running count is not. */
  #final: Usage4 | null = null;

  /**
   * Tokens processed so far. Mid-stream it is the sum of each reply's own usage, which counts cache reads and
   * writes exactly but under-reports output (a reply's first event carries a partial output count); the final
   * `result` event replaces it with the agent's own totals.
   */
  get tokens(): TokenUsage {
    const u = this.#final ?? this.#sum;
    return { ...u, total: u.input + u.output + u.cacheWrite + u.cacheRead };
  }

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
      subtype?: string;
      model?: unknown;
      message?: { id?: unknown; content?: { type?: string; text?: unknown }[]; usage?: unknown };
      result?: unknown;
      usage?: unknown;
      total_cost_usd?: number;
      cost_usd?: number;
    };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      return;
    }
    if (e.type === 'system' && e.subtype === 'init' && typeof e.model === 'string')
      this.model = cleanAgentText(e.model, 100);
    if (e.type === 'assistant') {
      // why: Claude's stream sends one `assistant` event per content block of a reply, all with the reply's
      // message id; a turn is one reply (plan 035). Events without an id count one turn each, as before.
      const id = typeof e.message?.id === 'string' ? e.message.id : null;
      if (id === null || !this.#replies.has(id)) {
        if (id !== null) this.#replies.add(id);
        this.turns++;
      }
      const usage = readUsage(e.message?.usage);
      if (usage) this.addUsage(id, usage);
      const blocks = e.message?.content ?? [];
      this.toolCalls += blocks.filter((c) => c.type === 'tool_use').length;
      const text = blocks.find(
        (c) => c.type === 'text' && typeof c.text === 'string' && c.text.trim(),
      );
      if (text) this.lastText = String(text.text);
    }
    if (e.type === 'result' && typeof e.result === 'string' && e.result.trim())
      this.resultText = e.result;
    if (e.type === 'result') {
      const final = readUsage(e.usage);
      if (final) this.#final = final;
    }
    const cost = e.total_cost_usd ?? e.cost_usd;
    if (typeof cost === 'number') this.costUsd = cost;
    if (this.tripped) return;
    const cap = this.ceilings.tokens ?? 0;
    if (!this.turnsByFlag && this.turns > this.ceilings.turns)
      this.tripped = `turns ${this.turns} > ${this.ceilings.turns}`;
    else if (this.toolCalls > this.ceilings.toolCalls)
      this.tripped = `tool calls ${this.toolCalls} > ${this.ceilings.toolCalls}`;
    else if (this.costUsd !== null && this.costUsd > this.ceilings.usd)
      this.tripped = `cost $${this.costUsd} > $${this.ceilings.usd}`;
    else if (cap > 0 && this.tokens.total > cap)
      this.tripped = `tokens ${count(this.tokens.total)} > ${count(cap)}`;
  }

  /** A reply's usage replaces what was counted for the same reply; an event without an id adds its own. */
  private addUsage(id: string | null, u: Usage4): void {
    const old = id === null ? undefined : this.#usageById.get(id);
    if (old) this.shift(old, -1);
    this.shift(u, 1);
    if (id !== null) this.#usageById.set(id, u);
  }

  private shift(u: Usage4, sign: 1 | -1): void {
    this.#sum.input += sign * u.input;
    this.#sum.output += sign * u.output;
    this.#sum.cacheWrite += sign * u.cacheWrite;
    this.#sum.cacheRead += sign * u.cacheRead;
  }
}

interface Usage4 {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** The four counts of an agent's `usage` object; anything that is not a number counts as 0, none at all is null. */
function readUsage(raw: unknown): Usage4 | null {
  if (raw === null || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    input: n(u['input_tokens']),
    output: n(u['output_tokens']),
    cacheWrite: n(u['cache_creation_input_tokens']),
    cacheRead: n(u['cache_read_input_tokens']),
  };
}

export interface HandoffOutcome {
  exitCode: number | null;
  turns: number;
  toolCalls: number;
  costUsd: number | null;
  /** What the agent processed, by kind: the usage figures to track, since the cost is plan usage, not an API bill. */
  tokens: TokenUsage;
  tripped: string | null;
  /** The owner stopped the agent (Stop in the app, Ctrl+C): the work is probably unfinished. */
  stopped: boolean;
  /** The model the agent reported, when it did. */
  model: string | null;
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

/** The plan's tickets that are not READY_FOR_TEST (or later) yet (plan 042). A missing or unreadable ticket file counts as not done. */
export function remainingTickets(repo: string, ids: readonly string[]): string[] {
  return ids.filter((id) => {
    let s: string | null = null;
    try {
      s = ticketState(repo, id);
    } catch {
      // why: the agent edits ticket files now; one it left broken is a request that is not done, not a crash.
    }
    return s !== 'READY_FOR_TEST' && s !== 'TEST_PASSED' && s !== 'DEPLOYED';
  });
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
    /** Stops the agent: its process tree is killed and the outcome says `stopped`. */
    signal?: AbortSignal;
    /** How long `summary` may be (default 4,000 characters); a memory run keeps the whole report. */
    summaryMax?: number;
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
  // why: a ceiling and an outside stop both end the agent the same way; only `stopped` tells them apart.
  const stopNow = (): void => {
    if (!abort.signal.aborted) abort.abort();
  };
  if (opts.signal?.aborted) stopNow();
  else opts.signal?.addEventListener('abort', stopNow, { once: true });
  let reported = -1;
  const r = await exec.run(plan.bin, plan.argv, {
    cwd: plan.cwd,
    ...(plan.env ? { env: plan.env } : {}),
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
  opts.signal?.removeEventListener('abort', stopNow);
  const tripped = monitor.tripped ?? (r.timedOut ? `minutes > ${plan.ceilings.minutes}` : null);
  return {
    exitCode: r.code,
    turns: monitor.turns,
    toolCalls: monitor.toolCalls,
    costUsd: monitor.costUsd,
    tokens: monitor.tokens,
    tripped,
    stopped: Boolean(opts.signal?.aborted) && !monitor.tripped,
    model: monitor.model,
    ticketState: opts.ticket ? ticketState(plan.cwd, opts.ticket) : null,
    summary: cleanAgentText(monitor.resultText ?? monitor.lastText, opts.summaryMax),
  };
}
