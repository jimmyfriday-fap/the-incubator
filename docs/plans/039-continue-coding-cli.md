# Plan 039: `incubator resume <run> --continue` on the command line

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 7 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plans 036 (coding in parts) and 037 (continue coding, engine). Before you start, check that `grep -c "async continueCoding" packages/core/src/engine.ts` prints 1; stop if it does not.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Plan 037 added `engine.continueCoding(runId)`: a finished folder run whose agent stopped before finishing the plan goes back to coding on the same branch, and the owner reviews the commit and the push again. Plan 038 offers it in the app. This plan offers it on the command line:

- `incubator resume <run> --continue` continues coding. It must be used on its own: with `--refresh`, `--yes`, `--change`, `--prompt`, `--prompt-file`, `--commit`, `--leave`, `--push`, `--skip-push`, `--check` or `--no-checks` it is refused before the run is touched.
- When a folder run finishes but its agent stopped before finishing the plan, the closing message names the command. It does not do so when the changes were left uncommitted: the folder is then not clean, and continuing would be refused.

## Work items

### 1. CLI: the option

In `apps/cli/src/main.ts`:

Find:

```text
    .option(
      '--change <text>',
      'at review: correct the plan in your own words; it is drafted again and comes back to review',
    )
```

Replace with:

```text
    .option(
      '--change <text>',
      'at review: correct the plan in your own words; it is drafted again and comes back to review',
    )
    .option(
      '--continue',
      'folder runs whose agent stopped before finishing the plan: code on from where it stopped, on the same branch (use on its own)',
    )
```

Find:

```text
          change?: string;
          commit?: boolean;
```

Replace with:

```text
          change?: string;
          continue?: boolean;
          commit?: boolean;
```

### 2. CLI: resume takes the option

In `apps/cli/src/commands/resume.ts`:

Find:

```text
    refresh?: boolean;
    change?: string;
```

Replace with:

```text
    refresh?: boolean;
    change?: string;
    continue?: boolean;
```

### 3. CLI: resume refuses --continue with other flags, then continues

In `apps/cli/src/commands/resume.ts`:

Find:

```text
    throw new PolicyError('use --change on its own, while the run waits at review', {
      code: 'usage',
    });
```

Replace with:

```text
    throw new PolicyError('use --change on its own, while the run waits at review', {
      code: 'usage',
    });
  if (
    opts.continue &&
    (opts.refresh ||
      opts.yes ||
      opts.change !== undefined ||
      opts.prompt !== undefined ||
      opts.promptFile !== undefined ||
      opts.commit ||
      opts.leave ||
      opts.push ||
      opts.skipPush ||
      (opts.check?.length ?? 0) > 0 ||
      opts.checks === false)
  )
    throw new PolicyError('use --continue on its own, on a finished run whose agent stopped', {
      code: 'usage',
    });
  // A finished folder run whose agent stopped before the plan was done codes on (plan 037).
  if (opts.continue) await deps.engine.continueCoding(runId);
```

### 4. CLI: the closing message names --continue

In `apps/cli/src/commands/finish.ts`:

Find:

```text
              `✔ committed ${d.commit?.sha?.slice(0, 12) ?? ''} on ${d.commit?.branch ?? d.branch ?? '?'} in ${d.dir}`,
            ];
    io.stderr(`${lines.join('\n')}\n`);
```

Replace with:

```text
              `✔ committed ${d.commit?.sha?.slice(0, 12) ?? ''} on ${d.commit?.branch ?? d.branch ?? '?'} in ${d.dir}`,
            ];
    // why: the agent stopped before finishing the plan; it can code on in place (plan 037), unless changes were left.
    if (d.agent && d.agent.verdict !== 'ready' && !d.commit?.left)
      lines.push(
        `  the agent stopped before finishing the plan (${d.agent.tripped ?? d.agent.verdict}); continue with: incubator resume ${id} --continue`,
      );
    io.stderr(`${lines.join('\n')}\n`);
```

### 5. Test: --continue on the command line

In `apps/cli/src/main.test.ts`:

Find:

```text
    it('keeps the commit local with --skip-push, and the changes uncommitted with --leave', async () => {
```

Replace with:

```text
    it('continues a run whose agent stopped at a limit with --continue (plan 039)', async () => {
      const { h, dir, factory } = await setup();
      process.env['FAKE_AGENT_MODE'] = 'parts';
      process.env['FAKE_AGENT_PARTS'] = '99';
      try {
        const a = io();
        expect(await main(['enhance', dir, ...start], a.io, factory)).toBe(2);
        const runId = /run (\S+): the agent has stopped/.exec(a.err.join(''))![1]!;
        expect(h.engine.entries(runId).filter((e) => e.type === 'code.part')).toHaveLength(4);
        await main(['resume', runId, '--commit'], io().io, factory);
        const done = io();
        expect(await main(['resume', runId, '--push'], done.io, factory)).toBe(0);
        expect(done.err.join('')).toContain(`continue with: incubator resume ${runId} --continue`);
        // --continue goes on its own, and is refused before the run is touched.
        const both = io();
        expect(await main(['resume', runId, '--continue', '--push'], both.io, factory)).toBe(2);
        expect(both.err.join('')).toContain('use --continue on its own');
        expect(h.engine.entries(runId).some((e) => e.type === 'code.continue')).toBe(false);
        process.env['FAKE_AGENT_PARTS'] = '7';
        const c = io();
        expect(await main(['resume', runId, '--continue'], c.io, factory)).toBe(2);
        expect(c.err.join('')).toContain(`run ${runId}: the agent has stopped`);
        expect(h.engine.entries(runId).some((e) => e.type === 'code.continue')).toBe(true);
        await main(['resume', runId, '--commit'], io().io, factory);
        const again = io();
        expect(await main(['resume', runId, '--push'], again.io, factory)).toBe(0);
        expect(again.err.join('')).toContain('✔ opened https://github.com/octo/order-desk/pull/1');
        // The plan is finished now: nothing to continue.
        expect(again.err.join('')).not.toContain('--continue');
        expect(h.github.repos.get('octo/order-desk')!.prs).toHaveLength(1);
      } finally {
        process.env['FAKE_AGENT_MODE'] = 'edit';
        delete process.env['FAKE_AGENT_PARTS'];
      }
    }, 300_000);

    it('does not offer --continue when the changes were left uncommitted (plan 039)', async () => {
      const { dir, factory } = await setup();
      process.env['FAKE_AGENT_MODE'] = 'parts';
      process.env['FAKE_AGENT_PARTS'] = '99';
      try {
        const a = io();
        expect(await main(['enhance', dir, ...start], a.io, factory)).toBe(2);
        const runId = /run (\S+): the agent has stopped/.exec(a.err.join(''))![1]!;
        const left = io();
        expect(await main(['resume', runId, '--leave'], left.io, factory)).toBe(0);
        expect(left.err.join('')).toContain('✔ left the changes uncommitted');
        expect(left.err.join('')).not.toContain('--continue');
      } finally {
        process.env['FAKE_AGENT_MODE'] = 'edit';
        delete process.env['FAKE_AGENT_PARTS'];
      }
    }, 300_000);

    it('keeps the commit local with --skip-push, and the changes uncommitted with --leave', async () => {
```

### 6. Nothing else

Do not change `apps/cli/src/commands/new.ts` or any other file.

### 7. Format the touched files

Run:

```powershell
pnpm exec prettier --write apps/cli/src/main.ts apps/cli/src/commands/resume.ts apps/cli/src/commands/finish.ts apps/cli/src/main.test.ts
```

## Touched files and markers

| File                              | Marker                                                                      |
| --------------------------------- | --------------------------------------------------------------------------- |
| `apps/cli/src/main.ts`            | `'--continue',`                                                             |
| `apps/cli/src/commands/resume.ts` | `if (opts.continue) await deps.engine.continueCoding(runId);`               |
| `apps/cli/src/commands/finish.ts` | `continue with: incubator resume ${id} --continue`                          |
| `apps/cli/src/main.test.ts`       | `continues a run whose agent stopped at a limit with --continue (plan 039)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit apps/cli/src/main.test.ts -t "folder runs"
pnpm typecheck
pnpm exec eslint --max-warnings=0 apps/cli
pnpm check:quick
```

```text
the CLI folder-run tests pass, including "continues a run whose agent stopped at a limit with --continue (plan 039)" and "does not offer --continue when the changes were left uncommitted (plan 039)"
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                          | Why                                                                                                 | Mechanical check                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--continue` with another flag touches the run before failing | the refusal must come before `continueCoding`                                                       | the test asserts the message and that no `code.continue` entry exists                                                          |
| The option is declared but never reaches `runResume`          | commander passes it only when the type lists it                                                     | the test drives the real `main` with `--continue` and expects a `code.continue` entry                                          |
| The closing hint shows when there is nothing to continue      | only an agent that stopped before finishing the plan can continue, and not over uncommitted changes | the test expects the hint after the first push and its absence after the second; a second test expects no hint after `--leave` |
| The test times out inside the full suite                      | the Windows unit timeout is 120 s and files run in parallel                                         | both new tests pass `300_000`                                                                                                  |
| A second pull request is opened                               | the push after continuing must update the same one                                                  | the test expects one pull request on the fake GitHub                                                                           |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                       | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The owner asked to continue a run stopped at a limit; plan 038 covers the app, this plan the command line                                                                                                                                                                                                                                                                                                                     | CLOSED |
| 2     | Adversarial review (Opus 5.5, 037 then 039 applied literally): FIX-FIRST. Must-fix: the test timed out at 120 s inside the full suite; the "left uncommitted" hint mutation survived. Both fixed (300 s timeouts, a second test). Also: the checkpoint count is pinned at 4, and `--check`/`--no-checks` are refused with `--continue`. Left: the CLI commit request still says "nothing is committed" when checkpoints exist | CLOSED |
