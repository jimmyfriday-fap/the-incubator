import { describe, expect, it } from 'vitest';
import {
  codeLogLine,
  countRuns,
  hasVerdict,
  runBadge,
  runNote,
  verifiedVerdict,
} from './verify.js';

const run = (command: string, result: 'passed' | 'failed' | 'missing') => ({
  command,
  result,
  exitCode: result === 'missing' ? null : result === 'passed' ? 0 : 1,
  tail: '',
});
const verify = (over: Partial<Parameters<typeof verifiedVerdict>[0]> = {}) => ({
  done: true,
  remaining: [] as string[],
  runs: [run('a test', 'passed')],
  alreadyFailing: [] as string[],
  ...over,
});
const entry = (type: string, fields: Record<string, unknown>) => ({
  seq: 1,
  ts: '2026-10-09T10:00:00.000Z',
  type,
  ...fields,
});

describe("the Incubator's own check, in the owner's words (plan 044)", () => {
  it('has something to say only when it ran a command or a request is left', () => {
    expect(hasVerdict(null)).toBe(false);
    expect(hasVerdict(undefined)).toBe(false);
    expect(hasVerdict(verify({ runs: [] }))).toBe(false);
    expect(hasVerdict(verify())).toBe(true);
    expect(hasVerdict(verify({ runs: [], remaining: ['E-x'] }))).toBe(true);
  });

  it('says whether the work is finished, left, or not fully checked', () => {
    expect(verifiedVerdict(verify())).toEqual({
      text: 'The agent finished and reports the work ready for test. The Incubator ran your approved commands itself: they passed, and no request is left.',
      warn: false,
    });
    expect(verifiedVerdict(verify({ done: false, runs: [run('a test', 'failed')] }))).toMatchObject(
      {
        text: expect.stringContaining('stopped with work left') as string,
        warn: true,
      },
    );
    expect(
      verifiedVerdict(verify({ alreadyFailing: ['a test'], runs: [run('a test', 'failed')] })),
    ).toMatchObject({
      text: expect.stringContaining('were already failing before the agent started') as string,
      warn: true,
    });
    expect(verifiedVerdict(verify({ done: false, remaining: ['E-x'] }))).toMatchObject({
      text: expect.stringContaining('stopped with work left') as string,
      warn: true,
    });
    expect(verifiedVerdict(verify({ runs: [run('a test', 'missing')] }))).toMatchObject({
      text: expect.stringContaining('could not run on this computer') as string,
      warn: true,
    });
  });

  it('badges each command and explains a failure that was already there', () => {
    expect(runBadge(run('x', 'passed'))).toBe('passed');
    expect(runBadge(run('x', 'failed'))).toBe('failed');
    expect(runBadge(run('x', 'missing'))).toBe('not run');
    expect(runNote(run('x', 'missing'), [])).toBe(' (not installed on this computer)');
    expect(runNote(run('x', 'failed'), ['x'])).toBe(
      ' (was already failing before the agent started)',
    );
    expect(runNote(run('x', 'failed'), [])).toBe('');
    expect(runNote(run('x', 'passed'), ['x'])).toBe('');
    expect(countRuns([run('a', 'passed'), run('b', 'failed'), run('c', 'missing')])).toEqual({
      passed: 1,
      failed: 1,
      missing: 1,
    });
  });

  it('writes the coding stage into the run log', () => {
    expect(
      codeLogLine(
        entry('code.part', { part: 1, tripped: 'turns 151 > 150', sha: 'abcdef1234567' }),
      ),
    ).toBe('part 1 stopped at a run limit (turns 151 > 150): committed as checkpoint abcdef1');
    expect(codeLogLine(entry('code.part', { part: 2, tripped: null, sha: 'abcdef1234567' }))).toBe(
      'part 2 ended with work left: committed as checkpoint abcdef1',
    );
    expect(
      codeLogLine(
        entry('code.baseline', {
          runs: [run('a', 'passed'), run('b', 'failed'), run('c', 'missing')],
        }),
      ),
    ).toBe('before the agent started, your approved commands: 1 passed, 1 failed, 1 not run');
    expect(
      codeLogLine(
        entry('code.verify', { part: 1, runs: [run('a', 'passed')], remaining: ['E-x'] }),
      ),
    ).toBe(
      'after part 1, the Incubator ran your approved commands: 1 passed, 0 failed; 1 request(s) not done',
    );
    expect(codeLogLine(entry('code.verify', { part: 2, runs: [], remaining: [] }))).toBe(
      'after part 2: 0 request(s) not done',
    );
    expect(codeLogLine(entry('handoff.launch', {}))).toBeNull();
  });
});
