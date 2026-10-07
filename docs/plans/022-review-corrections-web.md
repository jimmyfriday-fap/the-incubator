# Plan 022: the owner can correct the plan at review (web and desktop page)

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Do not refactor, rename or reformat anything else by
  hand; work item 10 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Copy every string exactly as written, including quotes, backticks, indentation and punctuation. Blocks in `text`
  fences carry the file's own indentation; keep it.
- Do not touch anything under `packages/`. Plan 021 already added `Engine.requestChanges(runId, text)` and the
  fixtures `packages/core/fixtures/enhance/review-changes/` that this plan uses.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** Plan 021 gave the engine `requestChanges`: at REVIEW the owner's corrections are recorded, the spec is
drafted again with them, and the run returns to REVIEW with a new plan and brief. This plan puts it on the page: a
"Want something changed?" box under "What this run will do", a route for it, and a brief and review that refresh
for the new plan.

## Work items

### 1. The driver

File: `apps/web/src/server/driver.ts`

Insert this block directly before the line
`  /** REVIEW → APPROVED (optionally with an edited spec), then continues in the background. */`:

```text
  /** The owner's corrections at REVIEW (plan 021): the run drafts the plan again with them, then waits at REVIEW. */
  requestChanges(runId: string, text: string): void {
    this.parkedAt(runId, 'REVIEW');
    if (this.#busy.has(runId)) throw new ConflictError(`run ${runId} is already working`);
    this.engine.requestChanges(runId, text);
    this.spawn(runId, () => this.engine.advance(runId, new WebPrompter()));
  }

```

### 2. The route

File: `apps/web/src/server/server.ts`

Insert this block directly before the line
`  // The owner's decision on what the coding agent may run (ADR-025). An empty list is a decision.`:

```text
  // The owner's corrections at REVIEW (plan 021): only while the run waits at review.
  app.post<{ Body: { text: string } }>(
    '/api/runs/:id/changes',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: { text: { type: 'string', minLength: 1, maxLength: 4000 } },
        },
      },
    },
    withRun((runId, req: { body: { text: string } }) => {
      driver.requestChanges(runId, req.body.text);
      return { accepted: true };
    }),
  );

```

### 3. The box on the review page

Create `apps/web/src/ui/views/RequestChanges.tsx` with exactly:

```tsx
import { useState } from 'react';

/**
 * At REVIEW (plan 021): the owner describes what to add, remove or do differently. The run drafts the plan
 * again with it and comes back here with a new plan and a new "What this run will do".
 */
export function RequestChanges({ onSubmit }: { onSubmit: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    setBusy(true);
    setProblem(null);
    onSubmit(text)
      .then(() => setText(''))
      .catch((e: Error) => setProblem(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="card wide request-changes" data-testid="request-changes">
      <h2>Want something changed?</h2>
      <p className="muted">
        Describe what to add, remove or do differently, in your own words. The plan below is drafted
        again with your corrections, and you review it before anything is written.
      </p>
      <textarea
        data-testid="review-changes-text"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Also let coaches filter meets by date, and leave out the export for now…"
      />
      {problem && (
        <p className="error" role="alert" data-testid="review-changes-error">
          {problem}
        </p>
      )}
      <button data-testid="submit-changes" disabled={!text.trim() || busy} onClick={submit}>
        {busy ? 'Sending…' : 'Update the plan'}
      </button>
    </section>
  );
}
```

### 4. The review page shows the box

File: `apps/web/src/ui/views/Review.tsx`

4a. Replace this exact line:

```text
import { ReviewBrief } from './ReviewBrief.js';
```

with:

```text
import { RequestChanges } from './RequestChanges.js';
import { ReviewBrief } from './ReviewBrief.js';
```

4b. Replace this exact line (in the props of `export function Review(props: {`):

```text
  onChecks?(commands: string[]): Promise<unknown>;
```

with:

```text
  onChecks?(commands: string[]): Promise<unknown>;
  /** The owner's corrections at review (plan 021); absent where the run cannot take them. */
  onRequestChanges?: (text: string) => Promise<unknown>;
```

(Property syntax, not method syntax: the function is passed on to `RequestChanges`, and lint's `unbound-method` rule
rejects passing a method.)

4c. Replace this exact line:

```text
      <ReviewBrief runId={props.runId} edited={original !== '' && text !== original} />
```

with:

```text
      <ReviewBrief
        runId={props.runId}
        rev={props.rev}
        edited={original !== '' && text !== original}
      />
      {props.onRequestChanges && <RequestChanges onSubmit={props.onRequestChanges} />}
```

### 5. The brief refreshes for a new plan

File: `apps/web/src/ui/views/ReviewBrief.tsx`

5a. Replace this exact block:

```text
export function ReviewBrief(props: {
  runId: string;
```

with:

```text
export function ReviewBrief(props: {
  runId: string;
  /** The spec revision the brief is for: a new plan (after corrections) asks for its own brief. */
  rev?: number;
```

5b. Replace this exact line:

```text
  }, [props.runId, attempt]);
```

with:

```text
  }, [props.runId, props.rev, attempt]);
```

### 6. The run page wires it

File: `apps/web/src/ui/views/RunView.tsx`

Replace this exact block:

```text
        <Review
          runId={runId}
          rev={run.rev}
```

with:

```text
        <Review
          key={run.rev}
          runId={runId}
          rev={run.rev}
          {...(run.kind === 'new' || run.kind === 'enhance'
            ? {
                onRequestChanges: (text: string) =>
                  post(`/api/runs/${runId}/changes`, { text }).then(refresh),
              }
            : {})}
```

### 7. The run log names the new entries

File: `apps/web/src/ui/views/RunLog.tsx`

Replace this exact line (inside `function describe(e: LogEntry): string {`):

```text
    case 'questions':
```

with:

```text
    case 'review.feedback':
      return `correction at review: ${String(e['text'])}`;
    case 'answers.superseded':
      return `earlier answers replaced by a correction: ${(e['keys'] as string[]).join(', ')}`;
    case 'questions':
```

### 8. Server test

File: `apps/web/src/server/server.test.ts`

Insert this test directly before the line
`  it('serves a plain-English review summary at REVIEW, and says what the scan found', async () => {` (it is inside
`describe('enhance over the API'`, where `REQUEST` is defined; work item 10 indents it):

```ts
it('takes the owner corrections at review and comes back with a new plan and brief (plan 021)', async () => {
  const { api, h } = await boot({ enhance: 'review-changes' });
  const { dir } = await seedAdoptRepo(h, 'bare-node');
  // A run that is not at review refuses corrections.
  const waiting = (
    await api.post<{ runId: string }>('/api/runs', {
      kind: 'enhance',
      repo: dir,
      repoRef: 'octo/bare-node',
    })
  ).body.runId;
  await until(api, waiting, (x) => !x.busy && x.parked?.reason === 'needs_request');
  expect((await api.post(`/api/runs/${waiting}/changes`, { text: 'x' })).status).toBe(409);

  const { runId } = (
    await api.post<{ runId: string }>('/api/runs', {
      kind: 'enhance',
      repo: dir,
      repoRef: 'octo/bare-node',
      request: REQUEST,
    })
  ).body;
  const first = await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
  expect((await api.post(`/api/runs/${runId}/changes`, { text: '   ' })).status).toBe(422);
  expect((await api.post(`/api/runs/${runId}/changes`, {})).status).toBe(400);
  const sent = await api.post(`/api/runs/${runId}/changes`, {
    text: 'Also let kitchen staff filter the export by date.',
  });
  expect(sent.status).toBe(200);
  const second = await until(
    api,
    runId,
    (x) => !x.busy && x.parked?.state === 'REVIEW' && x.rev > first.rev,
  );
  expect(second.parked?.state).toBe('REVIEW');
  const spec = (
    await api.get<{ spec: { intent: { coreFeatures: { id: string }[] } } }>(
      `/api/runs/${runId}/spec-diff`,
    )
  ).body.spec;
  expect(spec.intent.coreFeatures.map((f) => f.id)).toEqual(['export-orders', 'export-filter']);
  let brief = (await api.get<ReviewSummaryResponse>(`/api/runs/${runId}/review-summary`)).body;
  for (let i = 0; i < 100 && brief.status === 'pending'; i++) {
    await new Promise((r) => setTimeout(r, 25));
    brief = (await api.get<ReviewSummaryResponse>(`/api/runs/${runId}/review-summary`)).body;
  }
  expect(brief).toMatchObject({
    status: 'ready',
    summary: { headline: expect.stringContaining('filtered by date') as string },
  });
});
```

Also add `ReviewSummaryResponse,` to the `import type {` list from `'../api-types.js'` at the top of the same file:
replace this exact line

```text
  RunListItem,
```

with:

```text
  ReviewSummaryResponse,
  RunListItem,
```

(the first occurrence, inside `import type { … } from '../api-types.js';`). If `ReviewSummaryResponse` is already
imported there, do not add it twice.

### 9. Browser test

File: `apps/web/e2e/web.e2e.test.ts`

Insert this test directly before the line
`  it('update: a GitHub remote that is not origin is suggested and pre-fills the repository field', async () => {`
(work item 10 indents it):

```ts
it('review: the owner corrects the plan in words and gets a new plan and brief (plan 021)', async () => {
  const { h, page, errors } = await open({ enhance: 'review-changes' });
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
    .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
  await page.getByTestId('submit-request').click();
  await page.getByTestId('review').waitFor({ timeout: 30_000 });

  // The box sits under "What this run will do"; it needs words before it can be sent.
  expect(await page.getByTestId('submit-changes').isDisabled()).toBe(true);
  await page
    .getByTestId('review-changes-text')
    .fill('Also let kitchen staff filter the export by date.');
  await shot(page, 'review-changes-1-typed');
  await page.getByTestId('submit-changes').click();

  // The run drafts the plan again and comes back to review with the new feature and a new brief.
  await expect
    .poll(() => page.getByTestId('brief-headline').textContent(), { timeout: 60_000 })
    .toContain('filtered by date');
  await expect
    .poll(() => page.getByTestId('spec-diff').textContent(), UI)
    .toContain('export-filter');
  await expect
    .poll(() => page.getByTestId('run-log').textContent(), UI)
    .toContain('correction at review: Also let kitchen staff filter the export by date.');
  await shot(page, 'review-changes-2-revised');
  expect(errors, errors.join('\n')).toEqual([]);
});
```

### 10. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write apps/web/src/server/driver.ts apps/web/src/server/server.ts apps/web/src/server/server.test.ts apps/web/src/ui/views/RequestChanges.tsx apps/web/src/ui/views/Review.tsx apps/web/src/ui/views/ReviewBrief.tsx apps/web/src/ui/views/RunView.tsx apps/web/src/ui/views/RunLog.tsx apps/web/e2e/web.e2e.test.ts
```

## Touched files and markers

| File                                       | Marker                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `apps/web/src/server/driver.ts`            | `requestChanges(runId: string, text: string): void {`                                       |
| `apps/web/src/server/server.ts`            | `'/api/runs/:id/changes'`                                                                   |
| `apps/web/src/ui/views/RequestChanges.tsx` | `data-testid="review-changes-text"`                                                         |
| `apps/web/src/ui/views/Review.tsx`         | `onRequestChanges?: (text: string) => Promise<unknown>;`                                    |
| `apps/web/src/ui/views/ReviewBrief.tsx`    | `[props.runId, props.rev, attempt]`                                                         |
| `apps/web/src/ui/views/RunView.tsx`        | ``post(`/api/runs/${runId}/changes`, { text })``                                            |
| `apps/web/src/ui/views/RunLog.tsx`         | `correction at review: `                                                                    |
| `apps/web/src/server/server.test.ts`       | `takes the owner corrections at review and comes back with a new plan and brief (plan 021)` |
| `apps/web/e2e/web.e2e.test.ts`             | `the owner corrects the plan in words and gets a new plan and brief (plan 021)`             |

## Acceptance commands

```sh
pnpm exec vitest run apps/web/src/server/server.test.ts -t "plan 021"
pnpm test:e2e
git status --porcelain -- packages
git diff -U0 -- "*.test.ts" | Select-String '^-[^-]'
pnpm exec eslint --max-warnings=0 apps/web
pnpm check:quick
```

```text
the server test passes: 409 away from review, 422 for empty text, 400 without text, then REVIEW again with a higher rev, the export-filter feature and a ready brief that mentions the date filter
the e2e suite passes, including "the owner corrects the plan in words and gets a new plan and brief (plan 021)"
git status --porcelain -- packages prints nothing (this plan changes no package)
the removed-lines check on *.test.ts prints nothing (work item 8 only adds lines; git shows the import change as one added line)
eslint on apps/web exits 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                    | Why                                                        | Mechanical check                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The box appears on adopt runs, which cannot take it     | adopt runs have no discovery step; the engine refuses them | `RunView` passes `onRequestChanges` only for `new` and `enhance`; the engine test from plan 021 asserts `no_discovery`                                                                                                                     |
| The brief keeps showing the old plan                    | `ReviewBrief` loaded once per run before                   | HUMAN: the e2e checks the new headline, but Review unmounts while the run redrafts (RunView renders it only when `!run.busy`), so dropping `rev` from the ReviewBrief deps still passes; keep it for a refresh that misses the busy window |
| The JSON editor keeps the old draft after a new plan    | `Review` kept its text once mounted                        | HUMAN: `key={run.rev}` is defensive; the e2e passes without it for the same reason. Without it, a Review that stays mounted keeps the old JSON and Approve would send the old plan as an edit                                              |
| Corrections are accepted at the wrong time              | the route must only work at REVIEW                         | the server test asserts 409 on a run waiting for its request                                                                                                                                                                               |
| The engine or its fixtures are edited to make this pass | this plan is web-only                                      | `git status --porcelain -- packages` prints nothing                                                                                                                                                                                        |
| A test line is removed or weakened                      | a literal executor may "fix" red tests that way            | the removed-lines check on `*.test.ts` prints nothing                                                                                                                                                                                      |
| A lint error ships                                      | the plan's own code must pass the repository's lint rules  | `pnpm exec eslint --max-warnings=0 apps/web` exits 0                                                                                                                                                                                       |

## Review rounds

| Round | Finding                                                                                                                                                                  | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1     | The owner had no way at review to say what to change except editing JSON (owner, run `20261006-031254-63n6jg`); plan 021 built the engine side                           | CLOSED |
| 2     | Review: method-syntax prop failed lint (unbound-method), the removed-lines expectation was wrong, and two guardrails overclaimed; fixed and marked HUMAN where defensive | CLOSED |
