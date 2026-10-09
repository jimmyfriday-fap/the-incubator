import { describe, expect, it } from 'vitest';
import type { RunState } from '@incubator/core';
import type { CliDeps } from '../deps.js';
import { reportRun } from './new.js';

const SPEC = {
  intent: {
    coreFeatures: [{ id: 'export-orders', summary: 'Export the orders as CSV.', lane: 'feature' }],
  },
};

function report(kind: string): { code: number; text: string } {
  const deps = { engine: { finalSpec: () => SPEC } } as unknown as CliDeps;
  const err: string[] = [];
  const io = { stdout: () => undefined, stderr: (t: string) => void err.push(t), isTTY: false };
  const state = {
    runId: 'r1',
    state: 'PARKED',
    parked: {
      state: 'REVIEW',
      reason: 'review_rejected',
      message: 'not approved at review',
      evidence: null,
    },
    input: { kind },
  } as unknown as RunState;
  return { code: reportRun(deps, io, state), text: err.join('') };
}

describe('a plan turned down at review (plan 034)', () => {
  it('lists the plan and says how to change it, for new and update runs', () => {
    for (const kind of ['new', 'enhance']) {
      const { code, text } = report(kind);
      expect(code).toBe(2);
      expect(text).toContain('⏸ run r1 parked at REVIEW: not approved at review');
      expect(text).toContain('  the plan:\n    - export-orders: Export the orders as CSV.\n');
      expect(text).toContain(
        '  change the plan with: incubator resume r1 --change "what to change"',
      );
    }
  });

  it('offers neither for an adopt run, which has no plan to correct', () => {
    const { code, text } = report('adopt');
    expect(code).toBe(2);
    expect(text).toContain('parked at REVIEW');
    expect(text).not.toContain('the plan:');
    expect(text).not.toContain('change the plan with');
  });
});
