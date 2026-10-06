# Plan 020: update runs name the decision key the schema gate wants

## Executor preamble

You are implementing a small, exact fix. Follow these rules for every work item:

- Change only the files named in this plan, at the places named. Do not refactor, rename or reformat
  anything else by hand (work item 9 runs the formatter on the files this plan touches).
- Every path below is relative to the repository root, which is your current working directory. There is only
  one repository in scope; do not look for these files anywhere else.
- Copy every string exactly as written in this plan, including quotes, backticks, indentation and punctuation.
- Do not touch anything under `packages/core/fixtures/discovery/`. Those recorded fixtures are keyed by a hash
  of the exact prompt text; greenfield prompt text, and the greenfield retry message, must stay byte-identical.
- Do not commit, push, or run `pnpm contracts:pin`. Do not edit `security/accepted-risks.json`.
- Do not delete, skip or weaken any test. Do not add `.skip`, `.only` or `.todo`. Do not re-key fixtures.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** On update runs (`kind: 'enhance'`) the model must attribute every value it sets with a `decisions[]`
entry whose `key` covers the changed path (`attributionIssues` in `packages/core/src/discovery/merge.ts`, lines
48-60, and `covers` in `packages/spec/src/paths.ts`). The update prompt said only "Record each request in
`decisions`", so the model keyed its decisions some other way. The gate's retry message ("draftSpec sets
intent.coreFeatures without a matching decisions[] entry") did not name the key either, so the model failed twice
and the run parked `llm_schema` (run `20261006-031254-63n6jg`). The fix names the exact key in the update
prompt and, on update runs only, in the retry message, and adds a regression test that replays that failure.

## Work items

### 1. The retry message can name the key (update runs only)

File: `packages/core/src/discovery/merge.ts`

Replace this exact block (lines 48-60):

```ts
/** Every value the model changed must be attributed by a decision (TDD §5.2 rule 4). */
export function attributionIssues(before: Draft, turn: DiscoveryTurn): Issue[] {
  const proposed = withoutPackFixed(turn.draftSpec);
  const after = deepMerge(withoutMeta(before), withoutMeta(proposed));
  const keys = [...(before.decisions ?? []), ...(proposed.decisions ?? [])].map((d) => d.key);
  return changedPaths(withoutMeta(before), after)
    .filter((p) => !keys.some((k) => covers(k, p)))
    .map((p) => ({
      code: 'decision.missing',
      path: `/draftSpec/${p.replaceAll('.', '/')}`,
      message: `draftSpec sets ${p} without a matching decisions[] entry`,
    }));
}
```

with:

```ts
/**
 * Every value the model changed must be attributed by a decision (TDD §5.2 rule 4). `nameKey` (update runs,
 * plan 020) adds the key to use to each message, so the model can correct itself on the retry; greenfield
 * messages stay as they were, because recorded fixtures are keyed by their exact text.
 */
export function attributionIssues(
  before: Draft,
  turn: DiscoveryTurn,
  opts: { nameKey?: boolean } = {},
): Issue[] {
  const proposed = withoutPackFixed(turn.draftSpec);
  const after = deepMerge(withoutMeta(before), withoutMeta(proposed));
  const keys = [...(before.decisions ?? []), ...(proposed.decisions ?? [])].map((d) => d.key);
  return changedPaths(withoutMeta(before), after)
    .filter((p) => !keys.some((k) => covers(k, p)))
    .map((p) => ({
      code: 'decision.missing',
      path: `/draftSpec/${p.replaceAll('.', '/')}`,
      message: opts.nameKey
        ? `draftSpec sets ${p} without a matching decisions[] entry: add one with key "${p}"`
        : `draftSpec sets ${p} without a matching decisions[] entry`,
    }));
}
```

### 2. The engine asks for the key on update runs

File: `packages/core/src/engine.ts`

Replace this exact line (line 2222, the only occurrence in the file):

```ts
          ...attributionIssues(before, turn),
```

with:

```ts
          ...attributionIssues(before, turn, { nameKey: enhance }),
```

(`enhance` is already a `const` in scope there; do not declare it.)

### 3. The update-run user prompt names the keys

File: `packages/core/src/discovery/prompt-builder.ts`

Replace this exact line (line 88):

```ts
    '- Record every value you set in draftSpec.decisions with source "inferred" and a one-line question/answer.',
```

with:

```ts
    ctx.enhance
      ? '- Record each intent field you set or change in draftSpec.decisions, keyed by its path: "intent.coreFeatures" whenever you set features, and "intent.personas" (or any other intent field) if you change it; source "inferred", with a one-line question/answer. A decision keyed by a feature id, by a request.<topic> key, or by a path below the field (such as intent.coreFeatures.exportOrders) does not count.'
      : '- Record every value you set in draftSpec.decisions with source "inferred" and a one-line question/answer.',
```

The greenfield branch (after the `:`) must stay byte-identical to the old line.

### 4. The update system prompt names the keys

File: `packages/core/prompts/enhance.md`

4a. Replace the line `version: 1.2.0` with `version: 1.3.0`.

4b. Replace the whole line that starts with `6. Record each request in` (line 13) with exactly:

```text
6. For every intent field you set or change, add an entry to `decisions` keyed by that field's path, with `source: "inferred"`: `intent.coreFeatures` whenever you set features, and `intent.personas` (or any other intent field) if you change it. A decision keyed by a feature id, by a `request.<topic>` key, or by a path below the field (such as `intent.coreFeatures.exportOrders`) does not count. Reply **only** with JSON matching `DiscoveryTurn` (`{ draftSpec, questions[], done }`). Set `done: true` when no open question would change what is delivered.
```

### 5. The prompt version test and its snapshot

File: `packages/core/src/enhance.test.ts`

5a. In the test `ships the enhance prompt versioned and byte-pinned`, replace `expect(p.version).toBe('1.2.0');`
with `expect(p.version).toBe('1.3.0');` (the only `'1.2.0'` in the file).

5b. Refresh only that test's snapshot (the enhance prompt body changed on purpose). Run exactly:

```powershell
pnpm exec vitest run packages/core/src/enhance.test.ts -u -t "ships the enhance prompt versioned and byte-pinned"
```

Never run `-u` any other way.

### 6. Unit tests for the message and the prompt line

File: `packages/core/src/discovery/questions.test.ts`

6a. Replace the line `import type { Question } from '@incubator/spec';` with:

```ts
import type { DiscoveryTurn, Question } from '@incubator/spec';
```

6b. Replace the line `import { applyAnswers, type AskedInfo, type Draft } from './merge.js';` with:

```ts
import { applyAnswers, attributionIssues, type AskedInfo, type Draft } from './merge.js';
```

6c. Append this block at the very end of the file, after one empty line:

```ts
describe('attribution on an update run (plan 020)', () => {
  const before = { intent: { coreFeatures: [] } } as unknown as Draft;
  const turn = (decisionKeys: string[]): DiscoveryTurn => ({
    draftSpec: {
      intent: {
        coreFeatures: [{ id: 'dashboard', summary: 'A dashboard', lane: 'enhancement/new' }],
        personas: ['coach'],
      },
      decisions: decisionKeys.map((key) => ({
        key,
        question: 'q',
        answer: 'a',
        source: 'inferred',
      })),
    },
    questions: [],
    done: true,
  });

  it('names the key to add when a decision does not cover the field', () => {
    const messages = attributionIssues(before, turn(['dashboard']), { nameKey: true }).map(
      (i) => i.message,
    );
    expect(messages).toContain(
      'draftSpec sets intent.coreFeatures without a matching decisions[] entry: add one with key "intent.coreFeatures"',
    );
    expect(messages).toContain(
      'draftSpec sets intent.personas without a matching decisions[] entry: add one with key "intent.personas"',
    );
  });

  it('keeps the greenfield message exactly as it was', () => {
    const messages = attributionIssues(before, turn(['dashboard'])).map((i) => i.message);
    expect(messages).toContain(
      'draftSpec sets intent.coreFeatures without a matching decisions[] entry',
    );
    expect(messages.join('\n')).not.toContain('add one with key');
  });

  it('accepts decisions keyed by the field paths, and not by a path below the field', () => {
    expect(attributionIssues(before, turn(['intent.coreFeatures', 'intent.personas']))).toEqual([]);
    expect(
      attributionIssues(before, turn(['intent.coreFeatures.dashboard', 'intent.personas'])).map(
        (i) => i.path,
      ),
    ).toEqual(['/draftSpec/intent/coreFeatures']);
  });
});

describe('the decision rule in the user prompt (plan 020)', () => {
  const ctx = {
    round: 1,
    narrative: 'A landing page called Dashboard.',
    analysis: null,
    draft: { intent: { coreFeatures: [] } },
    decisions: [],
  };

  it('tells an update run the exact keys', () => {
    const text = buildUserPrompt({ ...ctx, enhance: true });
    expect(text).toContain('keyed by its path: "intent.coreFeatures" whenever you set features');
    expect(text).not.toContain('- Record every value you set in draftSpec.decisions');
  });

  it('leaves the greenfield rule as it was', () => {
    const text = buildUserPrompt(ctx);
    expect(text).toContain(
      '- Record every value you set in draftSpec.decisions with source "inferred" and a one-line question/answer.',
    );
    expect(text).not.toContain('keyed by its path');
  });
});
```

### 7. A fixture that replays the failure, then the fix

Create the folder `packages/core/fixtures/enhance/missing-decision/` with exactly these three files. (This folder is
prettier-ignored; write the JSON exactly as shown.)

7a. `narrative.md` (one line, ending with a newline):

```text
Let kitchen staff export the day's orders as a CSV file from the orders list.
```

7b. `01-DiscoveryTurn.json`. This is the bad reply. The decision key `exportOrders` passes the wire schema's key
pattern but does not cover `intent.coreFeatures` or `intent.personas`, so the attribution gate must send it back:

```json
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 020: decisions keyed by the feature, not the field; the gate must send it back naming intent.coreFeatures",
  "response": {
    "draftSpec": {
      "intent": {
        "coreFeatures": [
          {
            "id": "export-orders",
            "summary": "Export the day's orders as CSV from the existing /orders route",
            "lane": "enhancement/existing"
          }
        ],
        "personas": ["kitchen staff"]
      },
      "decisions": [
        {
          "key": "exportOrders",
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

7c. `02-DiscoveryTurn.json` (the corrected reply):

```json
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 020: the corrected reply keys its decisions by the field paths",
  "response": {
    "draftSpec": {
      "intent": {
        "coreFeatures": [
          {
            "id": "export-orders",
            "summary": "Export the day's orders as CSV from the existing /orders route",
            "lane": "enhancement/existing"
          }
        ],
        "personas": ["kitchen staff"]
      },
      "decisions": [
        {
          "key": "intent.coreFeatures",
          "question": "Which existing behaviour changes",
          "answer": "GET /orders gains a CSV export",
          "source": "inferred"
        },
        {
          "key": "intent.personas",
          "question": "Who uses it",
          "answer": "kitchen staff",
          "source": "inferred"
        }
      ]
    },
    "questions": [],
    "done": true
  }
}
```

### 8. The regression test

File: `packages/core/src/enhance.test.ts`

Do not add any import: `FakeLlmAdapter` is already imported on line 9, and `DefaultsPrompter`, `engineFor`, `seed`,
`start` and `fixtures` already exist in this file.

Insert this test directly before the line
`  it('heals a run whose draft an earlier build corrupted with option slugs', async () => {` (it goes inside the
same `describe` block; work item 9 indents it, so paste it as shown):

```ts
it('names the missing decision key in the retry, so the model can fix it (plan 020)', async () => {
  const h = engineFor('missing-decision');
  const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
  const runId = start(h, dir, ref, { noPublish: true });
  const s = await h.engine.advance(runId, new DefaultsPrompter());
  expect(s.state).toBe('DONE');
  const turns = (h.llm as FakeLlmAdapter).calls.filter((c) => c.schemaName === 'DiscoveryTurn');
  expect(turns).toHaveLength(2);
  expect(turns[0]!.user).toContain('keyed by its path: "intent.coreFeatures"');
  expect(turns[1]!.user).toContain('add one with key "intent.coreFeatures"');
  expect(turns[1]!.user).toContain('add one with key "intent.personas"');
  expect(h.engine.finalSpec(runId)!.intent.personas).toEqual(['kitchen staff']);
});
```

### 9. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write packages/core/src/enhance.test.ts packages/core/src/discovery/questions.test.ts packages/core/src/discovery/merge.ts packages/core/src/discovery/prompt-builder.ts packages/core/src/engine.ts
```

## Touched files and markers

| File                                                                    | Marker                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/core/src/discovery/merge.ts`                                  | `opts: { nameKey?: boolean } = {},`                                               |
| `packages/core/src/engine.ts`                                           | `attributionIssues(before, turn, { nameKey: enhance })`                           |
| `packages/core/src/discovery/prompt-builder.ts`                         | `or by a path below the field (such as intent.coreFeatures.exportOrders)`         |
| `packages/core/prompts/enhance.md`                                      | `keyed by that field's path`                                                      |
| `packages/core/src/enhance.test.ts`                                     | `names the missing decision key in the retry, so the model can fix it (plan 020)` |
| `packages/core/src/discovery/questions.test.ts`                         | `attribution on an update run (plan 020)`                                         |
| `packages/core/fixtures/enhance/missing-decision/01-DiscoveryTurn.json` | `plan 020: decisions keyed by the feature, not the field`                         |
| `packages/core/fixtures/enhance/missing-decision/02-DiscoveryTurn.json` | `plan 020: the corrected reply`                                                   |

## Acceptance commands

```sh
pnpm exec vitest run packages/core/src/discovery packages/core/src/enhance.test.ts packages/core/src/discovery.test.ts
pnpm exec vitest run packages/core apps/web/src apps/cli
git diff --exit-code -- packages/core/fixtures/discovery
git status --porcelain -- packages/core/fixtures/discovery
git diff --name-only -- "*.snap"
pnpm check:quick
```

```text
the update prompt names "intent.coreFeatures" and "intent.personas"; the greenfield prompt line is unchanged
on update runs a decision that does not cover the field is rejected with a message naming the key to add
the greenfield retry message is unchanged, so the recorded live-claude-bookclub fixtures still replay
the missing-decision run makes exactly two discovery calls and ends DONE with personas ["kitchen staff"]
git diff --exit-code on packages/core/fixtures/discovery exits 0, and git status prints nothing for it
git diff --name-only on *.snap prints exactly one line: packages/core/src/__snapshots__/enhance.test.ts.snap
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                      | Why                                                                         | Mechanical check                                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The greenfield prompt line or retry message changes       | `live-claude-bookclub/02` is a recorded retry keyed by the old message text | `keeps the greenfield message exactly as it was` and `leaves the greenfield rule as it was`; `discovery.test.ts` replays the keyed fixtures and fails on any byte |
| The snapshot update hides an unintended prompt change     | `-u` accepts whatever the file now says                                     | `git diff --name-only -- "*.snap"` must print exactly the one enhance snapshot; the version test asserts `1.3.0`                                                  |
| The gate is weakened instead of the prompt fixed          | accepting a non-covering key would make a test pass                         | the regression test needs `toHaveLength(2)` calls and the retry text; `accepts decisions keyed by the field paths, and not by a path below the field`             |
| The bad fixture fails the wire schema instead of the gate | a kebab-case key fails the key pattern, so `extraCheck` never runs          | fixture 01 uses `exportOrders`; the regression test asserts the retry contains `add one with key "intent.coreFeatures"`, which only the attribution gate produces |
| The executor edits recorded discovery fixtures            | keyed fixtures fail loudly when prompt text drifts                          | `git diff --exit-code -- packages/core/fixtures/discovery` exits 0 and `git status --porcelain` on it prints nothing                                              |
| A duplicate import, an unneeded cast, or unformatted code | items 6 and 8 touch imports and add code                                    | `pnpm check:quick` runs prettier, eslint (`no-unnecessary-type-assertion`) and tsc, and exits non-zero on any of them                                             |

## Review rounds

| Round | Finding                                                                                                                                                                                                             | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Root cause: update runs keyed decisions by something other than the field path; the prompt and the retry message never named `intent.coreFeatures` (run `20261006-031254-63n6jg`, park evidence `decision.missing`) | CLOSED |
| 2     | Review: the kebab-case fixture key failed the wire schema before the attribution gate; the key is now `exportOrders`                                                                                                | CLOSED |
| 3     | Review: changing the retry message for every run broke the recorded greenfield retry fixture; the key is named on update runs only (`nameKey`)                                                                      | CLOSED |
| 4     | Review: an unneeded cast (lint), unindented test code, no formatting step, a PATH placeholder, and three human-only guardrails; all fixed and the guardrails made mechanical                                        | CLOSED |
