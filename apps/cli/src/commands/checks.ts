import { PolicyError } from '@incubator/runtime';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

/** `--check <command>` (repeatable) and `--no-checks`, on `enhance --in-place` and `resume`. */
export interface CheckOptions {
  check?: string[];
  /** Commander sets this to false for `--no-checks`. */
  checks?: boolean;
}

export const collectCheck = (value: string, previous: string[] = []): string[] => [
  ...previous,
  value,
];

/**
 * Records the owner's decision on what the coding agent may run in a repository the Incubator did
 * not build (ADR-025). Naming a command on the command line is the approval; `--yes` never is.
 */
export function applyChecks(deps: CliDeps, runId: string, opts: CheckOptions): void {
  const named = opts.check ?? [];
  if (named.length && opts.checks === false)
    throw new PolicyError('use either --check or --no-checks, not both', { code: 'usage' });
  if (named.length) deps.engine.submitChecks(runId, named);
  else if (opts.checks === false) deps.engine.submitChecks(runId, []);
}

/** After the agent ran with nothing approved: say so, and show how to approve the proposals. */
export function checksHint(deps: CliDeps, io: Io, runId: string): void {
  const detail = deps.engine.checksDetail(runId);
  if (!detail || detail.approved !== null) return;
  const proposed = detail.proposed.map((c) => c.command);
  io.stderr(
    [
      '',
      'No check commands were approved for this repository, so the coding agent could only edit files:',
      'its work is untested. To let an agent run checks next time, approve them by naming them:',
      proposed.length
        ? `  incubator enhance <folder> --in-place ${proposed.map((c) => `--check "${c}"`).join(' ')}`
        : '  incubator enhance <folder> --in-place --check "<command>"   (none could be proposed)',
      'or pass --no-checks to say the agent should run nothing.',
      '',
    ].join('\n'),
  );
}
