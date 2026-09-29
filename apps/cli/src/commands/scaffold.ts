import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scaffoldSpec } from '@incubator/core';
import { ExitCode, PolicyError } from '@incubator/runtime';
import type { Io } from '../io.js';

export interface ScaffoldCliOptions {
  out?: string;
  dryRun?: boolean;
  validateOnly?: boolean;
  force?: boolean;
}

/** `incubator scaffold <spec> --out <dir> [--dry-run] [--validate-only] [--force]` */
export async function runScaffold(
  io: Io,
  specFile: string,
  opts: ScaffoldCliOptions,
): Promise<number> {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(path.resolve(specFile), 'utf8'));
  } catch (e) {
    throw new PolicyError(
      `cannot read spec ${specFile}: ${e instanceof Error ? e.message : String(e)}`,
      {
        code: 'bad_spec',
      },
    );
  }
  if (!opts.out && !opts.dryRun && !opts.validateOnly)
    throw new PolicyError('--out <dir> is required (or use --dry-run / --validate-only)', {
      code: 'usage',
    });
  const r = await scaffoldSpec(input, {
    ...(opts.out ? { out: opts.out } : {}),
    ...(opts.dryRun ? { dryRun: true } : {}),
    ...(opts.validateOnly ? { validateOnly: true } : {}),
    ...(opts.force ? { force: true } : {}),
  });
  const packs = r.result.packs.map((p) => `${p.manifest.id}@${p.manifest.version}`).join(', ');
  if (r.defaulted.length)
    io.stderr(
      `ℹ ${r.defaulted.length} default(s) filled in (recorded as source "default" in incubator.json decisions)\n`,
    );
  if (opts.validateOnly) {
    io.stderr(`✔ spec is valid; ${r.result.files.size} files would be rendered (${packs})\n`);
    return ExitCode.Ok;
  }
  if (r.plan) {
    io.stdout(`${r.plan.join('\n')}\n`);
    io.stderr(`• dry run: ${r.result.files.size} files (${packs}); nothing written\n`);
    return ExitCode.Ok;
  }
  const report = r.report!;
  io.stderr(
    `✔ scaffolded ${report.written.length} file(s) into ${report.roots.app}${report.roots.paired ? ` and ${report.roots.paired}` : ''}\n` +
      `  packs      ${packs}\n` +
      `  next       cd ${opts.out ?? '.'} && node scripts/check.mjs quick\n`,
  );
  return ExitCode.Ok;
}
