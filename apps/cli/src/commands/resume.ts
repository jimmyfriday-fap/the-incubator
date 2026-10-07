import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, fileSink } from '@incubator/runtime';
import { isLlmAdapterId } from '@incubator/llm';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { applyChecks, type CheckOptions } from './checks.js';
import { answerFinish, type FinishFlags } from './finish.js';
import { choosePrompter, settleRun } from './new.js';

export async function runResume(
  deps: CliDeps,
  io: Io,
  runId: string,
  opts: {
    yes?: boolean;
    adapter?: string;
    out?: string;
    prompt?: string;
    promptFile?: string;
    refresh?: boolean;
    change?: string;
  } & FinishFlags &
    CheckOptions,
): Promise<number> {
  if (opts.adapter && !isLlmAdapterId(opts.adapter))
    throw new PolicyError(`unknown adapter ${opts.adapter}`, { code: 'usage' });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  const before = deps.engine.state(runId);
  io.stderr(
    `▶ resuming run ${runId} (${before.state}${before.parked ? `: ${before.parked.reason}` : ''})\n`,
  );
  if (opts.prompt && opts.promptFile)
    throw new PolicyError('use either --prompt or --prompt-file, not both', { code: 'usage' });
  if (opts.refresh && (opts.prompt !== undefined || opts.promptFile !== undefined))
    throw new PolicyError(
      'use --refresh on its own; confirm what you asked with --prompt afterwards',
      { code: 'usage' },
    );
  if (
    opts.change !== undefined &&
    (opts.refresh || opts.yes || opts.prompt !== undefined || opts.promptFile !== undefined)
  )
    throw new PolicyError('use --change on its own, while the run waits at review', {
      code: 'usage',
    });
  // Update runs: read the repository again; the run then asks to confirm what was asked (plan 025).
  if (opts.refresh) await deps.engine.refreshRepo(runId);
  const request = opts.promptFile
    ? readFileSync(path.resolve(opts.promptFile), 'utf8')
    : opts.prompt;
  // The answer to a parked "what do you want to change?" (enhance runs).
  if (request !== undefined) deps.engine.submitRequest(runId, request);
  // What the coding agent may run is the owner's decision too, until it starts coding (ADR-025).
  applyChecks(deps, runId, opts);
  // The commit and push requests are the owner's: --yes never answers them.
  await answerFinish(deps, runId, opts);
  // A correction at review (plan 021): the plan is drafted again with it and comes back to review (plan 032).
  // why: last, so a flag refused above leaves the run untouched at review.
  if (opts.change !== undefined) deps.engine.requestChanges(runId, opts.change);
  const prompter = choosePrompter(io, opts.yes);
  const run = (id: string) =>
    deps.engine.resume(id, prompter, opts.adapter ? { adapter: opts.adapter } : {});
  return settleRun(deps, io, await run(runId), run, opts.out);
}
