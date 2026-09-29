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
  opts: { yes?: boolean; adapter?: string; out?: string },
): Promise<number> {
  if (opts.adapter && !isLlmAdapterId(opts.adapter))
    throw new PolicyError(`unknown adapter ${opts.adapter}`, { code: 'usage' });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  const before = deps.engine.state(runId);
  io.stderr(
    `▶ resuming run ${runId} (${before.state}${before.parked ? `: ${before.parked.reason}` : ''})\n`,
  );
  const state = await deps.engine.resume(
    runId,
    choosePrompter(io, opts.yes),
    opts.adapter ? { adapter: opts.adapter } : {},
  );
  return reportRun(deps, io, state, opts.out);
}
