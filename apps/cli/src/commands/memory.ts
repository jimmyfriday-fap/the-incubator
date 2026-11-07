import { readFileSync } from 'node:fs';
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
  storePolicy?: string;
  storeRemote?: string;
  join?: string;
}

/**
 * `incubator memory <path>` (plan 071): installs agent memory into one local repository by running the memory
 * seed's playbook in an agent session. The agent commits the install; the push stays with the owner.
 */
export async function runMemory(
  deps: CliDeps,
  io: Io,
  sources: string | string[],
  opts: MemoryOptions,
): Promise<number> {
  const list = Array.isArray(sources) ? sources : [sources];
  const source = list[0]!;
  for (const x of list)
    if (/^[a-z]+:\/\//i.test(x) || x.startsWith('git@'))
      throw new PolicyError('Add memory needs a local folder, not a URL', { code: 'usage' });
  const store = list.length > 1;
  if (
    opts.join !== undefined &&
    (store || opts.storePolicy !== undefined || opts.storeRemote !== undefined)
  )
    throw new PolicyError('--join adds one repository to an existing system: use it alone', {
      code: 'usage',
    });
  if (store && !opts.system)
    throw new PolicyError('store mode (several repositories) needs --system <name>', {
      code: 'usage',
    });
  if (!store && (opts.storePolicy !== undefined || opts.storeRemote !== undefined))
    throw new PolicyError(
      '--store-policy and --store-remote are for store mode (several repositories)',
      {
        code: 'usage',
      },
    );
  if (opts.storePolicy !== undefined && !['pr', 'direct'].includes(opts.storePolicy))
    throw new PolicyError('--store-policy is pr or direct', { code: 'usage' });
  const policy = (opts.policy ?? 'auto') as MemoryCommitPolicy;
  if (!['auto', 'pr', 'direct'].includes(policy))
    throw new PolicyError('--policy is auto, pr or direct', { code: 'usage' });
  if (opts.effort !== undefined && !(MEMORY_EFFORTS as readonly string[]).includes(opts.effort))
    throw new PolicyError(`--effort is one of ${MEMORY_EFFORTS.join(', ')}`, { code: 'usage' });
  const members: { dir: string; name: string }[] = [];
  for (const x of store ? list : []) {
    const mv = await deps.engine.inspectFolder(x, 'existing');
    if (!mv.ok) throw new PolicyError(`${x}: ${mv.problems.join(' ')}`, { code: 'bad_folder' });
    if (mv.memoryPresent)
      throw new PolicyError(`${x} already has memory (.memory/ or .memory-link)`, {
        code: 'memory_present',
      });
    members.push({ dir: mv.path, name: path.basename(mv.path) });
  }
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
      system: opts.join ?? opts.system ?? defaults.system,
      ...(opts.join ? { joinSystem: opts.join } : {}),
      isolationTerms: terms,
      commitPolicy: policy,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
      ...(store
        ? { members, storeCommitPolicy: (opts.storePolicy ?? 'pr') as 'pr' | 'direct' }
        : {}),
      ...(store && opts.storeRemote ? { storeRemote: opts.storeRemote } : {}),
    },
  });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  io.stderr(
    `▶ run ${runId}: ${store ? `finding the system of ${members.map((x) => x.name).join(', ')} (nothing is written until you confirm its manifest)` : `installing memory (seed ${defaults.seedVersion}) in ${v.path}`}\n  isolation terms: ${terms.length ? terms.join(', ') : '(none)'}\n`,
  );
  const state = await deps.engine.advance(runId, choosePrompter(io, opts.yes));
  return reportMemory(deps, io, state);
}

/**
 * `incubator memory-manifest <runId> [file]` (plan 076): the owner's confirmation of a store-mode run's manifest.
 * Without a file it is the proposed manifest as it stands; with one, the owner's edit. Never run by `--yes`.
 */
export async function runMemoryManifest(
  deps: CliDeps,
  io: Io,
  runId: string,
  file: string | undefined,
): Promise<number> {
  const detail = deps.engine.memoryDetail(runId);
  if (!detail?.store)
    throw new PolicyError('that run is not a store-mode Add memory run', { code: 'usage' });
  const yaml = file ? readFileSync(path.resolve(file), 'utf8') : detail.store.proposed;
  if (!yaml)
    throw new PolicyError('no manifest was proposed: pass the path of a system.yaml you wrote', {
      code: 'usage',
    });
  await deps.engine.confirmMemoryManifest(runId, yaml);
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  io.stderr(`▶ manifest confirmed; installing the shared store for ${detail.system}\n`);
  const state = await deps.engine.resume(runId, choosePrompter(io, true));
  return reportMemory(deps, io, state);
}
