import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, fileSink } from '@incubator/runtime';
import { isLlmAdapterId } from '@incubator/llm';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { parseRepoOption } from './adopt.js';
import { choosePrompter, reportEnhance, reportRun } from './new.js';

export interface EnhanceOptions {
  yes?: boolean;
  repo?: string;
  org?: boolean;
  publish?: boolean;
  prompt?: string;
  promptFile?: string;
  adapter?: string;
  withGaps?: boolean;
}

/**
 * `incubator enhance <url|path> [--prompt|--prompt-file] [--with-gaps] …` (TDD §7.4, ADR-020).
 * A separate command from `adopt`: it needs the owner's change request, and its branch, delivery and
 * handoff differ. Takes adopt's flags plus the request and adapter flags.
 */
export async function runEnhance(
  deps: CliDeps,
  io: Io,
  source: string,
  opts: EnhanceOptions,
): Promise<number> {
  if (opts.prompt && opts.promptFile)
    throw new PolicyError('use either --prompt or --prompt-file, not both', { code: 'usage' });
  if (opts.adapter && !isLlmAdapterId(opts.adapter))
    throw new PolicyError(`unknown adapter ${opts.adapter}`, { code: 'usage' });
  const repoRef = parseRepoOption(opts.repo);
  let request = opts.promptFile ? readFileSync(path.resolve(opts.promptFile), 'utf8') : opts.prompt;
  // On a terminal, ask. Elsewhere the run parks at REQUEST and `resume --prompt` answers it.
  if (!request?.trim() && io.isTTY && io.readLine)
    request = await io.readLine('What do you want to change?');
  const runId = deps.engine.start({
    kind: 'enhance',
    repo: /^[a-z]+:\/\//i.test(source) || source.startsWith('git@') ? source : path.resolve(source),
    surface: 'cli',
    yes: Boolean(opts.yes),
    ...(request?.trim() ? { request: request.trim() } : {}),
    ...(repoRef ? { repoRef } : {}),
    ...(opts.org ? { ownerType: 'org' as const } : {}),
    ...(opts.publish === false ? { noPublish: true } : {}),
    ...(opts.withGaps ? { withGaps: true } : {}),
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
  });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  io.stderr(`▶ run ${runId}: scanning ${source}\n`);
  const state = await deps.engine.advance(runId, choosePrompter(io, opts.yes));
  if (state.state !== 'DONE') return reportRun(deps, io, state);
  return reportEnhance(deps, io, runId);
}
