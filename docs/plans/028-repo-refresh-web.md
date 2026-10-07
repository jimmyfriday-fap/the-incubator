# Plan 028: the web screens for refreshing an update run

## Executor preamble

You are implementing an exact UI change. Rules for every work item:

- Change only the files named here, at the places named. Work item 9 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the browser test looks for the `data-testid` values and some texts.
- Keep every existing `data-testid` as it is. Do not touch anything under `packages/` or `apps/cli/`. Do not commit,
  push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable
  comment.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** Plans 025–027 let an update run notice that its repository moved on, read it again ("refresh"), and ask
the owner to confirm their change request and earlier answers. The server already offers:

- `GET /api/runs/:id/repo-status`;
- `POST /api/runs/:id/refresh`;
- `carriedQuestions` on the run detail.

This plan shows all of it on the run page:

1. A banner in the run header (`repo-moved`) when the repository has new commits, with a **Refresh** button
   (`refresh-repo`). A run parked with `repo_moved` shows the banner instead of a Resume button that would only park
   again.
2. After a refresh, the "What do you want to change?" box comes pre-filled with what the owner asked before
   (`evidence.previous`), with a note saying why (`request-previous-note`).
3. The questions asked again are titled "Your earlier answers", with a note (`carried-note`). Each earlier answer
   is selected, and the second button reads "Keep all my answers".

## Work items

### 1. The banner component

Create `apps/web/src/ui/views/RepoMoved.tsx` with exactly:

```tsx
import { useState } from 'react';
import type { RepoStatus } from '../../api-types.js';

/** The repository moved on since the run read it (plan 028): the owner can read it again. */
export function RepoMoved(props: { status: RepoStatus; onRefresh: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const { commits, recorded, current } = props.status;
  const what =
    commits === null
      ? 'it has new commits'
      : commits === 0
        ? 'another branch is checked out'
        : `${commits} new commit${commits === 1 ? '' : 's'}`;
  return (
    <div className="parked" data-testid="repo-moved">
      <p>
        The repository has changed since this run read it: {what}
        {recorded && current && (
          <>
            {' '}
            (<code>{recorded.slice(0, 7)}</code> → <code>{current.slice(0, 7)}</code>)
          </>
        )}
        . Refresh to read it again: you then confirm your request and your earlier answers, and the
        plan is drafted again from the code as it is now.
      </p>
      <button
        data-testid="refresh-repo"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void props.onRefresh().finally(() => setBusy(false));
        }}
      >
        {busy ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
```

### 2. The run page: imports and the repository status

File `apps/web/src/ui/views/RunView.tsx`.

Find:

```text
import type { LogEntry, RunDetail } from '../../api-types.js';
```

Replace with:

```text
import type { LogEntry, RepoStatus, RunDetail } from '../../api-types.js';
```

Find:

```text
import { Questions } from './Questions.js';
```

Replace with:

```text
import { Questions } from './Questions.js';
import { RepoMoved } from './RepoMoved.js';
```

Find:

```text
  const [tab, setTab] = useState<RunTab>('overview');
```

Replace with:

```text
  const [tab, setTab] = useState<RunTab>('overview');
  const [repo, setRepo] = useState<RepoStatus | null>(null);
```

Find:

```text
  useEffect(() => {
    const follow: RunTab = step?.startsWith('PARKED:REVIEW:') ? 'plan' : 'overview';
    if (step) setTab(follow);
  }, [step]);
```

Replace with:

```text
  useEffect(() => {
    const follow: RunTab = step?.startsWith('PARKED:REVIEW:') ? 'plan' : 'overview';
    if (step) setTab(follow);
  }, [step]);

  // Whether the repository moved on since the run read it (plan 028): asked again each time the run settles.
  const watchRepo = run?.kind === 'enhance' && !run.done && !run.busy;
  useEffect(() => {
    if (!watchRepo) {
      setRepo(null);
      return;
    }
    // why: an answer that lands after the run moved on (or after a newer ask) must not bring the banner back.
    let live = true;
    get<RepoStatus>(`/api/runs/${runId}/repo-status`)
      .then((s) => {
        if (live) setRepo(s);
      })
      .catch(() => {
        if (live) setRepo(null);
      });
    return () => {
      live = false;
    };
  }, [runId, watchRepo, step]);
```

### 3. The run page: the banner replaces a Resume that would only park again

File `apps/web/src/ui/views/RunView.tsx`.

Find:

```text
  const stuck =
    run.state === 'PARKED' &&
    !reviewing &&
```

Replace with:

```text
  // why: a run parked because its repository moved on (plan 025) is refreshed, not resumed; the banner says so.
  const movedAway = run.state === 'PARKED' && run.parked?.reason === 'repo_moved' && !!repo?.moved;
  const stuck =
    run.state === 'PARKED' &&
    !movedAway &&
    !reviewing &&
```

Find:

```text
        {stuck && run.parked && (
          <div className="parked" data-testid="parked">
```

Replace with:

```text
        {repo?.moved && (
          <RepoMoved status={repo} onRefresh={() => act(post(`/api/runs/${runId}/refresh`))} />
        )}
        {stuck && run.parked && (
          <div className="parked" data-testid="parked">
```

Find:

```text
          <Questions
            questions={run.questions}
            round={run.round}
```

Replace with:

```text
          <Questions
            questions={run.questions}
            round={run.round}
            carried={run.carriedQuestions}
```

### 4. Questions: the earlier answers asked again

File `apps/web/src/ui/views/Questions.tsx`.

Find:

```text
export function Questions(props: {
  questions: Question[];
  round: number;
```

Replace with:

```text
export function Questions(props: {
  questions: Question[];
  round: number;
  /** Earlier answers asked again after a refresh (plan 028): each one's earlier answer is selected. */
  carried?: boolean;
```

Find:

```text
      <h2>A few questions (round {props.round})</h2>
```

Replace with:

```text
      <h2>{props.carried ? 'Your earlier answers' : `A few questions (round ${props.round})`}</h2>
      {props.carried && (
        <p className="muted" data-testid="carried-note">
          The repository was read again. These are the questions you answered before, with your answer
          selected: keep it or pick another.
        </p>
      )}
```

Find:

```text
          Accept all defaults
```

Replace with:

```text
          {props.carried ? 'Keep all my answers' : 'Accept all defaults'}
```

Find:

```text
              {o.recommended && <span className="badge">recommended</span>}
```

Replace with:

```text
              {o.recommended && (
                <span className="badge">{props.carried ? 'your answer' : 'recommended'}</span>
              )}
```

### 5. The change request: pre-filled after a refresh

File `apps/web/src/ui/views/ChangeRequest.tsx`.

Find:

```text
  const [text, setText] = useState('');
```

Replace with:

```text
  // why: after a refresh (plan 025) the run hands back what the owner asked before, to confirm or edit.
  const previous = (run.parked?.evidence as { previous?: unknown } | null | undefined)?.previous;
  const [text, setText] = useState(typeof previous === 'string' ? previous : '');
```

Find:

```text
      <p className="muted">
        Describe the update in plain English.
```

Replace with:

```text
      {typeof previous === 'string' && (
        <p data-testid="request-previous-note">
          The repository was read again. Below is what you asked before, with any corrections you gave
          at review: confirm it, or edit it.
        </p>
      )}
      <p className="muted">
        Describe the update in plain English.
```

### 6. Fixtures for the browser test

Run exactly (PowerShell, from the repository root):

```powershell
New-Item -ItemType Directory -Force packages/core/fixtures/enhance/refresh-web | Out-Null
Copy-Item packages/core/fixtures/enhance/dashboard-questions/02-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-web/01-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/dashboard-questions/03-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-web/02-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/export-orders/02-ReviewSummary.json packages/core/fixtures/enhance/refresh-web/03-ReviewSummary.json
Copy-Item packages/core/fixtures/enhance/dashboard-questions/03-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-web/04-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/export-orders/02-ReviewSummary.json packages/core/fixtures/enhance/refresh-web/05-ReviewSummary.json
```

They answer, in order:

1. the first draft, which asks two questions;
2. the draft after the answers;
3. the brief at the first review;
4. the draft after the refresh;
5. the brief at the second review.

The analysis summaries are advisory: when the next fixture is not one, the run warns and goes on. This directory is
under `packages/` only as test data, so the "do not touch packages/" rule does not apply to it.

### 7. Browser test: the whole refresh

File `apps/web/e2e/web.e2e.test.ts`.

Find:

```text
  it('update: a GitHub remote that is not origin is suggested and pre-fills the repository field', async () => {
```

Replace with:

```text
  it('refresh: the repository moved on; the owner reads it again and confirms the request and earlier answers (plan 028)', async () => {
    const REQ = 'Kitchen staff need to export the orders list as a CSV file at the end of the day.';
    const { h, page, errors } = await open({ enhance: 'refresh-web' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await page.getByTestId('repo-ref').fill('octo/bare-node');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    await page.getByTestId('start-enhance').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('request-previous-note').count()).toBe(0);
    await page.getByTestId('request-text').fill(REQ);
    await page.getByTestId('submit-request').click();
    // The first questions: the owner picks the answer that is not recommended for one of them.
    await page.getByTestId('questions').waitFor({ timeout: 30_000 });
    await page
      .getByTestId('question-request.dashboardExtras')
      .getByLabel('Only the three actions')
      .check();
    await page.getByTestId('submit-answers').click();
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    await page.getByTestId('brief-headline').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('repo-moved').count()).toBe(0);

    // The owner keeps working on the folder; on the next visit the page says so.
    writeFileSync(path.join(dir, 'later.txt'), 'the owner kept working\n');
    await nodeExec.run('git', ['add', '-A'], { cwd: dir, timeoutMs: 30_000 });
    await nodeExec.run('git', ['commit', '-q', '-m', 'later'], { cwd: dir, timeoutMs: 30_000 });
    await page.reload();
    await page.getByTestId('repo-moved').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('repo-moved').textContent()).toContain('1 new commit');
    await shot(page, 'refresh-1-moved');
    // Approving now would build on code that changed: the run parks and offers Refresh, not a Resume.
    await page.getByTestId('approve').click();
    await expect.poll(() => page.getByTestId('review').count(), UI).toBe(0);
    await page.getByTestId('repo-moved').waitFor({ timeout: 30_000 });
    expect(await state(page).textContent()).toBe('PARKED');
    expect(await page.getByTestId('parked').count()).toBe(0);
    expect(await page.getByTestId('resume').count()).toBe(0);
    await page.getByTestId('refresh-repo').click();

    // The request comes back filled in, to confirm or edit.
    await page.getByTestId('request-previous-note').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('request-text').inputValue()).toBe(REQ);
    expect(await page.getByTestId('repo-moved').count()).toBe(0);
    await shot(page, 'refresh-2-request');
    await page.getByTestId('submit-request').click();

    // The earlier questions come back with the earlier answers selected.
    await page.getByTestId('carried-note').waitFor({ timeout: 30_000 });
    expect(
      await page
        .getByTestId('question-request.dashboardExtras')
        .getByLabel('Only the three actions')
        .isChecked(),
    ).toBe(true);
    expect(await page.getByTestId('accept-defaults').textContent()).toBe('Keep all my answers');
    expect(await page.getByTestId('questions').textContent()).not.toContain('recommended');
    await shot(page, 'refresh-3-answers');
    await page.getByTestId('submit-answers').click();
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    await page.getByTestId('brief-headline').waitFor({ timeout: 30_000 });
    await page.getByTestId('runtab-log').click();
    await expect
      .poll(() => page.getByTestId('run-log').textContent(), UI)
      .toContain('repository read again');
    await expect
      .poll(() => page.getByTestId('run-log').textContent(), UI)
      .toContain('asked again from before the refresh');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('update: a GitHub remote that is not origin is suggested and pre-fills the repository field', async () => {
```

### 8. Build the UI the browser test uses

Run exactly:

```powershell
pnpm --filter @incubator/web build:ui
```

### 9. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write apps/web/src/ui/views/RepoMoved.tsx apps/web/src/ui/views/RunView.tsx apps/web/src/ui/views/Questions.tsx apps/web/src/ui/views/ChangeRequest.tsx apps/web/e2e/web.e2e.test.ts packages/core/fixtures/enhance/refresh-web
```

## Touched files and markers

| File                                                               | Marker                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `apps/web/src/ui/views/RepoMoved.tsx`                              | `data-testid="refresh-repo"`                                                       |
| `apps/web/src/ui/views/RunView.tsx`                                | `<RepoMoved status={repo}`                                                         |
| `apps/web/src/ui/views/Questions.tsx`                              | `data-testid="carried-note"`                                                       |
| `apps/web/src/ui/views/ChangeRequest.tsx`                          | `data-testid="request-previous-note"`                                              |
| `packages/core/fixtures/enhance/refresh-web/05-ReviewSummary.json` | `"schemaName": "ReviewSummary"`                                                    |
| `apps/web/e2e/web.e2e.test.ts`                                     | `the owner reads it again and confirms the request and earlier answers (plan 028)` |

## Acceptance commands

```sh
pnpm exec tsc -p apps/web/src/ui/tsconfig.json --noEmit
pnpm exec eslint --max-warnings=0 apps/web
pnpm exec vitest run apps/web/src/ui
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; pnpm test:e2e
(Get-ChildItem packages/core/fixtures/enhance/refresh-web -Filter *.json).Count
(Select-String apps/web/src/ui/views/RunView.tsx -SimpleMatch "=== 'enhance' && !run.done && !run.busy;").Count
(Select-String apps/web/src/ui/views/RunView.tsx -SimpleMatch "}, [runId, watchRepo, step]);").Count
(Select-String apps/web/src/ui/views/RunView.tsx -SimpleMatch "if (live) setRepo(s);").Count
pnpm check:quick
```

```text
the UI typechecks and eslint on apps/web exits 0
the UI unit tests pass (including the stylesheet token test)
the e2e suite passes, including "refresh: the repository moved on; the owner reads it again and confirms the request and earlier answers (plan 028)"
the fixture count prints 5
the three RunView Select-String counts print 1
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                                            | Why                                                                                  | Mechanical check                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The banner never shows because the status is fetched once, before the move                                      | the page must ask again when the run settles or reloads                              | the e2e reloads after the commit and waits for `repo-moved`; the Select-String count for the effect deps `[runId, watchRepo, step]` prints 1                               |
| The banner stays while the run works, or a late answer brings it back                                           | the status must be cleared while busy, and an answer from an older ask ignored       | the Select-String count for `!run.done && !run.busy;` prints 1; the effect cleanup sets `live = false`; the e2e asserts `repo-moved` is gone at the confirmed-request step |
| The request box opens empty after a refresh                                                                     | `useState` must start from `evidence.previous`                                       | the e2e asserts the textarea's value equals the earlier request                                                                                                            |
| The questions asked again look like new ones, and "Accept all defaults" reads as discarding the owner's answers | `carried` must reach `Questions`                                                     | the e2e waits for `carried-note` and asserts the button reads "Keep all my answers"                                                                                        |
| The earlier answer is not the one selected                                                                      | the form preselects the recommended option, which plan 026 set to the earlier answer | the e2e asserts "Only the three actions" is checked                                                                                                                        |
| The owner's own earlier answer is badged "recommended", as if the model advised it                              | plan 026 marks the earlier answer `recommended`                                      | the e2e asserts the questions card does not contain "recommended" when carried                                                                                             |
| The second brief is never produced, so fixtures 04 and 05 are untested                                          | the test stopped at the review card                                                  | the e2e waits for `brief-headline` after the refresh                                                                                                                       |
| The log does not show the refresh                                                                               | plan 027's `repo.refresh` and carried-questions log text                             | the e2e asserts both log lines                                                                                                                                             |
| A `repo_moved` park offers a Resume that only parks again                                                       | `stuck` must exclude it while the repository has moved                               | the e2e approves while moved, waits for `repo-moved`, and asserts the `parked` and `resume` counts are 0                                                                   |
| A console error from the new fetch                                                                              | `repo-status` runs on every settle                                                   | the e2e asserts no page errors                                                                                                                                             |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1     | The owner asked for a way to refresh a run whose repository moved on, redoing the design and confirming their earlier request and answers; plans 025–027 made it possible, this plan shows it                                                                                                                                                                                                                                                                                                          | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy): FIX-FIRST (no must-fix). Folded: a repo_moved park is now driven in the e2e (no Resume), the carried answer is badged "your answer", the second brief is awaited, a late status answer is ignored (effect cleanup), and the two weak guardrails got source counts. Left for later: the project banner shows no "This run:" line until the request is confirmed, and a commit made with the page open shows only on the next load | CLOSED |
