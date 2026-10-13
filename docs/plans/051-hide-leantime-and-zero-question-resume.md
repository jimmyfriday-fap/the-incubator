# Plan 051: the tracker question stops offering Leantime, and a run parked for answers with no question shows Resume

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 9 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/core/src/discovery/questions.ts` contains `export function selectQuestions(` and that `apps/web/src/server/driver.ts` contains `export class WebPrompter implements Prompter {`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Do not edit `packages/core/prompts/`, `packages/core/src/discovery/prompt-builder.ts`, `packages/spec/`, or anything under `.github/`.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.**

[item 2] The questions cannot ask for a Leantime address and project, so a run that chose Leantime only fell back to local tickets afterwards (plan 045). The owner decided the tracker question should not offer Leantime at all. The schema allows `leantime` and `local` for `tracker.type`, so once the engine removes `leantime` from the model's reply nothing is left to choose, and the question is dropped. The prompt and the schema stay as they are: the model may still offer it, `incubator.json` may still say `leantime`, and an owner can set it at review.

[item 3] A run can park `needs_input` with an empty question list. The web prompter then parks again for zero questions, and the run page shows neither a card nor Resume, because the card renders only when there are questions and the generic parked card is hidden whenever the run is "asking". After this plan a zero-question ask returns at once, so the engine carries on, and a parked run with no questions to show falls through to the parked card with its Resume button.

## Work items

### 1. [item 2] Add `withoutLeantime` to the question rules

In `packages/core/src/discovery/questions.ts`:

Find:

```text
/**
 * The engine, not the model, enforces the clarification rules (TDD §5.2): drop questions the packs
```

Replace with:

```text
/** Why a tracker question is dropped once Leantime is taken out of it (plan 051). */
const LEANTIME_DROPPED = 'Leantime is not offered, and fewer than two other options remain';

/**
 * The questions cannot ask for a Leantime address and project, so the tracker question never offers
 * Leantime (plan 051). The option is taken out after the model replies; the prompt and the schema's
 * allowed values are unchanged, and an owner can still set Leantime in incubator.json at review.
 */
function withoutLeantime(q: Question): Question {
  if (q.key !== 'tracker.type' || !q.options.some((o) => o.value === 'leantime')) return q;
  const options = q.options.filter((o) => o.value !== 'leantime');
  if (options.length > 0 && !options.some((o) => o.recommended))
    options[0] = { ...options[0]!, recommended: true };
  return { ...q, options: options as Question['options'] };
}

/**
 * The engine, not the model, enforces the clarification rules (TDD §5.2): drop questions the packs
```

### 2. [item 2] Use it in `selectQuestions`

In `packages/core/src/discovery/questions.ts`:

Find:

```text
  for (const q of questions) {
    if (FIXED_BY_PACKS.some((k) => covers(k, q.key)))
      dropped.push({ key: q.key, why: 'fixed by the template packs' });
```

Replace with:

```text
  for (const offered of questions) {
    const q = withoutLeantime(offered);
    if (q !== offered && q.options.length < 2) dropped.push({ key: q.key, why: LEANTIME_DROPPED });
    else if (FIXED_BY_PACKS.some((k) => covers(k, q.key)))
      dropped.push({ key: q.key, why: 'fixed by the template packs' });
```

### 3. [item 2] Tests in `questions.test.ts`

In `packages/core/src/discovery/questions.test.ts`:

Find:

```text
import { questionIssues, questionTarget } from './questions.js';
```

Replace with:

```text
import { questionIssues, questionTarget, selectQuestions } from './questions.js';
```

Find:

```text
describe('withoutTargets (plan 021)', () => {
```

Replace with:

```text
describe('the tracker question never offers Leantime (plan 051)', () => {
  const tracker = (values: string[], recommended: string): Question => {
    const t = q('tracker.type', values);
    t.options.forEach((o) => (o.recommended = o.value === recommended));
    return t;
  };

  it('drops the question when taking Leantime out leaves fewer than two options', () => {
    const { asked, dropped } = selectQuestions([tracker(['leantime', 'local'], 'local')], []);
    expect(asked).toEqual([]);
    expect(dropped).toEqual([
      {
        key: 'tracker.type',
        why: 'Leantime is not offered, and fewer than two other options remain',
      },
    ]);
  });

  it('removes only the Leantime option, and keeps one option recommended', () => {
    const { asked, dropped } = selectQuestions(
      [tracker(['leantime', 'local', 'github'], 'leantime')],
      [],
    );
    expect(dropped).toEqual([]);
    expect(asked[0]!.options.map((o) => o.value)).toEqual(['local', 'github']);
    expect(asked[0]!.options.map((o) => o.recommended)).toEqual([true, false]);
  });

  it('leaves every other question, and Leantime as an option of it, alone', () => {
    const other = [q('request.tracker', ['leantime', 'local']), q('deploy.target', ['a', 'b'])];
    const { asked, dropped } = selectQuestions(other, []);
    expect(dropped).toEqual([]);
    expect(asked.map((a) => a.options.map((o) => o.value)).sort()).toEqual([
      ['a', 'b'],
      ['leantime', 'local'],
    ]);
  });

  it('does not send a reply back through the gate for offering Leantime', () => {
    expect(questionIssues([tracker(['leantime', 'local'], 'local')])).toEqual([]);
  });
});

describe('withoutTargets (plan 021)', () => {
```

### 4. [item 3] A zero-question ask returns at once

In `apps/web/src/server/driver.ts`:

Find:

```text
  ask(questions: readonly AskedQuestion[]): Promise<Answer[]> {
    const answers = this.#answers;
```

Replace with:

```text
  ask(questions: readonly AskedQuestion[]): Promise<Answer[]> {
    // why: with nothing to ask there is nothing to wait for; parking would show an empty card and no way on (plan 051).
    if (questions.length === 0) return Promise.resolve([]);
    const answers = this.#answers;
```

### 5. [item 3] Create `driver.test.ts`

Create `apps/web/src/server/driver.test.ts` with exactly this content:

```text
import { describe, expect, it } from 'vitest';
import { ParkError } from '@incubator/runtime';
import type { AskedQuestion } from '@incubator/core';
import { WebPrompter } from './driver.js';

const asked = (key: string): AskedQuestion => ({
  key,
  question: `Question about ${key}?`,
  impact: 5,
  options: [
    { value: 'a', label: 'A', recommended: true },
    { value: 'b', label: 'B', recommended: false },
  ],
});

describe('WebPrompter.ask', () => {
  it('answers a round with no questions at once (plan 051)', async () => {
    await expect(new WebPrompter().ask([])).resolves.toEqual([]);
  });

  it('parks needs_input when there are questions and no answers yet', async () => {
    const err = await new WebPrompter().ask([asked('deploy.target')]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ParkError);
    expect((err as ParkError).reason).toBe('needs_input');
  });

  it('hands back the submitted answers once, for the pending round', async () => {
    const answers = [{ key: 'deploy.target', value: 'a', source: 'user' as const }];
    const prompter = new WebPrompter(answers);
    await expect(prompter.ask([asked('deploy.target')])).resolves.toEqual(answers);
    await expect(prompter.ask([asked('deploy.target')])).rejects.toBeInstanceOf(ParkError);
  });
});
```

### 6. [item 3] Create the pure helper `asking.ts`

Create `apps/web/src/ui/asking.ts` with exactly this content:

```text
import type { RunDetail } from '../api-types.js';

/**
 * Whether the run page shows the questions card (plan 051). A run parked for answers with no question to
 * show is not asking: it falls through to the generic parked card, which has the Resume button.
 */
export function isAsking(run: Pick<RunDetail, 'state' | 'busy' | 'parked' | 'questions'>): boolean {
  return (
    run.state === 'PARKED' &&
    run.parked?.reason === 'needs_input' &&
    !run.busy &&
    (run.questions?.length ?? 0) > 0
  );
}
```

### 7. [item 3] Create `asking.test.ts`

Create `apps/web/src/ui/asking.test.ts` with exactly this content:

```text
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
```

### 8. [item 3] Use `isAsking` in `RunView.tsx`

In `apps/web/src/ui/views/RunView.tsx`:

Find:

```text
import { get, post } from '../api.js';
```

Replace with:

```text
import { get, post } from '../api.js';
import { isAsking } from '../asking.js';
```

Find:

```text
  const asking = run.state === 'PARKED' && run.parked?.reason === 'needs_input' && !run.busy;
```

Replace with:

```text
  // why: a run parked for answers with no question to show falls through to the Resume card (plan 051).
  const asking = isAsking(run);
```

### 8b. [item 2] Update the existing question-round expectation in `discovery.test.ts`

Found in review: the `python-webhook` fixture offers `tracker.type`, which is now dropped, so `testing.coverageThreshold` moves into the first round of five. In `packages/core/src/discovery.test.ts`:

Find:

```text
      ['deploy.target', 'stack.database', 'testing.home', 'tracker.type', 'agents.primary'],
```

Replace with:

```text
      [
        'deploy.target',
        'stack.database',
        'testing.home',
        'agents.primary',
        'testing.coverageThreshold',
      ],
```

Find:

```text
      { key: 'testing.coverageThreshold', why: 'over the per-round limit' },
```

Replace with:

```text
      {
        key: 'tracker.type',
        why: 'Leantime is not offered, and fewer than two other options remain',
      },
```

### 9. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/discovery/questions.ts packages/core/src/discovery/questions.test.ts apps/web/src/server/driver.ts apps/web/src/server/driver.test.ts apps/web/src/ui/asking.ts apps/web/src/ui/asking.test.ts apps/web/src/ui/views/RunView.tsx
```

## Touched files and markers

| File                                            | Marker                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/src/discovery/questions.ts`      | `function withoutLeantime(q: Question): Question {`                |
| `packages/core/src/discovery/questions.test.ts` | `the tracker question never offers Leantime (plan 051)`            |
| `packages/core/src/discovery.test.ts`           | `Leantime is not offered, and fewer than two other options remain` |
| `apps/web/src/server/driver.ts`                 | `if (questions.length === 0) return Promise.resolve([]);`          |
| `apps/web/src/server/driver.test.ts`            | `answers a round with no questions at once (plan 051)`             |
| `apps/web/src/ui/asking.ts`                     | `export function isAsking(`                                        |
| `apps/web/src/ui/asking.test.ts`                | `isAsking (plan 051)`                                              |
| `apps/web/src/ui/views/RunView.tsx`             | `const asking = isAsking(run);`                                    |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/discovery/questions.test.ts apps/web/src/server/driver.test.ts apps/web/src/ui/asking.test.ts
(Select-String -SimpleMatch -Path apps/web/src/ui/views/RunView.tsx "reason === 'needs_input'").Count
git status --short
pnpm typecheck
pnpm exec tsc -p apps/web/src/ui/tsconfig.json
pnpm exec eslint --max-warnings=0 packages/core/src/discovery apps/web/src
pnpm check:quick
```

```text
questions.test.ts, driver.test.ts and asking.test.ts pass, including the new plan 051 tests
the Select-String count prints 0
git status lists exactly the eight files in the manifest (three of them new), and docs/plans/051-hide-leantime-and-zero-question-resume.md
pnpm typecheck, the ui tsc and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                   | Why                                                                                                 | Mechanical check                                                                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The prompt or the schema is changed to hide Leantime                   | it would look like the simplest fix                                                                 | `git status --short` must not list `packages/core/prompts/`, `prompt-builder.ts` or `packages/spec/`; the fourth plan 051 test needs Leantime still valid                 |
| The helper is written but `selectQuestions` still loops on `questions` | an unused function still type-checks                                                                | the first plan 051 test expects `asked` empty and the Leantime reason in `dropped`; it fails if the loop does not call `withoutLeantime`; eslint flags an unused function |
| Other questions lose a Leantime option                                 | a filter on the option value alone would hit `request.tracker` too                                  | the third plan 051 test keeps `leantime` in the `request.tracker` question                                                                                                |
| `questionIssues` is changed and starts rejecting good replies          | the owner's text mentioned it; it needs no change because `leantime` is a valid enum value          | the fourth plan 051 test expects `[]`; no work item edits `questionIssues`                                                                                                |
| The zero-question return is placed after the answers logic             | a prompter with stored answers would then consume them for an empty round                           | the new line comes first in the Replace block; the driver test "hands back the submitted answers once" still passes                                                       |
| `RunView` keeps the old `asking` expression                            | `isAsking` would be imported and unused                                                             | the Select-String count of `reason === 'needs_input'` in `RunView.tsx` must print 0; eslint flags the unused import                                                       |
| The Resume card still hides                                            | `stuck` excludes `asking`; if `asking` stayed true with no questions the card would still be hidden | `isAsking` returns false for `[]` and `null` questions (asking.test.ts); `stuck` is not edited                                                                            |
| The UI test needs a React renderer                                     | there is none in the repo                                                                           | the decision lives in `asking.ts`, a pure function, tested like `recheck.ts`; `git status` shows no `package.json` change                                                 |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Review of the Copilot run (Haiku 4.5; 5.5 was not available): all seven manifest markers present and the source matches the plan. Gap: the plan missed `packages/core/src/discovery.test.ts`, whose `python-webhook` expectation listed `tracker.type` in round 1; Haiku updated it correctly (now work item 8b). `pnpm check:quick` exits 0 (17 checks, unit 0 failures)                                                                               | CLOSED |
| 1     | Claude review by trial apply in the worktree, then reverted: every Find block unique; the three test files (31 tests), typecheck, the ui tsc, eslint and plan-lint pass; four mutations (no `withoutLeantime` call, filter on every key, no zero-question return, `isAsking` ignoring questions) each fail a plan 051 test. Finding: the schema allows only `leantime` and `local`, so the tracker question is dropped outright, which the Why now says | CLOSED |
