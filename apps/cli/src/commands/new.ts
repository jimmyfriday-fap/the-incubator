import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DefaultsPrompter,
  NonInteractivePrompter,
  type Prompter,
  type RunState,
} from '@incubator/core';
import { ExitCode, PolicyError, fileSink } from '@incubator/runtime';
import { isLlmAdapterId } from '@incubator/llm';
import { serializeSpec, type IncubatorSpec } from '@incubator/spec';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { TerminalPrompter } from '../prompter.js';
import { finishLoop, reportFinish } from './finish.js';
import { summarizeSpec } from '../summary.js';

export interface NewOptions {
  prompt?: string;
  promptFile?: string;
  specOnly?: boolean;
  yes?: boolean;
  out?: string;
  adapter?: string;
  scaffoldTo?: string;
  keep?: boolean;
  /** Initialize the repository in this folder (empty or missing); the agent then codes in it. */
  dir?: string;
}

export function choosePrompter(io: Io, yes: boolean | undefined): Prompter {
  if (yes) return new DefaultsPrompter();
  return io.isTTY ? new TerminalPrompter(io) : new NonInteractivePrompter();
}

/**
 * The end of a run: a folder run's commit and push requests are asked here on a terminal (and
 * otherwise reported as parked, with the command that answers them); every other run reports as before.
 */
export async function settleRun(
  deps: CliDeps,
  io: Io,
  state: RunState,
  resume: (runId: string) => Promise<RunState>,
  out?: string,
): Promise<number> {
  const settled = await finishLoop(deps, io, state, resume);
  return (await reportFinish(deps, io, settled)) ?? reportRun(deps, io, settled, out);
}

/** Prints the outcome of an advance() and returns the exit code. */
export function reportRun(deps: CliDeps, io: Io, state: RunState, out?: string): number {
  if (state.state === 'PARKED') {
    io.stderr(
      `⏸ run ${state.runId} parked at ${state.parked?.state ?? '?'}: ${state.parked?.message ?? ''}\n`,
    );
    const previous = (state.parked?.evidence as { previous?: unknown } | null | undefined)
      ?.previous;
    // why: after a refresh (plan 025) the owner confirms or edits what they asked for before.
    if (state.parked?.reason === 'needs_request' && typeof previous === 'string')
      io.stderr(
        `  what you asked before (confirm it or edit it):\n${previous.replace(/^/gm, '    ')}\n`,
      );
    io.stderr(
      state.parked?.reason === 'needs_request'
        ? `  answer with: incubator resume ${state.runId} --prompt "what you want to change"${typeof previous === 'string' ? ' (or --prompt-file <file> for a longer text)' : ''}\n`
        : state.parked?.reason === 'repo_moved'
          ? `  refresh with: incubator resume ${state.runId} --refresh\n`
          : `  resume with: incubator resume ${state.runId}${state.parked?.reason === 'needs_input' || state.parked?.reason === 'needs_review' ? ' (interactively, or add --yes)' : ''}\n`,
    );
    return ExitCode.Policy;
  }
  if (state.state === 'DONE' && state.input.kind === 'enhance')
    return reportEnhance(deps, io, state.runId);
  const spec = deps.engine.draft(state.runId) as unknown as IncubatorSpec;
  if (state.state === 'DONE' && !state.input.specOnly) return reportDone(deps, io, state, spec);
  const text = serializeSpec(spec);
  if (state.state === 'DONE' || state.state === 'APPROVED') {
    if (out) {
      writeFileSync(path.resolve(out), text);
      io.stderr(
        `✔ spec approved (run ${state.runId})\n${summarizeSpec(spec)}\nwritten    ${out}\n`,
      );
    } else {
      io.stderr(`✔ spec approved (run ${state.runId})\n${summarizeSpec(spec)}\n`);
      io.stdout(text);
    }
    return ExitCode.Ok;
  }
  io.stderr(`run ${state.runId} stopped at ${state.state}\n`);
  return ExitCode.Ok;
}

const NOOP_TEXT: Record<string, string> = {
  no_features:
    'the request produced no enhancement; to add only the canonical-pattern gaps use `incubator adopt`',
  already_delivered: 'this plan is already in the repository',
};

/** The end of an enhance run: nothing to change, the local branch, or the pull request. */
export function reportEnhance(deps: CliDeps, io: Io, runId: string): number {
  const s = deps.engine.enhanceSummary(runId);
  if (s.noop) {
    io.stderr(`✔ nothing to change (${NOOP_TEXT[s.noop] ?? s.noop}); no branch, no pull request\n`);
    return ExitCode.Ok;
  }
  const dir = path.join(deps.store.runDir(runId), 'workspace', 'repo');
  const plan = s.plan;
  const lines = [
    s.pr ? `✔ opened ${s.pr.url}` : `✔ enhance branch written locally in ${dir}`,
    ...(plan
      ? [
          `  plan       ${plan.planPath} (${plan.features.length} request(s); ${plan.create.length} file(s) added, ${plan.proposed.length} proposed)`,
          ...(plan.gaps ? ['  gaps       canonical pattern gaps in a separate commit'] : []),
        ]
      : []),
    `  scan       ${path.join(deps.store.runDir(runId), 'enhance', 'scan-report.md')}`,
    `  next       incubator handoff ${runId} --launch`,
  ];
  io.stderr(`${lines.join('\n')}\n`);
  return ExitCode.Ok;
}

/** The end of a full run: where the tree went, or the publish summary with what is left to set. */
export function reportDone(deps: CliDeps, io: Io, state: RunState, spec: IncubatorSpec): number {
  if (state.input.out) {
    io.stderr(`✔ scaffolded ${spec.project.slug} into ${state.input.out} (run ${state.runId})\n`);
    return ExitCode.Ok;
  }
  const s = deps.engine.publishSummary(state.runId);
  if (!s) {
    io.stderr(`✔ run ${state.runId} finished\n`);
    return ExitCode.Ok;
  }
  const lines = [
    `✔ published ${s.repo} (run ${state.runId})`,
    ...(s.pairedRepo ? [`  tests      ${s.pairedRepo}`] : []),
    `  commit     ${s.commit.slice(0, 12)}`,
    ...(s.variablesCreated.length
      ? [`  variables  created with __INCUBATOR_UNSET__: ${s.variablesCreated.join(', ')}`]
      : []),
    ...(s.secretsToSet.length
      ? [
          '  secrets    set these before deploying (Settings → Secrets and variables → Actions):',
          ...s.secretsToSet.map((x) => `             - ${x.name} (${x.repo}): ${x.description}`),
        ]
      : []),
    ...s.warnings.map((w) => `  ⚠ ${w}`),
    `  next       incubator handoff ${state.runId} --launch`,
  ];
  io.stderr(`${lines.join('\n')}\n`);
  return ExitCode.Ok;
}

export async function runNew(deps: CliDeps, io: Io, opts: NewOptions): Promise<number> {
  if (opts.prompt && opts.promptFile)
    throw new PolicyError('use either --prompt or --prompt-file, not both', { code: 'usage' });
  const narrative = opts.promptFile
    ? readFileSync(path.resolve(opts.promptFile), 'utf8')
    : opts.prompt;
  if (!narrative?.trim())
    throw new PolicyError('a narrative is required: --prompt "…" or --prompt-file <path>', {
      code: 'usage',
    });
  if (opts.adapter && !isLlmAdapterId(opts.adapter))
    throw new PolicyError(`unknown adapter ${opts.adapter}`, { code: 'usage' });
  if (opts.dir && (opts.specOnly || opts.scaffoldTo))
    throw new PolicyError('--dir cannot be combined with --spec-only or --scaffold-to', {
      code: 'usage',
    });
  let dir: string | undefined;
  if (opts.dir) {
    const v = await deps.engine.inspectFolder(opts.dir, 'new');
    if (!v.ok) throw new PolicyError(v.problems.join(' '), { code: 'bad_folder' });
    dir = v.path;
  }
  const runId = deps.engine.start({
    kind: 'new',
    narrative: narrative.trim(),
    ...(opts.specOnly ? { specOnly: true } : {}),
    ...(opts.scaffoldTo ? { out: path.resolve(opts.scaffoldTo) } : {}),
    ...(dir ? { dir } : {}),
    ...(opts.keep ? { keep: true } : {}),
    yes: Boolean(opts.yes),
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
    surface: 'cli',
  });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  io.stderr(`▶ run ${runId}\n`);
  const prompter = choosePrompter(io, opts.yes);
  const state = await deps.engine.advance(runId, prompter);
  return settleRun(deps, io, state, (id) => deps.engine.resume(id, prompter), opts.out);
}
