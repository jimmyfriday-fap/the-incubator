import { describe, expect, it } from 'vitest';
import type { Question } from '@incubator/spec';
import { isAsking } from './asking.js';

const question: Question = {
  key: 'deploy.target',
  question: 'Where does it run?',
  impact: 5,
  options: [
    { value: 'a', label: 'A', recommended: true },
    { value: 'b', label: 'B', recommended: false },
  ],
};
const parked = { state: 'CLARIFY', reason: 'needs_input', message: 'questions are waiting' };

describe('isAsking (plan 051)', () => {
  it('asks while a parked run has questions to show', () => {
    expect(isAsking({ state: 'PARKED', busy: false, parked, questions: [question] })).toBe(true);
  });

  it('does not ask when there is no question to show, so Resume is offered instead', () => {
    expect(isAsking({ state: 'PARKED', busy: false, parked, questions: [] })).toBe(false);
    expect(isAsking({ state: 'PARKED', busy: false, parked, questions: null })).toBe(false);
  });

  it('does not ask while busy, for another park reason, or when not parked', () => {
    expect(isAsking({ state: 'PARKED', busy: true, parked, questions: [question] })).toBe(false);
    expect(
      isAsking({
        state: 'PARKED',
        busy: false,
        parked: { ...parked, reason: 'needs_review' },
        questions: [question],
      }),
    ).toBe(false);
    expect(isAsking({ state: 'DONE', busy: false, parked: null, questions: [question] })).toBe(
      false,
    );
  });
});
