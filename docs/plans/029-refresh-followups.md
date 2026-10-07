# Plan 029: refresh follow-ups: the banner line, a commit while the page is open, and a cancel mid-refresh

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 8 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an
  eslint-disable comment. Work item 6 extends one existing browser test; it removes nothing.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** Plans 025–028 let an update run notice that its repository moved on and read it again. Their reviews left
three small gaps:

1. **The banner line.** After a refresh, the project banner's "This run:" line goes blank until the owner confirms
   the request. The request now counts only once it is submitted again. While the run waits at that confirm step,
   the banner should show the earlier request (`parked.evidence.previous`); during the re-read itself it stays blank.
2. **A commit while the page is open.** The run page asks whether the repository moved only when the run settles or
   the page loads. An owner who commits in their editor and comes back to the window sees nothing until they reload.
   The page should ask again when the window gets focus.
3. **A cancel during a refresh.** `Engine.refreshRepo` checks that the run is still planning, then awaits
   `repoMoved`, which runs git. A cancel landing during that await still gets a `repo.refresh` and an ANALYZE
   recorded on a run that is done. The check must run again after the await.

## Work items

### 1. Engine: check the run again after reading the repository

File `packages/core/src/engine.ts`.

Find:

```text
    const m = await this.repoMoved(runId);
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working`, { code: 'working' });
```

Replace with:

```text
    const m = await this.repoMoved(runId);
    // why: the run may have been cancelled, or moved past planning, while git was reading (plan 029).
    const now = this.state(runId);
    const atNow = now.state === 'PARKED' ? now.parked?.state : now.state;
    if (now.done || !atNow || !PLANNING_STATES.includes(atNow))
      throw new PolicyError(
        `run ${runId} ${now.cancelled ? 'was cancelled' : 'is past planning'} while the repository was read`,
        { code: 'too_late' },
      );
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working`, { code: 'working' });
```

Find:

```text
      throw new PolicyError(`run ${runId} is past planning: its plan is already being built`, {
        code: 'too_late',
      });
```

Replace with:

```text
      throw new PolicyError(
        `run ${runId} ${s.cancelled ? 'was cancelled' : 'is past planning: its plan is already being built'}`,
        { code: 'too_late' },
      );
```

### 2. Engine test: a cancel during the read

File `packages/core/src/folder-runs.test.ts`.

Find:

```text
    await expect(h.engine.refreshRepo(other)).rejects.toMatchObject({ code: 'not_enhance' });
  });
```

Replace with:

```text
    await expect(h.engine.refreshRepo(other)).rejects.toMatchObject({ code: 'not_enhance' });
  });

  it('records nothing when the run is cancelled while the repository is being read (plan 029)', async () => {
    const { h, ref, dir } = await seeded();
    const runId = start(h, dir, ref);
    const waiting = new ScriptedPrompter({}, { approve: false, reason: 'owner is reading' });
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    const read = h.engine.repoMoved.bind(h.engine);
    // The owner cancels while git is reading the folder.
    vi.spyOn(h.engine, 'repoMoved').mockImplementationOnce(async (id: string) => {
      const m = await read(id);
      h.engine.cancel(id, 'changed my mind');
      return m;
    });
    await expect(h.engine.refreshRepo(runId)).rejects.toMatchObject({ code: 'too_late' });
    const types = h.engine.entries(runId).map((e) => e.type);
    expect(types).toContain('run.cancel');
    expect(types).not.toContain('repo.refresh');
    expect(h.engine.state(runId)).toMatchObject({ done: true, cancelled: true });
  });
```

### 3. Run page: the banner keeps the earlier request until it is confirmed

File `apps/web/src/ui/views/RunView.tsx`.

Find:

```text
  const act = (p: Promise<unknown>) => p.then(refresh).catch((e: Error) => setError(e.message));
```

Replace with:

```text
  const act = (p: Promise<unknown>) => p.then(refresh).catch((e: Error) => setError(e.message));
  // why: after a refresh (plan 025) the request is asked again; until then the banner shows the earlier one.
  const earlier = (run.parked?.evidence as { previous?: unknown } | null | undefined)?.previous;
  const enhanceRequest = run.enhance?.request
    ? run.enhance.request
    : typeof earlier === 'string'
      ? earlier
      : '';
```

Find:

```text
          request={
            run.kind === 'enhance' ? (run.enhance?.request ?? '') : (run.input.narrative ?? '')
          }
```

Replace with:

```text
          request={run.kind === 'enhance' ? enhanceRequest : (run.input.narrative ?? '')}
```

### 4. Run page: ask again when the window gets focus

File `apps/web/src/ui/views/RunView.tsx`.

Find:

```text
  const [repo, setRepo] = useState<RepoStatus | null>(null);
```

Replace with:

```text
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  // why: the owner may commit in their editor while this page is open; ask again when they come back (plan 029).
  const [looked, setLooked] = useState(0);
  useEffect(() => {
    const again = () => setLooked((n) => n + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
```

Find:

```text
  }, [runId, watchRepo, step]);
```

Replace with:

```text
  }, [runId, watchRepo, step, looked]);
```

### 5. Plan 028's acceptance guards: the working command form and the new dependency list

File `docs/plans/028-repo-refresh-web.md`.

Find:

```text
(Select-String apps/web/src/ui/views/RunView.tsx -SimpleMatch "=== 'enhance' && !run.done && !run.busy;").Count
(Select-String apps/web/src/ui/views/RunView.tsx -SimpleMatch "}, [runId, watchRepo, step]);").Count
(Select-String apps/web/src/ui/views/RunView.tsx -SimpleMatch "if (live) setRepo(s);").Count
```

Replace with:

```text
(Select-String -SimpleMatch -Path apps/web/src/ui/views/RunView.tsx "=== 'enhance' && !run.done && !run.busy;").Count
(Select-String -SimpleMatch -Path apps/web/src/ui/views/RunView.tsx "}, [runId, watchRepo, step, looked]);").Count
(Select-String -SimpleMatch -Path apps/web/src/ui/views/RunView.tsx "if (live) setRepo(s);").Count
```

Find:

```text
the Select-String count for the effect deps `[runId, watchRepo, step]` prints 1
```

Replace with:

```text
the Select-String count for the effect deps `[runId, watchRepo, step, looked]` prints 1
```

The first three lines were written in a form PowerShell reads as a pattern and a path the wrong way round (they printed 0); `-SimpleMatch -Path <file>` is the form plans 024, 027 and 030 use.

### 6. Browser test: the banner appears on focus, and the banner line survives the refresh

File `apps/web/e2e/web.e2e.test.ts`.

Find:

```text
    await nodeExec.run('git', ['commit', '-q', '-m', 'later'], { cwd: dir, timeoutMs: 30_000 });
    await page.reload();
    await page.getByTestId('repo-moved').waitFor({ timeout: 30_000 });
```

Replace with:

```text
    await nodeExec.run('git', ['commit', '-q', '-m', 'later'], { cwd: dir, timeoutMs: 30_000 });
    // Coming back to the window is enough (plan 029); a reload shows it too.
    expect(await page.getByTestId('repo-moved').count()).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByTestId('repo-moved').waitFor({ timeout: 30_000 });
    await page.reload();
    await page.getByTestId('repo-moved').waitFor({ timeout: 30_000 });
```

Find:

```text
    expect(await page.getByTestId('request-text').inputValue()).toBe(REQ);
    expect(await page.getByTestId('repo-moved').count()).toBe(0);
```

Replace with:

```text
    expect(await page.getByTestId('request-text').inputValue()).toBe(REQ);
    expect(await page.getByTestId('repo-moved').count()).toBe(0);
    // The project banner keeps the earlier request until it is confirmed (plan 029).
    expect(await page.getByTestId('project-request').textContent()).toContain(REQ);
```

### 7. Server: the route comment names the new trigger

File `apps/web/src/server/server.ts`.

Find:

```text
  // asks GitHub (ls-remote), so the screens ask when the run settles or the page loads, never on a timer.
```

Replace with:

```text
  // asks GitHub (ls-remote), so the screens ask when the run settles, the page loads or the window regains focus,
  // never on a timer.
```

### 8. Build the UI and format the touched files

Run exactly:

```powershell
pnpm --filter @incubator/web build:ui
pnpm exec prettier --write packages/core/src/engine.ts packages/core/src/folder-runs.test.ts apps/web/src/ui/views/RunView.tsx apps/web/src/server/server.ts apps/web/e2e/web.e2e.test.ts docs/plans/028-repo-refresh-web.md
```

## Touched files and markers

| File                                    | Marker                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/core/src/engine.ts`           | `while the repository was read`                                                           |
| `packages/core/src/folder-runs.test.ts` | `records nothing when the run is cancelled while the repository is being read (plan 029)` |
| `apps/web/src/ui/views/RunView.tsx`     | `window.addEventListener('focus', again);`                                                |
| `docs/plans/028-repo-refresh-web.md`    | `}, [runId, watchRepo, step, looked]);`                                                   |
| `apps/web/e2e/web.e2e.test.ts`          | `window.dispatchEvent(new Event('focus'))`                                                |
| `apps/web/src/server/server.ts`         | `the window regains focus`                                                                |

## Acceptance commands

```sh
pnpm exec vitest run --project unit packages/core/src/folder-runs.test.ts
pnpm typecheck
pnpm exec tsc -p apps/web/src/ui/tsconfig.json --noEmit
pnpm exec eslint --max-warnings=0 apps/web packages/core
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; pnpm test:e2e
(Select-String -SimpleMatch -Path apps/web/src/ui/views/RunView.tsx "}, [runId, watchRepo, step, looked]);").Count
(Select-String -SimpleMatch -Path apps/web/src/ui/views/RunView.tsx "window.removeEventListener('focus', again);").Count
pnpm check:quick
```

```text
the folder-runs tests pass, including "records nothing when the run is cancelled while the repository is being read (plan 029)"
pnpm typecheck, the UI typecheck and eslint exit 0
the e2e suite passes, including the plan 028 refresh test with its focus and banner-line checks
both RunView Select-String counts print 1
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                     | Why                                                                                | Mechanical check                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The re-check runs before the await, where it already was | it must read the state after git returns                                           | the cancel test cancels inside the mocked `repoMoved` and asserts `too_late` and no `repo.refresh` entry                          |
| The spy does not intercept the call                      | `refreshRepo` calls `this.repoMoved`; a spy on the instance replaces that property | the cancel test asserts `run.cancel` is in the journal, which only the spy records                                                |
| The focus listener is added but never triggers a new ask | `looked` must be a dependency of the status effect                                 | the e2e dispatches `focus` before any reload and waits for `repo-moved`; the Select-String count for the dependency list prints 1 |
| The focus listener leaks across run pages                | the effect must remove it                                                          | the Select-String count for `removeEventListener('focus', again)` prints 1                                                        |
| The banner still goes blank after the refresh            | `request` must fall back to `evidence.previous`                                    | the e2e asserts `project-request` contains the earlier request at the confirm step                                                |
| Plan 028's guard now fails on the new dependency list    | it searched for the old text                                                       | work item 5 updates it; its count prints 1                                                                                        |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1     | Follow-ups left by the reviews of plans 027 and 028: the blank "This run:" line during the confirm step, a commit made with the page open, and a cancel landing while `refreshRepo` awaits git                                                                                                                                                                                                                                                                                             | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy): FIX-FIRST. Must-fix: the Select-String guards were written as pattern-then-path, so they printed 0 or failed (the same form sat in plan 028); now `-SimpleMatch -Path <file>`, and plan 028's guards and row are rewritten. Also: the banner claim is narrowed to the confirm step (it stays blank during the re-read), the server comment names focus, and the older too_late message says when a run was cancelled | CLOSED |
