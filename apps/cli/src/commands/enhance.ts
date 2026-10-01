import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, fileSink } from '@incubator/runtime';
import { isLlmAdapterId } from '@incubator/llm';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { parseRepoOption } from './adopt.js';
import { choosePrompter, reportEnhance, settleRun } from './new.js';

export interface EnhanceOptions {
  yes?: boolean;
  repo?: string;
  org?: boolean;
  publish?: boolean;
  prompt?: string;
  promptFile?: string;
  adapter?: string;
  withGaps?: boolean;
  /** Work in the local folder itself, on a new branch; the agent codes there and the owner commits. */
  inPlace?: boolean;
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
  let dir: string | undefined;
  if (opts.inPlace) {
    if (/^[a-z]+:\/\//i.test(source) || source.startsWith('git@'))
      throw new PolicyError('--in-place needs a local folder, not a URL', { code: 'usage' });
    const v = await deps.engine.inspectFolder(source, 'existing');
    if (!v.ok) throw new PolicyError(v.problems.join(' '), { code: 'bad_folder' });
    dir = v.path;
  }
  let request = opts.promptFile ? readFileSync(path.resolve(opts.promptFile), 'utf8') : opts.prompt;
  // On a terminal, ask. Elsewhere the run parks at REQUEST and `resume --prompt` answers it.
  if (!request?.trim() && io.isTTY && io.readLine)
    request = await io.readLine('What do you want to change?');
  const runId = deps.engine.start({
    kind: 'enhance',
    repo:
      dir ??
      (/^[a-z]+:\/\//i.test(source) || source.startsWith('git@') ? source : path.resolve(source)),
    ...(dir ? { dir } : {}),
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
  const prompter = choosePrompter(io, opts.yes);
  const state = await deps.engine.advance(runId, prompter);
  const resume = (id: string) => deps.engine.resume(id, prompter);
  if (dir || state.state !== 'DONE') return settleRun(deps, io, state, resume);
  return reportEnhance(deps, io, runId);
}
