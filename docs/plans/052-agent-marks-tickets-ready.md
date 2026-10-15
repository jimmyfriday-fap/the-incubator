# Plan 052: the coding agent is told that marking a finished ticket READY_FOR_TEST is expected of it, whatever state the file shows

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 4 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/core/prompts/handoff-external.md` contains `name: handoff-external` and that `packages/core/prompts/handoff-continue.md` contains `name: handoff-continue`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** In a real update run, part 1 wrote the code, but `npm test` failed because the scratch clone had no dependencies installed. The agent correctly left both tickets unmarked. After the dependencies were installed, a continuing part found everything done and `npm test` green, and still did not mark the tickets: both files said `"state": "TAGGED_TO_RELEASE"`, and the agent wrote that moving a state that says "release" "seemed like your call". The run ended parked with the work finished and no ticket ready. The prompt says to set `READY_FOR_TEST` when a step is finished and the commands pass, but not that this holds whatever state the file shows now.

After this plan, both prompts say it: the state a ticket file shows now (usually `TAGGED_TO_RELEASE`) does not matter, and setting `READY_FOR_TEST` once its step is done and the approved commands pass is expected of the agent, not a decision for the owner. The continuing-part prompt also says: if every item is already done and the commands pass, mark the tickets instead of stopping with nothing marked. The Incubator still marks nothing itself, so a ticket is only ever ready when the agent says its step is finished. The agent's rule about commands that fail is unchanged.

## Work items

### 1. The external prompt

In `packages/core/prompts/handoff-external.md`:

Find:

```text
version: 1.1.0
```

Replace with:

```text
version: 1.2.0
```

Find:

```text
set that ticket's `"state"` to `"READY_FOR_TEST"`, and change nothing else in the file. When you stop,
```

Replace with:

```text
set that ticket's `"state"` to `"READY_FOR_TEST"`, and change nothing else in the file. Whatever state the file shows now (it usually says `TAGGED_TO_RELEASE`), setting `READY_FOR_TEST` is expected of you: it is not a decision for the owner, and the Incubator accepts it from any state. When you stop,
```

### 2. The continuing-part prompt

In `packages/core/prompts/handoff-continue.md`:

Find:

```text
version: 1.1.0
```

Replace with:

```text
version: 1.2.0
```

Find:

```text
3. As before, leave your work as uncommitted changes. The Incubator commits each part, and the owner reviews the whole branch before anything is pushed.
```

Replace with:

```text
3. As before, leave your work as uncommitted changes. The Incubator commits each part, and the owner reviews the whole branch before anything is pushed.
4. If you find that every item is already done and the approved commands pass, do not stop with the tickets unmarked: set each finished request's ticket to `"READY_FOR_TEST"`, whatever state its file shows now. That is expected of you, not a decision for the owner.
```

### 3. The prompt tests

In `packages/core/src/handoff.test.ts`:

Find:

```text
    expect(p.name).toBe('handoff-continue');
    expect(p.version).toBe('1.1.0');
```

Replace with:

```text
    expect(p.name).toBe('handoff-continue');
    expect(p.version).toBe('1.2.0');
    expect(p.body).toContain('do not stop with the tickets unmarked');
```

Find:

```text
    expect(p.name).toBe('handoff-external');
    expect(p.version).toBe('1.1.0');
    expect(p.body).toMatchSnapshot();
```

Replace with:

```text
    expect(p.name).toBe('handoff-external');
    expect(p.version).toBe('1.2.0');
    expect(p.body).toContain('Whatever state the file shows now');
    expect(p.body).toMatchSnapshot();
```

Then update the snapshot. Run:

```powershell
pnpm exec vitest run --project unit packages/core/src/handoff.test.ts -t "ships the external prompt versioned and byte-pinned" -u
```

Then run `git diff --name-only -- "*.snap"`. It must print exactly `packages/core/src/__snapshots__/handoff.test.ts.snap`. If it prints any other file, run `git checkout -- <that file>` for it.

### 4. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/handoff.test.ts packages/core/prompts/handoff-external.md packages/core/prompts/handoff-continue.md
```

## Touched files and markers

| File                                                   | Marker                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `packages/core/prompts/handoff-external.md`            | `Whatever state the file shows now (it usually says`             |
| `packages/core/prompts/handoff-continue.md`            | `do not stop with the tickets unmarked`                          |
| `packages/core/src/handoff.test.ts`                    | `expect(p.body).toContain('Whatever state the file shows now');` |
| `packages/core/src/__snapshots__/handoff.test.ts.snap` | `it usually says \`TAGGED_TO_RELEASE\``                          |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/handoff.test.ts tests/scenarios.test.ts
git diff --name-only -- "*.snap"
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
handoff.test.ts and tests/scenarios.test.ts pass
git diff prints exactly packages/core/src/__snapshots__/handoff.test.ts.snap
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                         | Why                                                                                                      | Mechanical check                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The prompt version is not bumped, or the snapshot hides more | `-u` accepts whatever the files say                                                                      | the version tests assert `1.2.0` for both prompts; `git diff --name-only -- "*.snap"` must print exactly the handoff snapshot         |
| The engine starts marking tickets itself                     | a ticket could then be ready though nobody did its step (a multi-request plan whose agent stopped early) | the plan changes prompt files and tests only; `git diff --name-only` lists no file under `packages/core/src` except `handoff.test.ts` |
| Another test pins the old continuation or external wording   | the continue prompt is part of the text sent to the agent in several folder-run tests                    | the first acceptance command and `pnpm check:quick` run every handoff and folder-run test; any pin on the old text fails there        |
| The Incubator-built (gate) prompt changes by accident        | `handoff.md` is the canonical prompt for repositories the Incubator built and has its own snapshot       | `git diff --name-only` must not list `packages/core/prompts/handoff.md`                                                               |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                               | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Follow-up from a real update run (scratch clone of backshack-agent-runner, run 20261012-020033-oclhsr): the agent finished the work, the checks were green, and it left the tickets unmarked because their state looked like a decision for the owner | CLOSED |
