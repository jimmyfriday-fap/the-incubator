import { PolicyError } from '@incubator/runtime';

export const TICKET_STATES = [
  'NEW',
  'TAGGED_TO_RELEASE',
  'ENRICHMENT_IN_PROGRESS',
  'DEV_IN_PROGRESS',
  'READY_FOR_TEST',
  'TEST_PASSED',
  'TEST_FAILED',
  'DEPLOYED',
  'PARKED',
] as const;
export type TicketState = (typeof TICKET_STATES)[number];

/** Legal edges. `TEST_FAILED → DEV_IN_PROGRESS` is the only backward edge; any state may park. */
const EDGES: Record<TicketState, readonly TicketState[]> = {
  NEW: ['TAGGED_TO_RELEASE'],
  TAGGED_TO_RELEASE: ['ENRICHMENT_IN_PROGRESS'],
  ENRICHMENT_IN_PROGRESS: ['DEV_IN_PROGRESS'],
  DEV_IN_PROGRESS: ['READY_FOR_TEST'],
  READY_FOR_TEST: ['TEST_PASSED', 'TEST_FAILED'],
  TEST_PASSED: ['DEPLOYED'],
  TEST_FAILED: ['DEV_IN_PROGRESS'],
  DEPLOYED: [],
  PARKED: [],
};

export function canTransition(from: TicketState, to: TicketState): boolean {
  if (to === 'PARKED') return from !== 'DEPLOYED' && from !== 'PARKED';
  return EDGES[from].includes(to);
}

/** Pure transition; an illegal edge is a policy finding. */
export function transition(from: TicketState, to: TicketState): TicketState {
  if (!canTransition(from, to)) {
    throw new PolicyError(`illegal ticket transition ${from} → ${to}`, {
      code: 'illegal_transition',
      details: { from, to },
    });
  }
  return to;
}
