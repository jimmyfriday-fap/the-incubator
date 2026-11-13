import path from 'node:path';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

/** `incubator memory-adopt <store-folder>` (plan 079 WI-2): registers an existing store; writes nothing in it. */
export async function runMemoryAdopt(deps: CliDeps, io: Io, folder: string): Promise<number> {
  const { system, matched } = await deps.engine.adoptMemorySystem(path.resolve(folder));
  io.stdout(
    [
      `adopted the memory system ${system.name}`,
      `  store: ${system.store}`,
      `  remote: ${system.remote ?? 'none'}`,
      `  seed: ${system.seedVersion}  store policy: ${system.storeCommitPolicy}`,
      `  members (${system.members.length}, ${matched} already known as projects):`,
      ...system.members.map((m) => `    ${m.name} | ${m.dir}`),
      'nothing was written in the store or in any member',
      '',
    ].join('\n'),
  );
  return 0;
}

/** `incubator memory-system <name> [--root <folder>]` (plan 079 WI-2): one line per repository. Changes nothing. */
export async function runMemorySystem(
  deps: CliDeps,
  io: Io,
  name: string,
  opts: { root?: string; settings?: string },
): Promise<number> {
  const got = await deps.engine.memorySystemRepos(name, {
    ...(opts.root ? { root: opts.root } : {}),
    ...(opts.settings ? { settingsFile: opts.settings } : {}),
  });
  for (const r of got.rows) {
    const where = r.dir ?? 'no local copy';
    const status =
      r.state === 'ambiguous'
        ? `ambiguous: ${r.candidates.join(', ')}`
        : r.member
          ? 'member'
          : 'not a member yet';
    io.stdout(`${r.repo} | ${where} | ${status}\n`);
  }
  for (const w of got.warnings) io.stdout(`warning: ${w}\n`);
  return 0;
}
