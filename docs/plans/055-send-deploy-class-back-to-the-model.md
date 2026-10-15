# Plan 055: a deploy target that breaks the library-only rule is sent back to the model, not left to park the run

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 4 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/core/src/discovery/merge.ts` contains `export function otherIssues(turn: DiscoveryTurn): Issue[] {` and that `packages/core/src/engine.ts` contains `: otherIssues(turn)),`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** In a real new-project run the owner answered `platform = wordpress-plugin`. The model then set the stack to `wordpress` and also `deploy.target = package-release` ("the plugin ships as a versioned package"). The spec rule (`packages/spec/src/semantics.ts`, code `deploy_class`) allows `package-release` only for the `node-lib` pack, and requires it there. That rule is only checked at the very end, and a failure parks the run with "the drafted spec is invalid (1 issue)". Resume asks the model again with the same inputs, so it parks again. Other model mistakes (picking `other`, a value with no decision) are sent back to the model once, with the exact problem, before the run can fail: `otherIssues` in `merge.ts`, run by `draftStep` in `engine.ts`.

After this plan, a turn that leaves the draft with a deploy target that breaks that rule gets the same treatment: the issue is added to the checks `draftStep` runs on the model's reply, the gate sends the reply back once with the reason, and the model corrects it. The check looks at the draft as it would be after the turn, so a draft that already holds the bad pair (the stuck run's state) is sent back even when the turn does not touch the target. The spec rule itself, the discovery prompt and update (enhance) runs do not change.

## Work items

### 1. The check

In `packages/core/src/discovery/merge.ts`:

Find:

```text
function upsert(list: Decision[], d: Decision): Decision[] {
```

Replace with:

```text
/**
 * Plan 055: a library or CLI (stack.pack node-lib) deploys as package-release, and nothing else does (the spec's
 * deploy_class rule). Checked on the draft as it would be after the turn, so a turn that breaks the rule, or leaves
 * it broken, is sent back to the model with this issue instead of parking the run at validation.
 */
export function deployClassIssues(before: Draft, turn: DiscoveryTurn): Issue[] {
  const after = deepMerge(withoutMeta(before), withoutMeta(withoutPackFixed(turn.draftSpec)));
  const pack = getAt(after, 'stack.pack');
  const target = getAt(after, 'deploy.target');
  if (typeof pack !== 'string' || typeof target !== 'string') return [];
  if ((pack === 'node-lib') === (target === 'package-release')) return [];
  return [
    {
      code: 'deploy_class',
      path: '/draftSpec/deploy/target',
      message:
        pack === 'node-lib'
          ? 'a library or CLI (stack.pack node-lib) deploys as package-release: set deploy.target to package-release'
          : `deploy.target package-release is only for libraries and CLIs (stack.pack node-lib): a ${pack} project uses vps-tailscale or docker-host`,
    },
  ];
}

function upsert(list: Decision[], d: Decision): Decision[] {
```

### 2. The engine runs it

In `packages/core/src/engine.ts`:

Find:

```text
  attributionIssues,
  mergeTurn,
  otherIssues,
```

Replace with:

```text
  attributionIssues,
  deployClassIssues,
  mergeTurn,
  otherIssues,
```

Find:

```text
            : otherIssues(turn)),
```

Replace with:

```text
            : [...otherIssues(turn), ...deployClassIssues(before, turn)]),
```

### 3. Tests

In `packages/core/src/discovery.test.ts`:

Find:

```text
import { otherIssues } from './discovery/merge.js';
```

Replace with:

```text
import { deployClassIssues, otherIssues } from './discovery/merge.js';
```

Find:

```text
  it('sends a turn that picks "other" back to the model', () => {
```

Replace with:

```text
  it('sends a library-only deploy target on another stack back to the model (plan 055)', () => {
    const turn = (draftSpec: Record<string, unknown>) =>
      ({ draftSpec, questions: [], done: true }) as never;
    const before = (stack: unknown, deploy?: unknown) =>
      ({ stack, ...(deploy ? { deploy } : {}), decisions: [] }) as never;
    const wanted = ['deploy_class /draftSpec/deploy/target'];
    const found = (b: never, t: never) =>
      deployClassIssues(b, t).map((i) => `${i.code} ${i.path}`);
    expect(
      found(before({ pack: 'wordpress' }), turn({ deploy: { target: 'package-release' } })),
    ).toEqual(wanted);
    expect(found(before({ pack: 'node-lib' }), turn({ deploy: { target: 'vps-tailscale' } }))).toEqual(
      wanted,
    );
    expect(
      deployClassIssues(
        before({ pack: 'wordpress' }),
        turn({ deploy: { target: 'package-release' } }),
      )[0]!.message,
    ).toContain('only for libraries and CLIs');
    expect(
      found(before({ pack: 'node-lib' }), turn({ deploy: { target: 'package-release' } })),
    ).toEqual([]);
    expect(
      found(before({ pack: 'node-web' }), turn({ deploy: { target: 'vps-tailscale' } })),
    ).toEqual([]);
    // Nothing to compare while the pack or the target is not known yet.
    expect(found(before(undefined), turn({ deploy: { target: 'package-release' } }))).toEqual([]);
    expect(found(before({ pack: 'wordpress' }), turn({}))).toEqual([]);
    // The draft already holds the bad pair and the turn does not touch it: still sent back.
    expect(
      found(before({ pack: 'wordpress' }, { target: 'package-release' }), turn({ intent: {} })),
    ).toEqual(wanted);
  });

  it('sends a library-only deploy target back to the model, and the run then finishes without parking (plan 055)', async () => {
    const dir = discoveryFixtureDir('saas-web');
    const [first, second] = ['01', '02'].map(
      (n) =>
        JSON.parse(readFileSync(path.join(dir, `${n}-DiscoveryTurn.json`), 'utf8')) as {
          response: { draftSpec: Record<string, unknown> };
        },
    );
    const bad = structuredClone(second!);
    bad.response.draftSpec['deploy'] = { staging: { tailnetOnly: false }, target: 'package-release' };
    const h = fakeEngine(new FakeLlmAdapter([first, bad, second] as never));
    const runId = h.engine.start({
      kind: 'new',
      narrative: narrative('saas-web'),
      specOnly: true,
      surface: 'test',
    });
    const s = await h.engine.advance(runId, new ScriptedPrompter());
    expect(s.state).toBe('DONE');
    expect(h.engine.entries(runId).some((e) => e.type === 'park')).toBe(false);
    const calls = (h.adapter as FakeLlmAdapter).calls;
    expect(calls).toHaveLength(3);
    expect(calls[2]!.user).toContain('only for libraries and CLIs');
    const spec = h.engine.draft(runId) as unknown as IncubatorSpec;
    expect(spec.deploy.target).not.toBe('package-release');
  });

  it('sends a turn that picks "other" back to the model', () => {
```

### 4. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/discovery/merge.ts packages/core/src/engine.ts packages/core/src/discovery.test.ts
```

## Touched files and markers

| File                                   | Marker                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `packages/core/src/discovery/merge.ts` | `export function deployClassIssues(before: Draft, turn: DiscoveryTurn)` |
| `packages/core/src/engine.ts`          | `...deployClassIssues(before, turn)`                                    |
| `packages/core/src/discovery.test.ts`  | `sends a library-only deploy target on another stack back to the model` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/discovery.test.ts packages/core/src/stop.test.ts tests/scenarios.test.ts
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "deployClassIssues").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
discovery.test.ts, stop.test.ts and tests/scenarios.test.ts pass, including the two new plan 055 tests
the Select-String count prints 2
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                             | Why                                                                                                          | Mechanical check                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The check is written but never run by the engine | a function nothing calls still type-checks and its unit test passes                                          | the engine test asserts the third model call carries the text `only for libraries and CLIs`; the Select-String count of `deployClassIssues` in `engine.ts` prints 2 |
| The rule differs from the spec's                 | the spec says `(pack === 'node-lib') !== (target === 'package-release')` in `packages/spec/src/semantics.ts` | the same condition is written in `merge.ts`; the unit test covers both directions and both fine pairs                                                               |
| Recorded discovery fixtures start failing        | they already pass `validateSemantics`, which is the same rule                                                | `discovery.test.ts` replays every recorded narrative in the first acceptance command                                                                                |
| Update (enhance) runs are changed                | the detected stack of an existing repository can be anything                                                 | the call is only in the new-project branch; the enhance tests run in `pnpm check:quick`                                                                             |
| The draft is read before the turn is merged      | the stuck run holds the bad pair already and the turn does not touch it                                      | the last unit test expects an issue for a turn that only touches `intent`                                                                                           |

## Review rounds

| Round | Finding                                                                                                                                                                                                                      | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Follow-up from a real new-project run (cert-guage): the model chose package-release for a WordPress plugin, the spec rule parked the run at validation, and Resume repeated it because nothing told the model what was wrong | CLOSED |
