import path from 'node:path';
import { MEMORY_EFFORTS, type MemoryCommitPolicy } from '@incubator/core';
import { PolicyError, fileSink } from '@incubator/runtime';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { reportMemory } from './memory-report.js';
import { choosePrompter } from './new.js';

export interface MemoryOptions {
  system?: string;
  /** Comma-separated isolation terms; when absent, every other solution's code identifiers. */
  terms?: string;
  policy?: string;
  model?: string;
  effort?: string;
  yes?: boolean;
}

/**
 * `incubator memory <path>` (plan 071): installs agent memory into one local repository by running the memory
 * seed's playbook in an agent session. The agent commits the install; the push stays with the owner.
 */
export async function runMemory(
  deps: CliDeps,
  io: Io,
  source: string,
  opts: MemoryOptions,
): Promise<number> {
  if (/^[a-z]+:\/\//i.test(source) || source.startsWith('git@'))
    throw new PolicyError('Add memory needs a local folder, not a URL', { code: 'usage' });
  const policy = (opts.policy ?? 'auto') as MemoryCommitPolicy;
  if (!['auto', 'pr', 'direct'].includes(policy))
    throw new PolicyError('--policy is auto, pr or direct', { code: 'usage' });
  if (opts.effort !== undefined && !(MEMORY_EFFORTS as readonly string[]).includes(opts.effort))
    throw new PolicyError(`--effort is one of ${MEMORY_EFFORTS.join(', ')}`, { code: 'usage' });
  const v = await deps.engine.inspectFolder(source, 'existing');
  if (!v.ok) throw new PolicyError(v.problems.join(' '), { code: 'bad_folder' });
  if (v.memoryPresent)
    throw new PolicyError('this repository already has memory (.memory/ or .memory-link)', {
      code: 'memory_present',
    });
  const defaults = await deps.engine.memoryDefaults({ dir: v.path });
  if (defaults.installed)
    throw new PolicyError(`${defaults.project?.name ?? 'this solution'} already has memory`, {
      code: 'memory_installed',
    });
  const terms =
    opts.terms !== undefined
      ? opts.terms
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : defaults.isolationTerms;
  const runId = deps.engine.start({
    kind: 'memory',
    dir: v.path,
    repo: v.path,
    surface: 'cli',
    yes: Boolean(opts.yes),
    memory: {
      system: opts.system ?? defaults.system,
      isolationTerms: terms,
      commitPolicy: policy,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
    },
  });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  io.stderr(
    `▶ run ${runId}: installing memory (seed ${defaults.seedVersion}) in ${v.path}\n  isolation terms: ${terms.length ? terms.join(', ') : '(none)'}\n`,
  );
  const state = await deps.engine.advance(runId, choosePrompter(io, opts.yes));
  return reportMemory(deps, io, state);
}
