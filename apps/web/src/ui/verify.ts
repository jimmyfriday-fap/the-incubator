import type { FinishInfo, LogEntry } from '../api-types.js';

type Verify = NonNullable<NonNullable<FinishInfo['agent']>['verify']>;
type Run = Verify['runs'][number];

/** True when the Incubator's own check has something to say: it ran a command, or a request is left (plan 044). */
export function hasVerdict(v: Verify | null | undefined): v is Verify {
  return !!v && (v.runs.length > 0 || v.remaining.length > 0);
}

/** The verdict line of an update run the Incubator checked itself. */
export function verifiedVerdict(v: Verify): { text: string; warn: boolean } {
  if (!v.done)
    return {
      text: 'The agent stopped with work left: requests not done, or commands failing. Review with care.',
      warn: true,
    };
  // why: starts with the plain verdict's words, so a reader (and the existing end-to-end checks) sees "ready" first.
  const ready = 'The agent finished and reports the work ready for test.';
  if (v.runs.some((r) => r.result === 'missing'))
    return {
      text: `${ready} Some approved commands could not run on this computer, so the work is not fully checked.`,
      warn: true,
    };
  if (v.runs.some((r) => r.result === 'failed'))
    return {
      text: `${ready} The Incubator ran your approved commands itself: the ones that fail were already failing before the agent started.`,
      warn: true,
    };
  return {
    text: `${ready} The Incubator ran your approved commands itself: they passed, and no request is left.`,
    warn: false,
  };
}

export function runBadge(r: Run): string {
  return r.result === 'passed' ? 'passed' : r.result === 'missing' ? 'not run' : 'failed';
}

/** What to add after a command, when its result needs explaining. */
export function runNote(r: Run, alreadyFailing: readonly string[]): string {
  if (r.result === 'missing') return ' (not installed on this computer)';
  if (r.result === 'failed' && alreadyFailing.includes(r.command))
    return ' (was already failing before the agent started)';
  return '';
}

export function countRuns(runs: readonly Pick<Run, 'result'>[]): {
  passed: number;
  failed: number;
  missing: number;
} {
  return {
    passed: runs.filter((r) => r.result === 'passed').length,
    failed: runs.filter((r) => r.result === 'failed').length,
    missing: runs.filter((r) => r.result === 'missing').length,
  };
}

function summarise(runs: readonly Pick<Run, 'result'>[]): string {
  const c = countRuns(runs);
  return `${c.passed} passed, ${c.failed} failed${c.missing ? `, ${c.missing} not run` : ''}`;
}

/** The run-log lines of the coding stage (plans 036 and 042); null for any other entry. */
export function codeLogLine(e: LogEntry): string | null {
  const runs = Array.isArray(e['runs']) ? (e['runs'] as Pick<Run, 'result'>[]) : [];
  switch (e.type) {
    case 'code.part':
      return `part ${String(e['part'])} ${typeof e['tripped'] === 'string' ? `stopped at a run limit (${e['tripped']})` : 'ended with work left'}: committed as checkpoint ${String(e['sha']).slice(0, 7)}`;
    case 'code.baseline':
      return `before the agent started, your approved commands: ${summarise(runs)}`;
    case 'code.verify': {
      const left = Array.isArray(e['remaining']) ? e['remaining'].length : 0;
      return runs.length > 0
        ? `after part ${String(e['part'])}, the Incubator ran your approved commands: ${summarise(runs)}; ${left} request(s) not done`
        : `after part ${String(e['part'])}: ${left} request(s) not done`;
    }
    default:
      return null;
  }
}
