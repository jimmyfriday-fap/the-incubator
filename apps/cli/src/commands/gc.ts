import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ExitCode, removeTree } from '@incubator/runtime';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

/**
 * `incubator gc [--days N] [--dry-run]`: removes finished runs older than N days (default from
 * config `gc.days`, else 30) and the leftover workspaces of all finished runs. Parked and active runs
 * are kept: they can still be resumed.
 */
export function runGc(deps: CliDeps, io: Io, opts: { days?: string; dryRun?: boolean }): number {
  const days = Number(opts.days ?? deps.config.gc?.days ?? 30);
  const cutoff = deps.clock.now().getTime() - days * 86_400_000;
  const runs = existsSync(deps.store.runsDir()) ? readdirSync(deps.store.runsDir()).sort() : [];
  let removed = 0;
  let workspaces = 0;
  for (const runId of runs) {
    let done: boolean;
    try {
      done = deps.engine.state(runId).done;
    } catch {
      continue;
    }
    if (!done) continue;
    const dir = deps.store.runDir(runId);
    // Age is the run's last journal timestamp (the engine clock), not a file mtime.
    const last = deps.engine.entries(runId).at(-1)?.ts;
    const age = last ? Date.parse(last) : 0;
    if (age <= cutoff) {
      io.stdout(`${opts.dryRun ? 'would remove' : 'removed'} run ${runId}\n`);
      if (!opts.dryRun) removeTree(dir);
      removed++;
      continue;
    }
    for (const sub of ['workspace', 'handoff']) {
      const w = path.join(dir, sub);
      if (!existsSync(w)) continue;
      io.stdout(`${opts.dryRun ? 'would remove' : 'removed'} ${sub} of ${runId}\n`);
      if (!opts.dryRun) removeTree(w);
      workspaces++;
    }
  }
  io.stderr(
    `✔ gc: ${removed} run(s), ${workspaces} workspace(s) ${opts.dryRun ? 'to remove' : 'removed'} (older than ${days} days)\n`,
  );
  return ExitCode.Ok;
}
