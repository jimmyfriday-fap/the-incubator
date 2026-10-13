import type { RunDetail } from '../api-types.js';

/**
 * Whether the run page shows the questions card (plan 051). A run parked for answers with no question to
 * show is not asking: it falls through to the generic parked card, which has the Resume button.
 */
export function isAsking(run: Pick<RunDetail, 'state' | 'busy' | 'parked' | 'questions'>): boolean {
  return (
    run.state === 'PARKED' &&
    run.parked?.reason === 'needs_input' &&
    !run.busy &&
    (run.questions?.length ?? 0) > 0
  );
}
