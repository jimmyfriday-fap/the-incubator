# Plan 046: a part that stops at a run limit is told what is left, and a round of checks is bounded by the run's minutes limit

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 7 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plans 041 to 044. Before you start, check that `packages/core/src/engine.ts` contains `'code.verify'` and that `packages/core/src/check-run.ts` contains `export const CHECK_TIMEOUT_MS`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. An "Insert after" block goes on the line right after the anchor, keeping the indentation shown.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Two gaps were left open in the review of plan 042:

1. **A part that stops at a run limit with requests left is not told what is left.** In `codeStep` (`packages/core/src/engine.ts`), the Incubator checks a part only when it ended normally or finished every request as a limit tripped. A part that tripped a limit with requests still unmarked gets no `verify`, so the next part's prompt has no "These requests are not done yet" list. After this plan the next part gets that list (no failing checks, because none were run).
2. **The time the checks take is not counted against the run's limits.** Each approved command may run for `CHECK_TIMEOUT_MS` (20 minutes), with no bound across a round of commands, so the checks after one part can take far longer than the run's `minutes` limit. After this plan one round of checks (the baseline, or the round after a part) shares a budget equal to the run's `minutes` limit: each command's timeout is the smaller of `CHECK_TIMEOUT_MS` and what is left of that budget, and a command that cannot start because the budget is used up is reported as `failed`, with the same `timed out` first line a timed-out command already gets.

## Work items

### 1. The budget helper and the budget option in `runChecks`

In `packages/core/src/check-run.ts`:

Find:

```text
import { STACK_CATALOG } from '@incubator/spec';
```

Replace with:

```text
import { DEFAULT_RUN_CEILINGS, STACK_CATALOG } from '@incubator/spec';
```

Find:

```text
/** How long one check may run: a full Flutter test run or a Docker-backed SQL suite takes minutes. */
export const CHECK_TIMEOUT_MS = 20 * 60_000;
```

Replace with:

```text
/** How long one check may run: a full Flutter test run or a Docker-backed SQL suite takes minutes. */
export const CHECK_TIMEOUT_MS = 20 * 60_000;

/** Plan 046: one round of checks may take no longer than the run's minutes limit (unset or 0 means the default). */
export function checkBudgetMs(minutes: number): number {
  return (minutes > 0 ? minutes : DEFAULT_RUN_CEILINGS.minutes) * 60_000;
}

/** Plan 046: the tail of a check that was not run because its round's time was used up. */
export const CHECK_NOT_RUN = "not run: the approved commands used up the run's minutes limit";
```

Find:

```text
  opts: { env?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CheckRun[]> {
  // why: these commands run on the owner's computer, so the approval rules are checked again here.
  if (validateChecks(commands).length > 0)
    throw new PolicyError('check commands refused', { code: 'check_command' });
  const runs: CheckRun[] = [];
```

Replace with:

```text
  opts: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Plan 046: the whole round's time, shared by its commands; unset means no shared limit. */
    budgetMs?: number;
  } = {},
): Promise<CheckRun[]> {
  // why: these commands run on the owner's computer, so the approval rules are checked again here.
  if (validateChecks(commands).length > 0)
    throw new PolicyError('check commands refused', { code: 'check_command' });
  const runs: CheckRun[] = [];
  const deadline = opts.budgetMs === undefined ? null : Date.now() + opts.budgetMs;
```

Find:

```text
      continue;
    }
    try {
      const r = await tools.exec.run(prog.bin, args, {
        cwd,
        timeoutMs: opts.timeoutMs ?? CHECK_TIMEOUT_MS,
```

Replace with:

```text
      continue;
    }
    const left = deadline === null ? Infinity : deadline - Date.now();
    if (left <= 0) {
      runs.push({
        command,
        result: 'failed',
        exitCode: null,
        tail: tailOf(CHECK_NOT_RUN, true),
      });
      continue;
    }
    try {
      const r = await tools.exec.run(prog.bin, args, {
        cwd,
        timeoutMs: Math.min(opts.timeoutMs ?? CHECK_TIMEOUT_MS, left),
```

### 2. Tests for the budget

In `packages/core/src/check-run.test.ts`:

Find:

```text
import { checkProgram, runChecks } from './check-run.js';
```

Replace with:

```text
import { checkBudgetMs, checkProgram, runChecks } from './check-run.js';
```

Find:

```text
    await expect(
      runChecks(['node scripts/slow.mjs'], dir, tools, { signal: stop.signal }),
    ).rejects.toBeInstanceOf(InterruptedError);
  }, 20_000);
});
```

Replace with:

```text
    await expect(
      runChecks(['node scripts/slow.mjs'], dir, tools, { signal: stop.signal }),
    ).rejects.toBeInstanceOf(InterruptedError);
  }, 20_000);

  it("a round of checks shares the run's minutes limit (plan 046)", async () => {
    expect(checkBudgetMs(10)).toBe(600_000);
    expect(checkBudgetMs(0)).toBe(45 * 60_000);
    const dir = repo();
    writeFileSync(path.join(dir, 'scripts', 'slow.mjs'), 'setTimeout(() => {}, 20000);\n');
    const started = Date.now();
    const runs = await runChecks(['node scripts/slow.mjs', 'node scripts/ok.mjs'], dir, tools, {
      budgetMs: 1500,
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(runs.map((r) => [r.command, r.result])).toEqual([
      ['node scripts/slow.mjs', 'failed'],
      ['node scripts/ok.mjs', 'failed'],
    ]);
    expect(runs[0]!.tail.startsWith('timed out')).toBe(true);
    expect(runs[1]!.exitCode).toBeNull();
    expect(runs[1]!.tail).toBe(
      "timed out\nnot run: the approved commands used up the run's minutes limit",
    );
    // Without a budget, nothing changes.
    const free = await runChecks(['node scripts/ok.mjs'], dir, tools);
    expect(free.map((r) => r.result)).toEqual(['passed']);
  }, 20_000);
});
```

### 3. The engine passes the budget

In `packages/core/src/engine.ts`:

Find:

```text
import { runChecks, type CheckRun } from './check-run.js';
```

Replace with:

```text
import { CHECK_NOT_RUN, checkBudgetMs, runChecks, type CheckRun } from './check-run.js';
```

Find:

```text
    const runs = await runChecks(commands, dir, tools, {
      ...(env ? { env } : {}),
      ...this.sig(runId),
    });
```

Replace with:

```text
    const runs = await runChecks(commands, dir, tools, {
      ...(env ? { env } : {}),
      // Plan 046: a round of checks gets its own time, equal to the run's minutes limit, as each part of the agent's work does.
      budgetMs: checkBudgetMs(this.approvedSpec(runId).agents.runCeilings.minutes),
      ...this.sig(runId),
    });
```

Find:

```text
      minutes: c.minutes > 0 ? c.minutes : 45,
```

Replace with:

```text
      minutes: c.minutes > 0 ? c.minutes : DEFAULT_RUN_CEILINGS.minutes,
```

### 4. The engine remembers what a limit-tripped part left

In `packages/core/src/engine.ts`, inside `codeStep`:

Find:

```text
      const alreadyFailing = baseline.filter((r) => r.result === 'failed').map((r) => r.command);
```

Replace with:

```text
      // why: a check the baseline never ran (its round's time was used up) is not known to fail, so it is not excused.
      const alreadyFailing = baseline
        .filter((r) => r.result === 'failed' && !r.tail.endsWith(CHECK_NOT_RUN))
        .map((r) => r.command);
```

Find:

```text
      let out: HandoffOutcome;
      for (;;) {
        let last = 0;
        const part = earlier.length + 1;
```

Replace with:

```text
      let out: HandoffOutcome;
      // Plan 046: the requests a part left unmarked when it stopped at a run limit (no checks run then).
      let unmarked: string[] = [];
      for (;;) {
        let last = 0;
        const part = earlier.length + 1;
```

Find:

```text
                          .map((r) => ({ command: r.command, tail: r.tail })),
                      }
                    : {}),
```

Replace with:

```text
                          .map((r) => ({ command: r.command, tail: r.tail })),
                      }
                    : unmarked.length
                      ? { remaining: tickets.filter((t) => unmarked.includes(t.id)) }
                      : {}),
```

Find:

```text
        verify = null;
        if (external && !out.stopped) {
```

Replace with:

```text
        verify = null;
        unmarked = [];
        if (external && !out.stopped) {
```

Find:

```text
            this.record(runId, 'code.verify', { part, ...verify });
            if (verify.done) break;
          }
        }
```

Replace with:

```text
            this.record(runId, 'code.verify', { part, ...verify });
            if (verify.done) break;
          } else if (out.tripped) {
            // why: a part that stopped at a limit with requests left is not checked, but the next part is still told which.
            unmarked = remaining;
          }
        }
```

### 5. The fake agent can stop at a run limit in `steps` mode

In `packages/core/fixtures/handoff/fake-agent.mjs`, inside the `mode === 'steps'` branch:

Find:

```text
    left--;
    writeFileSync(file, `${JSON.stringify({ ...t, state: 'READY_FOR_TEST' }, null, 2)}\n`);
  }
  assistant(1);
  emit({ type: 'result', subtype: 'success', total_cost_usd: 0.42, result: `Finished step ${n}.` });
} else if (mode === 'runaway') {
```

Replace with:

```text
    left--;
    writeFileSync(file, `${JSON.stringify({ ...t, state: 'READY_FOR_TEST' }, null, 2)}\n`);
  }
  // FAKE_AGENT_TRIP=N (plan 046): the first N launches keep calling tools until a run limit stops them.
  if (n <= Number(process.env.FAKE_AGENT_TRIP ?? 0)) {
    const tick = () => {
      assistant(5);
      setTimeout(tick, 5);
    };
    tick();
  } else {
    assistant(1);
    emit({ type: 'result', subtype: 'success', total_cost_usd: 0.42, result: `Finished step ${n}.` });
  }
} else if (mode === 'runaway') {
```

### 6. The end-to-end test for a limit-tripped part

In `packages/core/src/folder-runs.test.ts`, inside `describe('an update run keeps going until every request is done (plan 043)', ...)`:

Find:

```text
    expect(done(h, runId)).toMatchObject({ verdict: 'ready', parts: 2, verify: { done: true } });
    expect(ticket(dir, FILTER)).toBe('READY_FOR_TEST');
  });

  it("sends a failing check's output to the next part, and ends ready once it passes", async () => {
```

Replace with:

```text
    expect(done(h, runId)).toMatchObject({ verdict: 'ready', parts: 2, verify: { done: true } });
    expect(ticket(dir, FILTER)).toBe('READY_FOR_TEST');
  });

  it('tells the next part which request is left after a part stopped at a run limit (plan 046)', async () => {
    const { h, dir, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '1');
    vi.stubEnv('FAKE_AGENT_TRIP', '1');
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(of(h, runId, 'handoff.launch')).toHaveLength(2);
    expect(of(h, runId, 'code.part').map((e) => [e['part'], typeof e['tripped']])).toEqual([
      [1, 'string'],
    ]);
    // Part 1 stopped at a limit with a request left, so the Incubator did not check it.
    expect(of(h, runId, 'code.verify').map((e) => e['part'])).toEqual([2]);
    expect(prompt(dir, 2)).toContain('## Continuing: part 2 of up to 5');
    expect(prompt(dir, 2)).toContain(
      `These requests are not done yet: their tickets are not marked READY_FOR_TEST.\n\n- ${FILTER}: ${FILTER_SUMMARY}`,
    );
    expect(prompt(dir, 2)).not.toContain(`- ${ORDERS}:`);
    expect(prompt(dir, 2)).not.toContain('these failed');
    expect(done(h, runId)).toMatchObject({ verdict: 'ready', parts: 2, verify: { done: true } });
    expect(ticket(dir, FILTER)).toBe('READY_FOR_TEST');
  });

  it("sends a failing check's output to the next part, and ends ready once it passes", async () => {
```

### 7. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/check-run.ts packages/core/src/check-run.test.ts packages/core/src/engine.ts packages/core/src/folder-runs.test.ts
```

## Touched files and markers

| File                                            | Marker                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/core/src/check-run.ts`                | `export const CHECK_NOT_RUN`                                                               |
| `packages/core/src/check-run.test.ts`           | `a round of checks shares the run's minutes limit (plan 046)`                              |
| `packages/core/src/engine.ts`                   | `unmarked = remaining;`                                                                    |
| `packages/core/fixtures/handoff/fake-agent.mjs` | `FAKE_AGENT_TRIP=N (plan 046)`                                                             |
| `packages/core/src/folder-runs.test.ts`         | `tells the next part which request is left after a part stopped at a run limit (plan 046)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/check-run.test.ts
pnpm exec vitest run --project unit packages/core/src/folder-runs.test.ts -t "every request is done"
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
check-run.test.ts passes, including "a round of checks shares the run's minutes limit (plan 046)"
folder-runs.test.ts passes every test in the plan 043 block, including the new plan 046 test
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                          | Why                                                                                                    | Mechanical check                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tripped part is verified, changing its verdict or journal | setting `verify` for a tripped part would record `code.verify` and park a run that hit a limit         | the new test asserts `code.verify` parts are `[2]` only; the tripped part is committed as `code.part` 1 and verified only after part 2                                      |
| `unmarked` leaks from one part into the next                  | it is set in one iteration and read in the next                                                        | `(Select-String -SimpleMatch -Path packages/core/src/engine.ts "unmarked = [];").Count` prints 1, next to `verify = null`; `left` (a real verify) is read before `unmarked` |
| The fake agent's new branch changes other `steps` tests       | every plan 043 test uses `steps` mode                                                                  | `FAKE_AGENT_TRIP` defaults to 0, so the old path runs; all plan 043 tests run in the acceptance command                                                                     |
| The budget breaks commands that were fine                     | `Math.min` with `Infinity` when no budget is set                                                       | the new test runs `node scripts/ok.mjs` with no budget and expects `passed`; the existing check-run tests pass no budget                                                    |
| The engine never passes the budget                            | the unit test covers `runChecks` only                                                                  | `Select-String -SimpleMatch -Path packages/core/src/engine.ts "budgetMs: checkBudgetMs("` prints one match; eslint fails if `checkBudgetMs` is imported but unused          |
| A check the baseline never ran is excused for the whole run   | a budget-exhausted baseline command is `failed`, and every baseline failure goes into `alreadyFailing` | `Select-String -SimpleMatch -Path packages/core/src/engine.ts "!r.tail.endsWith(CHECK_NOT_RUN)"` prints one match; eslint fails if `CHECK_NOT_RUN` is imported but unused   |
| The default minutes drift apart                               | `prepareHandoff` used a literal `45`                                                                   | both now read `DEFAULT_RUN_CEILINGS.minutes`; `checkBudgetMs(0)` is asserted to be `45 * 60_000`                                                                            |

## Review rounds

| Round | Finding                                                                                                                             | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Opus review: a baseline check never run for lack of time would be excused as already failing; wording overclaimed "counted against" | CLOSED |
| 1     | Plan 042 review nits: a limit-tripped part with requests left is not told what is left; check time is not bounded by the run limits | CLOSED |
