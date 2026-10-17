# Plan 063: every unit test run keeps its temp folders under one per-run folder and deletes it at the end

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 4 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `vitest.config.ts` contains `setupFiles: ['tests/setup/no-network.ts'],` and that `tests/setup/no-network.ts` exists; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. A "Create" item writes a new file with exactly the content shown.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** The unit tests make temporary folders in 116 places (`mkdtempSync`) and remove them in 12. Nothing cleans up the rest. On the development machine the system temp folder reached about 700,000 entries, thousands of them added by every run: `incubator-home` (30,000), `fake-github` (28,000), `existing-src` (13,000), `gitcfg`, `new solution`, `adopt-src`, and more. A directory that large slows every test that creates a folder, and a quick check that normally takes 12 minutes ran for 45 and ended with the runner broken, with all 855 tests already reported as passing (853 passed, 2 pending).

After this plan, the unit project has a global setup that makes one folder per test run, `incubator-tests/run-<random>` under the system temp folder, and points `TEMP`, `TMP` and `TMPDIR` at it before any test process starts, so every `os.tmpdir()` in every test lands there. When the run ends, the whole folder is removed. At the start of a run it also removes run folders older than two hours that a crashed run left behind. Only folders under `incubator-tests` are ever touched. A new test asserts that the setup is active, so removing it from the configuration fails a test.

## Work items

### 1. The global setup

Create `tests/setup/temp-root.ts` with exactly this content:

```ts
// Unit-suite hygiene (plan 063): all temp folders of a run live under one folder, removed when the run ends.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STALE_MS = 2 * 60 * 60 * 1000;

/** Vitest global setup: points the temp folder of every test process at a per-run folder and returns its removal. */
export default function setup(): () => void {
  const parent = path.join(os.tmpdir(), 'incubator-tests');
  mkdirSync(parent, { recursive: true });
  // why: a run that crashed never reached its teardown; only folders in this parent are ever removed.
  for (const name of readdirSync(parent)) {
    const stale = path.join(parent, name);
    try {
      if (Date.now() - statSync(stale).mtimeMs > STALE_MS)
        rmSync(stale, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // a folder another run still holds is left for the next time
    }
  }
  const root = mkdtempSync(path.join(parent, 'run-'));
  process.env['TEMP'] = root;
  process.env['TMP'] = root;
  process.env['TMPDIR'] = root;
  return () => {
    rmSync(root, { recursive: true, force: true, maxRetries: 2 });
  };
}
```

### 2. Use it in the unit project

In `vitest.config.ts`:

Find:

```text
          setupFiles: ['tests/setup/no-network.ts'],
          // why: git-heavy integration tests spawn dozens of processes; Windows runners spawn them
```

Replace with:

```text
          setupFiles: ['tests/setup/no-network.ts'],
          // why: plan 063: the tests leave about a hundred temp folders per run; one per-run root is removed at the end.
          globalSetup: ['tests/setup/temp-root.ts'],
          // why: git-heavy integration tests spawn dozens of processes; Windows runners spawn them
```

### 3. A test that the setup is active

Create `tests/setup/temp-root.test.ts` with exactly this content:

```ts
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the per-run temp root (plan 063)', () => {
  it('points the temp folder of every test at a folder under incubator-tests/run-', () => {
    const tmp = os.tmpdir();
    expect(path.basename(path.dirname(tmp))).toBe('incubator-tests');
    expect(path.basename(tmp)).toMatch(/^run-/);
    expect(existsSync(tmp)).toBe(true);
    expect(process.env['TMPDIR']).toBe(tmp);
  });
});
```

### 4. Format the touched files

Run:

```powershell
pnpm exec prettier --write tests/setup/temp-root.ts tests/setup/temp-root.test.ts vitest.config.ts
```

## Touched files and markers

| File                            | Marker                                        |
| ------------------------------- | --------------------------------------------- |
| `tests/setup/temp-root.ts`      | `export default function setup(): () => void` |
| `vitest.config.ts`              | `globalSetup: ['tests/setup/temp-root.ts'],`  |
| `tests/setup/temp-root.test.ts` | `the per-run temp root (plan 063)`            |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit tests/setup/temp-root.test.ts scripts/guard/guards.test.mjs packages/core/src/standup.test.ts
(Get-ChildItem (Join-Path $env:TEMP 'incubator-tests') -Directory -ErrorAction SilentlyContinue | Measure-Object).Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 tests vitest.config.ts
pnpm check:quick
```

```text
the three test files pass, including the new plan 063 test
the folder count prints 0: the run removed its own folder
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                    | Why                                                                                                 | Mechanical check                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The setup is written but not wired in                   | an unused file type-checks                                                                          | the new test fails when `os.tmpdir()` is not `incubator-tests/run-*`, so removing the `globalSetup` line fails it                     |
| Test processes do not see the new folder                | the variables must be set before the workers start, and a worker started earlier keeps the old ones | the new test runs inside a worker and asserts the folder and `TMPDIR`; vitest runs the global setup before it starts the workers      |
| The cleanup removes something that is not the suite's   | the temp folder holds other programs' files                                                         | only the `incubator-tests` parent is read, and only entries in it are removed; the run folder is created with `mkdtempSync` inside it |
| A leftover folder from a crashed run accumulates        | its teardown never ran                                                                              | the next run's setup removes entries in the parent older than two hours                                                               |
| A test passes only because it relied on an old leftover | stale fixtures were shared between runs                                                             | the run starts from an empty root, so any such test fails in the full `pnpm check:quick`                                              |
| The new test counts toward the suite floor              | the tests-collected guard fails closed on zero tests only                                           | the guard needs at least one test and the suite has hundreds                                                                          |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The system temp folder reached about 700,000 entries from test runs that never clean up, and a quick check that takes 12 minutes ran for 45 and broke                                                                                                                                                                                                                                                                                                                                          | CLOSED |
| 2     | In-session adversarial review (Cursor unavailable), after the cheap guards (abs-path, plan-lint, format) and the trial apply: typecheck and eslint clean; the new test and 43 others pass with the setup active and the run folder is gone afterwards; the heavier folder, adopt and verify tests run under it; two mutants (removing the globalSetup line, removing the TMPDIR line) are killed. Known limit: it does not clear the existing pile of old folders, which is removed separately | CLOSED |
| 3     | Code review of the Copilot run (Haiku 4.5): both new files and the one-line config change are identical to the trial apply; the two mutants killed in round 2 are the same code; `pnpm check:quick` alone follows, and its unit step time against the 12 to 15 minutes it normally takes is the proof that the temp pile no longer slows the tests                                                                                                                                             | CLOSED |
