# Plan 045: choosing Leantime as the tracker no longer parks a new run for good

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 7 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. A "Create" block makes a new file with exactly that content.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment. Do not change `packages/spec/schema/incubator.schema.json` or any prompt file.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A real new-solution run parked at `DRAFT_SPEC` with "the drafted spec is invalid (1 issue(s))", and after Resume it parked again at `CLARIFY` with the same issue: `leantime_config`, "tracker leantime needs baseUrl and projectId" (`packages/spec/src/semantics.ts`). The model had asked "Which work tracker should this project use?" with Leantime recommended, and the owner picked it.

Nothing can ever supply the missing values:

- Questions only offer fixed options; the questions screen has no text field, so a URL or a project number cannot be answered.
- `tracker.leantime.baseUrl` is a security field (`SECURITY_FIELDS` in `packages/spec/src/constants.ts`): the model never takes it from a repository, and on a new run nothing gives it one unless the owner writes it into a correction at review.
- An empty Leantime block (`baseUrl: ""`, `projectId: null`) is worse: it passes validation, the run publishes, and then HANDOFF has no tracker (`packages/core/src/live.ts` needs both values), so it parks after the repository exists.
- Resume drafts again, the draft still says Leantime, and `finalize` in `packages/core/src/engine.ts` parks again. The run is stuck.

The fix: when the drafted spec asks for Leantime without `tracker.leantime`, the engine uses local tickets instead, replaces the tracker decision with one that says why, and records a warning in the run log. The run reaches review. The owner can still switch to Leantime at review by adding `tracker.leantime` (`baseUrl` and `projectId`) to the spec, which validation accepts as before. A run already parked this way finishes on its next Resume.

## Work items

### 1. Spec: fall back to local tickets when Leantime has no address

In `packages/spec/src/defaults.ts`:

Find:

```text
  spec.decisions = [...(spec.decisions ?? []), ...added];
  return { spec, added };
}
```

Replace with:

```text
  spec.decisions = [...(spec.decisions ?? []), ...added];
  return { spec, added };
}

/** The tracker decision recorded when a Leantime tracker has no address (plan 045). */
export const LEANTIME_FALLBACK =
  'local: Leantime was chosen, but it needs its address (tracker.leantime.baseUrl) and project ID (tracker.leantime.projectId), which the questions cannot ask; add both at review to use Leantime';

/**
 * A Leantime tracker needs its address and project, which only the owner can give (plan 045). Without them
 * the spec can never validate, so the run would park on every resume: it falls back to local tickets, and the
 * tracker decision says why. A configured Leantime tracker, and a local one, are kept as they are.
 */
export function withReachableTracker(spec: IncubatorSpec): {
  spec: IncubatorSpec;
  fellBack: boolean;
} {
  // The same test as the live tracker (packages/core/src/live.ts): without both values HANDOFF has no tracker.
  const lt = spec.tracker.leantime;
  if (spec.tracker.type !== 'leantime' || (lt?.baseUrl && typeof lt.projectId === 'number'))
    return { spec, fellBack: false };
  const decision: Decision = {
    key: 'tracker.type',
    question: 'Which work tracker?',
    answer: LEANTIME_FALLBACK,
    source: 'default',
  };
  return {
    spec: {
      ...spec,
      tracker: { type: 'local' },
      decisions: [
        ...spec.decisions.filter((d) => d.key !== 'tracker' && !d.key.startsWith('tracker.')),
        decision,
      ],
    },
    fellBack: true,
  };
}
```

### 2. Engine: the imports

In `packages/core/src/engine.ts`:

Find:

```text
  ENHANCEMENT_SPEC_VERSION,
  OTHER,
  completeSpec,
```

Replace with:

```text
  ENHANCEMENT_SPEC_VERSION,
  LEANTIME_FALLBACK,
  OTHER,
  completeSpec,
```

Find:

```text
  validateSemantics,
  validateSpec,
  type DiscoveryTurn,
```

Replace with:

```text
  validateSemantics,
  validateSpec,
  withReachableTracker,
  type DiscoveryTurn,
```

### 3. Engine: use it before the spec is validated

In `packages/core/src/engine.ts`:

Find:

```text
    let spec = completed.spec;
    if (this.state(runId).input.kind === 'enhance') {
```

Replace with:

```text
    let spec = completed.spec;
    // A Leantime tracker without its address and project can never validate, so every resume would park
    // again: use local tickets and say why; the owner can add tracker.leantime at review (plan 045).
    const tracker = withReachableTracker(spec);
    if (tracker.fellBack) {
      spec = tracker.spec;
      this.record(runId, 'step.warn', {
        step: 'spec.tracker',
        data: { reason: LEANTIME_FALLBACK },
      });
    }
    if (this.state(runId).input.kind === 'enhance') {
```

### 4. Spec test: the fallback

In `packages/spec/src/spec.test.ts`:

Find:

```text
  validateSpec,
  type IncubatorSpec,
} from './index.js';
```

Replace with:

```text
  validateSpec,
  withReachableTracker,
  LEANTIME_FALLBACK,
  type IncubatorSpec,
} from './index.js';
```

Then add at the end of `packages/spec/src/spec.test.ts`, after one blank line:

```text
describe('a Leantime tracker without its address (plan 045)', () => {
  const base = (): IncubatorSpec =>
    completeSpec({ stack: { pack: 'node-web' }, project: { name: 'Shop' } }).spec;

  it('falls back to local tickets, replaces the tracker decision and leaves the spec valid', () => {
    const s = base();
    s.tracker = { type: 'leantime' };
    s.decisions = [
      ...s.decisions.filter((d) => d.key !== 'tracker' && !d.key.startsWith('tracker.')),
      { key: 'tracker.type', question: 'Which tracker?', answer: 'leantime', source: 'user' },
      { key: 'tracker', question: 'Tracker', answer: 'leantime', source: 'inferred' },
      { key: 'tracker.leantime', question: 'Where?', answer: 'ask the owner', source: 'inferred' },
    ];
    expect(validateSemantics(s).map((i) => i.code)).toContain('leantime_config');
    const { spec, fellBack } = withReachableTracker(s);
    expect(fellBack).toBe(true);
    expect(spec.tracker).toEqual({ type: 'local' });
    expect(
      spec.decisions.filter((d) => d.key === 'tracker' || d.key.startsWith('tracker.')),
    ).toEqual([
      {
        key: 'tracker.type',
        question: 'Which work tracker?',
        answer: LEANTIME_FALLBACK,
        source: 'default',
      },
    ]);
    expect(validateSpec(spec).issues).toEqual([]);
    expect(validateSemantics(spec)).toEqual([]);
    // The input is not changed.
    expect(s.tracker).toEqual({ type: 'leantime' });
  });

  it('keeps a configured Leantime tracker and a local one as they are', () => {
    const configured = base();
    configured.tracker = {
      type: 'leantime',
      leantime: { baseUrl: 'https://leantime.example.invalid', projectId: 3 },
    };
    expect(withReachableTracker(configured)).toEqual({ spec: configured, fellBack: false });
    const local = base();
    expect(withReachableTracker(local)).toEqual({ spec: local, fellBack: false });
  });

  it('falls back when the Leantime block is there but empty, since HANDOFF could not reach it', () => {
    const half = base();
    half.tracker = { type: 'leantime', leantime: { baseUrl: '', projectId: null } };
    expect(validateSemantics(half)).toEqual([]);
    expect(withReachableTracker(half).fellBack).toBe(true);
    const noProject = base();
    noProject.tracker = {
      type: 'leantime',
      leantime: { baseUrl: 'https://leantime.example.invalid', projectId: null },
    };
    expect(withReachableTracker(noProject).spec.tracker).toEqual({ type: 'local' });
  });
});
```

### 5. The fixture: a model that picks Leantime

Create `packages/core/fixtures/discovery/leantime-tracker/narrative.md` with exactly:

```text
semver-lite: a tiny zero-dependency TypeScript library that parses, compares and sorts semantic versions, published to npm. Track the work in Leantime.
```

Create `packages/core/fixtures/discovery/leantime-tracker/01-DiscoveryTurn.json` with exactly:

```text
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 045: the model picks the Leantime tracker, and nothing can give its address",
  "response": {
    "draftSpec": {
      "project": {
        "name": "semver-lite",
        "slug": "semver-lite",
        "description": "Parse, compare and sort semantic versions with zero dependencies."
      },
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
      "tracker": { "type": "leantime" },
      "decisions": [
        { "key": "project", "question": "Name", "answer": "semver-lite", "source": "inferred" },
        { "key": "intent", "question": "Features", "answer": "parse, compare", "source": "inferred" },
        { "key": "platform", "question": "Type", "answer": "library", "source": "inferred" },
        { "key": "stack", "question": "Stack", "answer": "node-lib, no database", "source": "inferred" },
        { "key": "deploy.target", "question": "Deploy", "answer": "npm via package-release", "source": "inferred" },
        { "key": "testing.e2e", "question": "E2E", "answer": "none for a library", "source": "inferred" },
        { "key": "tracker.type", "question": "Tracker", "answer": "leantime, as the narrative asks", "source": "inferred" }
      ]
    },
    "questions": [],
    "done": true
  }
}
```

### 6. Engine test: the run reaches the end instead of parking

In `packages/core/src/discovery.test.ts`:

Find:

```text
describe('clarification rules', () => {
```

Replace with:

```text
describe('a Leantime tracker without its address (plan 045)', () => {
  it('uses local tickets and finishes, instead of parking on every resume', async () => {
    const { state, spec, h, runId } = await run('leantime-tracker');
    expect(state.state).toBe('DONE');
    expect(spec.tracker).toEqual({ type: 'local' });
    expect(validateSemantics(spec)).toEqual([]);
    expect(spec.decisions.find((d) => d.key === 'tracker.type')).toMatchObject({
      source: 'default',
      answer: expect.stringContaining('add both at review to use Leantime') as string,
    });
    expect(
      h.engine
        .entries(runId)
        .some((e) => e.type === 'step.warn' && e['step'] === 'spec.tracker'),
    ).toBe(true);
    expect(h.engine.entries(runId).some((e) => e.type === 'park')).toBe(false);
    // The publish result's warnings read data.reason (packages/core/src/publish.ts).
    expect(
      h.engine.entries(runId).find((e) => e.type === 'step.warn' && e['step'] === 'spec.tracker')?.[
        'data'
      ],
    ).toEqual({ reason: expect.stringContaining('add both at review to use Leantime') as string });
  });

  it('keeps Leantime when the owner adds its address and project at review', async () => {
    const h = fakeEngine({ dir: discoveryFixtureDir('leantime-tracker') });
    const runId = h.engine.start({
      kind: 'new',
      narrative: narrative('leantime-tracker'),
      specOnly: true,
      surface: 'test',
    });
    const parked = await h.engine.advance(
      runId,
      new ScriptedPrompter({}, { approve: false, reason: 'use Leantime' }),
    );
    expect(parked.parked).toMatchObject({ state: 'REVIEW', reason: 'review_rejected' });
    const spec = h.engine.draft(runId) as unknown as IncubatorSpec;
    const edited: IncubatorSpec = {
      ...spec,
      tracker: {
        type: 'leantime',
        leantime: { baseUrl: 'https://leantime.example.invalid', projectId: 3 },
      },
    };
    const done = await h.engine.resume(
      runId,
      new ScriptedPrompter({}, { approve: true, spec: edited }),
    );
    expect(done.state).toBe('DONE');
    expect((h.engine.draft(runId) as unknown as IncubatorSpec).tracker).toEqual(edited.tracker);
  });
});

describe('clarification rules', () => {
```

### 7. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/spec/src/defaults.ts packages/spec/src/spec.test.ts packages/core/src/engine.ts packages/core/src/discovery.test.ts packages/core/fixtures/discovery/leantime-tracker
```

## Touched files and markers

| File                                                                      | Marker                                                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/spec/src/defaults.ts`                                           | `export function withReachableTracker(spec: IncubatorSpec): {`                         |
| `packages/core/src/engine.ts`                                             | `data: { reason: LEANTIME_FALLBACK },`                                                 |
| `packages/spec/src/spec.test.ts`                                          | `falls back to local tickets, replaces the tracker decision and leaves the spec valid` |
| `packages/core/fixtures/discovery/leantime-tracker/narrative.md`          | `Track the work in Leantime.`                                                          |
| `packages/core/fixtures/discovery/leantime-tracker/01-DiscoveryTurn.json` | `plan 045: the model picks the Leantime tracker`                                       |
| `packages/core/src/discovery.test.ts`                                     | `uses local tickets and finishes, instead of parking on every resume`                  |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/spec/src/spec.test.ts packages/core/src/discovery.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/spec packages/core
pnpm check:quick
```

```text
the unit tests pass, including "falls back to local tickets, replaces the tracker decision and leaves the spec valid", "keeps a configured Leantime tracker and a local one as they are", "uses local tickets and finishes, instead of parking on every resume" and "keeps Leantime when the owner adds its address and project at review"; every existing discovery test still passes
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                      | Why                                                                              | Mechanical check                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The semantic rule is weakened instead of the engine fixed | deleting the `leantime_config` check in `semantics.ts` also makes the run finish | the spec test asserts `validateSemantics` still reports `leantime_config` for a bare Leantime tracker; `semantics.ts` is not in the touched files |
| An empty Leantime block counts as configured              | `{ baseUrl: "", projectId: null }` passes validation and dead-ends at HANDOFF    | the spec test "falls back when the Leantime block is there but empty"                                                                             |
| The warning shows no text                                 | the publish result reads `data.reason`, not `message`                            | the engine test asserts `data` equals `{ reason: ... }`                                                                                           |
| A configured Leantime tracker is downgraded too           | a check on `type` alone would drop the owner's real choice                       | the spec test keeps `{ type: 'leantime', leantime: {...} }` unchanged, and the engine test finishes with it after a review edit                   |
| The old tracker decision stays next to the new one        | the user's "leantime" answer would contradict the spec                           | the spec test expects exactly one `tracker.type` decision, the fallback one                                                                       |
| The fallback hides itself                                 | the owner would not know why the tracker changed                                 | the engine test asserts the `step.warn` entry `spec.tracker` and the `default` decision text                                                      |
| Recorded live fixtures break                              | a change to the discovery prompt changes their keys                              | no prompt or schema file is touched; the existing "replays a keyed real-model exchange" test must still pass                                      |

## Review rounds

| Round | Finding                                                                                                                                                                                                  | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Opus review: an empty Leantime block passed validation and dead-ended at HANDOFF; the warning used `message` where publish reads `data.reason`; `tracker.*` decisions other than `tracker.type` survived | CLOSED |
| 1     | A real run parked at DRAFT_SPEC, then at CLARIFY after Resume, on `leantime_config`: the owner picked Leantime and nothing could ever supply its address or project                                      | CLOSED |
