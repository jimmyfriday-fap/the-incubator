import type { RunState } from '@incubator/core';
import { ExitCode } from '@incubator/runtime';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

/**
 * The end of an Add memory run (plan 071): the playbook's report in full (it is the review artifact), the
 * rules the Incubator found broken, and what answers a parked run.
 */
export function reportMemory(deps: CliDeps, io: Io, state: RunState): number {
  const id = state.runId;
  const m = deps.engine.memoryDetail(id);
  if (m?.report) io.stdout(`${m.report}\n`);
  if (m?.dropped.length)
    io.stderr(
      `isolation terms dropped because the repository uses them: ${m.dropped.join(', ')}\n`,
    );
  if (state.state === 'PARKED') {
    for (const p of m?.problems ?? []) io.stderr(`  ✖ ${p}\n`);
    io.stderr(
      `⏸ run ${id} parked at ${state.parked?.state ?? '?'}: ${state.parked?.message ?? ''}\n`,
    );
    io.stderr(
      state.parked?.reason === 'needs_push'
        ? `  push with: incubator resume ${id} --push\n  or stay local: incubator resume ${id} --skip-push\n`
        : `  resume with: incubator resume ${id}\n`,
    );
    return ExitCode.Policy;
  }
  if (state.state === 'DONE' && m) {
    io.stderr(
      m.pr
        ? `✔ memory installed; pull request ${m.pr.url} is open for review\n`
        : m.pushed
          ? `✔ memory installed and pushed on ${m.branch ?? '?'}\n`
          : `✔ memory installed locally on ${m.branch ?? '?'} in ${m.dir}${m.target.reason ? ` (${m.target.reason})` : ''}\n`,
    );
    return ExitCode.Ok;
  }
  io.stderr(`run ${id} stopped at ${state.state}\n`);
  return ExitCode.Ok;
}
