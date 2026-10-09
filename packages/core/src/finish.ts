import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { GitIdentity, RepoRef, StatusEntry } from '@incubator/git';
import { cleanAgentText, type HandoffOutcome } from './handoff.js';

/** What the agent's run amounts to, in the words the owner sees at the commit request. */
export type AgentVerdict = 'ready' | 'parked' | 'ceiling' | 'failed' | 'stopped';

/**
 * What the agent could run to check its work: the repository's own Incubator gate, the commands the
 * owner approved, or nothing (edits only).
 */
export interface AgentChecks {
  mode: 'gate' | 'approved' | 'none';
  commands: string[];
}

export interface AgentReport {
  verdict: AgentVerdict;
  /** Set by the engine for folder runs; absent in reports journaled before ADR-025. */
  checks?: AgentChecks;
  /** The agent's own closing message, cleaned and capped. */
  summary: string | null;
  tripped: string | null;
  exitCode: number | null;
  turns: number;
  toolCalls: number;
  costUsd: number | null;
  /** How many parts the agent worked in (plan 036); absent in reports journaled before. */
  parts?: number;
}

export function agentReport(out: HandoffOutcome): AgentReport {
  const verdict: AgentVerdict = out.stopped
    ? 'stopped'
    : out.tripped
      ? 'ceiling'
      : out.exitCode !== 0
        ? 'failed'
        : out.ticketState === 'READY_FOR_TEST' || out.ticketState === null
          ? 'ready'
          : 'parked';
  return {
    verdict,
    summary: out.summary,
    tripped: out.tripped,
    exitCode: out.exitCode,
    turns: out.turns,
    toolCalls: out.toolCalls,
    costUsd: out.costUsd,
  };
}

export const FIRST_LINE_MAX = 72;

/** The first line of a commit message: a conventional-commit subject, trimmed to fit. */
export function subject(kind: 'feat' | 'chore', title: string): string {
  const t = title.replace(/\s+/g, ' ').trim() || 'changes by the coding agent';
  const line = `${kind}: ${t}`;
  return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX - 1)}…` : line;
}

/** A message drafted for the owner to edit: subject, the agent's summary, and nothing about the run's insides. */
export function draftMessage(opts: { title: string; summary: string | null }): string {
  const body = cleanAgentText(opts.summary, 1500);
  return `${subject('feat', opts.title)}\n${body ? `\n${body}\n` : ''}`;
}

/** The message the owner approved, cleaned, with the run's trailers appended once. */
export function finalMessage(approved: string, fallback: string, runId: string): string {
  const text = cleanAgentText(approved, 4000) ?? fallback;
  const trailer = `Incubator-Run: ${runId}\nIncubator-Part: finish`;
  return `${text.replace(/\n*Incubator-(Run|Part):.*$/gm, '').trimEnd()}\n\n${trailer}\n`;
}

export const finishTrailer = (runId: string): string =>
  `Incubator-Run: ${runId}\nIncubator-Part: finish`;

/** The most parts one coding stage may take (plan 036); each part keeps the spec's run limits. */
export const MAX_CODE_PARTS = 5;

/** The checkpoint commit after a part stopped at a run limit (plan 036): local only, never the owner's commit. */
export function partMessage(
  opts: { title: string; part: number; tripped: string | null },
  runId: string,
): string {
  const head = subject('chore', `part ${opts.part} of up to ${MAX_CODE_PARTS}: ${opts.title}`);
  const why = `The coding agent stopped at a run limit (${opts.tripped ?? 'unknown'}); the next part continues from here.`;
  return `${head}\n\n${why}\n\nIncubator-Run: ${runId}\nIncubator-Part: code-${opts.part}\n`;
}

/**
 * Hides the agent's bookkeeping (`.incubator/state/`) from `git status` without touching any tracked
 * file: it goes into the repository's local, uncommitted exclude list.
 */
export function ensureLocalExclude(dir: string, pattern = '.incubator/state/'): void {
  const gitDir = path.join(dir, '.git');
  // A worktree or submodule has a `.git` file rather than a directory; leave those alone.
  if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return;
  const file = path.join(gitDir, 'info', 'exclude');
  mkdirSync(path.dirname(file), { recursive: true });
  const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (have.split(/\r?\n/).includes(pattern)) return;
  appendFileSync(file, `${have && !have.endsWith('\n') ? '\n' : ''}${pattern}\n`);
}

export interface FinishDetail {
  /** Where the run is in the end-of-iteration sequence. */
  stage: 'coding' | 'commit' | 'push' | 'done';
  dir: string;
  branch: string | null;
  agent: AgentReport | null;
  /** Uncommitted changes, before the commit; empty after. */
  files: StatusEntry[];
  /** The drafted message, or the approved one once approved. */
  message: string;
  identity: GitIdentity | null;
  commit: { sha: string | null; branch: string | null; none?: boolean; left?: boolean } | null;
  /** Where Push would send the branch, or why it cannot. */
  target: { repo: RepoRef | null; reason: string | null };
  pr: { number: number; url: string } | null;
  /** The parts committed as checkpoints since coding last started (plan 036). */
  checkpoints: { part: number; sha: string }[];
  /** Live counters while the agent works. */
  progress: {
    turns: number;
    toolCalls: number;
    costUsd: number | null;
    snippet: string | null;
  } | null;
}

/** The pull request body: the agent's own words, the verdict, and what changed. Opened with the owner's approval. */
export function finishBody(opts: {
  title: string;
  summary: string | null;
  verdict: AgentVerdict;
  files: readonly string[];
}): string {
  const said = cleanAgentText(opts.summary, 3000);
  const shown = opts.files.slice(0, 50);
  const verdictText: Record<AgentVerdict, string> = {
    ready: 'The agent finished and reported the work ready for test.',
    parked: 'The agent stopped before reaching ready-for-test; review with care.',
    ceiling: 'The agent was stopped at a run ceiling; the work may be incomplete.',
    failed: 'The agent exited with an error; the work may be incomplete.',
    stopped: 'The owner stopped the agent; the work is probably incomplete.',
  };
  return [
    `# ${cleanAgentText(opts.title, 200) ?? 'Changes by the coding agent'}`,
    '',
    '_Generated by the Incubator. The owner reviewed the changes and approved this commit and push._',
    '',
    `**${verdictText[opts.verdict]}**`,
    ...(said
      ? ['', '## What the agent reported', '', ...said.split('\n').map((l) => `> ${l}`)]
      : []),
    '',
    `## Changed files (${opts.files.length})`,
    '',
    ...shown.map((f) => `- \`${f}\``),
    ...(opts.files.length > shown.length ? [`- … ${opts.files.length - shown.length} more`] : []),
    '',
  ].join('\n');
}
