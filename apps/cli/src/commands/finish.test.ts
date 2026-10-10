import { describe, expect, it } from 'vitest';
import { verifyLines } from './finish.js';

describe('what the Incubator checked itself, in the terminal (plan 044)', () => {
  it('lists each command and the requests left', () => {
    expect(
      verifyLines({
        done: false,
        remaining: ['E-export-filter', 'E-export-orders'],
        alreadyFailing: ['node scripts/fail.mjs', 'node scripts/fixed.mjs'],
        runs: [
          { command: 'node scripts/pass.mjs', result: 'passed', exitCode: 0, tail: '' },
          { command: 'node scripts/fail.mjs', result: 'failed', exitCode: 1, tail: 'x' },
          { command: 'flutter test', result: 'failed', exitCode: 1, tail: 'y' },
          { command: 'supabase-nothing test', result: 'missing', exitCode: null, tail: '' },
          { command: 'node scripts/fixed.mjs', result: 'passed', exitCode: 0, tail: '' },
        ],
      }),
    ).toEqual([
      '  check      ✔ passed: node scripts/pass.mjs',
      '  check      ✘ failed: node scripts/fail.mjs (was already failing before the agent started)',
      '  check      ✘ failed: flutter test',
      '  check      - not run: supabase-nothing test',
      '  check      ✔ passed: node scripts/fixed.mjs',
      '  not done   E-export-filter, E-export-orders',
    ]);
  });

  it('says nothing when there is nothing to report', () => {
    expect(verifyLines({ done: true, remaining: [], alreadyFailing: [], runs: [] })).toEqual([]);
  });
});
