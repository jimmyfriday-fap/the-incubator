# Plan 021: the owner can correct the plan at review (engine)

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Do not refactor, rename or reformat anything else by
  hand; work item 12 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Copy every string exactly as written, including quotes, backticks and punctuation.
- Do not touch existing files under `packages/core/fixtures/discovery/` or `packages/core/fixtures/enhance/`; only
  create the two new folders named below. Recorded fixtures are keyed by the exact prompt text, so every prompt
  must stay byte-identical when there are no corrections.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** At REVIEW the owner can only approve or hand-edit JSON. This plan lets them send corrections in plain
words: the engine records them (`review.feedback`), drafts the spec again with them, and returns to REVIEW with a
new plan (and so a new plain-English brief, which is cached per spec hash). A field the corrected turn changes wins
over an answer given before the review (journal entry `answers.superseded`). On update runs the draft shown to the
model drops the engine-resolved `targets`, which the model may not set. Plan 022 adds the web route and the box on
the review page.

## Work items

### 1. Two helpers in the merge module

File: `packages/core/src/discovery/merge.ts`

Append this block at the very end of the file:

```ts
/**
 * The draft as the model sees it on an update run: `targets` are resolved by the engine, never set by the model
 * (plan 021). The same object comes back when there is nothing to remove, so prompts stay byte-identical.
 */
export function withoutTargets(draft: Draft): Draft {
  const intent = draft['intent'] as { coreFeatures?: unknown } | undefined;
  const features = intent?.coreFeatures;
  if (
    !Array.isArray(features) ||
    !features.some((f) => typeof f === 'object' && f !== null && 'targets' in f)
  )
    return draft;
  const out = structuredClone(draft);
  const list = (out['intent'] as { coreFeatures: Record<string, unknown>[] }).coreFeatures;
  for (const f of list) delete f['targets'];
  return out;
}

/**
 * The keys of answers a correction turn overrides: an answer whose field the turn changed, or a field below or
 * above it (plan 021). Each key once, in answer order.
 */
export function supersededAnswers(
  before: Draft,
  turn: DiscoveryTurn,
  answers: readonly Answer[],
): string[] {
  const proposed = withoutPackFixed(turn.draftSpec);
  const changed = changedPaths(
    withoutMeta(before),
    deepMerge(withoutMeta(before), withoutMeta(proposed)),
  );
  const keys = answers
    .map((a) => a.key)
    .filter((k) => changed.some((p) => covers(k, p) || covers(p, k)));
  return [...new Set(keys)];
}
```

### 2. Corrections in the user prompt

File: `packages/core/src/discovery/prompt-builder.ts`

2a. In `export interface TurnContext`, replace this exact line:

```ts
  decisions: readonly Decision[];
}
```

with:

```ts
  decisions: readonly Decision[];
  /** The owner's corrections at review, oldest first (plan 021). Absent or empty: the prompt is unchanged. */
  corrections?: readonly string[];
}
```

2b. In `buildUserPrompt`, replace these exact two lines:

```ts
    ctx.narrative.trim() || '(none)',
    '',
```

with:

```ts
    ctx.narrative.trim() || '(none)',
    '',
    ...(ctx.corrections?.length
      ? ["## Owner's corrections at review", ...ctx.corrections.map((c) => `- ${c}`), '']
      : []),
```

2c. In `buildUserPrompt`, replace this exact line:

```ts
    '- Answers the user already gave are final; do not ask about them again.',
```

with:

```ts
    '- Answers the user already gave are final; do not ask about them again.',
    ...(ctx.corrections?.length
      ? [
          '- Apply every correction from the owner; it overrides earlier answers and decisions. Record each field you change in draftSpec.decisions as usual.',
        ]
      : []),
```

### 3. Corrections in the review-summary prompt

File: `packages/core/src/review-summary.ts`

3a. In `export interface ReviewSummaryInput`, replace this exact line:

```ts
  digest: string | null;
}
```

with:

```ts
  digest: string | null;
  /** The owner's corrections at review, oldest first (plan 021); printed only when there are some. */
  corrections?: readonly string[];
}
```

3b. In `reviewSummaryUserPrompt`, replace these exact three lines:

```ts
    "## The owner's request",
    sanitizeRequest(i.request, 2000) || '(none)',
    '',
```

with:

```ts
    "## The owner's request",
    sanitizeRequest(i.request, 2000) || '(none)',
    '',
    ...(i.corrections?.length
      ? [
          "## The owner's corrections at review",
          ...i.corrections.map((c) => `- ${sanitizeRequest(c, 2000)}`),
          '',
        ]
      : []),
```

### 4. Engine imports

File: `packages/core/src/engine.ts`

Replace this exact block:

```ts
import {
  attributionIssues,
  mergeTurn,
  otherIssues,
  type AskedInfo,
  type Draft,
} from './discovery/merge.js';
```

with:

```ts
import {
  attributionIssues,
  mergeTurn,
  otherIssues,
  supersededAnswers,
  withoutTargets,
  type AskedInfo,
  type Draft,
} from './discovery/merge.js';
```

### 5. `requestChanges` and `reviewFeedback`

File: `packages/core/src/engine.ts`

Insert this block directly before the line `  /** REVIEW → APPROVED, optionally with a user-edited spec (revalidated). */`:

```ts
  /**
   * The owner's corrections at REVIEW (plan 021): recorded, then the run drafts the spec again with them and
   * comes back to REVIEW with a new plan and a new brief. Only for runs that plan through discovery.
   */
  requestChanges(runId: string, text: string): void {
    const s = this.state(runId);
    if (s.input.kind !== 'new' && s.input.kind !== 'enhance')
      throw new PolicyError(`run ${runId} has no plan to revise`, { code: 'no_discovery' });
    if (s.state !== 'REVIEW' && !(s.state === 'PARKED' && s.parked?.state === 'REVIEW'))
      throw new PolicyError(`run ${runId} is not at review`, { code: 'not_at_review' });
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working`, { code: 'working' });
    const clean = sanitizeRequest(text, 2000);
    if (!clean) throw new PolicyError('describe what to change', { code: 'empty_feedback' });
    this.record(runId, 'review.feedback', { text: clean, rev: s.rev });
    this.enter(runId, 'DRAFT_SPEC', MAX_ROUNDS);
  }

  /** The owner's corrections at review, oldest first (plan 021). */
  private reviewFeedback(runId: string): string[] {
    return this.entries(runId)
      .filter((e) => e.type === 'review.feedback' && typeof e['text'] === 'string')
      .map((e) => e['text'] as string);
  }

```

### 6. The draft step uses the corrections

File: `packages/core/src/engine.ts`, method `private async draftStep(runId: string, s: RunState)`.

6a. Replace this exact block (it is indented by four spaces in the file, as shown):

```text
    const baseline = enhance ? this.enhanceBaseline(runId) : [];
    const user = buildUserPrompt({
      round: s.round,
      narrative,
      ...(enhance ? { narrativeHeading: 'Change request', enhance: true } : {}),
      analysis: enhance ? scanDigest(this.readScan(runId)) : null,
      draft: before,
      decisions: before.decisions ?? [],
    });
```

with:

```text
    const baseline = enhance ? this.enhanceBaseline(runId) : [];
    const corrections = this.reviewFeedback(runId);
    const user = buildUserPrompt({
      round: s.round,
      narrative,
      ...(enhance ? { narrativeHeading: 'Change request', enhance: true } : {}),
      analysis: enhance ? scanDigest(this.readScan(runId)) : null,
      draft: enhance ? withoutTargets(before) : before,
      decisions: before.decisions ?? [],
      ...(corrections.length ? { corrections } : {}),
    });
```

6b. In the same method, replace this exact block (the only `const { answers, questions } = this.answers(runId);`
in `draftStep`; it comes right after the `this.record(runId, 'llm.turn', {` block that ends with
`done: turn.done,` and `});`):

```text
    const { answers, questions } = this.answers(runId);
    const merged = mergeTurn({
      before,
```

with:

```text
    let base = before;
    if (corrections.length) {
      // why: after the owner's corrections, a field this turn changed wins over an answer given before
      // review, and that answer no longer stands as the owner's decision.
      const keys = supersededAnswers(before, turn, this.answers(runId).answers);
      if (keys.length) {
        this.record(runId, 'answers.superseded', { keys });
        base = {
          ...before,
          decisions: (before.decisions ?? []).filter((d) => !keys.includes(d.key)),
        };
      }
    }
    const { answers, questions } = this.answers(runId);
    const merged = mergeTurn({
      before: base,
```

### 7. Superseded answers no longer apply

File: `packages/core/src/engine.ts`, method `private answers(runId: string)`.

Replace this exact line (indented by six spaces in the file):

```text
      if (e.type === 'answers') answers.push(...(e['answers'] as Answer[]));
```

with:

```text
      if (e.type === 'answers') answers.push(...(e['answers'] as Answer[]));
      if (e.type === 'answers.superseded') {
        // why: a field the owner corrected at review no longer takes the answer given before it (plan 021).
        const gone = new Set(e['keys'] as string[]);
        answers.splice(0, answers.length, ...answers.filter((a) => !gone.has(a.key)));
      }
```

### 8. The review summary reads the corrections

File: `packages/core/src/engine.ts`, method `private async writeReviewSummary(`.

Replace this exact line:

```ts
          digest: enhance ? scanDigest(this.readScan(runId)) : null,
        }),
```

with:

```ts
          digest: enhance ? scanDigest(this.readScan(runId)) : null,
          corrections: this.reviewFeedback(runId),
        }),
```

### 9. Fixtures

9a. Create `packages/core/fixtures/discovery/review-changes/narrative.md` with exactly one line (ending in a
newline):

```text
semver-lite: a tiny zero-dependency TypeScript library that parses, compares and sorts semantic versions, published to npm.
```

9b. Create `packages/core/fixtures/discovery/review-changes/01-DiscoveryTurn.json`:

```json
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 021: round 1 drafts the library and asks for the description",
  "response": {
    "draftSpec": {
      "project": { "name": "semver-lite", "slug": "semver-lite" },
      "intent": {
        "personas": ["library consumer"],
        "coreFeatures": [
          { "id": "parse", "summary": "Parse version strings", "lane": "enhancement/new" },
          { "id": "compare", "summary": "Compare and sort versions", "lane": "enhancement/new" }
        ]
      },
      "platform": "library",
      "stack": {
        "pack": "node-lib",
        "framework": "typescript-lib",
        "database": "none",
        "auth": "none",
        "packageManager": "pnpm"
      },
      "deploy": { "target": "package-release" },
      "testing": { "e2e": "none" },
      "decisions": [
        { "key": "project", "question": "Name", "answer": "semver-lite", "source": "inferred" },
        {
          "key": "intent",
          "question": "Features",
          "answer": "parse, compare",
          "source": "inferred"
        },
        { "key": "platform", "question": "Type", "answer": "library", "source": "inferred" },
        {
          "key": "stack",
          "question": "Stack",
          "answer": "node-lib, no database",
          "source": "inferred"
        },
        {
          "key": "deploy.target",
          "question": "Deploy",
          "answer": "npm via package-release",
          "source": "inferred"
        },
        {
          "key": "testing.e2e",
          "question": "E2E",
          "answer": "none for a library",
          "source": "inferred"
        }
      ]
    },
    "questions": [
      {
        "key": "project.description",
        "question": "How should the package describe itself?",
        "impact": 3,
        "options": [
          {
            "value": "parse-compare-sort",
            "label": "Parse, compare and sort",
            "recommended": true
          },
          { "value": "versions-only", "label": "Versions only", "recommended": false }
        ]
      }
    ],
    "done": false
  }
}
```

9c. Create `packages/core/fixtures/discovery/review-changes/02-DiscoveryTurn.json`:

```json
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 021: round 2 has nothing left to ask",
  "response": { "draftSpec": { "decisions": [] }, "questions": [], "done": true }
}
```

9d. Create `packages/core/fixtures/discovery/review-changes/03-DiscoveryTurn.json`:

```json
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 021: the turn after the owner's corrections at review",
  "response": {
    "draftSpec": {
      "project": { "description": "Tiny semver helpers." },
      "intent": {
        "coreFeatures": [
          { "id": "parse", "summary": "Parse version strings", "lane": "enhancement/new" },
          { "id": "compare", "summary": "Compare and sort versions", "lane": "enhancement/new" },
          {
            "id": "bump",
            "summary": "Bump a version by major, minor or patch",
            "lane": "enhancement/new"
          }
        ]
      },
      "decisions": [
        {
          "key": "project",
          "question": "Description",
          "answer": "Tiny semver helpers.",
          "source": "inferred"
        },
        {
          "key": "intent.coreFeatures",
          "question": "Features",
          "answer": "parse, compare, bump",
          "source": "inferred"
        }
      ]
    },
    "questions": [],
    "done": true
  }
}
```

9e. Create `packages/core/fixtures/enhance/review-changes/narrative.md` with exactly one line:

```text
Let kitchen staff export the day's orders as a CSV file from the orders list.
```

9f. Create `packages/core/fixtures/enhance/review-changes/01-DiscoveryTurn.json`:

```json
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 021: the update plan before the owner's corrections",
  "response": {
    "draftSpec": {
      "intent": {
        "coreFeatures": [
          {
            "id": "export-orders",
            "summary": "Export the day's orders as CSV from the existing /orders route",
            "lane": "enhancement/existing"
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

9g. Create `packages/core/fixtures/enhance/review-changes/02-DiscoveryTurn.json`:

```json
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 021: the update plan after the owner asked for a date filter",
  "response": {
    "draftSpec": {
      "intent": {
        "coreFeatures": [
          {
            "id": "export-orders",
            "summary": "Export the day's orders as CSV from the existing /orders route",
            "lane": "enhancement/existing"
          },
          {
            "id": "export-filter",
            "summary": "Filter the CSV export of orders by date on the existing /orders route",
            "lane": "enhancement/existing"
          }
        ]
      },
      "decisions": [
        {
          "key": "intent.coreFeatures",
          "question": "Which existing behaviour changes",
          "answer": "GET /orders gains a CSV export with a date filter",
          "source": "inferred"
        }
      ]
    },
    "questions": [],
    "done": true
  }
}
```

9h. Create `packages/core/fixtures/enhance/review-changes/03-ReviewSummary.json`:

```json
{
  "schemaName": "ReviewSummary",
  "note": "plan 021: the brief for the corrected plan",
  "response": {
    "headline": "Kitchen staff will be able to export the day's orders as CSV, filtered by date.",
    "changes": ["Add a CSV export with a date filter to the orders list."],
    "approach": "A coding assistant makes the edits in a working copy of your repository. Nothing in your repository changes until you approve.",
    "notIncluded": [],
    "watchFor": []
  }
}
```

### 10. Engine tests

10a. File: `packages/core/src/discovery.test.ts`. Insert these two tests directly before the line
`  it('repairs a torn journal line and resumes', async () => {` (they are inside the same `describe`; work item 12
indents them):

```ts
it('revises the plan from the corrections at review, and a corrected field beats an earlier answer (plan 021)', async () => {
  const h = fakeEngine({ dir: discoveryFixtureDir('review-changes') });
  const runId = h.engine.start({
    kind: 'new',
    narrative: narrative('review-changes'),
    specOnly: true,
    surface: 'test',
  });
  const waiting = new ScriptedPrompter({}, { approve: false, reason: 'owner is reading' });
  const first = await h.engine.advance(runId, waiting);
  expect(first.parked).toMatchObject({ state: 'REVIEW', reason: 'review_rejected' });
  expect(h.engine.finalSpec(runId)!.project.description).toBe('parse-compare-sort');
  expect(() => h.engine.requestChanges(runId, '   ')).toThrow(
    expect.objectContaining({ code: 'empty_feedback' }),
  );
  h.engine.requestChanges(
    runId,
    'Describe it as: Tiny semver helpers. Also add a feature to bump versions.',
  );
  const second = await h.engine.advance(runId, waiting);
  expect(second.parked).toMatchObject({ state: 'REVIEW' });
  expect(second.rev).toBeGreaterThan(first.rev);
  const spec = h.engine.finalSpec(runId)!;
  expect(spec.project.description).toBe('Tiny semver helpers.');
  // The answer given before review no longer stands as the owner's decision.
  expect(spec.decisions.filter((d) => d.key === 'project.description')).toEqual([]);
  expect(spec.intent.coreFeatures.map((f) => f.id)).toEqual(['parse', 'compare', 'bump']);
  const turns = (h.adapter as FakeLlmAdapter).calls.filter((c) => c.schemaName === 'DiscoveryTurn');
  expect(turns).toHaveLength(3);
  expect(turns[0]!.user).not.toContain("Owner's corrections");
  expect(turns[2]!.user).toContain(
    "## Owner's corrections at review\n- Describe it as: Tiny semver helpers. Also add a feature to bump versions.",
  );
  expect(turns[2]!.user).toContain(
    '- Apply every correction from the owner; it overrides earlier answers and decisions.',
  );
  expect(h.engine.entries(runId).filter((e) => e.type === 'answers.superseded')).toEqual([
    expect.objectContaining({ keys: ['project.description'] }),
  ]);
});

it('takes corrections only at review, and only on runs that plan through discovery (plan 021)', () => {
  const h = fakeEngine({ dir: discoveryFixtureDir('review-changes') });
  const runId = h.engine.start({
    kind: 'new',
    narrative: narrative('review-changes'),
    specOnly: true,
    surface: 'test',
  });
  expect(() => h.engine.requestChanges(runId, 'x')).toThrow(
    expect.objectContaining({ code: 'not_at_review' }),
  );
  const adopt = h.engine.start({
    kind: 'adopt',
    repo: 'https://github.com/octo/x',
    surface: 'test',
  });
  expect(() => h.engine.requestChanges(adopt, 'x')).toThrow(
    expect.objectContaining({ code: 'no_discovery' }),
  );
});
```

10b. File: `packages/core/src/enhance.test.ts`. Insert this test directly before the line
`  it('heals a run whose draft an earlier build corrupted with option slugs', async () => {`:

```ts
it('revises an update plan from corrections at review and resolves the targets again (plan 021)', async () => {
  const h = engineFor('review-changes');
  const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
  const runId = start(h, dir, ref, { noPublish: true });
  const waiting = new ScriptedPrompter({}, { approve: false, reason: 'owner is reading' });
  expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
  expect(h.engine.finalSpec(runId)!.intent.coreFeatures[0]!.targets).toEqual(['src/server.js']);
  h.engine.requestChanges(runId, 'Also let kitchen staff filter the export by date.');
  expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
  const features = h.engine.finalSpec(runId)!.intent.coreFeatures;
  expect(features.map((f) => f.id)).toEqual(['export-orders', 'export-filter']);
  expect(features.every((f) => Array.isArray(f.targets))).toBe(true);
  const turns = (h.llm as FakeLlmAdapter).calls.filter((c) => c.schemaName === 'DiscoveryTurn');
  expect(turns).toHaveLength(2);
  expect(turns[1]!.user).toContain("## Owner's corrections at review");
  expect(turns[1]!.user).not.toContain('"targets"');
  // The plain-English brief for the corrected plan is told about the corrections.
  let brief = h.engine.reviewSummary(runId);
  for (let i = 0; i < 100 && brief.status === 'pending'; i++) {
    await new Promise((r) => setTimeout(r, 20));
    brief = h.engine.reviewSummary(runId);
  }
  expect(brief.status).toBe('ready');
  const briefs = (h.llm as FakeLlmAdapter).calls.filter((c) => c.schemaName === 'ReviewSummary');
  expect(briefs).toHaveLength(1);
  expect(briefs[0]!.user).toContain(
    "## The owner's corrections at review\n- Also let kitchen staff filter the export by date.",
  );
});
```

### 11. Prompt tests

11a. File: `packages/core/src/discovery/questions.test.ts`. Append this block at the very end of the file, after one
empty line:

```ts
describe('the owner corrections in the user prompt (plan 021)', () => {
  const ctx = {
    round: 2,
    narrative: 'A landing page called Dashboard.',
    analysis: null,
    draft: { intent: { coreFeatures: [] } },
    decisions: [],
  };

  it('prints the corrections and the rule only when there are some', () => {
    const text = buildUserPrompt({ ...ctx, corrections: ['Add a calendar.', 'No exports.'] });
    expect(text).toContain("## Owner's corrections at review\n- Add a calendar.\n- No exports.\n");
    expect(text).toContain(
      '- Apply every correction from the owner; it overrides earlier answers and decisions.',
    );
    expect(buildUserPrompt({ ...ctx, corrections: [] })).toBe(buildUserPrompt(ctx));
    expect(buildUserPrompt(ctx)).not.toContain('corrections');
  });
});
```

11b. Create `packages/core/src/review-summary.test.ts` with exactly:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeSpec } from '@incubator/spec';
import { reviewSummaryUserPrompt } from './review-summary.js';

const spec = completeSpec(
  JSON.parse(
    readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../templates/fixtures/combos/node-lib.in-repo.package-release.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>,
).spec;
const input = { kind: 'new', request: 'A small library.', spec, detected: null, digest: null };

describe('the review-summary prompt (plan 021)', () => {
  it('names the owner corrections only when there are some', () => {
    const text = reviewSummaryUserPrompt({ ...input, corrections: ['Add a bump feature.'] });
    expect(text).toContain("## The owner's corrections at review\n- Add a bump feature.\n");
    expect(reviewSummaryUserPrompt({ ...input, corrections: [] })).toBe(
      reviewSummaryUserPrompt(input),
    );
    expect(reviewSummaryUserPrompt(input)).not.toContain('corrections');
  });
});
```

11c. File: `packages/core/src/discovery/questions.test.ts`.

First replace this exact line:

```text
import { applyAnswers, attributionIssues, type AskedInfo, type Draft } from './merge.js';
```

with:

```text
import {
  applyAnswers,
  attributionIssues,
  withoutTargets,
  type AskedInfo,
  type Draft,
} from './merge.js';
```

Then append this block at the very end of the file, after one empty line:

```ts
describe('withoutTargets (plan 021)', () => {
  it('returns the same draft when no feature has targets, and a copy without them otherwise', () => {
    const plain: Draft = {
      intent: { coreFeatures: [{ id: 'a', summary: 'A', lane: 'enhancement/new' }] },
    };
    expect(withoutTargets(plain)).toBe(plain);
    const targeted: Draft = {
      intent: {
        coreFeatures: [{ id: 'a', summary: 'A', lane: 'enhancement/new', targets: ['src/a.ts'] }],
      },
    };
    expect(JSON.stringify(withoutTargets(targeted))).not.toContain('targets');
    expect(JSON.stringify(targeted)).toContain('src/a.ts');
  });
});
```

### 12. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write packages/core/src/discovery/merge.ts packages/core/src/discovery/prompt-builder.ts packages/core/src/review-summary.ts packages/core/src/review-summary.test.ts packages/core/src/engine.ts packages/core/src/discovery.test.ts packages/core/src/enhance.test.ts packages/core/src/discovery/questions.test.ts
```

## Touched files and markers

| File                                                                    | Marker                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/core/src/discovery/merge.ts`                                  | `export function supersededAnswers(`                                |
| `packages/core/src/discovery/prompt-builder.ts`                         | `## Owner's corrections at review`                                  |
| `packages/core/src/review-summary.ts`                                   | `## The owner's corrections at review`                              |
| `packages/core/src/engine.ts`                                           | `requestChanges(runId: string, text: string): void {`               |
| `packages/core/src/discovery.test.ts`                                   | `a corrected field beats an earlier answer (plan 021)`              |
| `packages/core/src/enhance.test.ts`                                     | `resolves the targets again (plan 021)`                             |
| `packages/core/src/discovery/questions.test.ts`                         | `the owner corrections in the user prompt (plan 021)`               |
| `packages/core/src/review-summary.test.ts`                              | `the review-summary prompt (plan 021)`                              |
| `packages/core/fixtures/discovery/review-changes/03-DiscoveryTurn.json` | `plan 021: the turn after the owner's corrections at review`        |
| `packages/core/fixtures/enhance/review-changes/02-DiscoveryTurn.json`   | `plan 021: the update plan after the owner asked for a date filter` |
| `packages/core/fixtures/enhance/review-changes/03-ReviewSummary.json`   | `plan 021: the brief for the corrected plan`                        |

## Acceptance commands

```sh
pnpm exec vitest run packages/core/src/discovery packages/core/src/discovery.test.ts packages/core/src/enhance.test.ts packages/core/src/review-summary.test.ts
pnpm exec vitest run --project unit packages/core
git diff --exit-code -- packages/core/fixtures
git status --porcelain -- packages/core/fixtures
git status --porcelain -- "*.snap"
git diff -U0 -- "*.test.ts" | Select-String '^-[^-]'
pnpm check:quick
```

```text
a correction at review drafts the spec again and returns to REVIEW with a higher rev and the corrected values
the corrected field beats the answer given before review, recorded as answers.superseded
the update-run draft shown to the model has no "targets"; finalize resolves them again
corrections are refused away from REVIEW (not_at_review), on adopt runs (no_discovery) and when empty
without corrections every prompt is byte-identical: the recorded keyed fixtures still replay
the brief for the corrected plan is generated with the corrections in its prompt
git diff --exit-code on packages/core/fixtures exits 0 (only new, untracked folders were added)
git status --porcelain on packages/core/fixtures prints exactly two lines:
  ?? packages/core/fixtures/discovery/review-changes/
  ?? packages/core/fixtures/enhance/review-changes/
git status --porcelain on "*.snap" prints nothing
the "*.test.ts" removed-lines check prints exactly one line, the import that work item 11c replaces:
  -import { applyAnswers, attributionIssues, type AskedInfo, type Draft } from './merge.js';
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                  | Why                                                  | Mechanical check                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A prompt changes when there are no corrections        | recorded fixtures are keyed by the exact prompt text | `toBe(buildUserPrompt(ctx))` and `toBe(reviewSummaryUserPrompt(input))` with `corrections: []`; the keyed `live-claude-bookclub` replay in `discovery.test.ts`                                                                                                                                                        |
| The answer given before review still wins             | `mergeTurn` applies every answer last                | the test asserts `description` is `Tiny semver helpers.`, one `answers.superseded` entry, and no remaining `project.description` decision (the fixture records the change under the parent key `project`)                                                                                                             |
| The model is shown `targets` and the turn is rejected | `featureIssues` forbids model-set targets            | the enhance test asserts the second prompt has no `"targets"` and the run reaches REVIEW again                                                                                                                                                                                                                        |
| `withoutTargets` changes a draft that has no targets  | that would change every normal update prompt         | the `withoutTargets (plan 021)` test asserts `toBe(plain)`                                                                                                                                                                                                                                                            |
| The brief ignores the corrections                     | item 8 is one line that is easy to miss              | the enhance test asserts the ReviewSummary prompt contains the corrections section                                                                                                                                                                                                                                    |
| An existing fixture, snapshot or test is edited       | a literal executor may "fix" red tests that way      | `git diff --exit-code -- packages/core/fixtures` exits 0; `git status --porcelain -- packages/core/fixtures` prints only the two new folders and `git status --porcelain -- "*.snap"` prints nothing; the removed-lines check on `*.test.ts` prints only the old `./merge.js` import line that work item 11c replaces |
| Corrections reach a run with no discovery             | adopt runs never draft                               | the refusal test asserts `no_discovery` for an adopt run                                                                                                                                                                                                                                                              |

## Review rounds

| Round | Finding                                                                                                                                                                         | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | No way to send corrections at review: a rejection only parked the run, and the only fix was editing JSON by hand (owner, run `20261006-031254-63n6jg`)                          | CLOSED |
| 2     | Review: the multi-line replace blocks lost their indentation and could not match; they are now `text` blocks with the file's indentation                                        | CLOSED |
| 3     | Review: a correction recorded under a parent key left the owner's earlier decision in place; superseded decisions are now removed, and the fixture uses `project`               | CLOSED |
| 4     | Review: the review-summary change and the "same object" promise of `withoutTargets` were untested; both now have tests, and the guardrails are mechanical                       | CLOSED |
| 5     | Second review: the combined fixtures and snapshot status check, and the "no removed test lines" check, could not pass on a correct run; both now state the real expected output | CLOSED |
