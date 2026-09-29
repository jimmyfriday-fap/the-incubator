import { PolicyError } from '@incubator/runtime';
import { describe, expect, it } from 'vitest';
import { TICKET_STATES, canTransition, transition } from './state.js';

describe('ticket state machine', () => {
  it('walks the happy path', () => {
    const path = [
      'NEW',
      'TAGGED_TO_RELEASE',
      'ENRICHMENT_IN_PROGRESS',
      'DEV_IN_PROGRESS',
      'READY_FOR_TEST',
      'TEST_PASSED',
      'DEPLOYED',
    ] as const;
    for (let i = 1; i < path.length; i++) {
      expect(transition(path[i - 1]!, path[i]!)).toBe(path[i]);
    }
  });
  it('allows only TEST_FAILED → DEV_IN_PROGRESS backwards', () => {
    expect(canTransition('TEST_FAILED', 'DEV_IN_PROGRESS')).toBe(true);
    expect(canTransition('READY_FOR_TEST', 'DEV_IN_PROGRESS')).toBe(false);
    expect(() => transition('NEW', 'DEPLOYED')).toThrow(PolicyError);
  });
  it('parks from any live state', () => {
    for (const s of TICKET_STATES) {
      expect(canTransition(s, 'PARKED')).toBe(s !== 'DEPLOYED' && s !== 'PARKED');
    }
  });
});
