# Plan 026: after a refresh, ask the earlier questions again with the earlier answers chosen

## Executor preamble

You are implementing an exact engine change. Rules for every work item:

- Change only the files named here, at the places named. Work item 6 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not touch anything under `apps/`. Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or
  weaken any test, and do not add an eslint-disable comment.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** Plan 025 made a refresh of an update run read the repository again and ask the owner to confirm their
change request. The answers the owner gave to earlier questions stopped counting at the refresh (`answers()`
skips entries before it). They must not simply vanish: the owner confirms or changes them.

So, once the request is confirmed after a refresh, the run asks the earlier questions again before the model
drafts. Each question keeps its exact options, with the owner's earlier answer marked `recommended`, so the form
pre-selects it. This is round 0, which no model call produces. The answers are then the owner's decisions, and
the model drafts round 1 against the new scan.

The run state gains `carriedQuestions` (true while those questions wait), so plan 027 can tell the owner why they
are being asked again.

## Work items

### 1. Run state: `carriedQuestions`

File `packages/core/src/state.ts`.

Find:

```text
  pendingQuestions: AskedQuestion[] | null;
  parked: { state: RunStateName; reason: string; message: string; evidence?: unknown } | null;
```

Replace with:

```text
  pendingQuestions: AskedQuestion[] | null;
  /** The pending questions were answered before a refresh and are asked again to confirm (plan 026). */
  carriedQuestions: boolean;
  parked: { state: RunStateName; reason: string; message: string; evidence?: unknown } | null;
```

Find:

```text
    rev: 0,
    pendingQuestions: null,
    parked: null,
```

Replace with:

```text
    rev: 0,
    pendingQuestions: null,
    carriedQuestions: false,
    parked: null,
```

Find:

```text
      case 'questions':
        s = { ...s, pendingQuestions: e['questions'] as AskedQuestion[] };
        break;
      case 'answers':
        s = { ...s, pendingQuestions: null };
        break;
```

Replace with:

```text
      case 'questions':
        s = {
          ...s,
          pendingQuestions: e['questions'] as AskedQuestion[],
          carriedQuestions: e['carried'] === true,
        };
        break;
      case 'answers':
        s = { ...s, pendingQuestions: null, carriedQuestions: false };
        break;
```

Find:

```text
          pendingQuestions: null,
          approvedHash: null,
        };
        break;
      default:
        break;
```

Replace with:

```text
          pendingQuestions: null,
          carriedQuestions: false,
          approvedHash: null,
        };
        break;
      default:
        break;
```

### 2. Engine: the earlier questions, with the earlier answers chosen

File `packages/core/src/engine.ts`.

Find:

```text
  /** The text `intent.narrative` carries: the owner's change request on an update run, else the idea. */
```

Replace with:

```text
  /**
   * After a refresh (plan 026): every question the owner answered before it, in the order first asked, with
   * its exact options and the earlier answer marked recommended. Answers given before a correction at review
   * are not carried: the correction travels in the confirmed request and may override any of them (request.*
   * keys are never superseded field by field).
   */
  private carriedQuestions(runId: string): AskedQuestion[] {
    const cut = this.since(runId);
    const asked = new Map<string, AskedQuestion>();
    const answered = new Map<string, string>();
    for (const e of this.entries(runId)) {
      if (e.seq >= cut) break;
      if (e.type === 'questions')
        for (const q of e['questions'] as AskedQuestion[]) asked.set(q.key, q);
      if (e.type === 'answers')
        for (const a of e['answers'] as Answer[]) answered.set(a.key, a.value);
      if (e.type === 'answers.superseded')
        for (const key of e['keys'] as string[]) answered.delete(key);
      // why: a correction at review may override any earlier answer; it travels in the confirmed request.
      if (e.type === 'review.feedback') answered.clear();
    }
    const out: AskedQuestion[] = [];
    for (const [key, q] of asked) {
      const value = answered.get(key);
      if (value === undefined || !q.options.some((o) => o.value === value)) continue;
      out.push({ ...q, options: q.options.map((o) => ({ ...o, recommended: o.value === value })) });
    }
    return out;
  }

  /** The text `intent.narrative` carries: the owner's change request on an update run, else the idea. */
```

### 3. Engine: the request step asks the earlier questions again before the draft

File `packages/core/src/engine.ts`.

Find:

```text
        'describe what you want to change (incubator enhance --prompt, or the "What do you want to change?" step)',
      );
    }
    this.enter(runId, 'DRAFT_SPEC', 1);
  }
```

Replace with:

```text
        'describe what you want to change (incubator enhance --prompt, or the "What do you want to change?" step)',
      );
    }
    const cut = this.since(runId);
    // why: after a refresh (plan 026) the owner confirms or changes their earlier answers before the draft.
    if (cut > 0 && !this.entries(runId).some((e) => e.type === 'questions' && e.seq > cut)) {
      const carried = this.carriedQuestions(runId);
      if (carried.length) {
        this.record(runId, 'questions', { round: 0, carried: true, questions: carried });
        this.enter(runId, 'CLARIFY', 0);
        return;
      }
    }
    this.enter(runId, 'DRAFT_SPEC', 1);
  }
```

### 4. Fixtures for the test

Run exactly (PowerShell, from the repository root):

```powershell
New-Item -ItemType Directory -Force packages/core/fixtures/enhance/refresh-questions | Out-Null
Copy-Item packages/core/fixtures/enhance/dashboard-questions/02-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-questions/01-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/dashboard-questions/03-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-questions/02-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/dashboard-questions/03-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-questions/03-DiscoveryTurn.json
New-Item -ItemType Directory -Force packages/core/fixtures/enhance/refresh-corrected | Out-Null
Copy-Item packages/core/fixtures/enhance/dashboard-questions/02-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-corrected/01-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/dashboard-questions/03-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-corrected/02-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/dashboard-questions/03-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-corrected/03-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/dashboard-questions/03-DiscoveryTurn.json packages/core/fixtures/enhance/refresh-corrected/04-DiscoveryTurn.json
```

`refresh-questions` answers, in order:

1. the first draft, which asks two questions;
2. the draft after the answers;
3. the draft after the refresh, once the owner has confirmed the answers.

`refresh-corrected` answers the same first two drafts, then the draft after a correction at review, then the draft
after the refresh.

No analysis-summary fixture is needed: that call is advisory and the run only warns when it fails.

### 5. Test: the earlier questions come back with the earlier answers chosen

File `packages/core/src/enhance.test.ts`.

Find:

```text
  it('heals a run whose draft an earlier build corrupted with option slugs', async () => {
```

Replace with:

```text
  it('after a refresh, asks the earlier questions again with the earlier answers chosen (plan 026)', async () => {
    const h = engineFor('refresh-questions');
    const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, dir, ref, { noPublish: true });
    const reading = { approve: false, reason: 'owner is reading' } as const;
    // The owner picks the answer that was not recommended for one of the two questions.
    const first = new ScriptedPrompter({ 'request.dashboardExtras': 'nothing' }, reading);
    expect((await h.engine.advance(runId, first)).parked).toMatchObject({ state: 'REVIEW' });
    // The repository gets a new commit; the owner refreshes and confirms the request.
    writeFileSync(path.join(dir, 'later.txt'), 'later\n');
    await git(['add', '-A'], dir);
    await git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'later'], dir);
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: true, commits: 1 });
    await h.engine.refreshRepo(runId);
    const waiting = new NonInteractivePrompter();
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({
      state: 'REQUEST',
      reason: 'needs_request',
    });
    h.engine.submitRequest(runId, h.engine.previousRequest(runId)!);
    // Before any model call, the earlier questions come back with the earlier answers chosen.
    const confirm = await h.engine.resume(runId, waiting);
    expect(confirm.parked).toMatchObject({ state: 'CLARIFY', reason: 'needs_input' });
    expect(confirm.round).toBe(0);
    expect(confirm.carriedQuestions).toBe(true);
    const llm = h.llm as FakeLlmAdapter;
    expect(llm.calls.filter((c) => c.schemaName === 'DiscoveryTurn')).toHaveLength(2);
    const q = confirm.pendingQuestions!;
    expect(q.map((x) => x.key)).toEqual(['request.dashboardRecords', 'request.dashboardExtras']);
    expect(q.map((x) => x.options.filter((o) => o.recommended).map((o) => o.value))).toEqual([
      ['events-and-meets'],
      ['nothing'],
    ]);
    // The owner keeps one answer and changes the other; the model then drafts with them as decisions.
    const second = new ScriptedPrompter({ 'request.dashboardRecords': 'events-only' }, reading);
    const done = await h.engine.resume(runId, second);
    expect(done.parked).toMatchObject({ state: 'REVIEW' });
    expect(done.carriedQuestions).toBe(false);
    expect(h.engine.entries(runId).findLast((e) => e.type === 'answers')).toMatchObject({
      round: 0,
      answers: [
        { key: 'request.dashboardRecords', value: 'events-only', source: 'user' },
        { key: 'request.dashboardExtras', value: 'nothing', source: 'user' },
      ],
    });
    expect(llm.calls.filter((c) => c.schemaName === 'DiscoveryTurn')).toHaveLength(3);
    const redraft = llm.calls.filter((c) => c.schemaName === 'DiscoveryTurn')[2]!.user;
    expect(redraft).toContain('# Discovery round 1 of 2');
    expect(redraft).toContain(
      '- request.dashboardRecords: "Which records should the Dashboard work on?" -> Events only (user)',
    );
    expect(llm.remaining).toBe(0);
    const answered = h.engine
      .finalSpec(runId)!
      .decisions.filter((d) => d.key.startsWith('request.'));
    expect(answered.map((d) => d.answer).sort()).toEqual(['Events only', 'Only the three actions']);
  });

  it('after a refresh, does not bring back answers given before a correction at review (plan 026)', async () => {
    const h = engineFor('refresh-corrected');
    const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    const runId = start(h, dir, ref, { noPublish: true });
    const reading = { approve: false, reason: 'owner is reading' } as const;
    const first = new ScriptedPrompter({ 'request.dashboardExtras': 'nothing' }, reading);
    expect((await h.engine.advance(runId, first)).parked).toMatchObject({ state: 'REVIEW' });
    // The correction contradicts the earlier answer; it is a request.* key, so nothing supersedes it.
    h.engine.requestChanges(runId, 'Show upcoming events on the Dashboard after all.');
    expect((await h.engine.advance(runId, first)).parked).toMatchObject({ state: 'REVIEW' });
    writeFileSync(path.join(dir, 'later.txt'), 'later\n');
    await git(['add', '-A'], dir);
    await git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'later'], dir);
    await h.engine.refreshRepo(runId);
    const waiting = new NonInteractivePrompter();
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ reason: 'needs_request' });
    h.engine.submitRequest(runId, h.engine.previousRequest(runId)!);
    const s = await h.engine.resume(runId, waiting);
    // No carried round: the correction travels in the confirmed request, and no earlier answer is re-asserted.
    expect(s.parked).toMatchObject({ state: 'REVIEW', reason: 'needs_review' });
    expect(
      h.engine.entries(runId).filter((e) => e.type === 'questions' && e['carried'] === true),
    ).toEqual([]);
    const redraft = (h.llm as FakeLlmAdapter).calls.filter((c) => c.schemaName === 'DiscoveryTurn')[3]!
      .user;
    expect(redraft).toContain('Show upcoming events on the Dashboard after all.');
    expect(redraft).not.toContain('Only the three actions');
  });

  it('heals a run whose draft an earlier build corrupted with option slugs', async () => {
```

### 6. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write packages/core/src/state.ts packages/core/src/engine.ts packages/core/src/enhance.test.ts packages/core/fixtures/enhance/refresh-questions packages/core/fixtures/enhance/refresh-corrected
```

## Touched files and markers

| File                                                                     | Marker                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `packages/core/src/state.ts`                                             | `carriedQuestions: e['carried'] === true,`                                                     |
| `packages/core/src/engine.ts`                                            | `private carriedQuestions(runId: string): AskedQuestion[] {`                                   |
| `packages/core/fixtures/enhance/refresh-questions/03-DiscoveryTurn.json` | `round 2: the model folds the answers into the feature list itself`                            |
| `packages/core/fixtures/enhance/refresh-corrected/04-DiscoveryTurn.json` | `round 2: the model folds the answers into the feature list itself`                            |
| `packages/core/src/enhance.test.ts`                                      | `after a refresh, asks the earlier questions again with the earlier answers chosen (plan 026)` |

## Acceptance commands

```sh
pnpm exec vitest run --project unit packages/core/src/enhance.test.ts packages/core/src/folder-runs.test.ts packages/core/src/discovery.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "this.record(runId, 'questions', { round: 0, carried: true, questions: carried });").Count
(Select-String -SimpleMatch -Path packages/core/src/state.ts 'carriedQuestions: false').Count
(Get-ChildItem packages/core/fixtures/enhance/refresh-questions -Filter *.json).Count
(Get-ChildItem packages/core/fixtures/enhance/refresh-corrected -Filter *.json).Count
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "if (e.type === 'review.feedback') answered.clear();").Count
pnpm check:quick
```

```text
the vitest run passes, including both plan 026 tests ("after a refresh, asks the earlier questions again …" and "after a refresh, does not bring back answers given before a correction at review") and plan 025's folder tests
pnpm typecheck exits 0
eslint on packages/core exits 0
the carried-questions record count prints 1
the "carriedQuestions: false" count in state.ts prints 3 (initial state, answers, repo.refresh)
the refresh-questions fixture count prints 3
the refresh-corrected fixture count prints 4
the review.feedback clear count prints 1
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                              | Why                                                                                                   | Mechanical check                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The earlier answers are not pre-selected, so a confirm click silently resets them | `recommended` must follow the earlier answer, not the model's original pick                           | the test asserts the recommended options are `events-and-meets` and `nothing` (the model had recommended `upcoming` for the second)                                     |
| The carried round goes to the model instead of the owner                          | round 0 must be recorded by the engine with no LLM call                                               | the test asserts two DiscoveryTurn calls when the questions are pending, and `round` is 0                                                                               |
| The carried round repeats forever                                                 | the step must check for questions since the refresh                                                   | defensive only: REQUEST is re-entered only through a refresh (a new cut), so no test can reach it; the test still reaches REVIEW with exactly three DiscoveryTurn calls |
| Earlier answers contradicted by a correction come back pre-selected               | update-run question keys are `request.*`, which a correction never supersedes field by field          | the refresh-corrected test asserts no carried round and that the redraft prompt lacks `Only the three actions`                                                          |
| The model never sees the confirmed answers                                        | the reused fixture already says "events and meets", so decisions alone prove nothing about the prompt | the test asserts the round-1 prompt contains the `request.dashboardRecords … -> Events only (user)` line                                                                |
| The confirmed answers do not become decisions                                     | `clarifyStep` must record them in the new epoch                                                       | the test asserts the recorded round-0 answers and the final decisions `Events only` and `Only the three actions`                                                        |
| `carriedQuestions` is left true after the answers                                 | the reducer must clear it                                                                             | the test asserts it is false at REVIEW; the Select-String count prints 3                                                                                                |
| A run never refreshed starts asking round 0                                       | the branch must need `cut > 0`                                                                        | redundant with `carriedQuestions` (it returns nothing when the cut is 0); plan 025's tests and every existing enhance test confirm unchanged behaviour                  |
| `enhance.test.ts` lacks an import the test uses                                   | it uses `writeFileSync`, `git`, `NonInteractivePrompter`, `ScriptedPrompter`, `FakeLlmAdapter`        | they are already imported at the top of the file (lines 1, 9, 10, 23); typecheck and eslint would fail otherwise                                                        |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The owner asked that a refresh re-run the design and bring back the earlier questions and prompts to confirm or change; plan 025 brought back the request, this plan the answers                                                                                                                                                                                                                                                                                                                                                                                                      | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy): FIX-FIRST. Must-fix: answers given before a correction at review came back pre-selected, because update-run keys are request.* and a correction never supersedes them; fixed by not carrying answers from before a correction, with a new refresh-corrected test. Also: the round-1 prompt is now asserted, the fixture marker corrected, and two guardrail rows relabelled as defensive. Noted for plan 027: --yes records carried answers as source default, and round 0 shows as 'round 0' in the UI and CLI | CLOSED |
