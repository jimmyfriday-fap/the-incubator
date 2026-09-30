import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, fileSink } from '@incubator/runtime';
import { isLlmAdapterId } from '@incubator/llm';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { choosePrompter, reportRun } from './new.js';

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
  },
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
  const state = await deps.engine.resume(
    runId,
    choosePrompter(io, opts.yes),
    opts.adapter ? { adapter: opts.adapter } : {},
  );
  return reportRun(deps, io, state, opts.out);
}
