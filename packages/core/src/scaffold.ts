import path from 'node:path';
import { PolicyError } from '@incubator/runtime';
import {
  completeSpec,
  validateSemantics,
  validateSpec,
  type Decision,
  type IncubatorSpec,
} from '@incubator/spec';
import {
  describeTree,
  loadRegistry,
  packRefs,
  render,
  selectPacks,
  writeTree,
  type PackRegistry,
  type RenderResult,
  type WriteMode,
  type WriteReport,
} from '@incubator/templates';
import { INCUBATOR_VERSION } from './version.js';

export interface ScaffoldOptions {
  /** Target directory for the application repository (the paired tests repo goes next to it). */
  out?: string;
  dryRun?: boolean;
  validateOnly?: boolean;
  force?: boolean;
  mode?: WriteMode;
  registry?: PackRegistry;
}

export interface ScaffoldOutcome {
  spec: IncubatorSpec;
  /** Defaults filled in because the input spec left them out (source: default). */
  defaulted: Decision[];
  result: RenderResult;
  /** `--dry-run`: one line per file (short hash, mode, pack, path). */
  plan?: string[];
  report?: WriteReport;
}

/**
 * The SCAFFOLD step (TDD §3.5): complete and validate the spec, pin the pack versions it composes,
 * render deterministically and write the tree. `validateOnly` stops after rendering in memory.
 */
export async function scaffoldSpec(
  input: unknown,
  opts: ScaffoldOptions,
): Promise<ScaffoldOutcome> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new PolicyError('the spec must be a JSON object', { code: 'bad_spec' });
  const { spec: completed, added } = completeSpec(input as never);
  const schema = validateSpec(completed);
  const issues = [...schema.issues, ...(schema.ok ? validateSemantics(completed) : [])];
  if (issues.length)
    throw new PolicyError(
      `the spec is not valid:\n${issues.map((i) => `  ${i.path || '/'}: ${i.message}`).join('\n')}`,
      { code: 'bad_spec' },
    );
  const registry = opts.registry ?? loadRegistry();
  const spec: IncubatorSpec =
    completed.templates.packs.length > 0
      ? completed
      : {
          ...completed,
          templates: { ...completed.templates, packs: packRefs(selectPacks(registry, completed)) },
        };
  const result = await render(spec, registry, { incubatorVersion: INCUBATOR_VERSION });
  const outcome: ScaffoldOutcome = { spec, defaulted: added, result };
  if (opts.validateOnly) return outcome;
  if (opts.dryRun) return { ...outcome, plan: describeTree(result) };
  if (!opts.out)
    throw new PolicyError('--out <dir> is required to write a scaffold', { code: 'usage' });
  const report = writeTree(result, path.resolve(opts.out), {
    mode: opts.mode ?? 'fresh',
    ...(opts.force ? { force: true } : {}),
    ...(spec.testing.home === 'paired-repo'
      ? { pairedName: spec.testing.pairedRepo?.name ?? `${spec.project.slug}-tests` }
      : {}),
  });
  return { ...outcome, report };
}
