# Plan 044: the app and the CLI show what the Incubator checked itself, and no longer say "nothing is committed" after checkpoints

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 9 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plans 041 to 043. Before you start, check that `packages/core/src/engine.ts` contains `'code.verify'` and that `packages/core/fixtures/enhance/two-requests/01-DiscoveryTurn.json` exists; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. A "Create" block makes a new file with exactly that content.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Plan 042 makes an update run run the owner-approved commands itself and keep going. The result is stored on the run (`code.done` carries `verify`, and `code.verify` / `code.baseline` are journaled), but the owner cannot see it yet, and two lines now say things that are no longer true:

- The commit request says of approved commands: "Whether they passed is its own report: read it below". For an update run the Incubator ran them, so it should show what happened.
- The CLI says "the agent has stopped; nothing is committed" even when parts 1 to N were committed as checkpoints. The same applies to the Coding screen, which says checkpoints were made because a limit was hit; they are now also made because work was left.

What the owner sees after this plan:

- **Summary (commit request):** a block "What the Incubator checked itself" with one line per approved command (passed, failed with the end of its output, or not run because the program is not installed), and the requests still not marked done. When the Incubator's check has something to say, the verdict line says so in plain words.
- **CLI:** `check` lines and a `not done` line under the changes, and an accurate "the last part is not committed" line.
- **Run log:** lines for the baseline and for each check, and an honest line for a part that ended with work left.

The verdict wording changes only when the Incubator ran a command or a request is left; a run where it ran nothing and nothing is left keeps the existing text. When the Incubator did run commands and the work is done, the new text starts with the existing sentence ("The agent finished and reports the work ready for test.") and adds what the Incubator checked, so the existing end-to-end checks of that sentence still hold.

## Work items

### 1. The API shape the page reads

In `apps/web/src/api-types.ts`:

Find:

```text
    /** What the agent could run to check its work (absent on runs from before ADR-025). */
    checks?: { mode: 'gate' | 'approved' | 'none'; commands: string[] };
  } | null;
```

Replace with:

```text
    /** What the agent could run to check its work (absent on runs from before ADR-025). */
    checks?: { mode: 'gate' | 'approved' | 'none'; commands: string[] };
    /** How many parts the agent worked in (plan 036); absent in reports journaled before. */
    parts?: number;
    /** The Incubator's own check of an update run (plan 042); absent on other runs. */
    verify?: {
      done: boolean;
      remaining: string[];
      runs: {
        command: string;
        result: 'passed' | 'failed' | 'missing';
        exitCode: number | null;
        tail: string;
      }[];
      alreadyFailing: string[];
    };
  } | null;
```

### 2. The words, in one testable file

Create `apps/web/src/ui/verify.ts` with exactly:

```text
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
```

### 3. The words, tested

Create `apps/web/src/ui/verify.test.ts` with exactly:

```text
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
    expect(
      verifiedVerdict(verify({ done: false, runs: [run('a test', 'failed')] })),
    ).toMatchObject({
      text: expect.stringContaining('stopped with work left') as string,
      warn: true,
    });
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
      codeLogLine(entry('code.part', { part: 1, tripped: 'turns 151 > 150', sha: 'abcdef1234567' })),
    ).toBe('part 1 stopped at a run limit (turns 151 > 150): committed as checkpoint abcdef1');
    expect(codeLogLine(entry('code.part', { part: 2, tripped: null, sha: 'abcdef1234567' }))).toBe(
      'part 2 ended with work left: committed as checkpoint abcdef1',
    );
    expect(
      codeLogLine(
        entry('code.baseline', { runs: [run('a', 'passed'), run('b', 'failed'), run('c', 'missing')] }),
      ),
    ).toBe('before the agent started, your approved commands: 1 passed, 1 failed, 1 not run');
    expect(
      codeLogLine(entry('code.verify', { part: 1, runs: [run('a', 'passed')], remaining: ['E-x'] })),
    ).toBe('after part 1, the Incubator ran your approved commands: 1 passed, 0 failed; 1 request(s) not done');
    expect(codeLogLine(entry('code.verify', { part: 2, runs: [], remaining: [] }))).toBe(
      'after part 2: 0 request(s) not done',
    );
    expect(codeLogLine(entry('handoff.launch', {}))).toBeNull();
  });
});
```

### 4. The Summary shows it

In `apps/web/src/ui/views/FinishChanges.tsx`:

Find:

```text
import type { FinishInfo } from '../../api-types.js';
```

Replace with:

```text
import type { FinishInfo } from '../../api-types.js';
import { hasVerdict, runBadge, runNote, verifiedVerdict } from '../verify.js';
```

Find:

```text
  const v = finish.agent ? VERDICT[finish.agent.verdict] : null;
```

Replace with:

```text
  const checked = finish.agent?.verify;
  const verify = hasVerdict(checked) ? checked : null;
  // The Incubator's own words only for a run that ended normally; a limit, an error or a stop keeps its own text.
  const v = finish.agent
    ? verify && (finish.agent.verdict === 'ready' || finish.agent.verdict === 'parked')
      ? verifiedVerdict(verify)
      : VERDICT[finish.agent.verdict]
    : null;
```

Find:

```text
          {finish.agent.checks.commands.join(', ')}). Whether they passed is its own report: read it
          below.
```

Replace with:

```text
          {finish.agent.checks.commands.join(', ')}).{' '}
          {verify
            ? 'The Incubator ran them itself when the agent stopped: the results are below.'
            : 'Whether they passed is its own report: read it below.'}
```

Find:

```text
      {finish.agent?.summary && (
```

Replace with:

```text
      {verify && (
        <div data-testid="agent-verify">
          <h3>What the Incubator checked itself</h3>
          {verify.runs.length > 0 && (
            <ul className="changes" data-testid="verify-runs">
              {verify.runs.map((r) => (
                <li key={r.command} data-result={r.result}>
                  <span className="badge">{runBadge(r)}</span> {r.command}
                  {runNote(r, verify.alreadyFailing)}
                  {r.result === 'failed' && r.tail ? <pre>{r.tail}</pre> : null}
                </li>
              ))}
            </ul>
          )}
          {verify.remaining.length > 0 && (
            <p className="warn" data-testid="verify-remaining">
              These requests are not marked done: {verify.remaining.join(', ')}.
            </p>
          )}
        </div>
      )}
      {finish.agent?.summary && (
```

### 5. The Coding screen no longer blames a limit

In `apps/web/src/ui/views/Coding.tsx`:

Find:

```text
          ? `Parts 1 to ${run.finish.checkpoints.length} stopped at a run limit and are committed on the branch as checkpoints, not pushed; part ${run.finish.checkpoints.length + 1} is under way.`
```

Replace with:

```text
          ? `Parts 1 to ${run.finish.checkpoints.length} are committed on the branch as checkpoints, not pushed; part ${run.finish.checkpoints.length + 1} is under way.`
```

### 6. The run log

In `apps/web/src/ui/views/RunLog.tsx`:

Find:

```text
import type { LogEntry } from '../../api-types.js';
```

Replace with:

```text
import type { LogEntry } from '../../api-types.js';
import { codeLogLine } from '../verify.js';
```

Find:

```text
    case 'code.part':
      return `part ${String(e['part'])} stopped at a run limit${typeof e['tripped'] === 'string' ? ` (${e['tripped']})` : ''}: committed as checkpoint ${String(e['sha']).slice(0, 7)}`;
```

Replace with:

```text
    case 'code.part':
    case 'code.baseline':
    case 'code.verify':
      return codeLogLine(e) ?? e.type;
```

### 7. The CLI

In `apps/cli/src/commands/finish.ts`:

Find:

```text
function describeChanges(d: FinishDetail): string {
```

Replace with:

```text
/** What the Incubator checked itself after the agent stopped (plan 044): one line per command, one for the requests left. */
export function verifyLines(v: NonNullable<NonNullable<FinishDetail['agent']>['verify']>): string[] {
  const word = { passed: '✔ passed', missing: '- not run', failed: '✘ failed' } as const;
  return [
    ...v.runs.map(
      (r) =>
        `  check      ${word[r.result]}: ${r.command}${r.result === 'failed' && v.alreadyFailing.includes(r.command) ? ' (was already failing before the agent started)' : ''}`,
    ),
    ...(v.remaining.length > 0 ? [`  not done   ${v.remaining.join(', ')}`] : []),
  ];
}

function describeChanges(d: FinishDetail): string {
```

Find:

```text
    ...(d.agent ? [`  agent      ${d.agent.verdict}: ${d.agent.summary ?? '(no summary)'}`] : []),
```

Replace with:

```text
    ...(d.agent ? [`  agent      ${d.agent.verdict}: ${d.agent.summary ?? '(no summary)'}`] : []),
    ...(d.agent?.verify ? verifyLines(d.agent.verify) : []),
```

Find:

```text
    if (d) io.stderr(`${describeChanges(d)}\n`);
    io.stderr(
      `⏸ run ${id}: the agent has stopped; nothing is committed\n  commit with: incubator resume ${id} --commit [-m "message"]\n  or keep the changes uncommitted: incubator resume ${id} --leave\n`,
```

Replace with:

```text
    if (d) io.stderr(`${describeChanges(d)}\n`);
    // Parts committed as checkpoints (plans 036 and 042) are on the branch already; only the last part is open.
    const parts = d?.checkpoints.length ?? 0;
    const open = parts
      ? `the last part is not committed (parts 1 to ${parts} are committed on ${d?.branch ?? 'the branch'}, not pushed)`
      : 'nothing is committed';
    io.stderr(
      `⏸ run ${id}: the agent has stopped; ${open}\n  commit with: incubator resume ${id} --commit [-m "message"]\n  or keep the changes uncommitted: incubator resume ${id} --leave\n`,
```

### 8. The CLI tests

Create `apps/cli/src/commands/finish.test.ts` with exactly:

```text
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
```

In `apps/cli/src/main.test.ts`:

Find:

```text
        expect(h.engine.entries(runId).filter((e) => e.type === 'code.part')).toHaveLength(4);
```

Replace with:

```text
        expect(h.engine.entries(runId).filter((e) => e.type === 'code.part')).toHaveLength(4);
        expect(a.err.join('')).toMatch(
          /the agent has stopped; the last part is not committed \(parts 1 to 4 are committed on \S+, not pushed\)/,
        );
        expect(a.err.join('')).not.toContain('nothing is committed');
```

### 9. The page shows it: one end-to-end test

In `apps/web/e2e/web.e2e.test.ts`:

Find:

```text
  it('a page on another origin cannot drive the API, and a reused launch link is refused', async () => {
```

Replace with:

```text
  it('update: the Incubator runs the approved commands itself, keeps going until every request is done, and shows what it checked (plan 044)', async () => {
    process.env['FAKE_AGENT_MODE'] = 'steps';
    process.env['FAKE_AGENT_TICKETS'] = 'E-export-orders,E-export-filter';
    process.env['FAKE_AGENT_MARKS'] = '1';
    try {
      const { h, page, errors } = await open({ enhance: 'two-requests' });
      const { dir } = await seedAdoptRepo(h, 'bare-node');
      await intent(page).selectOption({ label: 'Update an existing solution' });
      await page.getByTestId('folder-path').fill(dir);
      await page.getByTestId('repo-ref').fill('octo/bare-node');
      await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
      await page.getByTestId('start-enhance').click();
      await page.waitForURL(/\/runs\/[\w-]+$/);
      await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
      await page
        .getByTestId('request-text')
        .fill('Kitchen staff need to export the orders list as a CSV file, and filter it by date.');
      await page.getByTestId('submit-request').click();
      await page.getByTestId('review').waitFor({ timeout: 30_000 });
      // A program that is not installed here: the Incubator reports it as not run, never as broken.
      await page.getByTestId('checks-editor').fill('incubator-no-such-tool test');
      await page.getByTestId('approve').click();

      // Part 1 marked one request; the Incubator started part 2 for the other, then checked its own way.
      await page.getByTestId('commit-request').waitFor({ timeout: 180_000 });
      expect(await page.getByTestId('agent-parts').textContent()).toContain(
        'The agent worked in 2 parts.',
      );
      expect(await page.getByTestId('agent-verdict').textContent()).toContain(
        'could not run on this computer',
      );
      const verify = (await page.getByTestId('agent-verify').textContent()) ?? '';
      expect(verify).toContain('What the Incubator checked itself');
      expect(verify).toContain('not run');
      expect(verify).toContain('incubator-no-such-tool test (not installed on this computer)');
      expect(await page.getByTestId('verify-remaining').count()).toBe(0);
      await shot(page, 'enhance-verified');
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      process.env['FAKE_AGENT_MODE'] = 'edit';
      delete process.env['FAKE_AGENT_TICKETS'];
      delete process.env['FAKE_AGENT_MARKS'];
    }
  }, 300_000);

  it('a page on another origin cannot drive the API, and a reused launch link is refused', async () => {
```

### 10. Format the touched files

Run:

```powershell
pnpm exec prettier --write apps/web/src/api-types.ts apps/web/src/ui/verify.ts apps/web/src/ui/verify.test.ts apps/web/src/ui/views/FinishChanges.tsx apps/web/src/ui/views/Coding.tsx apps/web/src/ui/views/RunLog.tsx apps/web/e2e/web.e2e.test.ts apps/cli/src/commands/finish.ts apps/cli/src/commands/finish.test.ts apps/cli/src/main.test.ts
```

## Touched files and markers

| File                                      | Marker                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/web/src/api-types.ts`               | `The Incubator's own check of an update run (plan 042); absent on other runs.`         |
| `apps/web/src/ui/verify.ts`               | `The run-log lines of the coding stage (plans 036 and 042); null for any other entry.` |
| `apps/web/src/ui/verify.test.ts`          | `the Incubator's own check, in the owner's words (plan 044)`                           |
| `apps/web/src/ui/views/FinishChanges.tsx` | `What the Incubator checked itself`                                                    |
| `apps/web/src/ui/views/Coding.tsx`        | `are committed on the branch as checkpoints, not pushed; part`                         |
| `apps/web/src/ui/views/RunLog.tsx`        | `return codeLogLine(e) ?? e.type;`                                                     |
| `apps/cli/src/commands/finish.ts`         | `the last part is not committed (parts 1 to`                                           |
| `apps/cli/src/commands/finish.test.ts`    | `what the Incubator checked itself, in the terminal (plan 044)`                        |
| `apps/cli/src/main.test.ts`               | `the agent has stopped; the last part is not committed`                                |
| `apps/web/e2e/web.e2e.test.ts`            | `shows what it checked (plan 044)`                                                     |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit apps/web/src/ui/verify.test.ts apps/cli/src/commands/finish.test.ts
pnpm exec vitest run --project unit apps/cli/src/main.test.ts -t "continues a run whose agent stopped at a limit with --continue"
pnpm typecheck
pnpm exec tsc -p apps/web/src/ui/tsconfig.json
pnpm exec eslint --max-warnings=0 apps/web apps/cli
pnpm check:quick
```

```text
the unit tests pass, including "the Incubator's own check, in the owner's words (plan 044)" and "what the Incubator checked itself, in the terminal (plan 044)"
pnpm typecheck, the UI typecheck and eslint exit 0
pnpm check:quick exits 0
```

The end-to-end test runs in the full gate (`INCUBATOR_E2E_CHANNEL=chrome pnpm check`), not here.

## Drift and hallucination guardrails

| Trap                                                              | Why                                                                                                                   | Mechanical check                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The verdict text changes for runs where the Incubator ran nothing | existing end-to-end checks read "The agent finished and reports the work ready for test." and "You stopped the agent" | `hasVerdict` is false when no command ran and no request is left; the unit test asserts it; every ready-and-done wording starts with the old sentence, so the existing e2e assertions stay unchanged (the "plans 036-038" test approves `npm run test` and still reads it) |
| A limit, an error or a stop is described as "finished"            | `verify` can exist next to a `ceiling` verdict                                                                        | the page uses the Incubator's words only for verdict `ready` or `parked`                                                                                                                                                                                                   |
| `code.part` log text changes for runs that tripped a limit        | the old test of the log line, and owners' habits                                                                      | the new unit test asserts the old string for a tripped part, exactly                                                                                                                                                                                                       |
| The CLI says "nothing is committed" after checkpoints             | the old message was fixed text                                                                                        | the CLI test asserts the new sentence and `not.toContain('nothing is committed')` for a run with 4 checkpoints                                                                                                                                                             |
| A run with no checkpoints loses its old message                   | the new sentence replaces the old one                                                                                 | the same sentence is kept when `checkpoints` is empty; the existing CLI tests that read `run <id>: the agent has stopped` still pass                                                                                                                                       |
| `FinishInfo` drifts from the core's `AgentReport`                 | two hand-written types                                                                                                | the new fields are optional and copy the core's names (`parts`, `verify`, `runs`, `alreadyFailing`, `remaining`) from plan 042                                                                                                                                             |

## Review rounds

| Round | Finding                                                                                                                                                       | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Opus review: the "they passed" wording broke an existing end-to-end check and was untrue when a command was already failing; two unit assertions were missing | CLOSED |
| 1     | The owner cannot see what the Incubator checked, and two lines still say a limit stopped the agent or that nothing is committed                               | CLOSED |
