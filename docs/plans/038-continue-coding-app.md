# Plan 038: the app shows coding parts and offers "Continue coding"

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 12 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plans 036 (coding in parts) and 037 (continue coding, engine). Before you start, check that `grep -c "plan 037" packages/core/src/engine.ts` prints a number above 0; stop if it does not.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Plan 036 lets the coding agent work in parts, with a checkpoint commit after each part stopped at a run limit. Plan 037 lets the engine continue a finished folder run whose agent did not finish the plan. The app shows neither yet:

- The Coding card says "Nothing is committed", which is false once a part is checkpointed.
- The commit request lists only the last part's files, with no word about the checkpoint commits already on the branch.
- The run log shows `code.part` and `code.continue` as raw type names.
- A finished run whose agent stopped at a limit offers nothing to continue it.

This plan adds:

- `checkpoints` (part and commit of each checkpoint since coding last started) to the finish detail. It comes from the engine's `codeParts`, which is inside the engine class, so `finishDetail` can call it.
- `canContinue` on the run detail. It is true for a finished, not cancelled folder run whose last coding stage did not end `ready` and whose changes were not left uncommitted (the engine refuses a folder that is not clean; the command line still offers `--continue` once the owner has committed by hand).
- `POST /api/runs/:id/continue`, through the driver (a busy check, then `engine.continueCoding`, then advance in the background), following `refresh`.
- A "Continue coding" box on the finished run's summary, wording on the Coding card and the commit request for parts, and log lines for both new entries.

## Work items

### 1. Core: the finish detail lists the checkpoints

In `packages/core/src/finish.ts`:

Find:

```text
  pr: { number: number; url: string } | null;
  /** Live counters while the agent works. */
```

Replace with:

```text
  pr: { number: number; url: string } | null;
  /** The parts committed as checkpoints since coding last started (plan 036). */
  checkpoints: { part: number; sha: string }[];
  /** Live counters while the agent works. */
```

In `packages/core/src/engine.ts`:

Find:

```text
      pr: pr ?? null,
      progress:
```

Replace with:

```text
      pr: pr ?? null,
      checkpoints: this.codeParts(runId).map(({ part, sha }) => ({ part, sha })),
      progress:
```

### 2. Web: the API types

In `apps/web/src/api-types.ts`:

Find:

```text
  pr: { number: number; url: string } | null;
  progress: {
```

Replace with:

```text
  pr: { number: number; url: string } | null;
  /** The parts committed as checkpoints since coding last started (plan 036). */
  checkpoints: { part: number; sha: string }[];
  progress: {
```

Find:

```text
  state: string;
  done: boolean;
  busy: boolean;
  error: string | null;
```

Replace with:

```text
  state: string;
  done: boolean;
  /** A finished folder run whose agent did not finish the plan can continue coding (plan 037). */
  canContinue: boolean;
  busy: boolean;
  error: string | null;
```

### 3. Web: the run detail says whether coding can continue

In `apps/web/src/server/server.ts`:

Find:

```text
      const s = engine.state(runId);
      const st = driver.status(runId);
      return {
        runId,
        kind: s.input.kind,
        state: s.state,
        done: s.done,
```

Replace with:

```text
      const s = engine.state(runId);
      const st = driver.status(runId);
      const finish = await engine.finishDetail(runId);
      return {
        runId,
        kind: s.input.kind,
        state: s.state,
        done: s.done,
        canContinue:
          s.done &&
          !s.cancelled &&
          Boolean(s.input.dir) &&
          finish?.agent != null &&
          finish.agent.verdict !== 'ready' &&
          !finish.commit?.left,
```

Find:

```text
        finish: await engine.finishDetail(runId),
```

Replace with:

```text
        finish,
```

### 4. Web: the driver continues coding

In `apps/web/src/server/driver.ts`:

Find:

```text
  /** REVIEW → APPROVED (optionally with an edited spec), then continues in the background. */
```

Replace with:

```text
  /** Continue coding a finished folder run (plan 037): back to CODE on the same branch, in the background. */
  async continueCoding(runId: string): Promise<void> {
    if (this.#busy.has(runId)) throw new ConflictError(`run ${runId} is already working`);
    try {
      await this.engine.continueCoding(runId);
    } catch (err) {
      if (err instanceof PolicyError && err.code === 'working')
        throw new ConflictError(err.message);
      throw err;
    }
    this.spawn(runId, () => this.engine.advance(runId, new WebPrompter()));
  }

  /** REVIEW → APPROVED (optionally with an edited spec), then continues in the background. */
```

### 5. Web: the route

In `apps/web/src/server/server.ts`:

Find:

```text
  // Reads an update run's repository again (plan 025): the owner then confirms what they asked for.
```

Replace with:

```text
  // Continues coding a finished folder run whose agent did not finish the plan (plan 037).
  app.post(
    '/api/runs/:id/continue',
    withRun(async (runId) => {
      await driver.continueCoding(runId);
      return { accepted: true };
    }),
  );

  // Reads an update run's repository again (plan 025): the owner then confirms what they asked for.
```

### 6. Web: the Coding card says what is committed

In `apps/web/src/ui/views/Coding.tsx`:

Find:

```text
        . Nothing is committed: when it stops you will see what it changed and decide.
```

Replace with:

```text
        .{' '}
        {run.finish?.checkpoints.length
          ? `Parts 1 to ${run.finish.checkpoints.length} stopped at a run limit and are committed on the branch as checkpoints, not pushed; part ${run.finish.checkpoints.length + 1} is under way.`
          : 'Nothing is committed: when it stops you will see what it changed and decide.'}
```

### 7. Web: the commit request names the checkpoint commits

In `apps/web/src/ui/views/FinishChanges.tsx`:

Find:

```text
          {v.text}
          {finish.agent?.tripped ? ` (${finish.agent.tripped})` : ''}
        </p>
      )}
```

Replace with:

```text
          {v.text}
          {finish.agent?.tripped ? ` (${finish.agent.tripped})` : ''}
        </p>
      )}
      {finish.checkpoints.length > 0 && (
        <p className="muted" data-testid="agent-parts">
          The agent worked in {finish.checkpoints.length + 1} parts. Parts 1 to{' '}
          {finish.checkpoints.length} are already committed on <code>{finish.branch}</code> as
          checkpoints ({finish.checkpoints.map((c) => c.sha.slice(0, 7)).join(', ')}); below is what
          the last part changed.
        </p>
      )}
```

### 8. Web: the finished run offers to continue

In `apps/web/src/ui/views/Summary.tsx`:

Find:

```text
export function Summary({ run }: { run: RunDetail }) {
```

Replace with:

```text
export function Summary({ run, onContinue }: { run: RunDetail; onContinue?: () => void }) {
```

Find:

```text
              <a
                data-testid="finish-pr-link"
                href={run.finish.pr.url}
                target="_blank"
                rel="noreferrer"
              >
                #{run.finish.pr.number}
              </a>
            </p>
          )}
```

Replace with:

```text
              <a
                data-testid="finish-pr-link"
                href={run.finish.pr.url}
                target="_blank"
                rel="noreferrer"
              >
                #{run.finish.pr.number}
              </a>
            </p>
          )}
          {run.canContinue && (
            <div data-testid="continue-box">
              <p className="warn">
                The agent stopped before finishing the plan
                {run.finish.agent?.tripped ? ` (${run.finish.agent.tripped})` : ''}. Continue coding
                on <code>{run.finish.branch}</code>: it picks up where it stopped, and you review the
                commit and the push again.
              </p>
              <button type="button" data-testid="continue-coding" onClick={onContinue}>
                Continue coding
              </button>
            </div>
          )}
```

In `apps/web/src/ui/views/RunView.tsx`:

Find:

```text
        {run.done && !run.cancelled && <Summary run={run} />}
```

Replace with:

```text
        {run.done && !run.cancelled && (
          <Summary run={run} onContinue={() => void act(post(`/api/runs/${runId}/continue`))} />
        )}
```

### 9. Web: the run log names the new entries

In `apps/web/src/ui/views/RunLog.tsx`:

Find:

```text
    case 'repo.refresh': {
```

Replace with:

```text
    case 'code.part':
      return `part ${String(e['part'])} stopped at a run limit${typeof e['tripped'] === 'string' ? ` (${e['tripped']})` : ''}: committed as checkpoint ${String(e['sha']).slice(0, 7)}`;
    case 'code.continue':
      return `continue coding from ${String(e['from']).slice(0, 7)} on ${String(e['branch'])}`;
    case 'repo.refresh': {
```

### 10. Test: the server refuses to continue an unfinished run

In `apps/web/src/server/server.test.ts`:

Find:

```text
  it("says when an update run's repository moved on, and a refresh reads it again and asks to confirm the request (plan 027)", async () => {
```

Replace with:

```text
  it('offers continue coding only for a finished run, and refuses it before (plan 038)', async () => {
    const { api, h } = await boot({ enhance: 'refresh' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
      })
    ).body;
    const d = await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    expect(d.canContinue).toBe(false);
    const r = await api.post<{ error: string }>(`/api/runs/${runId}/continue`);
    expect(r.status).toBe(422);
    expect(r.body.error).toContain('is not finished');
    expect((await api.post('/api/runs/20200101-000000-aaaaaa/continue')).status).toBe(404);
  });

  it("says when an update run's repository moved on, and a refresh reads it again and asks to confirm the request (plan 027)", async () => {
```

### 11. Test: end to end in the browser

In `apps/web/e2e/web.e2e.test.ts`:

Find:

```text
  it('stop and cancel: stop the coding agent, resume to the commit request, then cancel the run', async () => {
```

Replace with:

```text
  it('continue coding: an agent stopped at its limit works in parts, then continues after the push into the same pull request (plans 036-038)', async () => {
    process.env['FAKE_AGENT_MODE'] = 'parts';
    process.env['FAKE_AGENT_PARTS'] = '99';
    try {
      const { h, page, errors } = await open({ enhance: 'export-orders' });
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
      await page.getByTestId('approve').click();

      // Five parts, each stopped at a limit: four checkpoint commits, the fifth part's work waits for the owner.
      await page.getByTestId('commit-request').waitFor({ timeout: 180_000 });
      expect(await page.getByTestId('agent-verdict').textContent()).toContain(
        'stopped at a run limit',
      );
      expect(await page.getByTestId('agent-parts').textContent()).toContain(
        'The agent worked in 5 parts.',
      );
      expect(await page.getByTestId('changed-files').textContent()).toContain('src/part-5.txt');
      await page.getByTestId('commit').click();
      await page.getByTestId('push-request').waitFor({ timeout: 60_000 });
      await page.getByTestId('push').click();
      await page.getByTestId('continue-coding').waitFor({ timeout: 60_000 });
      const pr = await page.getByTestId('finish-pr-link').textContent();
      await shot(page, 'continue-1-offered');

      // Continue: part 6 stops at the limit again and is committed; part 7 finishes the plan.
      process.env['FAKE_AGENT_PARTS'] = '7';
      await page.getByTestId('continue-coding').click();
      await page.getByTestId('commit-request').waitFor({ timeout: 180_000 });
      expect(await page.getByTestId('agent-verdict').textContent()).toContain(
        'The agent finished and reports the work ready for test.',
      );
      expect(await page.getByTestId('agent-parts').textContent()).toContain(
        'The agent worked in 2 parts.',
      );
      await page.getByTestId('commit').click();
      await page.getByTestId('push-request').waitFor({ timeout: 60_000 });
      await page.getByTestId('push').click();
      await page.getByTestId('finish-pr-link').waitFor({ timeout: 60_000 });
      // The same pull request, and nothing left to continue.
      expect(await page.getByTestId('finish-pr-link').textContent()).toBe(pr);
      expect(await page.getByTestId('continue-coding').count()).toBe(0);
      await shot(page, 'continue-2-done');
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      process.env['FAKE_AGENT_MODE'] = 'edit';
      delete process.env['FAKE_AGENT_PARTS'];
    }
  }, 300_000);

  it('stop and cancel: stop the coding agent, resume to the commit request, then cancel the run', async () => {
```

### 12. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/finish.ts packages/core/src/engine.ts apps/web/src/api-types.ts apps/web/src/server/server.ts apps/web/src/server/driver.ts apps/web/src/ui/views/Coding.tsx apps/web/src/ui/views/FinishChanges.tsx apps/web/src/ui/views/Summary.tsx apps/web/src/ui/views/RunView.tsx apps/web/src/ui/views/RunLog.tsx apps/web/src/server/server.test.ts apps/web/e2e/web.e2e.test.ts
```

## Touched files and markers

| File                                      | Marker                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/core/src/finish.ts`             | `checkpoints: { part: number; sha: string }[];`                                    |
| `packages/core/src/engine.ts`             | `checkpoints: this.codeParts(runId).map(({ part, sha }) => ({ part, sha })),`      |
| `apps/web/src/api-types.ts`               | `canContinue: boolean;`                                                            |
| `apps/web/src/server/server.ts`           | `'/api/runs/:id/continue',`                                                        |
| `apps/web/src/server/driver.ts`           | `async continueCoding(runId: string): Promise<void> {`                             |
| `apps/web/src/ui/views/Coding.tsx`        | `are committed on the branch as checkpoints, not pushed`                           |
| `apps/web/src/ui/views/FinishChanges.tsx` | `data-testid="agent-parts"`                                                        |
| `apps/web/src/ui/views/Summary.tsx`       | `data-testid="continue-coding"`                                                    |
| `apps/web/src/ui/views/RunView.tsx`       | `onContinue={() => void act(post(`                                                 |
| `apps/web/src/ui/views/RunLog.tsx`        | `case 'code.continue':`                                                            |
| `apps/web/src/server/server.test.ts`      | `offers continue coding only for a finished run, and refuses it before (plan 038)` |
| `apps/web/e2e/web.e2e.test.ts`            | `continue coding: an agent stopped at its limit works in parts`                    |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit apps/web/src/server/server.test.ts -t "plan 038"
pnpm typecheck
pnpm exec tsc -p apps/web/src/ui/tsconfig.json
pnpm exec eslint --max-warnings=0 apps/web packages/core
pnpm --filter @incubator/web build:ui
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; pnpm exec vitest run --project e2e apps/web/e2e/web.e2e.test.ts -t "continue coding"
pnpm check:quick
```

```text
the server test "offers continue coding only for a finished run, and refuses it before (plan 038)" passes
pnpm typecheck, the UI typecheck and eslint exit 0
the e2e test "continue coding: an agent stopped at its limit works in parts…" passes in Chrome
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                              | Why                                                    | Mechanical check                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| The button shows on a run that cannot continue                    | `canContinue` must follow the engine's own rules       | the server test expects `canContinue: false` at review; the e2e expects the button gone after the plan finishes |
| The click handler returns a promise                               | `@typescript-eslint/no-misused-promises` fails lint    | `void act(...)`; the acceptance eslint run fails otherwise                                                      |
| The e2e stops at the project's 120 s timeout before its own waits | five parts plus a continue take about a minute         | the test passes `300_000` as its timeout                                                                        |
| The continue route answers 200 but the run never moves            | the driver must spawn `advance` after `continueCoding` | the e2e waits for a new commit request after clicking Continue coding                                           |
| The commit request hides the checkpoints                          | the owner reviews only the last part's files           | the e2e asserts "The agent worked in 5 parts." and then "2 parts."                                              |
| A second pull request is opened                                   | the push after continuing must update the same one     | the e2e compares the pull request link before and after                                                         |
| The finish detail is computed twice and disagrees                 | `canContinue` and `finish` must come from one read     | item 3 reads it once into `finish` and uses it for both                                                         |
| The e2e leaks its fake agent mode into later tests                | they rely on `FAKE_AGENT_MODE=edit`                    | the test resets it and deletes `FAKE_AGENT_PARTS` in `finally`                                                  |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Plan 036's review: the owner's view misreports a multi-part run (Coding card, commit request, RunLog); the owner asked for a way to continue a run stopped at a limit                                                                                                                                                                                                                                                                                                                                                                                                                                     | CLOSED |
| 2     | Adversarial review (Opus 5.5, 037 then 038 applied literally, e2e in Chrome, 8 mutations): FIX-FIRST. Must-fix: lint (`no-misused-promises` on the button handler), the server test posted `repo` instead of `dir`, and the button showed for a run whose changes were left uncommitted. Also: a 300 s timeout for the e2e, the UI typecheck in the acceptance. Left: canContinue and the route's advance are caught by the e2e only; a double click can record two continues (the second gets an error); the Coding card can show the previous stage's checkpoints between a continue and its first part | CLOSED |
