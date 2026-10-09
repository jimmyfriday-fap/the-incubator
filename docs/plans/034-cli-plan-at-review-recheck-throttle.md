# Plan 034: the command line shows the plan at review, and GitHub re-checks are throttled

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 10 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not touch anything under `packages/`. Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip
  or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already
  prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Three follow-ups from plans 029 and 032:

1. `incubator resume <run> --change "..."` drafts the plan again and parks at review, but the command line only
   says "parked at REVIEW". The owner never sees the revised plan without opening the app. From now on, a new or
   update run parked at review lists the plan's features (`id: summary`), then the `--change` hint as before.
2. The `--change` hint is shown for every REVIEW park (`state.parked?.state === 'REVIEW'`), including a plan turned
   down at the terminal (`review_rejected`, thrown by `reviewStep` in `packages/core/src/engine.ts`). That case had
   no test.
3. The run page asks again whether the repository moved on each time the window gets focus (plan 029). For a
   folder run that reads a local folder. For a GitHub run it asks GitHub over the network (`git ls-remote`), on
   every focus. A GitHub run's answer is the one with no commit count (`RepoStatus.commits` is `null`;
   `apps/web/src/api-types.ts`: "null when they cannot be counted (a GitHub repository)"), while a folder run's
   answer counts the commits (0 when nothing moved). Focus re-checks for an answer with `commits === null` (a
   GitHub run, or nothing to compare yet) are now limited to once a minute. Folder runs with a count are unchanged.

## Work items

### 1. CLI: list the plan at a review park

In `apps/cli/src/commands/new.ts`:

Find:

```text
    if (
      state.parked?.state === 'REVIEW' &&
      (state.input.kind === 'new' || state.input.kind === 'enhance')
    )
      io.stderr(
        `  change the plan with: incubator resume ${state.runId} --change "what to change"\n`,
      );
```

Replace with:

```text
    if (
      state.parked?.state === 'REVIEW' &&
      (state.input.kind === 'new' || state.input.kind === 'enhance')
    ) {
      // why: the plan to approve, in the terminal too; after --change it is the plan drafted again (plan 034).
      const features = deps.engine.finalSpec(state.runId)?.intent.coreFeatures ?? [];
      if (features.length > 0)
        io.stderr(`  the plan:\n${features.map((f) => `    - ${f.id}: ${f.summary}`).join('\n')}\n`);
      io.stderr(
        `  change the plan with: incubator resume ${state.runId} --change "what to change"\n`,
      );
    }
```

### 2. CLI test: the revised plan is shown after `--change`

In `apps/cli/src/main.test.ts`:

Find:

```text
      expect(h.engine.finalSpec(runId)!.intent.coreFeatures.map((f) => f.id)).toEqual([
        'export-orders',
        'export-filter',
      ]);
```

Replace with:

```text
      expect(h.engine.finalSpec(runId)!.intent.coreFeatures.map((f) => f.id)).toEqual([
        'export-orders',
        'export-filter',
      ]);
      // The revised plan is shown on the command line (plan 034).
      expect(changed.err.join('')).toContain('  the plan:\n');
      for (const f of h.engine.finalSpec(runId)!.intent.coreFeatures)
        expect(changed.err.join('')).toContain(`    - ${f.id}: ${f.summary}\n`);
```

### 3. CLI test: a plan turned down at review

Create `apps/cli/src/commands/new.test.ts` with exactly:

```ts
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
```

### 4. Web: when coming back to the window asks again

Create `apps/web/src/ui/recheck.ts` with exactly:

```ts
import type { RepoStatus } from '../api-types.js';

/** How often coming back to the window may ask GitHub again whether a repository moved on (plan 034). */
export const REMOTE_RECHECK_MS = 60_000;

/**
 * Whether coming back to the window should check the repository again (plan 029). A folder run reads its own
 * folder, which is cheap, and its answer counts the commits. An answer with no count (`commits: null`: a GitHub
 * run, which asks GitHub over the network, or nothing to compare yet) asks again at most once a minute.
 */
export function recheckOnFocus(last: RepoStatus | null, lastAskedAt: number, now: number): boolean {
  if (!last || last.commits !== null) return true;
  return now - lastAskedAt >= REMOTE_RECHECK_MS;
}
```

### 5. Web: test for the re-check

Create `apps/web/src/ui/recheck.test.ts` with exactly:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '../api-types.js';
import { REMOTE_RECHECK_MS, recheckOnFocus } from './recheck.js';

const status = (commits: number | null): RepoStatus => ({
  moved: false,
  recorded: 'a'.repeat(40),
  current: 'a'.repeat(40),
  branch: 'main',
  commits,
});

describe('the repository re-check on focus (plan 034)', () => {
  it('always asks again for a folder run, and before the first answer', () => {
    expect(recheckOnFocus(null, 1000, 1001)).toBe(true);
    expect(recheckOnFocus(status(0), 1000, 1001)).toBe(true);
    expect(recheckOnFocus(status(3), 1000, 1001)).toBe(true);
  });

  it('asks GitHub at most once a minute', () => {
    expect(REMOTE_RECHECK_MS).toBe(60_000);
    expect(recheckOnFocus(status(null), 1000, 1000 + REMOTE_RECHECK_MS - 1)).toBe(false);
    expect(recheckOnFocus(status(null), 1000, 1000 + REMOTE_RECHECK_MS)).toBe(true);
  });

  it('is what the run page uses', () => {
    const view = readFileSync(path.join(import.meta.dirname, 'views', 'RunView.tsx'), 'utf8');
    expect(view).toContain(
      'if (recheckOnFocus(lastRepo.current, askedAt.current, Date.now())) setLooked((n) => n + 1);',
    );
    expect(view).toContain('askedAt.current = Date.now();');
    expect(view).toContain('lastRepo.current = s;');
    expect(view).toContain('lastRepo.current = null;');
  });
});
```

### 6. Web: the run page imports the re-check

In `apps/web/src/ui/views/RunView.tsx`:

Find:

```text
import { get, post } from '../api.js';
```

Replace with:

```text
import { get, post } from '../api.js';
import { recheckOnFocus } from '../recheck.js';
```

### 7. Web: the focus listener asks only when it should

In `apps/web/src/ui/views/RunView.tsx`:

Find:

```text
  const [looked, setLooked] = useState(0);
  useEffect(() => {
    const again = () => setLooked((n) => n + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
```

Replace with:

```text
  const [looked, setLooked] = useState(0);
  // why: a GitHub run's check asks GitHub over the network; coming back asks it at most once a minute (plan 034).
  const lastRepo = useRef<RepoStatus | null>(null);
  const askedAt = useRef(0);
  useEffect(() => {
    const again = () => {
      if (recheckOnFocus(lastRepo.current, askedAt.current, Date.now())) setLooked((n) => n + 1);
    };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
```

### 8. Web: the check records when it asked and what it heard

In `apps/web/src/ui/views/RunView.tsx`:

Find:

```text
    let live = true;
    get<RepoStatus>(`/api/runs/${runId}/repo-status`)
      .then((s) => {
        if (live) setRepo(s);
      })
```

Replace with:

```text
    let live = true;
    askedAt.current = Date.now();
    get<RepoStatus>(`/api/runs/${runId}/repo-status`)
      .then((s) => {
        if (!live) return;
        lastRepo.current = s;
        setRepo(s);
      })
```

### 9. Web: a run that stops being watched forgets the last answer

In `apps/web/src/ui/views/RunView.tsx`:

Find:

```text
    if (!watchRepo) {
      setRepo(null);
      return;
    }
```

Replace with:

```text
    if (!watchRepo) {
      lastRepo.current = null;
      setRepo(null);
      return;
    }
```

### 10. Format the touched files

Run:

```powershell
pnpm exec prettier --write apps/cli/src/commands/new.ts apps/cli/src/main.test.ts apps/cli/src/commands/new.test.ts apps/web/src/ui/recheck.ts apps/web/src/ui/recheck.test.ts apps/web/src/ui/views/RunView.tsx
```

## Touched files and markers

| File                                | Marker                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/cli/src/commands/new.ts`      | `const features = deps.engine.finalSpec(state.runId)?.intent.coreFeatures ?? [];`             |
| `apps/cli/src/main.test.ts`         | `The revised plan is shown on the command line (plan 034).`                                   |
| `apps/cli/src/commands/new.test.ts` | `a plan turned down at review (plan 034)`                                                     |
| `apps/web/src/ui/recheck.ts`        | `export const REMOTE_RECHECK_MS = 60_000;`                                                    |
| `apps/web/src/ui/recheck.test.ts`   | `the repository re-check on focus (plan 034)`                                                 |
| `apps/web/src/ui/views/RunView.tsx` | `if (recheckOnFocus(lastRepo.current, askedAt.current, Date.now())) setLooked((n) => n + 1);` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit apps/cli/src/commands/new.test.ts apps/cli/src/main.test.ts apps/web/src/ui/recheck.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 apps/cli apps/web
pnpm check:quick
pnpm --filter @incubator/web build:ui
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; pnpm exec vitest run --project e2e apps/web/e2e/web.e2e.test.ts -t "refresh: the repository moved on"
```

```text
the unit tests pass, including "a plan turned down at review (plan 034)", "the repository re-check on focus (plan 034)" and "resume --change corrects the plan at review in words, and the plan is drafted again (plan 032)"
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
the e2e test "refresh: the repository moved on" passes (a folder run still notices a commit on focus)
```

## Drift and hallucination guardrails

| Trap                                                                        | Why                                                          | Mechanical check                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| The plan list prints nothing because the spec is read from the wrong place  | `finalSpec` is the reviewed spec; `draft` may differ         | the main test asserts each feature of `finalSpec` appears as `    - id: summary` after `--change`                              |
| The list or the hint leaks onto adopt runs                                  | only new and update runs plan through discovery              | `new.test.ts` asserts neither appears for an adopt run                                                                         |
| A `review_rejected` park loses the hint                                     | the hint keys on the park's state, not its reason            | `new.test.ts` drives a `review_rejected` park for new and update runs                                                          |
| Folder runs stop noticing a commit on focus                                 | the throttle must apply only to answers with no commit count | `recheck.test.ts` asserts folder answers (0 and 3) always ask; the acceptance e2e (commit, then focus) passes for a folder run |
| The throttle is written but the page never uses it, or never records an ask | three wiring sites in `RunView.tsx`                          | `recheck.test.ts` reads `RunView.tsx` and asserts the focus call, the `askedAt` stamp and both `lastRepo` writes               |
| The minute is off by one or in seconds                                      | `REMOTE_RECHECK_MS` is milliseconds                          | `recheck.test.ts` asserts 60 000 and the edge either side of it                                                                |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Follow-ups from plans 029 and 032: the revised plan is not shown after `--change`, the `review_rejected` hint is untested, and GitHub is asked again on every focus                                                                                                                                                                                                                                                                                         | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy, unit, lint, typecheck and the folder-focus e2e): FIX-FIRST. Must-fix: the plan file itself failed the format gate; now formatted, with code spans on one line. Also: folder runs answer `commits: null` before there is anything to compare, so the wording says "an answer with no count"; the folder-focus e2e is an acceptance command; the late-answer guard covers `lastRepo` too | CLOSED |
