# Plan 047: the Stop hook moves a tagged ticket to READY_FOR_TEST along the legal states

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work items 5 to 7 run the formatter, copy the scripts into the template pack, and refresh the template goldens.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `scripts/agent/tracker.mjs` contains `export async function transition(root, id, to)` and that `scripts/packs-sync.mjs` exists; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. A "Create" block makes a new file with exactly that content.
- Make the script edits in `scripts/agent/tracker.mjs` and `scripts/agent/on-stop.mjs` at the repository root, never in their copies under `packages/templates/packs/`: work item 6 copies them.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Every ticket the Incubator writes starts at `TAGGED_TO_RELEASE` (`packages/templates/packs/base/files/.incubator/tickets/ticket.json.eta` for a new solution, `buildDelivery` in `packages/core/src/enhance.ts` for an update run). When `check:quick` passes, the Stop hook (`scripts/agent/on-stop.mjs`) calls `transition(root, ticket, 'READY_FOR_TEST')`. The local tracker only allows `TAGGED_TO_RELEASE → ENRICHMENT_IN_PROGRESS`, so the call throws `illegal ticket transition TAGGED_TO_RELEASE → READY_FOR_TEST`. The hook catches that error and only prints it, so the ticket is never marked ready in a repository the Incubator built. The tests never caught this because the fake agent writes `READY_FOR_TEST` straight into the ticket file.

After this plan, the hook moves the ticket forward one legal edge at a time until it reaches `READY_FOR_TEST` (here `ENRICHMENT_IN_PROGRESS`, then `DEV_IN_PROGRESS`, then `READY_FOR_TEST`). A `TEST_FAILED` ticket goes back through `DEV_IN_PROGRESS` to `READY_FOR_TEST`, which is the retry the states allow (before, the hook threw on it too). A ticket that is `PARKED`, `TEST_PASSED` or `DEPLOYED` has no way forward to `READY_FOR_TEST` and is left as it is. The strict single-edge `transition` (used by `tracker.mjs transition <id> <state>`) is unchanged. Leantime trackers are unchanged: they set the mapped status directly, as before.

## Work items

### 1. `pathTo` and `advanceToReady` in the tracker client

In `scripts/agent/tracker.mjs`:

Find:

```text
export function canTransition(from, to) {
  if (to === 'PARKED') return from !== 'DEPLOYED' && from !== 'PARKED';
  return (EDGES[from] ?? []).includes(to);
}
```

Replace with:

```text
export function canTransition(from, to) {
  if (to === 'PARKED') return from !== 'DEPLOYED' && from !== 'PARKED';
  return (EDGES[from] ?? []).includes(to);
}

/** Plan 047: the states after `from`, in order, that reach `to` by legal edges ([] when already there); null when none do. */
export function pathTo(from, to) {
  if (from === to) return [];
  const seen = new Set([from]);
  const queue = [[from, []]];
  while (queue.length) {
    const [state, route] = queue.shift();
    for (const next of EDGES[state] ?? []) {
      if (seen.has(next)) continue;
      const longer = [...route, next];
      if (next === to) return longer;
      seen.add(next);
      queue.push([next, longer]);
    }
  }
  return null;
}
```

Find:

```text
export async function addRemediation(root, id, item) {
```

Replace with:

```text
/**
 * The Stop hook's move (plan 047): a local ticket goes forward along legal edges to READY_FOR_TEST, from
 * wherever the Incubator left it (TAGGED_TO_RELEASE). Leantime takes the mapped status directly.
 */
export async function advanceToReady(root, id) {
  const cfg = readJson(root, '.incubator/tracker.json');
  if (cfg.type === 'leantime') return transition(root, id, 'READY_FOR_TEST');
  const file = ticketFile(root, cfg, id);
  const ticket = JSON.parse(readFileSync(file, 'utf8'));
  const route = pathTo(ticket.state, 'READY_FOR_TEST');
  if (route === null) throw new Error(`illegal ticket transition ${ticket.state} → READY_FOR_TEST`);
  for (const state of route) await transition(root, id, state);
  return 'READY_FOR_TEST';
}

export async function addRemediation(root, id, item) {
```

### 2. The Stop hook uses it

In `scripts/agent/on-stop.mjs`:

Find:

```text
import { activeTicket, addRemediation, transition } from './tracker.mjs';
```

Replace with:

```text
import { activeTicket, addRemediation, advanceToReady, transition } from './tracker.mjs';
```

Find:

```text
    if (ticket)
      await transition(root, ticket, 'READY_FOR_TEST').catch((e) =>
        process.stderr.write(`tracker: ${e.message}\n`),
      );
```

Replace with:

```text
    // why: the Incubator tags tickets TAGGED_TO_RELEASE, which has no direct edge to READY_FOR_TEST (plan 047).
    if (ticket)
      await advanceToReady(root, ticket).catch((e) =>
        process.stderr.write(`tracker: ${e.message}\n`),
      );
```

### 3. Tests for the tracker client

Create `scripts/agent/tracker.test.mjs` with exactly:

```text
// Unit tests for the generated repository's tracker client (plan 047).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { advanceToReady, pathTo, transition } from './tracker.mjs';

function repo(state) {
  const root = mkdtempSync(path.join(tmpdir(), 'tracker '));
  mkdirSync(path.join(root, '.incubator', 'tickets'), { recursive: true });
  writeFileSync(
    path.join(root, '.incubator', 'tracker.json'),
    `${JSON.stringify({ type: 'local', ticketsDir: '.incubator/tickets' })}\n`,
  );
  writeFileSync(
    path.join(root, '.incubator', 'tickets', 'F-a.json'),
    `${JSON.stringify({ id: 'F-a', state, remediations: ['kept'] }, null, 2)}\n`,
  );
  return root;
}

const ticketOf = (root) =>
  JSON.parse(readFileSync(path.join(root, '.incubator', 'tickets', 'F-a.json'), 'utf8'));

describe('the Stop hook marks a ticket ready from where the Incubator left it (plan 047)', () => {
  it('finds the legal way forward to READY_FOR_TEST, or none', () => {
    expect(pathTo('TAGGED_TO_RELEASE', 'READY_FOR_TEST')).toEqual([
      'ENRICHMENT_IN_PROGRESS',
      'DEV_IN_PROGRESS',
      'READY_FOR_TEST',
    ]);
    expect(pathTo('TEST_FAILED', 'READY_FOR_TEST')).toEqual(['DEV_IN_PROGRESS', 'READY_FOR_TEST']);
    expect(pathTo('READY_FOR_TEST', 'READY_FOR_TEST')).toEqual([]);
    expect(pathTo('PARKED', 'READY_FOR_TEST')).toBeNull();
    expect(pathTo('TEST_PASSED', 'READY_FOR_TEST')).toBeNull();
    expect(pathTo('DEPLOYED', 'READY_FOR_TEST')).toBeNull();
  });

  it('moves a tagged ticket to READY_FOR_TEST, which a single transition refuses', async () => {
    const root = repo('TAGGED_TO_RELEASE');
    await expect(transition(root, 'F-a', 'READY_FOR_TEST')).rejects.toThrow(
      'illegal ticket transition TAGGED_TO_RELEASE → READY_FOR_TEST',
    );
    expect(ticketOf(root).state).toBe('TAGGED_TO_RELEASE');
    expect(await advanceToReady(root, 'F-a')).toBe('READY_FOR_TEST');
    expect(ticketOf(root)).toEqual({ id: 'F-a', state: 'READY_FOR_TEST', remediations: ['kept'] });
    // Already ready: nothing changes.
    expect(await advanceToReady(root, 'F-a')).toBe('READY_FOR_TEST');
    expect(ticketOf(root).state).toBe('READY_FOR_TEST');
  });

  it('never revives a parked or finished ticket', async () => {
    for (const state of ['PARKED', 'TEST_PASSED', 'DEPLOYED']) {
      const root = repo(state);
      await expect(advanceToReady(root, 'F-a')).rejects.toThrow(
        `illegal ticket transition ${state} → READY_FOR_TEST`,
      );
      expect(ticketOf(root).state).toBe(state);
    }
  });
});
```

### 4. The ADR says what the hook does now

In `docs/adr/017-agent-hooks-and-tracker-loop.md`:

Find:

```text
  - **pass:** transition the active ticket (`.incubator/state/active-ticket`) to `READY_FOR_TEST` via
    the tracker client, then exit 0;
```

Replace with:

```text
  - **pass:** move the active ticket (`.incubator/state/active-ticket`) to `READY_FOR_TEST` via
    the tracker client, then exit 0. A local ticket goes forward one legal edge at a time from where
    it is (`TAGGED_TO_RELEASE` → `ENRICHMENT_IN_PROGRESS` → `DEV_IN_PROGRESS` → `READY_FOR_TEST`,
    plan 047); a parked or finished ticket is left as it is;
```

### 5. Format the touched files

Run:

```powershell
pnpm exec prettier --write scripts/agent/tracker.mjs scripts/agent/on-stop.mjs scripts/agent/tracker.test.mjs docs/adr/017-agent-hooks-and-tracker-loop.md
```

### 6. Copy the scripts into the template pack

Run:

```powershell
node scripts/packs-sync.mjs
node scripts/packs-sync.mjs --check
```

The first prints `synced 2 file(s)`; the second prints `0 stale`.

### 7. Refresh the template goldens

Run:

```powershell
$env:INCUBATOR_GOLDEN_UPDATE = '1'; pnpm exec vitest run --project unit packages/templates/src/packs.test.ts; Remove-Item Env:INCUBATOR_GOLDEN_UPDATE
pnpm exec vitest run --project unit packages/templates/src/packs.test.ts
git diff --numstat -- packages/templates/__golden__
```

The second run passes. The last command prints 10 lines, one per golden, and every line starts with `3`, a tab, `3` (the lines for `scripts/agent/tracker.mjs`, `scripts/agent/on-stop.mjs` and `.incubator/lock.json`). If any line shows other numbers, stop and report it.

## Touched files and markers

| File                                                            | Marker                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `scripts/agent/tracker.mjs`                                     | `export async function advanceToReady(root, id)`                                 |
| `scripts/agent/on-stop.mjs`                                     | `await advanceToReady(root, ticket)`                                             |
| `scripts/agent/tracker.test.mjs`                                | `the Stop hook marks a ticket ready from where the Incubator left it (plan 047)` |
| `docs/adr/017-agent-hooks-and-tracker-loop.md`                  | `` `TAGGED_TO_RELEASE` → `ENRICHMENT_IN_PROGRESS` → `DEV_IN_PROGRESS` ``         |
| `packages/templates/packs/base/files/scripts/agent/tracker.mjs` | `export async function advanceToReady(root, id)`                                 |
| `packages/templates/packs/base/files/scripts/agent/on-stop.mjs` | `await advanceToReady(root, ticket)`                                             |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit scripts/agent/tracker.test.mjs packages/templates/src/packs.test.ts scripts/dogfood.test.mjs
node scripts/packs-sync.mjs --check
pnpm exec eslint --max-warnings=0 scripts
pnpm check:quick
```

```text
tracker.test.mjs passes (3 tests), packs.test.ts and dogfood.test.mjs pass
packs-sync --check prints "0 stale"
eslint exits 0
pnpm check:quick exits 0 (its unit step runs scripts/dogfood.test.mjs, which compares the pack copies)
```

## Drift and hallucination guardrails

| Trap                                                                 | Why                                                                             | Mechanical check                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Only one copy of the scripts changes                                 | the repository and the template pack each carry `tracker.mjs` and `on-stop.mjs` | `node scripts/packs-sync.mjs --check` prints `0 stale`; `scripts/dogfood.test.mjs` (in `check:quick`'s unit step) fails otherwise                                                                                                          |
| The strict `transition` is loosened instead of adding a new function | the `transition` CLI command must keep refusing skipped states                  | the new test asserts `transition(root, 'F-a', 'READY_FOR_TEST')` still rejects with `illegal ticket transition TAGGED_TO_RELEASE → READY_FOR_TEST`                                                                                         |
| A parked or deployed ticket is revived                               | a walk could pass through `TEST_FAILED → DEV_IN_PROGRESS`                       | the test asserts `PARKED`, `TEST_PASSED` and `DEPLOYED` reject and keep their state; `pathTo` starts from the ticket's own state and no edge leads to `PARKED`                                                                             |
| The hook still calls the old function                                | the ready branch is a single call that is easy to miss                          | `Select-String -SimpleMatch -Path scripts/agent/on-stop.mjs "advanceToReady(root, ticket)"` prints one match, and `Select-String -SimpleMatch -Path scripts/agent/on-stop.mjs "transition(root, ticket, 'READY_FOR_TEST')"` prints nothing |
| Goldens are refreshed over an unrelated change                       | `INCUBATOR_GOLDEN_UPDATE=1` rewrites every golden                               | `git diff --numstat -- packages/templates/__golden__` prints 10 lines, each starting with `3`, a tab, `3` (the two scripts and `.incubator/lock.json` in every golden)                                                                     |
| The ticket loses its other fields                                    | each step rewrites the file through `transition`                                | the test compares the whole ticket after the move (`remediations: ['kept']`)                                                                                                                                                               |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                   | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Opus review: the golden guardrail had an unescaped pipe and relied on reading a diff; the drift-step claim was wrong (dogfood.test.mjs compares the copies); "one edge at a time" is now true in the code; plan formatted for check:quick | CLOSED |
| 1     | Follow-up from plans 040-044: the canonical Stop hook cannot move a TAGGED_TO_RELEASE ticket to READY_FOR_TEST (illegal transition)                                                                                                       | CLOSED |
