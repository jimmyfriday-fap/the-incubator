# Plan 060: two fixes in the stand-up guide: no pointer to a section it does not have, and a warning that the image build takes minutes

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 3 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plan 058. Before you start, check that `packages/core/src/standup.ts` contains `export function standUpMarkdown(` and that `packages/core/src/standup.test.ts` contains `it('activates a theme as a theme'`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment. Do not touch `packages/core/src/what-now.ts` or its tests: WHAT-NOW.md keeps its wording.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** The first stand-up guide generated from a real run (COI Tracker, `STAND-UP-coi-tracker.md`) had two defects. Its last section said "Run it on your machine: the steps are under "How to run it" above." That sentence comes from plan 057's guide, where a "How to run it" section exists; the stand-up document has no such section (its work items are the steps), so a reader looked for a section that is not there. And the WordPress step `docker compose up -d --wait` builds the WordPress image on its first run, which takes minutes; nothing told the executor to wait, and a small model may stop a command that is only slow. Both were fixed by hand in the copy saved in the project.

After this plan, the stand-up document says "the steps are the work items above", only in the stand-up document (WHAT-NOW.md and the run page keep their own wording), and the WordPress start step's expected result says the first run builds the image and takes several minutes and must not be stopped.

## Work items

### 1. The two edits in the builder

In `packages/core/src/standup.ts`:

Find:

```text
          'The command exits 0 (`$LASTEXITCODE` is 0) and the last lines say the `db` and `wordpress` containers are `Healthy` or `Started`.',
```

Replace with:

```text
          'The command exits 0 (`$LASTEXITCODE` is 0) and the last lines say the `db` and `wordpress` containers are `Healthy` or `Started`. The first run builds the WordPress image and can take several minutes: wait for the command to finish, do not stop it.',
```

Find:

```text
    ...g.next.map((l, i) => `${i + 1}. ${esc(l)}`),
```

Replace with:

```text
    // why: plan 057's line points at its "How to run it" section; this document has none, its work items are the steps.
    ...g.next.map(
      (l, i) =>
        `${i + 1}. ${esc(l.replace('the steps are under "How to run it" above', 'the steps are the work items above'))}`,
    ),
```

### 2. The test

In `packages/core/src/standup.test.ts`:

Find:

```text
  it('activates a theme as a theme', () => {
```

Replace with:

```text
  it('points at its own work items and tells the executor to wait for the image build (plan 060)', () => {
    const md = standUp(facts()).markdown;
    expect(md).toContain('2. Run it on your machine: the steps are the work items above.');
    expect(md).not.toContain('How to run it');
    expect(md).toContain(
      'The first run builds the WordPress image and can take several minutes: wait for the command to finish, do not stop it.',
    );
  });

  it('activates a theme as a theme', () => {
```

### 3. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/standup.ts packages/core/src/standup.test.ts
```

## Touched files and markers

| File                                | Marker                                                      |
| ----------------------------------- | ----------------------------------------------------------- |
| `packages/core/src/standup.ts`      | `the steps are the work items above`                        |
| `packages/core/src/standup.test.ts` | `tells the executor to wait for the image build (plan 060)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/standup.test.ts packages/core/src/what-now.test.ts
(Select-String -SimpleMatch -Path packages/core/src/standup.ts "do not stop it").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
standup.test.ts and what-now.test.ts pass, including the new plan 060 test
the Select-String count prints 1
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                    | Why                                                                                                              | Mechanical check                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sentence in `what-now.ts` changes later and the replacement silently stops matching | `String.replace` with a text that is not found changes nothing and type-checks                                   | the new test asserts the exact result sentence `2. Run it on your machine: the steps are the work items above.` and the absence of `How to run it`   |
| The fix is made in `what-now.ts` instead                                                | WHAT-NOW.md and the run page do have a "How to run it" section, so changing the shared sentence would break them | `what-now.test.ts` still pins `the steps are under "How to run it" above` and runs in the acceptance command                                         |
| The replacement adds markdown the formatter rewrites                                    | a generated Node repository checks the format of every file                                                      | `standup.test.ts` still formats three guides with prettier and expects them unchanged                                                                |
| The wait sentence lands on the wrong step                                               | the other steps do not build an image                                                                            | the new test asserts the sentence appears in the WordPress guide, and the first edit's Find text is the expect of `docker compose up -d --wait` only |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                             | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Follow-up from the first real stand-up guide (COI Tracker): a dangling reference to a section the document does not have, and no warning that the first image build takes minutes                                                                                                                                                   | CLOSED |
| 2     | In-session adversarial review (Cursor unavailable): every edit is literal; the one silent failure (the replacement no longer matching) is guarded by the exact-sentence assertion; trial apply passed typecheck, eslint and 16 tests, and three mutants (the result sentence, the wait sentence, the replace target) are all killed | CLOSED |
| 3     | Code review of the Copilot run (Haiku 4.5): the diff is identical to the trial apply; the three mutants killed in round 2 are the same code; `pnpm check:quick` alone passes (853 tests). A red Stop-hook run during the dispatch was two suites running at once (the hook and Copilot's own check), not a defect                   | CLOSED |
