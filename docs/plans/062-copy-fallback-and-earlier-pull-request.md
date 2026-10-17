# Plan 062: Copy works where the clipboard API is refused, and a finished run names the pull request it already opened

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 4 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plans 057 to 059. Before you start, check that `apps/web/src/ui/views/StandUpGuide.tsx` contains `export function StandUpGuidePanel(` and that `packages/core/src/engine.ts` contains `private whatNowFor(`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Two defects showed on the real COI Tracker run page, opened in the built app.

First, the stand-up guide's Copy button answered "The guide could not be copied: use Download instead." The panel calls `navigator.clipboard.writeText`, which a locked-down webview or an insecure context refuses. The usual fallback needs no permission: put the text in a hidden text box, select it and ask the document to copy.

Second, the run page said "The agent changed nothing, so nothing was committed." and "Not pushed to GitHub yet." although pull request 1 had been opened for this branch a stage earlier. After "Continue coding", the finished-run detail only looks at the current stage for the pull request (the earlier push is filtered out on purpose, so the page does not claim an old push for new work), and the WHAT-NOW guide copied that. A stage that changed nothing opens no pull request of its own, so the guide said the work was not pushed when it was.

After this plan, Copy tries the clipboard API and then the selection fallback, and only shows the error when both are refused. And the guide's "Where it stands" and "What to do next" use the latest pull request of the run, from any stage, when the current stage has none.

## Work items

### 1. Copy with a fallback

In `apps/web/src/ui/views/StandUpGuide.tsx`:

Find:

```text
/** Plan 059: writes the stand-up guide of a finished run (plan 058), then shows it with Copy and Download. */
```

Replace with:

```text
/**
 * Plan 062: copies text without the async clipboard API, which a locked-down webview or an insecure page refuses:
 * select a hidden text box and ask the document to copy. False when that is refused too.
 */
function copyWithSelection(text: string): boolean {
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'absolute';
  box.style.left = '-9999px';
  document.body.appendChild(box);
  box.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(box);
  return ok;
}

/** Plan 059: writes the stand-up guide of a finished run (plan 058), then shows it with Copy and Download. */
```

Find:

```text
    void navigator.clipboard
      .writeText(guide.markdown)
      .then(() => setCopied(true))
      .catch(() => setError('The guide could not be copied: use Download instead.'));
```

Replace with:

```text
    const text = guide.markdown;
    const viaApi =
      'clipboard' in navigator
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error('no clipboard api'));
    void viaApi
      .catch(() => {
        if (!copyWithSelection(text)) throw new Error('copy refused');
      })
      .then(() => {
        setError(null);
        setCopied(true);
      })
      .catch(() => setError('The guide could not be copied: use Download instead.'));
```

### 2. The latest pull request of the run

In `packages/core/src/engine.ts`:

Find:

```text
      pr: d.pr ?? null,
    });
  }
```

Replace with:

```text
      pr: d.pr ?? this.latestPr(runId),
    });
  }

  /**
   * Plan 062: the pull request of the latest push, from any stage. A continued stage that changed nothing opens none of
   * its own, and the guide must not say the work is unpushed when an earlier stage pushed it.
   */
  private latestPr(runId: string): { number: number; url: string } | null {
    const e = this.entries(runId).findLast((x) => x.type === 'finish.summary');
    return (e?.['pr'] as { number: number; url: string } | undefined) ?? null;
  }
```

### 3. The test

In `packages/core/src/folder-runs.test.ts`:

Find:

```text
  it('commits WHAT-NOW.md with the work and shows the same guide once the run is done (plan 057)', async () => {
```

Replace with:

```text
  it('names the earlier pull request in the guide after a continued stage that changed nothing (plan 062)', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    await setOwner(dir);
    h.engine.submitCommit(runId, { action: 'commit' });
    await h.engine.resume(runId, new DefaultsPrompter());
    h.engine.submitPush(runId, 'push');
    expect((await h.engine.resume(runId, new DefaultsPrompter())).done).toBe(true);
    vi.stubEnv('FAKE_AGENT_MODE', 'idle');
    await h.engine.continueCoding(runId);
    expect((await h.engine.resume(runId, new DefaultsPrompter())).done).toBe(true);
    const w = (await h.engine.finishDetail(runId))!.whatNow!;
    expect(w.status.some((l) => l.startsWith('Pull request #1: '))).toBe(true);
    expect(w.status).not.toContain('Not pushed to GitHub yet.');
  });

  it('commits WHAT-NOW.md with the work and shows the same guide once the run is done (plan 057)', async () => {
```

### 4. Format the touched files

Run:

```powershell
pnpm exec prettier --write apps/web/src/ui/views/StandUpGuide.tsx packages/core/src/engine.ts packages/core/src/folder-runs.test.ts
```

## Touched files and markers

| File                                     | Marker                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/web/src/ui/views/StandUpGuide.tsx` | `function copyWithSelection(text: string)`                                                            |
| `packages/core/src/engine.ts`            | `private latestPr(runId: string)`                                                                     |
| `packages/core/src/folder-runs.test.ts`  | `names the earlier pull request in the guide after a continued stage that changed nothing (plan 062)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/folder-runs.test.ts -t "plan 062"
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "latestPr(").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core apps/web
pnpm check:quick
```

```text
the new plan 062 test passes
the Select-String count prints 2
pnpm typecheck and eslint exit 0 (its typecheck-ui step compiles the panel)
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                               | Why                                                           | Mechanical check                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The fallback is written but the clipboard API result still decides | a rejected promise would skip straight to the error           | the final `.catch` is reached only after the fallback throws; `pnpm typecheck` and `typecheck-ui` compile the chain                                                                                                           |
| The guide claims an old push for new work                          | the finished-run detail filters earlier pushes out on purpose | only `whatNowFor` (the guide) uses `latestPr`; `finishDetail.pr` and the run page's own push line are unchanged, and `server.test.ts` and the commit and push tests in `folder-runs.test.ts` still pass in `pnpm check:quick` |
| The test passes without a continued stage                          | a first-stage run also names its pull request                 | the test continues with an idle agent, asserts the run is done again, and asserts the pull request line                                                                                                                       |
| The Copy fallback has no automated test                            | the web app has no browser harness                            | the operator presses Copy in the rebuilt app; the review also presses it in the built page and reports what the button says                                                                                                   |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Seen on the COI Tracker run page: Copy refused in a webview, and the guide said "Not pushed to GitHub yet" after a continued stage that changed nothing                                                                                                                                                                                                                                                                                         | CLOSED |
| 2     | In-session adversarial review (Cursor unavailable), after the cheap guards (abs-path, plan-lint, drift, format) and the trial apply: eslint flagged a useless initial assignment in the copy helper, fixed in the plan; typecheck, UI typecheck and the new engine test pass; two mutants (the latest-pull-request fallback and the entries lookup) are killed. The Copy fallback itself has no automated test and is checked in the built page | CLOSED |
| 3     | Code review of the Copilot run (Haiku 4.5): the diff is identical to the trial apply (64 changed lines); the two mutants killed in round 2 are the same code; `pnpm check:quick` alone follows                                                                                                                                                                                                                                                  | CLOSED |
