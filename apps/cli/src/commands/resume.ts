import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, fileSink } from '@incubator/runtime';
import { isLlmAdapterId } from '@incubator/llm';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
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
  } & FinishFlags,
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
  const request = opts.promptFile
    ? readFileSync(path.resolve(opts.promptFile), 'utf8')
    : opts.prompt;
  // The answer to a parked "what do you want to change?" (enhance runs).
  if (request !== undefined) deps.engine.submitRequest(runId, request);
  // The commit and push requests are the owner's: --yes never answers them.
  await answerFinish(deps, runId, opts);
  const prompter = choosePrompter(io, opts.yes);
  const run = (id: string) =>
    deps.engine.resume(id, prompter, opts.adapter ? { adapter: opts.adapter } : {});
  return settleRun(deps, io, await run(runId), run, opts.out);
}
