import type { PortfolioProject } from '@incubator/core';
import { ExitCode, PolicyError } from '@incubator/runtime';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

const day = (iso: string): string => iso.slice(0, 10);
const where = (p: PortfolioProject): string =>
  p.repo.url?.replace(/^https:\/\/github\.com\//, '') ?? p.repo.dir ?? '-';

/** A project by its id, an unambiguous start of it, or its exact name. */
function find(projects: PortfolioProject[], ref: string): PortfolioProject {
  const lower = ref.toLowerCase();
  const hits = projects.filter(
    (p) => p.id === ref || p.id.startsWith(lower) || p.name.toLowerCase() === lower,
  );
  if (hits.length === 1) return hits[0]!;
  throw new PolicyError(
    hits.length === 0
      ? `no project matches "${ref}"; run \`incubator portfolio\` to list them`
      : `"${ref}" matches ${hits.length} projects; use more of the id`,
    { code: hits.length === 0 ? 'not_found' : 'ambiguous' },
  );
}

/**
 * `incubator portfolio [project] [--json]` (ADR-028): every project the Incubator has worked on, or one
 * project with the runs that worked on it. The first use files the runs already on disk.
 */
export async function runPortfolio(
  deps: CliDeps,
  io: Io,
  ref: string | undefined,
  opts: { json?: boolean },
): Promise<number> {
  await deps.engine.portfolioBackfill();
  const projects = deps.engine.portfolioList();
  if (ref !== undefined) {
    const p = find(projects, ref);
    if (opts.json) io.stdout(`${JSON.stringify(p, null, 2)}\n`);
    else {
      io.stdout(`${p.name}  (${p.id})\n`);
      if (p.summary) io.stdout(`${p.summary}\n`);
      io.stdout(
        `stack: ${p.stack ?? '-'} · repository: ${where(p)} · ${p.origin} · since ${day(p.createdAt)}\n`,
      );
      if (p.repo.dir) io.stdout(`folder: ${p.repo.dir}\n`);
      io.stdout(`\nruns (${p.runs.length}), newest first:\n`);
      for (const r of p.runs) {
        const out = r.outcome;
        const outcome = [
          out?.pr ? `PR #${out.pr.number}` : '',
          out?.commit ? `commit ${out.commit.slice(0, 7)}` : '',
          out?.local ? `left in ${out.local}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        io.stdout(
          `  ${r.runId}  ${r.state.padEnd(8)} ${r.kind.padEnd(8)} ${day(r.startedAt)}${outcome ? `  ${outcome}` : ''}\n`,
        );
        if (r.request) io.stdout(`    ${r.request.replace(/\s+/g, ' ').slice(0, 120)}\n`);
      }
    }
    return ExitCode.Ok;
  }
  if (opts.json) {
    io.stdout(`${JSON.stringify(projects, null, 2)}\n`);
    return ExitCode.Ok;
  }
  if (projects.length === 0) {
    io.stdout('No projects yet. A run on a folder files it here.\n');
    return ExitCode.Ok;
  }
  const width = Math.min(30, Math.max(...projects.map((p) => p.name.length)));
  for (const p of projects) {
    const latest = p.runs[0];
    io.stdout(
      `${p.id.slice(0, 8)}  ${p.name.slice(0, width).padEnd(width)}  ${(p.stack ?? '-').padEnd(13)} ${String(p.runs.length).padStart(3)} runs  ${latest ? `${latest.state} ${day(latest.startedAt)}` : '-'}  ${where(p)}\n`,
    );
  }
  return ExitCode.Ok;
}
