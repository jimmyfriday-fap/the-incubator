import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { RUN_ID_PATTERN, PolicyError, fileSink } from '@incubator/runtime';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { choosePrompter, reportRun } from './new.js';

/**
 * `incubator publish <spec.json | runId> [--keep]`: from a spec file, a new run that scaffolds,
 * verifies and publishes; from a run id, resume that run where its journal stopped.
 */
export async function runPublish(
  deps: CliDeps,
  io: Io,
  target: string,
  opts: { keep?: boolean; yes?: boolean },
): Promise<number> {
  let runId: string;
  if (RUN_ID_PATTERN.test(target) && existsSync(deps.store.runDir(target))) {
    runId = target;
    deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
    io.stderr(`▶ resuming run ${runId} (${deps.engine.state(runId).state})\n`);
    return reportRun(deps, io, await deps.engine.resume(runId, choosePrompter(io, opts.yes)));
  }
  let draft: unknown;
  try {
    draft = JSON.parse(readFileSync(path.resolve(target), 'utf8'));
  } catch (e) {
    throw new PolicyError(
      `${target} is neither a run id nor a readable spec: ${e instanceof Error ? e.message : String(e)}`,
      {
        code: 'usage',
      },
    );
  }
  const spec: IncubatorSpec = completeSpec(draft as never).spec;
  runId = deps.engine.startFromSpec(spec, {
    kind: 'scaffold',
    surface: 'cli',
    ...(opts.keep ? { keep: true } : {}),
  });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  io.stderr(`▶ run ${runId}: publishing ${spec.project.owner.login}/${spec.project.slug}\n`);
  return reportRun(deps, io, await deps.engine.advance(runId, choosePrompter(io, opts.yes)));
}
