# Plan 035: count the coding agent's turns by reply, and raise the turn limit to 150

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 8 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A real update run (rolling-schedule, 7 requests) was stopped with "turns 61 > 60" after about four minutes. Its log holds 61 `assistant` events but only 27 distinct `message.id` values and 32 tool calls.

The cause is in `CeilingMonitor` (`packages/core/src/handoff.ts`). Claude's `--output-format stream-json --verbose` sends one `assistant` event per content block of a reply (each `thinking`, `text` and `tool_use` block), and every one of those events carries the same `message.id`. The monitor adds a turn per event, so a reply with text and two tool calls counts as three turns.

From now on, a turn is one reply: an `assistant` event whose `message.id` was not seen before. An event with no id still counts one turn each, as before. Other agent CLIs that send no ids are therefore unchanged.

The owner also raised the default turn limit from 60 to 150 per agent session. The limit is taken from `spec.agents.runCeilings`, which new specs fill from `DEFAULT_RUN_CEILINGS` (`packages/spec/src/constants.ts`). The engine also falls back to it when a spec says `0`. Specs already approved keep the limit they recorded.

The generated repository's own agent profile template (`packages/templates/packs/base/files/.incubator/agent-profile.json.eta`, `pick(c.turns, 60)`) keeps its fallback for a spec that says `0`. Changing it would change the base pack's pinned files, and every new spec now carries 150, so it is out of scope.

## Work items

### 1. Core: the monitor remembers the replies it has counted

In `packages/core/src/handoff.ts`:

Find:

```text
  /** The model the agent says it is using (its `system` init event). */
  model: string | null = null;
  #buf = '';
```

Replace with:

```text
  /** The model the agent says it is using (its `system` init event). */
  model: string | null = null;
  #buf = '';
  /** The replies already counted as turns (plan 035). */
  #replies = new Set<string>();
```

### 2. Core: the event's message id is read

In `packages/core/src/handoff.ts`:

Find:

```text
      message?: { content?: { type?: string; text?: unknown }[] };
```

Replace with:

```text
      message?: { id?: unknown; content?: { type?: string; text?: unknown }[] };
```

### 3. Core: a turn is one reply

In `packages/core/src/handoff.ts`:

Find:

```text
    if (e.type === 'assistant') {
      this.turns++;
```

Replace with:

```text
    if (e.type === 'assistant') {
      // why: Claude's stream sends one `assistant` event per content block of a reply, all with the reply's
      // message id; a turn is one reply (plan 035). Events without an id count one turn each, as before.
      const id = typeof e.message?.id === 'string' ? e.message.id : null;
      if (id === null || !this.#replies.has(id)) {
        if (id !== null) this.#replies.add(id);
        this.turns++;
      }
```

### 4. Spec: the default turn limit is 150

In `packages/spec/src/constants.ts`:

Find:

```text
export const DEFAULT_RUN_CEILINGS = { turns: 60, toolCalls: 400, minutes: 45, usd: 10 } as const;
```

Replace with:

```text
// why: 150 turns (replies) per agent session; 60 stopped real update runs a few minutes in (plan 035).
export const DEFAULT_RUN_CEILINGS = { turns: 150, toolCalls: 400, minutes: 45, usd: 10 } as const;
```

### 5. Core: the engine's fallback follows the default

In `packages/core/src/engine.ts`:

Find:

```text
      turns: c.turns > 0 ? c.turns : 60,
```

Replace with:

```text
      turns: c.turns > 0 ? c.turns : DEFAULT_RUN_CEILINGS.turns,
```

In `packages/core/src/engine.ts`:

Find:

```text
import {
  ENHANCEMENT_SPEC_VERSION,
  OTHER,
  completeSpec,
```

Replace with:

```text
import {
  DEFAULT_RUN_CEILINGS,
  ENHANCEMENT_SPEC_VERSION,
  OTHER,
  completeSpec,
```

### 6. Tests

In `packages/core/src/handoff.test.ts`:

Find:

```text
  it('keeps what the agent said: the result text, else its last message, cleaned and capped', () => {
```

Replace with:

```text
  it('counts one turn per reply when a reply arrives as several events (plan 035)', () => {
    const m = new CeilingMonitor({ turns: 2, toolCalls: 99, minutes: 1, usd: 9 }, false);
    const block = (id: string, type: 'text' | 'tool_use') =>
      `${JSON.stringify({ type: 'assistant', message: { id, content: [type === 'text' ? { type, text: 'x' } : { type }] } })}\n`;
    m.feed(block('msg_1', 'text') + block('msg_1', 'tool_use') + block('msg_1', 'tool_use'));
    expect([m.turns, m.toolCalls]).toEqual([1, 2]);
    expect(m.feed(block('msg_2', 'tool_use') + block('msg_2', 'tool_use'))).toBeNull();
    expect([m.turns, m.toolCalls]).toEqual([2, 4]);
    expect(m.feed(block('msg_3', 'text'))).toBe('turns 3 > 2');
  });

  it('replays the shape of a real run that was stopped too early: 61 events, 27 replies (plan 035)', () => {
    const m = new CeilingMonitor({ turns: 60, toolCalls: 400, minutes: 45, usd: 10 }, false);
    let events = 0;
    for (let i = 0; i < 27; i++)
      for (let j = 0; j < (i < 7 ? 3 : 2); j++) {
        events++;
        m.feed(
          `${JSON.stringify({ type: 'assistant', message: { id: `msg_${i}`, content: [{ type: j === 0 ? 'text' : 'tool_use', text: 'x' }] } })}\n`,
        );
      }
    expect(events).toBe(61);
    expect(m.turns).toBe(27);
    expect(m.tripped).toBeNull();
  });

  it('keeps what the agent said: the result text, else its last message, cleaned and capped', () => {
```

The expected spec of the recorded discovery exchange is compared byte for byte by `packages/core/src/discovery.test.ts`.

In `packages/core/fixtures/discovery/live-claude-bookclub/expected-incubator.json`:

Find:

```text
    "runCeilings": {
      "turns": 60,
```

Replace with:

```text
    "runCeilings": {
      "turns": 150,
```

The default is also recorded as a decision in the same file. In `packages/core/fixtures/discovery/live-claude-bookclub/expected-incubator.json`:

Find:

```text
      "question": "Default for agents.runCeilings.turns",
      "answer": "60",
```

Replace with:

```text
      "question": "Default for agents.runCeilings.turns",
      "answer": "150",
```

### 7. Refresh the template goldens

Every template combo renders its spec's run ceilings into four files (`.incubator/agent-profile.json`, `.incubator/lock.json`, `contracts.lock.json`, `incubator.json`), whose hashes are pinned in `packages/templates/__golden__/*.txt`. Refresh them only after work items 1 to 6 are done, then check the refresh changed nothing else:

```powershell
$env:INCUBATOR_GOLDEN_UPDATE = '1'; pnpm exec vitest run --project unit packages/templates/src/packs.test.ts; Remove-Item Env:INCUBATOR_GOLDEN_UPDATE
git diff --stat packages/templates/__golden__
```

The stat must show exactly 10 files changed, 40 insertions and 40 deletions. Do not edit a golden file by hand.

### 8. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/handoff.ts packages/core/src/handoff.test.ts packages/core/src/engine.ts packages/spec/src/constants.ts
```

Do not run the formatter on the fixture JSON file.

## Touched files and markers

| File                                                                            | Marker                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/core/src/handoff.ts`                                                  | `#replies = new Set<string>();`                                                                      |
| `packages/spec/src/constants.ts`                                                | `export const DEFAULT_RUN_CEILINGS = { turns: 150, toolCalls: 400, minutes: 45, usd: 10 } as const;` |
| `packages/core/src/engine.ts`                                                   | `turns: c.turns > 0 ? c.turns : DEFAULT_RUN_CEILINGS.turns,`                                         |
| `packages/core/src/handoff.test.ts`                                             | `counts one turn per reply when a reply arrives as several events (plan 035)`                        |
| `packages/core/fixtures/discovery/live-claude-bookclub/expected-incubator.json` | `"turns": 150,`                                                                                      |
| `packages/templates/__golden__/*.txt` (10 files)                                | regenerated by work item 7, not edited by hand                                                       |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/handoff.test.ts packages/core/src/discovery.test.ts packages/spec packages/templates
Select-String -SimpleMatch -Path packages/core/src/engine.ts "c.turns : 60"
git diff --shortstat packages/templates/__golden__
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core packages/spec
pnpm check:quick
```

```text
the unit tests pass, including "counts one turn per reply when a reply arrives as several events (plan 035)", "replays the shape of a real run that was stopped too early: 61 events, 27 replies (plan 035)" and "replays a keyed real-model exchange to the same approved spec, byte for byte"
the Select-String prints nothing (the engine fallback no longer says 60)
the golden shortstat says 10 files changed, 40 insertions(+), 40 deletions(-)
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                              | Why                                                                          | Mechanical check                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turns are still counted per event                                 | the id check must gate the increment                                         | the reply test asserts 1 turn for three events of one reply, and the replay asserts 27 for 61 events                                                                                                                                                      |
| Events without an id stop counting                                | other agent CLIs send no `message.id`                                        | the existing test "counts turns, tool calls and cost from the stream and trips ceilings" feeds events with no id and still expects 2 turns and `turns 3 > 2`                                                                                              |
| Tool calls are counted once per reply instead of per block        | the dedupe must apply to turns only                                          | the reply test asserts 2 and then 4 tool calls                                                                                                                                                                                                            |
| The default changes in one place but not the other                | the spec default and the engine fallback are separate                        | the acceptance Select-String finds no `c.turns : 60` in `engine.ts`; eslint fails on the unused `DEFAULT_RUN_CEILINGS` import if the fallback line is left; the byte-for-byte spec fixture fails unless both its `turns` and its default decision say 150 |
| Goldens are hand-edited, or refreshed before the constant changed | they pin the hashes of the rendered ceilings                                 | work item 7 runs after items 1 to 6, and the acceptance shortstat must be exactly 10 files, 40 insertions and 40 deletions                                                                                                                                |
| The repository's own agent profile is edited                      | `.incubator/agent-profile.json` is a pinned contract and a human-only change | the plan names no such file; `pnpm check:quick` runs `contracts-pin`                                                                                                                                                                                      |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | A real update run was stopped at "turns 61 > 60" after 27 replies; the owner asked for correct counting and a 150-turn limit                                                                                                                                                                                                                                                                                                                                                    | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy, full quick gate): FIX-FIRST. Must-fix: the fixture's recorded default decision also said 60, and the 10 template goldens pin the rendered ceilings, so the quick gate failed; both are now work items with mechanical checks. Also: the engine fallback is checked by Select-String (typecheck would not catch it), `thinking` blocks are named, and the template's own fallback is stated as out of scope | CLOSED |
