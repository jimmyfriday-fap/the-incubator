import path from 'node:path';
import { ExitCode, PolicyError, fileSink } from '@incubator/runtime';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { choosePrompter, reportRun } from './new.js';

export interface AdoptOptions {
  yes?: boolean;
  repo?: string;
  org?: boolean;
  publish?: boolean;
}

/** `incubator adopt <url|path> [--repo owner/name] [--org] [--no-publish] [--yes]` (TDD §7.3). */
export async function runAdopt(
  deps: CliDeps,
  io: Io,
  source: string,
  opts: AdoptOptions,
): Promise<number> {
  let repoRef: { owner: string; name: string } | undefined;
  if (opts.repo) {
    const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(opts.repo);
    if (!m) throw new PolicyError('--repo must be owner/name', { code: 'usage' });
    repoRef = { owner: m[1]!, name: m[2]! };
  }
  const runId = deps.engine.start({
    kind: 'adopt',
    repo: /^[a-z]+:\/\//i.test(source) || source.startsWith('git@') ? source : path.resolve(source),
    surface: 'cli',
    yes: Boolean(opts.yes),
    ...(repoRef ? { repoRef } : {}),
    ...(opts.org ? { ownerType: 'org' as const } : {}),
    ...(opts.publish === false ? { noPublish: true } : {}),
  });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  io.stderr(`▶ run ${runId}: adopting ${source}\n`);
  const state = await deps.engine.advance(runId, choosePrompter(io, opts.yes));
  if (state.state !== 'DONE') return reportRun(deps, io, state);
  const s = deps.engine.adoptSummary(runId);
  const analysis = deps.engine.entries(runId).find((e) => e.type === 'adopt.analysis') as
    { gaps?: { present: number; partial: number; missing: number } } | undefined;
  const gaps = analysis?.gaps;
  const line = gaps
    ? `${gaps.present} present, ${gaps.partial} partial, ${gaps.missing} missing`
    : '';
  if (s.compliant) io.stderr(`✔ already compliant (${line}); nothing to change, no pull request\n`);
  else if (s.pr)
    io.stderr(
      `✔ opened ${s.pr.url} (${line})\n  gap report ${path.join(deps.store.runDir(runId), 'adopt', 'gap-report.md')}\n`,
    );
  else
    io.stderr(
      `✔ adopt branch written locally in ${path.join(deps.store.runDir(runId), 'workspace', 'repo')} (${line})\n`,
    );
  return ExitCode.Ok;
}
