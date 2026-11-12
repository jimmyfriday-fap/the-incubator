# Plan 080: Backshack builds stop on an estimated cost mid-run and keep tests out of backshack-dev

## Executor preamble

You are a literal executor. Do exactly the numbered work items below, in order, and nothing else.

- Output only the edits listed. No conversational text in any file.
- Every path is relative to the repository root. Edit only the files named in "Touched files and markers".
- Use the `old` text exactly as shown. If an `old` block is not found verbatim, STOP and report the mismatch. Never guess a nearby location.
- Add no new dependencies and no new imports except the one named in work item 5.
- Do not commit, do not push, do not open a pull request.
- Do not edit, skip or delete any existing test.
- After all items, run the acceptance commands and report their output.

Lane conformance: not applicable (Incubator engine code, not a Backshack tool or plugin).

Why: a Backshack build's part 2 cost $17.91 against a $10 ceiling, because the agent reports its cost only at the end. A plan step also asked for tests in backshack-dev, where the Build Contract forbids them, so the run parked.

## Work items

### 1. Price table and estimator

File: `packages/core/src/handoff.ts`

old:

```ts
const count = (n: number): string => n.toLocaleString('en-US');
```

new:

```ts
const count = (n: number): string => n.toLocaleString('en-US');

/** Plan 080: list prices in dollars per million tokens, from the claude-api reference (cached 2026-11-03). */
export const LIST_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

/**
 * Plan 080: what the tokens so far cost at list price, or null when the model has no price. Cache writes are priced
 * at twice the input rate (the 1-hour cache), so the estimate errs toward stopping early.
 */
export function estimateCostUsd(model: string | null, t: TokenUsage): number | null {
  if (!model) return null;
  const p = LIST_PRICES[model.replace(/\[.*\]$/, '').trim()];
  if (!p) return null;
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheWrite * p.input * 2 +
      t.cacheRead * p.cacheRead) /
    1_000_000
  );
}
```

### 2. Comment on the dollar ceiling

File: `packages/core/src/handoff.ts`

old:

```ts
/** Dollars at list price. The agent reports its cost only in its final message, so this stops nothing mid-run. */
```

new:

```ts
/**
 * Dollars at list price. Mid-run the monitor estimates it from the tokens and the model (plan 080); the agent's own
 * figure, sent in its final message, wins once it arrives.
 */
```

### 3. The estimate getter on CeilingMonitor

File: `packages/core/src/handoff.ts`

old:

```ts
    return { ...u, total: u.input + u.output + u.cacheWrite + u.cacheRead };
  }
```

new:

```ts
    return { ...u, total: u.input + u.output + u.cacheWrite + u.cacheRead };
  }

  /** Plan 080: the cost so far at list price, from the tokens and the model; null when the model has no price. */
  get estimatedUsd(): number | null {
    return estimateCostUsd(this.model, this.tokens);
  }
```

### 4. Trip on the estimate

File: `packages/core/src/handoff.ts`

old:

```ts
    else if (this.costUsd !== null && this.costUsd > this.ceilings.usd)
      this.tripped = `cost $${this.costUsd} > $${this.ceilings.usd}`;
```

new:

```ts
    else if (this.costUsd !== null && this.costUsd > this.ceilings.usd)
      this.tripped = `cost $${this.costUsd} > $${this.ceilings.usd}`;
    else if (this.costUsd === null && (this.estimatedUsd ?? 0) > this.ceilings.usd)
      this.tripped = `cost ~$${(this.estimatedUsd ?? 0).toFixed(2)} > $${this.ceilings.usd} (estimated)`;
```

### 5. Import the estimator in the handoff tests

File: `packages/core/src/handoff.test.ts`

old:

```ts
  continuationText,
  handoffPrompt,
```

new:

```ts
  continuationText,
  estimateCostUsd,
  handoffPrompt,
```

### 6. Tests for the estimate

File: `packages/core/src/handoff.test.ts`

old:

```ts
  it('takes the final token totals from the result event, and has no cap unless one is set', () => {
```

new:

```ts
  it('trips the dollar ceiling mid-stream on the list-price estimate, before any cost is reported (plan 080)', () => {
    const m = new CeilingMonitor({ turns: 99, toolCalls: 99, minutes: 1, usd: 1 }, false);
    m.feed(`${JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5-5' })}\n`);
    const reply = (id: string, output: number) =>
      `${JSON.stringify({ type: 'assistant', message: { id, content: [], usage: { output_tokens: output } } })}\n`;
    // 40,000 output tokens at $20 per million is $0.80: under the $1 ceiling.
    expect(m.feed(reply('msg_1', 40_000))).toBeNull();
    expect(m.estimatedUsd).toBeCloseTo(0.8, 6);
    // 20,000 more makes $1.20: over it.
    expect(m.feed(reply('msg_2', 20_000))).toBe('cost ~$1.20 > $1 (estimated)');
    expect(m.costUsd).toBeNull();
  });

  it('never trips on an estimate for a model it has no price for (plan 080)', () => {
    const m = new CeilingMonitor({ turns: 99, toolCalls: 99, minutes: 1, usd: 1 }, false);
    m.feed(`${JSON.stringify({ type: 'system', subtype: 'init', model: 'fake-agent-model' })}\n`);
    m.feed(
      `${JSON.stringify({ type: 'assistant', message: { id: 'a', content: [], usage: { output_tokens: 50_000_000 } } })}\n`,
    );
    expect(m.estimatedUsd).toBeNull();
    expect(m.tripped).toBeNull();
  });

  it('prices tokens at list price, cache writes at twice the input rate (plan 080)', () => {
    const t = {
      input: 1_000_000,
      output: 1_000_000,
      cacheWrite: 1_000_000,
      cacheRead: 1_000_000,
      total: 4_000_000,
    };
    // Sonnet 5.5: $2 input + $10 output + $4 cache write + $0.10 cache read.
    expect(estimateCostUsd('claude-sonnet-5-5', t)).toBeCloseTo(16.1, 6);
    expect(estimateCostUsd('claude-sonnet-5-5[1m]', t)).toBeCloseTo(16.1, 6);
    expect(estimateCostUsd('gpt-5', t)).toBeNull();
    expect(estimateCostUsd(null, t)).toBeNull();
  });

  it('takes the final token totals from the result event, and has no cap unless one is set', () => {
```

### 7. Prompt rule: tests stay out of backshack-dev

File: `packages/core/prompts/handoff-backshack.md`

old:

```md
version: 1.0.0
```

new:

```md
version: 1.1.0
```

old:

```md
4. Do not commit, push or open a pull request. The owner commits on this worktree's branch; the handoff to staging is theirs.
```

new:

```md
4. Do not commit, push or open a pull request. The owner commits on this worktree's branch; the handoff to staging is theirs.
5. Tests live only in backshack-generator (contract Section 5). When a plan step asks for tests in this repository, write no test files here. Put the scenarios the generator suite needs (the cases, the fixtures, the two-group isolation test) in that step's design file, name `/test-newslug-scaffolding` as the follow-up in your summary, and set the step's ticket to READY_FOR_TEST.
```

### 8. Test for the prompt rule

File: `packages/core/src/backshack.test.ts`

old:

```ts
    expect(handoffPrompt(plan, undefined, { contract: CONTRACT })).toContain(CONTRACT.trim());
  });
```

new:

```ts
    expect(handoffPrompt(plan, undefined, { contract: CONTRACT })).toContain(CONTRACT.trim());
  });

  it('keeps tests out of backshack-dev: a test step becomes scenarios for backshack-generator (plan 080)', () => {
    const p = handoffPrompt(plan, { checks: [] }, { contract: CONTRACT });
    expect(p).toContain('Tests live only in backshack-generator');
    expect(p).toContain('/test-newslug-scaffolding');
    for (const other of [handoffPrompt(plan), handoffPrompt(plan, { checks: [] })])
      expect(other).not.toContain('Tests live only in backshack-generator');
  });
```

## Touched files and markers

| File                                         | Marker                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `packages/core/src/handoff.ts`               | `export function estimateCostUsd(`                               |
| `packages/core/src/handoff.test.ts`          | `trips the dollar ceiling mid-stream on the list-price estimate` |
| `packages/core/prompts/handoff-backshack.md` | `5. Tests live only in backshack-generator`                      |
| `packages/core/src/backshack.test.ts`        | `keeps tests out of backshack-dev`                               |

## Acceptance commands

Run from the repository root:

```bash
pnpm exec vitest run packages/core/src/handoff.test.ts packages/core/src/backshack.test.ts
```

Expected:

```text
Test Files  2 passed (2)
(every test passes, including the four new plan 080 tests; 0 failed)
```

## Drift and hallucination guardrails

| Trap                                          | Why                                                 | Mechanical check                                                                                                    |
| --------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The estimate trips an existing test           | Older tests feed usage with an init model           | The vitest command above exits 0                                                                                    |
| The estimate overrides the agent's own figure | Wrong branch order in the chain                     | Work item 4 checks `this.costUsd === null`; the new test asserts `costUsd` stays null after the trip                |
| An unknown model trips on a guess             | A default price was added                           | The new test "never trips on an estimate for a model it has no price for"                                           |
| The prompt rule leaks into other stacks       | Text added to `handoff.md` or `handoff-external.md` | The new backshack test asserts that the other prompts lack it; `git diff --stat` lists only the four manifest files |
| An existing test was weakened                 | The executor "fixed" a red test                     | `git diff -- packages/core/src/*.test.ts` shows only additions (no `-` lines except the import line)                |

## Review rounds

| Round | Reviewer              | Finding                                                                                                                                                    | Status |
| ----- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | in session (Opus 5.5) | Prices checked against the claude-api reference; the chain order keeps the reported cost authoritative; `handoff-backshack` has no version pin or snapshot | CLOSED |
