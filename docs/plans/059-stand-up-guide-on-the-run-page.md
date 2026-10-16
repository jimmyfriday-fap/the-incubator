# Plan 059: the run page writes the stand-up guide of a finished run, and lets the operator copy or download it

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 5 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plan 058. Before you start, check that `packages/core/src/engine.ts` contains `async standUpGuide(runId: string): Promise<StandUp>` and that `apps/web/src/ui/views/Summary.tsx` contains `<WhatNowPanel w={run.finish.whatNow} />`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. A "Create" item writes a new file with exactly the content shown.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Plan 058 gives the engine a stand-up guide for a finished run (`Engine.standUpGuide`), but nothing in the web app or the desktop app calls it. The operator wants to open a finished run, press a button, read the guide, and download it as a markdown file to give to a coding assistant.

After this plan the web server has `POST /api/runs/:id/stand-up-guide`, which returns `{ fileName, markdown }` (a run that is not finished, or has no project folder, answers 422 through the same error mapping as the other routes). A finished folder run's page shows, under the guide of plan 057, a "Write the stand-up guide" button. After it is pressed the page shows the markdown in a scrollable block with "Download" (a file named like `STAND-UP-<slug>.md`, saved from the browser with no second request) and "Copy". The desktop app serves the same page, so it gets the same buttons.

## Work items

### 1. The route

In `apps/web/src/server/server.ts`:

Find:

```text
  // Reads an update run's repository again (plan 025): the owner then confirms what they asked for.
```

Replace with:

```text
  // Writes the stand-up guide of a finished folder run and returns it (plan 058, plan 059): the run page shows it and
  // lets the owner copy or download it. A run that is not finished answers 422.
  app.post(
    '/api/runs/:id/stand-up-guide',
    withRun((runId) => engine.standUpGuide(runId)),
  );

  // Reads an update run's repository again (plan 025): the owner then confirms what they asked for.
```

### 2. The type

In `apps/web/src/api-types.ts`:

Find:

```text
export interface Question {
```

Replace with:

```text
/** Plan 059: the stand-up guide of a finished run (plan 058): the file name to save it as, and its markdown. */
export interface StandUpGuide {
  fileName: string;
  markdown: string;
}

export interface Question {
```

### 3. The panel

Create `apps/web/src/ui/views/StandUpGuide.tsx` with exactly this content:

```tsx
import { useState } from 'react';
import type { StandUpGuide } from '../../api-types.js';
import { ApiError, post } from '../api.js';

/** Plan 059: writes the stand-up guide of a finished run (plan 058), then shows it with Copy and Download. */
export function StandUpGuidePanel({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState<StandUpGuide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const write = () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    post<StandUpGuide>(`/api/runs/${runId}/stand-up-guide`)
      .then(setGuide)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'The guide could not be written.'),
      )
      .finally(() => setBusy(false));
  };

  const download = () => {
    if (!guide) return;
    const url = URL.createObjectURL(new Blob([guide.markdown], { type: 'text/markdown' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = guide.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = () => {
    if (!guide) return;
    void navigator.clipboard
      .writeText(guide.markdown)
      .then(() => setCopied(true))
      .catch(() => setError('The guide could not be copied: use Download instead.'));
  };

  return (
    <section className="stand-up" data-testid="stand-up">
      <h3>Stand-up guide</h3>
      <p className="muted">
        One document of what was built and the exact steps to stand it up, written so a coding
        assistant can follow it. Give it to the assistant in the project folder.
      </p>
      <div className="actions">
        <button type="button" data-testid="stand-up-write" disabled={busy} onClick={write}>
          {busy ? 'Writing…' : guide ? 'Write it again' : 'Write the stand-up guide'}
        </button>
        {guide && (
          <>
            <button type="button" data-testid="stand-up-download" onClick={download}>
              Download {guide.fileName}
            </button>
            <button type="button" data-testid="stand-up-copy" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="error" data-testid="stand-up-error">
          {error}
        </p>
      )}
      {guide && (
        <pre className="stand-up-text" data-testid="stand-up-text">
          {guide.markdown}
        </pre>
      )}
    </section>
  );
}
```

### 4. The page

In `apps/web/src/ui/views/Summary.tsx`:

Find:

```text
import { WhatNowPanel } from './WhatNow.js';
```

Replace with:

```text
import { StandUpGuidePanel } from './StandUpGuide.js';
import { WhatNowPanel } from './WhatNow.js';
```

Find:

```text
          {run.finish.whatNow && <WhatNowPanel w={run.finish.whatNow} />}
```

Replace with:

```text
          {run.finish.whatNow && <WhatNowPanel w={run.finish.whatNow} />}
          {run.finish.whatNow && <StandUpGuidePanel runId={run.runId} />}
```

In `apps/web/src/ui/styles.css`:

Find:

```text
/* --- badges --- */
```

Replace with:

```text
/* --- stand-up guide (plan 059) --- */

.stand-up {
  border-top: 1px solid var(--line);
  margin-top: var(--s4);
  padding-top: var(--s3);
}

.stand-up-text {
  max-height: 24rem;
  overflow: auto;
  white-space: pre-wrap;
  background: var(--tint);
  border-radius: var(--r-sm);
  padding: var(--s3);
}

/* --- badges --- */
```

### 5. Tests

In `apps/web/src/server/server.test.ts`:

Find:

```text
    expect(h.github.repos.get('octo/stockroom')!.prs).toHaveLength(1);
```

Replace with:

```text
    expect(h.github.repos.get('octo/stockroom')!.prs).toHaveLength(1);
    // The finished run writes its stand-up guide (plan 059), and the project folder stays untouched.
    const guide = await api.post<{ fileName: string; markdown: string }>(
      `/api/runs/${runId}/stand-up-guide`,
    );
    expect(guide.status).toBe(200);
    expect(guide.body.fileName).toBe('STAND-UP-stockroom.md');
    expect(guide.body.markdown).toContain('# Stand-up guide: Stockroom');
    expect(existsSync(path.join(dir, guide.body.fileName))).toBe(false);
```

Find:

```text
    expect((await api.post('/api/runs/20200101-000000-aaaaaa/continue')).status).toBe(404);
```

Replace with:

```text
    expect((await api.post('/api/runs/20200101-000000-aaaaaa/continue')).status).toBe(404);
    // The stand-up guide (plan 059) is for a finished run only.
    const early = await api.post<{ error: string }>(`/api/runs/${runId}/stand-up-guide`);
    expect(early.status).toBe(422);
    expect(early.body.error).toContain('is not finished');
```

### 6. Format the touched files

Run:

```powershell
pnpm exec prettier --write apps/web/src/server/server.ts apps/web/src/server/server.test.ts apps/web/src/api-types.ts apps/web/src/ui/views/StandUpGuide.tsx apps/web/src/ui/views/Summary.tsx apps/web/src/ui/styles.css
```

## Touched files and markers

| File                                     | Marker                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| `apps/web/src/server/server.ts`          | `'/api/runs/:id/stand-up-guide',`                       |
| `apps/web/src/api-types.ts`              | `export interface StandUpGuide {`                       |
| `apps/web/src/ui/views/StandUpGuide.tsx` | `export function StandUpGuidePanel(`                    |
| `apps/web/src/ui/views/Summary.tsx`      | `<StandUpGuidePanel runId={run.runId} />`               |
| `apps/web/src/ui/styles.css`             | `/* --- stand-up guide (plan 059) --- */`               |
| `apps/web/src/server/server.test.ts`     | `The finished run writes its stand-up guide (plan 059)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit apps/web/src/server/server.test.ts apps/web/src/ui/styles.test.ts
(Select-String -SimpleMatch -Path apps/web/src/server/server.ts "stand-up-guide").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 apps/web
pnpm check:quick
```

```text
server.test.ts and styles.test.ts pass, including the new plan 059 assertions
the Select-String count prints 1
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0 (its typecheck-ui step compiles the new panel)
```

## Drift and hallucination guardrails

| Trap                                                      | Why                                                           | Mechanical check                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The route exists but nothing in the page calls it         | a route nobody calls type-checks                              | the marker `<StandUpGuidePanel runId={run.runId} />` is in `Summary.tsx`, and `typecheck-ui` compiles the panel                                           |
| The page offers the button for a run that is not finished | the engine refuses it and the button would only show an error | the button is only rendered inside `run.finish.whatNow &&`, which the engine sets only for a done run; the server test expects 422 before the run is done |
| The guide is written into the project folder              | an untracked file there makes Continue coding refuse          | the server test asserts the file is absent from the folder after the guide is written                                                                     |
| A stylesheet token is used that is not defined            | the page would render with no value                           | `styles.test.ts` fails on any `var(--x)` with no definition; the new rules use `--line`, `--s3`, `--s4`, `--tint`, `--r-sm`                               |
| Download and Copy are not exercised by any test           | the web app has no browser test harness                       | the operator presses both in the rebuilt app (step 2 of the task); the server route they depend on is tested                                              |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                               | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Operator request after a real run (COI Tracker): a way in the Incubator to generate the stand-up guide for a finished run, and to download or export it                                                                                                                                                                                                                               | CLOSED |
| 2     | In-session adversarial review (Cursor unavailable): trial apply passed typecheck, UI typecheck, eslint and 34 server and style tests; a mutant that answers a constant instead of the engine's guide is killed by the new server assertions. The Download and Copy buttons have no browser test (the web app has no harness for one), so the operator presses both in the rebuilt app | CLOSED |
| 3     | Code review of the Copilot run (Haiku 4.5): the new panel and every tracked-file change are identical to the trial apply; the constant-route mutant killed in round 2 is the same code; `pnpm check:quick` follows                                                                                                                                                                    | CLOSED |
