import { describe, expect, it } from 'vitest';
import { summarizeGaps } from './index.js';

describe('summarizeGaps', () => {
  it('counts statuses and decides compliance', () => {
    expect(summarizeGaps([])).toEqual({ present: 0, partial: 0, missing: 0, compliant: true });
    expect(
      summarizeGaps([
        { id: 'a', status: 'present' },
        { id: 'b', status: 'missing' },
        { id: 'c', status: 'partial' },
      ]),
    ).toEqual({ present: 1, partial: 1, missing: 1, compliant: false });
  });
});
