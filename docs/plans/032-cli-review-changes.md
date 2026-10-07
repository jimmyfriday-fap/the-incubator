# Plan 032: correct the plan at review from the command line

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 5 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not touch anything under `packages/` or `apps/web/`. Do not commit, push, or run `pnpm contracts:pin`. Do not
  delete, skip or weaken any test, and do not add an eslint-disable comment.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** Plans 021 and 022 let the owner correct a plan at review in their own words: "Update the plan" in the app.
The engine method is `Engine.requestChanges(runId, text)` (`packages/core/src/engine.ts`). It records
`review.feedback`, drafts the spec again with the correction, and comes back to review with a new plan.

The command line has no way to do this yet; at review it can only approve. This plan adds
`incubator resume <id> --change "what to change"`:

- it is used on its own, not with `--refresh`, `--yes`, `--prompt` or `--prompt-file`, and is refused before the run is
  touched;
- a run waiting at review prints the hint `change the plan with: incubator resume <id> --change "what to change"`.

## Work items

### 1. CLI: the `--change` option

File `apps/cli/src/main.ts`.

Find:

```text
      '--refresh',
      'update runs: read the repository again, then confirm what you asked (use on its own)',
    )
```

Replace with:

```text
      '--refresh',
      'update runs: read the repository again, then confirm what you asked (use on its own)',
    )
    .option(
      '--change <text>',
      'at review: correct the plan in your own words; it is drafted again and comes back to review',
    )
```

Find:

```text
          refresh?: boolean;
```

Replace with:

```text
          refresh?: boolean;
          change?: string;
```

### 2. CLI: resume sends the correction

File `apps/cli/src/commands/resume.ts`.

Find:

```text
    refresh?: boolean;
  } & FinishFlags &
```

Replace with:

```text
    refresh?: boolean;
    change?: string;
  } & FinishFlags &
```

Find:

```text
  // Update runs: read the repository again; the run then asks to confirm what was asked (plan 025).
  if (opts.refresh) await deps.engine.refreshRepo(runId);
```

Replace with:

```text
  if (
    opts.change !== undefined &&
    (opts.refresh || opts.yes || opts.prompt !== undefined || opts.promptFile !== undefined)
  )
    throw new PolicyError('use --change on its own, while the run waits at review', {
      code: 'usage',
    });
  // Update runs: read the repository again; the run then asks to confirm what was asked (plan 025).
  if (opts.refresh) await deps.engine.refreshRepo(runId);
```

`--yes` is refused with `--change` because it would approve the redrafted plan before the owner sees it.

Find:

```text
  await answerFinish(deps, runId, opts);
```

Replace with:

```text
  await answerFinish(deps, runId, opts);
  // A correction at review (plan 021): the plan is drafted again with it and comes back to review (plan 032).
  // why: last, so a flag refused above leaves the run untouched at review.
  if (opts.change !== undefined) deps.engine.requestChanges(runId, opts.change);
```

### 3. CLI: a run at review says how to change the plan

File `apps/cli/src/commands/new.ts`.

Find:

```text
          : `  resume with: incubator resume ${state.runId}${state.parked?.reason === 'needs_input' || state.parked?.reason === 'needs_review' ? ' (interactively, or add --yes)' : ''}\n`,
    );
    return ExitCode.Policy;
```

Replace with:

```text
          : `  resume with: incubator resume ${state.runId}${state.parked?.reason === 'needs_input' || state.parked?.reason === 'needs_review' ? ' (interactively, or add --yes)' : ''}\n`,
    );
    // why: new and update runs plan through discovery, so the owner can correct the plan in words (plan 032).
    if (
      state.parked?.state === 'REVIEW' &&
      (state.input.kind === 'new' || state.input.kind === 'enhance')
    )
      io.stderr(
        `  change the plan with: incubator resume ${state.runId} --change "what to change"\n`,
      );
    return ExitCode.Policy;
```

### 4. CLI test

File `apps/cli/src/main.test.ts`.

Find:

```text
    it('asks for the request on a terminal', async () => {
```

Replace with:

```text
    it('resume --change corrects the plan at review in words, and the plan is drafted again (plan 032)', async () => {
      const { factory, dir, h } = await setup('review-changes');
      const first = io();
      expect(
        await main(
          ['enhance', dir, '--repo', 'octo/order-desk', '--prompt', REQUEST, '--no-publish'],
          first.io,
          factory,
        ),
      ).toBe(2);
      const runId = /incubator resume (\S+)/.exec(first.err.join(''))![1]!;
      expect(first.err.join('')).toContain(
        `change the plan with: incubator resume ${runId} --change "what to change"`,
      );
      // --change goes on its own, and is refused before the run is touched.
      const both = io();
      expect(await main(['resume', runId, '--change', 'x', '--refresh'], both.io, factory)).toBe(2);
      expect(both.err.join('')).toContain('use --change on its own');
      expect(h.engine.entries(runId).some((e) => e.type === 'repo.refresh')).toBe(false);
      // --yes would approve the redrafted plan unseen; --commit has nothing to answer at review.
      for (const extra of [['--yes'], ['--commit']])
        expect(await main(['resume', runId, '--change', 'x', ...extra], io().io, factory)).toBe(2);
      const changed = io();
      expect(
        await main(
          ['resume', runId, '--change', 'Also let kitchen staff filter the export by date.'],
          changed.io,
          factory,
        ),
      ).toBe(2);
      expect(changed.err.join('')).toContain('parked at REVIEW');
      expect(h.engine.entries(runId).filter((e) => e.type === 'review.feedback')).toHaveLength(1);
      expect(h.engine.finalSpec(runId)!.intent.coreFeatures.map((f) => f.id)).toEqual([
        'export-orders',
        'export-filter',
      ]);
      // Adopt runs have no plan to revise: their review park does not offer --change.
      const adopt = io();
      expect(
        await main(['adopt', dir, '--repo', 'octo/order-desk', '--no-publish'], adopt.io, factory),
      ).toBe(2);
      expect(adopt.err.join('')).toContain('parked at REVIEW');
      expect(adopt.err.join('')).not.toContain('change the plan with');
    });

    it('asks for the request on a terminal', async () => {
```

### 5. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write apps/cli/src/main.ts apps/cli/src/commands/resume.ts apps/cli/src/commands/new.ts apps/cli/src/main.test.ts
```

## Touched files and markers

| File                              | Marker                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/cli/src/main.ts`            | `'--change <text>',`                                                                             |
| `apps/cli/src/commands/resume.ts` | `if (opts.change !== undefined) deps.engine.requestChanges(runId, opts.change);`                 |
| `apps/cli/src/commands/new.ts`    | `change the plan with: incubator resume`                                                         |
| `apps/cli/src/main.test.ts`       | `resume --change corrects the plan at review in words, and the plan is drafted again (plan 032)` |

## Acceptance commands

```sh
pnpm exec vitest run --project unit apps/cli/src/main.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 apps/cli
pnpm check:quick
```

```text
the CLI tests pass, including "resume --change corrects the plan at review in words, and the plan is drafted again (plan 032)"
pnpm typecheck and eslint on apps/cli exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                       | Why                                                                  | Mechanical check                                                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--change` with `--refresh` refreshes the run before failing                               | the refusal must come before `refreshRepo`                           | the test asserts the "use --change on its own" message and that no `repo.refresh` entry exists                         |
| The correction is recorded but the plan is not drafted again                               | `requestChanges` enters DRAFT_SPEC, and the resume must then advance | the test asserts the run parks at REVIEW again with the `export-filter` feature                                        |
| The option is declared but never reaches `runResume`                                       | commander passes it only when the type lists it                      | the test drives the real `main` with `--change`                                                                        |
| The hint shows on runs that cannot be corrected (adopt, scaffold)                          | only new and update runs plan through discovery                      | the test asserts the hint on an update run and its absence on an adopt run parked at REVIEW                            |
| `--change` with `--commit`, `-m` or a bad `--check` leaves the run in DRAFT_SPEC, stranded | `requestChanges` used to run before the other flags were checked     | `requestChanges` runs last; the test's `--commit` loop and the single `review.feedback` entry fail if it moves earlier |
| `--change --yes` approves the redrafted plan before the owner sees it                      | `--yes` answers review                                               | refused; the test loop asserts exit 2 for `--yes`                                                                      |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Corrections at review (plans 021 and 022) existed only in the app; the owner listed the command line as a follow-up                                                                                                                                                                                                                                                                                                                                                                                                                                           | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy): FIX-FIRST. Must-fix: `requestChanges` ran before `--commit`/`--check` were refused, stranding the run in DRAFT_SPEC; it now runs last. Also: `--change --yes` is refused (it approved an unseen plan), the hint keys on a REVIEW park (any reason) for new and update runs, and the test asserts its absence on an adopt run. Incident: the reviewer's .NET file writes resolved against the real worktree (PowerShell Set-Location does not move the .NET current directory); restored | CLOSED |
