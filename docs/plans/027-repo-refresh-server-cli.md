# Plan 027: refresh an update run from the web server and the command line

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 13 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not touch `apps/web/src/ui/` (plan 028 does the screens), except `apps/web/src/ui/views/RunLog.tsx` in work
  item 5. Do not commit, push, or run `pnpm contracts:pin`.
  Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** Plans 025 and 026 gave the engine three things for an update run whose repository moved on:

- `repoMoved`, which tells whether it moved;
- `refreshRepo`, which reads the repository again and asks the owner to confirm their request and earlier answers;
- a `repo_moved` park before the plan is built.

Nothing outside the engine can reach these yet, so a `repo_moved` park is a dead end. This plan adds:

1. Web server:
   - `GET /api/runs/:id/repo-status`;
   - `POST /api/runs/:id/refresh`, through `RunDriver.refresh`;
   - `carriedQuestions` on the run detail, so plan 028's screens can explain the questions asked again.
2. Command line:
   - `incubator resume <id> --refresh`;
   - after a refresh, the request step prints what the owner asked before;
   - a `repo_moved` park says how to refresh;
   - round 0 is labelled as the earlier answers.
3. Run log: a line for `repo.refresh`, and a note on a question round that was carried over.
4. Engine: an earlier answer confirmed with `--yes` keeps the source it had before the refresh. The owner's own
   choice stays `"user"`, and a default the owner never chose stays `"default"`.

## Work items

### 1. API types

File `apps/web/src/api-types.ts`.

Find:

```text
  questions: Question[] | null;
  round: number;
  rev: number;
```

Replace with:

```text
  questions: Question[] | null;
  /** The questions are earlier answers, asked again to confirm after a refresh (plan 026). */
  carriedQuestions: boolean;
  round: number;
  rev: number;
```

Find:

```text
export interface ModelUse {
```

Replace with:

```text
/** Whether an update run's repository moved on since the run read it (GET /api/runs/:id/repo-status). */
export interface RepoStatus {
  moved: boolean;
  /** The commit the run read. */
  recorded: string | null;
  /** The commit there now. */
  current: string | null;
  branch: string | null;
  /** New commits; null when they cannot be counted (a GitHub repository). */
  commits: number | null;
}

export interface ModelUse {
```

### 2. Driver: refresh

File `apps/web/src/server/driver.ts`.

Find:

```text
  /** REVIEW → APPROVED (optionally with an edited spec), then continues in the background. */
```

Replace with:

```text
  /** Reads an update run's repository again (plan 025); the run then asks the owner to confirm their request. */
  async refresh(runId: string): Promise<void> {
    if (this.#busy.has(runId)) throw new ConflictError(`run ${runId} is already working`);
    try {
      await this.engine.refreshRepo(runId);
    } catch (err) {
      // why: work started while the repository was being read; that is a conflict, not a bad request.
      if (err instanceof PolicyError && err.code === 'working') throw new ConflictError(err.message);
      throw err;
    }
    this.spawn(runId, () => this.engine.advance(runId, new WebPrompter()));
  }

  /** REVIEW → APPROVED (optionally with an edited spec), then continues in the background. */
```

### 3. Server: routes and the run detail

File `apps/web/src/server/server.ts`.

Find:

```text
  ProjectDetail,
  RunDetail,
  RunListItem,
```

Replace with:

```text
  ProjectDetail,
  RepoStatus,
  RunDetail,
  RunListItem,
```

Find:

```text
          s.state === 'PARKED' && s.parked?.state === 'CLARIFY' ? s.pendingQuestions : null,
        round: s.round,
```

Replace with:

```text
          s.state === 'PARKED' && s.parked?.state === 'CLARIFY' ? s.pendingQuestions : null,
        carriedQuestions: s.carriedQuestions,
        round: s.round,
```

Find:

```text
      driver.requestChanges(runId, req.body.text);
      return { accepted: true };
    }),
  );
```

Replace with:

```text
      driver.requestChanges(runId, req.body.text);
      return { accepted: true };
    }),
  );

  // Whether an update run's repository moved on since the run read it (plan 027). On a GitHub repository each call
  // asks GitHub (ls-remote), so the screens ask when the run settles or the page loads, never on a timer.
  app.get(
    '/api/runs/:id/repo-status',
    withRun((runId): Promise<RepoStatus> => engine.repoMoved(runId)),
  );

  // Reads an update run's repository again (plan 025): the owner then confirms what they asked for.
  app.post(
    '/api/runs/:id/refresh',
    withRun(async (runId) => {
      await driver.refresh(runId);
      return { accepted: true };
    }),
  );
```

### 4. Server test

File `apps/web/src/server/server.test.ts`.

Find:

```text
  ReviewSummaryResponse,
  RunDetail,
```

Replace with:

```text
  RepoStatus,
  ReviewSummaryResponse,
  RunDetail,
```

Find:

```text
  it('serves a plain-English review summary at REVIEW, and says what the scan found', async () => {
```

Replace with:

```text
  it('says when an update run’s repository moved on, and a refresh reads it again and asks to confirm the request (plan 027)', async () => {
    const { api, h } = await boot({ enhance: 'refresh' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
      })
    ).body;
    await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    const before = (await api.get<RepoStatus>(`/api/runs/${runId}/repo-status`)).body;
    expect(before).toMatchObject({ moved: false });
    const git = (args: string[]) => nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 });
    writeFileSync(path.join(dir, 'later.txt'), 'later\n');
    await git(['add', '-A']);
    await git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'later']);
    const moved = (await api.get<RepoStatus>(`/api/runs/${runId}/repo-status`)).body;
    expect(moved).toMatchObject({ moved: true, recorded: before.recorded, commits: 1 });
    expect((await api.post(`/api/runs/${runId}/refresh`)).status).toBe(200);
    const asked = await until(api, runId, (x) => !x.busy && x.parked?.reason === 'needs_request');
    expect(asked.parked?.evidence).toEqual({ previous: REQUEST });
    expect(asked.enhance?.request).toBe('');
    expect(asked.carriedQuestions).toBe(false);
    const after = (await api.get<RepoStatus>(`/api/runs/${runId}/repo-status`)).body;
    expect(after).toMatchObject({ moved: false, recorded: moved.current });
    expect((await api.get('/api/runs/20200101-000000-aaaaaa/repo-status')).status).toBe(404);
  });

  it('marks the earlier questions asked again after a refresh as carried (plan 027)', async () => {
    const { api, h } = await boot({ enhance: 'refresh-questions' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const { runId } = (
      await api.post<{ runId: string }>('/api/runs', {
        kind: 'enhance',
        repo: dir,
        repoRef: 'octo/bare-node',
        request: REQUEST,
      })
    ).body;
    const first = await until(api, runId, (x) => !x.busy && x.parked?.state === 'CLARIFY');
    expect(first.carriedQuestions).toBe(false);
    const answers = first.questions!.map((q) => ({
      key: q.key,
      value: q.options.find((o) => o.recommended)!.value,
    }));
    expect((await api.post(`/api/runs/${runId}/answers`, { answers })).status).toBe(200);
    await until(api, runId, (x) => !x.busy && x.parked?.state === 'REVIEW');
    const git = (args: string[]) => nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 });
    writeFileSync(path.join(dir, 'later.txt'), 'later\n');
    await git(['add', '-A']);
    await git([
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-q',
      '-m',
      'later',
    ]);
    expect((await api.post(`/api/runs/${runId}/refresh`)).status).toBe(200);
    await until(api, runId, (x) => !x.busy && x.parked?.reason === 'needs_request');
    expect((await api.post(`/api/runs/${runId}/request`, { narrative: REQUEST })).status).toBe(200);
    const again = await until(api, runId, (x) => !x.busy && x.parked?.state === 'CLARIFY');
    expect(again).toMatchObject({ round: 0, carriedQuestions: true });
    expect(again.questions?.map((q) => q.key)).toEqual(answers.map((a) => a.key));
  });

  it('serves a plain-English review summary at REVIEW, and says what the scan found', async () => {
```

### 5. Run log: the refresh and the questions asked again

File `apps/web/src/ui/views/RunLog.tsx`. This is the one UI file this plan touches (the exception named in the
preamble); plan 028's browser test asserts these log lines.

Find:

```text
    case 'questions':
      return `${(e['questions'] as unknown[]).length} question(s)`;
```

Replace with:

```text
    case 'repo.refresh': {
      const to = typeof e['to'] === 'string' ? ` at ${e['to'].slice(0, 7)}` : '';
      const n = typeof e['commits'] === 'number' ? e['commits'] : 0;
      return `repository read again${to}${n > 0 ? ` (${n} new commit${n === 1 ? '' : 's'})` : ''}`;
    }
    case 'questions':
      return `${(e['questions'] as unknown[]).length} question(s)${e['carried'] === true ? ', asked again from before the refresh' : ''}`;
```

### 6. Engine: an earlier answer confirmed with --yes keeps its earlier source

File `packages/core/src/engine.ts`.

Find:

```text
    this.record(runId, 'answers', { round: s.round, answers });
```

Replace with:

```text
    // why: an earlier answer confirmed after a refresh (plan 026) keeps the source it had then, even when --yes took
    // it now: the owner's choice stays the owner's, and a default the owner never chose stays a default.
    const earlier = s.carriedQuestions ? this.answersBeforeRefresh(runId) : null;
    const recorded = earlier
      ? answers.map((a) => {
          const was = earlier.get(a.key);
          return a.source === 'default' && was?.value === a.value
            ? { ...a, source: was.source }
            : a;
        })
      : answers;
    this.record(runId, 'answers', { round: s.round, answers: recorded });
```

Find:

```text
  /** The text `intent.narrative` carries: the owner's change request on an update run, else the idea. */
```

Replace with:

```text
  /** The latest answer to each question before the latest refresh (plan 027), with its source. */
  private answersBeforeRefresh(runId: string): Map<string, Answer> {
    const cut = this.since(runId);
    const out = new Map<string, Answer>();
    for (const e of this.entries(runId)) {
      if (e.seq >= cut) break;
      if (e.type === 'answers') for (const a of e['answers'] as Answer[]) out.set(a.key, a);
    }
    return out;
  }

  /** The text `intent.narrative` carries: the owner's change request on an update run, else the idea. */
```

### 7. Engine test for work item 6

File `packages/core/src/enhance.test.ts`.

Find:

```text
  it('heals a run whose draft an earlier build corrupted with option slugs', async () => {
```

Replace with:

```text
  it('records an earlier answer confirmed with --yes after a refresh as the owner’s (plan 027)', async () => {
    const h = engineFor('refresh-questions');
    const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, dir, ref, { noPublish: true });
    const reading = { approve: false, reason: 'owner is reading' } as const;
    const first = new ScriptedPrompter({ 'request.dashboardExtras': 'nothing' }, reading);
    expect((await h.engine.advance(runId, first)).parked).toMatchObject({ state: 'REVIEW' });
    writeFileSync(path.join(dir, 'later.txt'), 'later\n');
    await git(['add', '-A'], dir);
    await git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'later'], dir);
    await h.engine.refreshRepo(runId);
    const waiting = new NonInteractivePrompter();
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ reason: 'needs_request' });
    h.engine.submitRequest(runId, h.engine.previousRequest(runId)!);
    expect((await h.engine.resume(runId, waiting)).parked).toMatchObject({ state: 'CLARIFY' });
    const done = await h.engine.resume(runId, new DefaultsPrompter());
    expect(done.state).toBe('DONE');
    expect(h.engine.entries(runId).find((e) => e.type === 'answers' && e['round'] === 0)).toMatchObject({
      answers: [
        { key: 'request.dashboardRecords', value: 'events-and-meets', source: 'user' },
        { key: 'request.dashboardExtras', value: 'nothing', source: 'user' },
      ],
    });
  });

  it('keeps an earlier --yes default a default when it is confirmed again after a refresh (plan 027)', async () => {
    const h = engineFor('refresh-questions');
    const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, dir, ref, { noPublish: true });
    const reading = { approve: false, reason: 'owner is reading' } as const;
    // --yes answered the first round: the owner never chose these answers.
    const first = Object.assign(new DefaultsPrompter(), { review: () => Promise.resolve(reading) });
    expect((await h.engine.advance(runId, first)).parked).toMatchObject({ state: 'REVIEW' });
    writeFileSync(path.join(dir, 'later.txt'), 'later\n');
    await git(['add', '-A'], dir);
    await git(
      ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'later'],
      dir,
    );
    await h.engine.refreshRepo(runId);
    const waiting = new NonInteractivePrompter();
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({
      reason: 'needs_request',
    });
    h.engine.submitRequest(runId, h.engine.previousRequest(runId)!);
    expect((await h.engine.resume(runId, waiting)).parked).toMatchObject({ state: 'CLARIFY' });
    expect((await h.engine.resume(runId, new DefaultsPrompter())).state).toBe('DONE');
    expect(
      h.engine.entries(runId).find((e) => e.type === 'answers' && e['round'] === 0),
    ).toMatchObject({
      answers: [
        { key: 'request.dashboardRecords', value: 'events-and-meets', source: 'default' },
        { key: 'request.dashboardExtras', value: 'upcoming', source: 'default' },
      ],
    });
  });

  it('heals a run whose draft an earlier build corrupted with option slugs', async () => {
```

### 8. CLI: the `--refresh` option

File `apps/cli/src/main.ts`.

Find:

```text
    .option('--prompt-file <path>', 'read that answer from a file')
    .option('--commit', "folder runs: commit the agent's changes (message: -m, or the drafted one)")
```

Replace with:

```text
    .option('--prompt-file <path>', 'read that answer from a file')
    .option(
      '--refresh',
      'update runs: read the repository again, then confirm what you asked (use on its own)',
    )
    .option('--commit', "folder runs: commit the agent's changes (message: -m, or the drafted one)")
```

Find:

```text
          prompt?: string;
          promptFile?: string;
          commit?: boolean;
```

Replace with:

```text
          prompt?: string;
          promptFile?: string;
          refresh?: boolean;
          commit?: boolean;
```

### 9. CLI: resume runs the refresh

File `apps/cli/src/commands/resume.ts`.

Find:

```text
    prompt?: string;
    promptFile?: string;
  } & FinishFlags &
```

Replace with:

```text
    prompt?: string;
    promptFile?: string;
    refresh?: boolean;
  } & FinishFlags &
```

Find:

```text
  if (opts.prompt && opts.promptFile)
    throw new PolicyError('use either --prompt or --prompt-file, not both', { code: 'usage' });
```

Replace with:

```text
  if (opts.prompt && opts.promptFile)
    throw new PolicyError('use either --prompt or --prompt-file, not both', { code: 'usage' });
  if (opts.refresh && (opts.prompt !== undefined || opts.promptFile !== undefined))
    throw new PolicyError(
      'use --refresh on its own; confirm what you asked with --prompt afterwards',
      { code: 'usage' },
    );
  // Update runs: read the repository again; the run then asks to confirm what was asked (plan 025).
  if (opts.refresh) await deps.engine.refreshRepo(runId);
```

### 10. CLI: what a parked run says

File `apps/cli/src/commands/new.ts`.

Find:

```text
    io.stderr(
      state.parked?.reason === 'needs_request'
        ? `  answer with: incubator resume ${state.runId} --prompt "what you want to change"\n`
        : `  resume with: incubator resume ${state.runId}${state.parked?.reason === 'needs_input' || state.parked?.reason === 'needs_review' ? ' (interactively, or add --yes)' : ''}\n`,
    );
```

Replace with:

```text
    const previous = (state.parked?.evidence as { previous?: unknown } | null | undefined)
      ?.previous;
    // why: after a refresh (plan 025) the owner confirms or edits what they asked for before.
    if (state.parked?.reason === 'needs_request' && typeof previous === 'string')
      io.stderr(
        `  what you asked before (confirm it or edit it):\n${previous.replace(/^/gm, '    ')}\n`,
      );
    io.stderr(
      state.parked?.reason === 'needs_request'
        ? `  answer with: incubator resume ${state.runId} --prompt "what you want to change"${typeof previous === 'string' ? ' (or --prompt-file <file> for a longer text)' : ''}\n`
        : state.parked?.reason === 'repo_moved'
          ? `  refresh with: incubator resume ${state.runId} --refresh\n`
          : `  resume with: incubator resume ${state.runId}${state.parked?.reason === 'needs_input' || state.parked?.reason === 'needs_review' ? ' (interactively, or add --yes)' : ''}\n`,
    );
```

### 11. CLI: round 0 in the terminal prompt

File `apps/cli/src/prompter.ts`.

Find:

```text
    this.io.stderr(
      `\nRound ${round}: ${questions.length} question(s). The recommended option is preselected.\n`,
    );
```

Replace with:

```text
    this.io.stderr(
      round === 0
        ? `\nYour earlier answers, from before the repository was read again: ${questions.length} question(s). Your answer then is preselected.\n`
        : `\nRound ${round}: ${questions.length} question(s). The recommended option is preselected.\n`,
    );
```

### 12. CLI test

File `apps/cli/src/main.test.ts`.

Find:

```text
    it('asks for the request on a terminal', async () => {
```

Replace with:

```text
    it('resume --refresh reads a repository that moved on again and shows what was asked, to confirm (plan 027)', async () => {
      const { factory, dir } = await setup('refresh');
      const first = io();
      expect(
        await main(
          ['enhance', dir, '--repo', 'octo/order-desk', '--prompt', REQUEST, '--no-publish'],
          first.io,
          factory,
        ),
      ).toBe(2);
      const runId = /incubator resume (\S+)/.exec(first.err.join(''))![1]!;
      const git = (args: string[]) => nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 });
      writeFileSync(path.join(dir, 'later.txt'), 'later\n');
      await git(['add', '-A']);
      await git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'later']);
      // Approving stops at the move, and the hint names the refresh.
      const approve = io();
      expect(await main(['resume', runId, '--yes'], approve.io, factory)).toBe(2);
      expect(approve.err.join('')).toContain(`refresh with: incubator resume ${runId} --refresh`);
      // --refresh goes on its own, and is refused before the run is touched.
      const both = io();
      expect(
        await main(['resume', runId, '--refresh', '--prompt', REQUEST], both.io, factory),
      ).toBe(2);
      expect(both.err.join('')).toContain('use --refresh on its own');
      const refreshed = io();
      expect(await main(['resume', runId, '--refresh'], refreshed.io, factory)).toBe(2);
      expect(refreshed.err.join('')).toContain('what you asked before (confirm it or edit it):');
      expect(refreshed.err.join('')).toContain(`    ${REQUEST}`);
      expect(refreshed.err.join('')).toContain('(or --prompt-file <file> for a longer text)');
      const done = io();
      expect(await main(['resume', runId, '--prompt', REQUEST, '--yes'], done.io, factory)).toBe(0);
      expect(done.err.join('')).toContain('✔ enhance branch written locally');
    });

    it('asks for the request on a terminal', async () => {
```

### 13. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write apps/web/src/api-types.ts apps/web/src/server/driver.ts apps/web/src/server/server.ts apps/web/src/server/server.test.ts apps/web/src/ui/views/RunLog.tsx packages/core/src/engine.ts packages/core/src/enhance.test.ts apps/cli/src/main.ts apps/cli/src/commands/resume.ts apps/cli/src/commands/new.ts apps/cli/src/prompter.ts apps/cli/src/main.test.ts
```

## Touched files and markers

| File                                 | Marker                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `apps/web/src/api-types.ts`          | `export interface RepoStatus {`                                                                           |
| `apps/web/src/server/driver.ts`      | `async refresh(runId: string): Promise<void> {`                                                           |
| `apps/web/src/server/server.ts`      | `'/api/runs/:id/repo-status',`                                                                            |
| `apps/web/src/server/server.test.ts` | `a refresh reads it again and asks to confirm the request (plan 027)`                                     |
| `apps/web/src/ui/views/RunLog.tsx`   | `case 'repo.refresh': {`                                                                                  |
| `packages/core/src/engine.ts`        | `answers: recorded });`                                                                                   |
| `packages/core/src/enhance.test.ts`  | `records an earlier answer confirmed with --yes after a refresh as the owner’s (plan 027)`                |
| `apps/cli/src/main.ts`               | `'--refresh',`                                                                                            |
| `apps/cli/src/commands/resume.ts`    | `if (opts.refresh) await deps.engine.refreshRepo(runId);`                                                 |
| `apps/cli/src/commands/new.ts`       | `refresh with: incubator resume`                                                                          |
| `apps/cli/src/prompter.ts`           | `Your earlier answers, from before the repository was read again`                                         |
| `apps/cli/src/main.test.ts`          | `resume --refresh reads a repository that moved on again and shows what was asked, to confirm (plan 027)` |

## Acceptance commands

```sh
pnpm exec vitest run --project unit apps/web/src/server/server.test.ts apps/cli/src/main.test.ts packages/core/src/enhance.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 apps/web apps/cli packages/core
(Select-String -SimpleMatch -Path apps/web/src/server/server.ts 'carriedQuestions: s.carriedQuestions,').Count
(Select-String -SimpleMatch -Path apps/web/src/server/server.ts "'/api/runs/:id/refresh',").Count
pnpm check:quick
```

```text
the vitest run passes, including the five plan 027 tests (two server, two engine, one CLI)
pnpm typecheck exits 0
eslint exits 0 on apps/web, apps/cli and packages/core
both Select-String counts print 1
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                                       | Why                                                                                           | Mechanical check                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RunDetail` gains `carriedQuestions` but the server does not set it                                        | the type would then be a lie the UI trusts                                                    | `pnpm typecheck` fails (the object literal misses a required field); a second server test asserts `carriedQuestions: true` at the round-0 CLARIFY park                                        |
| The refresh route returns before the run is working, so the page shows stale state                         | `driver.refresh` must start the background work                                               | the server test waits for the `needs_request` park with `evidence.previous`                                                                                                                   |
| `repo-status` hides an unknown run                                                                         | `withRun` maps `no_run` to 404 only if the engine throws                                      | the server test asserts 404 for an unknown run id                                                                                                                                             |
| `--refresh` with `--prompt` submits the request to a run that is not waiting for one                       | `submitRequest` needs the REQUEST park, which the refresh only reaches after the advance      | the CLI test asserts exit 2 for `--refresh --prompt` and the "use --refresh on its own" message (without the check the run is refreshed first and fails later with another message)           |
| A `repo_moved` park on the CLI tells the owner to resume, which parks again                                | the generic hint says `resume`                                                                | the CLI test asserts the `refresh with:` hint                                                                                                                                                 |
| The earlier request is not shown on the CLI, so the owner retypes it blind                                 | `reportRun` prints only the park message                                                      | the CLI test asserts the request text is printed under "what you asked before"                                                                                                                |
| `--yes` turns the owner's earlier answers into defaults, or a never-chosen default into the owner's choice | `DefaultsPrompter` records `source: "default"`; the carried question does not keep the source | an earlier answer confirmed with `--yes` keeps the source it had before the refresh: one engine test asserts `user` for answers the owner chose, the other `default` for answers `--yes` took |
| A refresh that races other work answers 422                                                                | `refreshRepo` throws `working` after its git await                                            | `driver.refresh` maps `working` to `ConflictError` (409); checked in review                                                                                                                   |
| The run log lines for the refresh go missing                                                               | nothing in this plan's tests renders `RunLog`                                                 | plan 028's browser test asserts "repository read again" and "asked again from before the refresh"                                                                                             |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Plans 025 and 026 left the refresh unreachable from the web and the CLI, so a `repo_moved` park was a dead end (plan 025 review, finding 7); plan 026's review noted `--yes` recording carried answers as defaults and round 0's label                                                                                                                                                                                                                                                                                                                                                                                                                                    | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy): FIX-FIRST. Must-fix: the --yes remap marked never-chosen defaults as the owner's (now the earlier source is kept, with a second engine test); the --refresh/--prompt test passed with the check deleted (now asserts the message). Also: a server test for carriedQuestions true; refresh racing other work maps to 409; the repo-status cost on GitHub runs is noted; RunLog named as the one UI exception, asserted by plan 028; the needs_request hint offers --prompt-file. Follow-up noted: refreshRepo does not re-read done after its await (a cancel mid-refresh still records the refresh) | CLOSED |
