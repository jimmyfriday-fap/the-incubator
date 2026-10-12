# Plan 050: an update run drops the targets a model sets instead of parking, and picks fewer stray targets

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 8 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/core/src/enhance.ts` contains `code: 'feature.targets',` and that `packages/core/src/engine.ts` contains `const turn = gate.value;`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test except the one assertion work item 5 replaces, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** On a real update run the owner's request named two files by path. The model's first reply failed the schema gate (a feature `summary` over 300 characters). Its second reply put those paths in `intent.coreFeatures[].targets`, which `featureIssues` rejects ("targets are resolved from the scan; do not set them"), so the run parked with `llm_schema`. The enhance prompt never mentions either rule. Targets are always resolved by the engine from the scan, so a model that sets them should not cost the owner a parked run: after this plan the engine drops them from the reply, the gate no longer counts them as a failure, and the prompt states both rules.

The same run's plan listed stray targets: a route the scanner found in a test fixture (`test/fixtures/lint-no-bow/tricky.mjs`), and modules that matched only because the summary said `src` or `test`. After this plan, `resolveTargets` never targets a path under a `fixtures/` (or `__fixtures__/`) folder, and ignores the words `src`, `lib`, `test` and `tests`. A module that matches a real word of the request (for example `src/state/` for "queued state") is still a target: word meaning is out of scope.

## Work items

### 1. `featureIssues` no longer rejects targets

In `packages/core/src/enhance.ts`:

Find:

```text
      draftSpec['intent'] as
        { coreFeatures?: { id?: unknown; lane?: unknown; targets?: unknown }[] } | undefined
```

Replace with:

```text
      draftSpec['intent'] as { coreFeatures?: { id?: unknown; lane?: unknown }[] } | undefined
```

Find:

```text
    if (f.targets !== undefined)
      issues.push({
        code: 'feature.targets',
        path: `/draftSpec/intent/coreFeatures/${i}/targets`,
        message: 'targets are resolved from the scan; do not set them',
      });
```

Replace with:

```text
    // Plan 050: targets a model sets are dropped by the engine (withoutTargets), not a reason to reject the reply.
```

### 2. The engine drops the targets from an update run's reply

In `packages/core/src/engine.ts`:

Find:

```text
    const turn = gate.value;
    this.record(runId, 'llm.turn', {
      round: s.round,
```

Replace with:

```text
    // Plan 050: targets come from the scan; ones the model set are dropped here, before the merge.
    const turn = enhance
      ? { ...gate.value, draftSpec: withoutTargets(gate.value.draftSpec) }
      : gate.value;
    this.record(runId, 'llm.turn', {
      round: s.round,
```

`withoutTargets` is already imported in this file (from `./discovery/merge.js`); do not add an import, and do not add a type assertion (`as ...`): eslint rejects it as unnecessary.

### 3. `resolveTargets` skips fixtures and path words

In `packages/core/src/enhance.ts`:

Find:

```text
const NAMING = new Set(['support']);
```

Replace with:

```text
const NAMING = new Set(['support']);

/** Plan 050: words in nearly every path ("src/admin", "test/admin"); they match every module, not the request. */
const PATH_WORDS = new Set(['src', 'lib', 'test', 'tests']);

/** Plan 050: a test fixture holds sample code (its routes are not the app's), never the place to make a change. */
const FIXTURE_PATH = /(^|\/)(__)?fixtures(__)?\//;
```

Find:

```text
    if (t.length < 3 || STOP.has(t) || (!keepNaming && NAMING.has(t))) continue;
```

Replace with:

```text
    if (t.length < 3 || STOP.has(t) || PATH_WORDS.has(t) || (!keepNaming && NAMING.has(t)))
      continue;
```

Find:

```text
  const bump = (target: string, text: string, weight: number): void => {
    const l = text.toLowerCase();
```

Replace with:

```text
  const bump = (target: string, text: string, weight: number): void => {
    if (FIXTURE_PATH.test(target)) return;
    const l = text.toLowerCase();
```

### 4. The enhance prompt states both rules

In `packages/core/prompts/enhance.md`:

Find:

```text
version: 1.3.0
```

Replace with:

```text
version: 1.4.0
```

Find:

```text
a one-sentence `summary` of the change, and a `lane`: `enhancement/existing` when it changes behaviour the digest shows, `enhancement/new` when it adds a capability. Use no other lane.
```

Replace with:

```text
a one-sentence `summary` of the change of at most 300 characters, and a `lane`: `enhancement/existing` when it changes behaviour the digest shows, `enhancement/new` when it adds a capability. Use no other lane. Do not set `targets`: the Incubator works out the files from the repository.
```

### 5. Unit tests in `enhance.test.ts`

In `packages/core/src/enhance.test.ts`:

Find:

```text
    expect(p.version).toBe('1.3.0');
```

Replace with:

```text
    expect(p.version).toBe('1.4.0');
```

Find:

```text
    // Targets come from the scan; a model that sets them is rejected.
    const withTargets = {
      intent: {
        coreFeatures: [{ id: 'x', summary: 's', lane: 'enhancement/new', targets: ['a'] }],
      },
    };
    expect(featureIssues(withTargets, []).map((i) => i.code)).toEqual(['feature.targets']);
```

Replace with:

```text
    // Plan 050: targets come from the scan; the engine drops ones the model sets, so they are not an issue.
    const withTargets = {
      intent: {
        coreFeatures: [{ id: 'x', summary: 's', lane: 'enhancement/new', targets: ['a'] }],
      },
    };
    expect(featureIssues(withTargets, [])).toEqual([]);
```

Find:

```text
  it('points a Flutter request at the feature module, its screens and its providers', () => {
```

Replace with:

```text
  it('leaves out test fixtures and the path words src and test (plan 050)', () => {
    const scan = {
      routes: [
        {
          method: 'GET',
          path: '/admin/status',
          file: 'test/fixtures/lint-no-bow/tricky.mjs',
          framework: 'node',
        },
      ],
      commands: [],
      dataModel: [],
      entryPoints: [],
      modules: [
        { dir: 'src/admin', files: 4, languages: ['JavaScript'] },
        { dir: 'src/config', files: 1, languages: ['JavaScript'] },
        { dir: 'src/state', files: 2, languages: ['JavaScript'] },
        { dir: 'test/admin', files: 3, languages: ['JavaScript'] },
        { dir: 'test/fixtures', files: 9, languages: ['JavaScript'] },
      ],
    } as unknown as RepoScan;
    // "state" is a word of the request, so src/state/ stays; the fixture route and src/config/ do not.
    expect(
      resolveTargets(scan, {
        id: 'admin-status-queue-waiting',
        summary:
          "Add a 'waiting' field to the queue part of GET /admin/status (src/admin): the count of live rows in the queued state. Update the test in test/admin.",
      }),
    ).toEqual(['src/admin/', 'src/state/', 'test/admin/']);
  });

  it('points a Flutter request at the feature module, its screens and its providers', () => {
```

### 6. An engine test, and its fixture, for a reply that sets targets

Create `packages/core/fixtures/enhance/model-targets/narrative.md` with exactly this content (one line, ending with a newline):

```text
Let kitchen staff export the day's orders as a CSV file from the orders list.
```

Create `packages/core/fixtures/enhance/model-targets/01-DiscoveryTurn.json` with exactly this content:

```json
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 050: the model sets targets; the engine drops them and resolves its own from the scan, with no retry",
  "response": {
    "draftSpec": {
      "intent": {
        "coreFeatures": [
          {
            "id": "export-orders",
            "summary": "Export the day's orders as CSV from the existing /orders route",
            "lane": "enhancement/existing",
            "targets": ["lib/elsewhere.js"]
          }
        ]
      },
      "decisions": [
        {
          "key": "intent.coreFeatures",
          "question": "Which existing behaviour changes",
          "answer": "GET /orders gains a CSV export",
          "source": "inferred"
        }
      ]
    },
    "questions": [],
    "done": true
  }
}
```

In `packages/core/src/enhance.test.ts`:

Find:

```text
  it('revises an update plan from corrections at review and resolves the targets again (plan 021)', async () => {
```

Replace with:

```text
  it('drops the targets a model sets and resolves them from the scan, with no retry (plan 050)', async () => {
    const h = engineFor('model-targets');
    const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, dir, ref, { noPublish: true });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.state).toBe('DONE');
    const turns = (h.llm as FakeLlmAdapter).calls.filter((c) => c.schemaName === 'DiscoveryTurn');
    expect(turns).toHaveLength(1);
    expect(h.engine.finalSpec(runId)!.intent.coreFeatures[0]!.targets).toEqual(['src/server.js']);
  });

  it('revises an update plan from corrections at review and resolves the targets again (plan 021)', async () => {
```

### 7. Update the enhance prompt snapshot

Run:

```powershell
pnpm exec vitest run --project unit packages/core/src/enhance.test.ts -t "ships the enhance prompt versioned and byte-pinned" -u
```

Then run `git diff --name-only -- "*.snap"`. It must print exactly `packages/core/src/__snapshots__/enhance.test.ts.snap`. If it prints any other file, run `git checkout -- <that file>` for it.

### 8. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/enhance.ts packages/core/src/engine.ts packages/core/src/enhance.test.ts packages/core/prompts/enhance.md
```

(`packages/core/fixtures/` is in `.prettierignore`; leave the fixture files exactly as written in work item 6.)

## Touched files and markers

| File                                                                 | Marker                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/core/src/enhance.ts`                                       | `const PATH_WORDS = new Set(['src', 'lib', 'test', 'tests']);`                             |
| `packages/core/src/engine.ts`                                        | `draftSpec: withoutTargets(gate.value.draftSpec)`                                          |
| `packages/core/prompts/enhance.md`                                   | `the Incubator works out the files from the repository.`                                   |
| `packages/core/src/enhance.test.ts`                                  | `drops the targets a model sets and resolves them from the scan, with no retry (plan 050)` |
| `packages/core/fixtures/enhance/model-targets/01-DiscoveryTurn.json` | `plan 050: the model sets targets; the engine drops them`                                  |
| `packages/core/fixtures/enhance/model-targets/narrative.md`          | `Let kitchen staff export the day's orders as a CSV file from the orders list.`            |
| `packages/core/src/__snapshots__/enhance.test.ts.snap`               | `of at most 300 characters`                                                                |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/enhance.test.ts packages/core/src/discovery/questions.test.ts tests/scenarios.test.ts
(Select-String -SimpleMatch -Path packages/core/src/enhance.ts "feature.targets").Count
git diff --name-only -- "*.snap"
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
enhance.test.ts, questions.test.ts and tests/scenarios.test.ts pass, including the two new plan 050 tests
the Select-String count prints 0
git diff prints exactly packages/core/src/__snapshots__/enhance.test.ts.snap
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                  | Why                                                                                                                | Mechanical check                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The engine keeps the model's targets                                  | spec building keeps a feature's `targets` when present (`f.targets ? f : …resolveTargets…` in `engine.ts`)         | the plan 050 engine test expects `['src/server.js']`, not the fixture's `lib/elsewhere.js`                                                                                           |
| The gate still rejects targets                                        | `featureIssues` runs inside the gate, before the engine can drop anything                                          | the engine test's fixture has one `DiscoveryTurn`; a retry finds no second fixture and the fake LLM throws `fixture_missing`; the test also asserts one call; Select-String prints 0 |
| Greenfield runs change                                                | discovery replies and recorded fixtures (`fixtures/discovery/live-claude-bookclub`) are keyed on unchanged prompts | the drop is guarded by `enhance`; `pnpm check:quick` runs the discovery replay tests                                                                                                 |
| The prompt changes without a version bump, or the snapshot hides more | `-u` accepts whatever the files say                                                                                | the version test asserts `1.4.0`; `git diff --name-only -- "*.snap"` must print exactly the enhance snapshot                                                                         |
| The fixture filter or path words are written but not applied          | a constant that nothing reads still type-checks                                                                    | the plan 050 resolveTargets test fails without either: the fixture route would rank first, and `src/config/` would appear                                                            |
| An existing target expectation shifts                                 | other tests pin targets (`src/server.js`, `src/billing/`, `lib/features/...`)                                      | the existing resolveTargets, Flutter and plan 021 tests run unchanged in the first acceptance command                                                                                |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Claude (Opus) review by trial apply in the worktree, then reverted: all anchors unique; tests, typecheck and eslint pass; four mutations (no drop in the engine, no fixture skip, no path words, the old targets check) each fail a plan 050 test. Fixed: an `as Draft` assertion eslint rejects as unnecessary; the formatter list no longer names an ignored fixture | CLOSED |
| 1     | Follow-up from a real update run (scratch clone of backshack-agent-runner): a request naming file paths parked llm_schema on model-set targets after a 300-character summary failure; the plan listed a test-fixture route as a target                                                                                                                                 | CLOSED |
