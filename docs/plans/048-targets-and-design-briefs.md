# Plan 048: an update plan points at the files a request names, and its design files read as briefs, not designs

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 6 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/core/src/enhance.ts` contains `export function resolveTargets(` and `function fill(template: string`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Two follow-ups from a real update run (a Support feature for a Flutter app):

1. **Targets.** `resolveTargets` (`packages/core/src/enhance.ts`) matches the request's words against the scan. It has two flaws:
   - `support` is in its `STOP` list, so a request about a support feature never matches `lib/features/support/`.
   - A file's score is summed over every route, command or table it holds, so a file with many routes that share one common word outranks the file the request actually names.

   After this plan:
   - `support` is dropped from the request's summary, where it is usually filler ("add support for"), but kept when it is part of the feature id (`support-tickets`). `user`, `users` and `page` stay stop words: kept from an id, they would match every `page.tsx`, `*_page.dart` or `users` file.
   - A target scores the number of different request words it matches, times the highest weight among its matching entries. Ties are still broken by path.

2. **Design files.** Each `.incubator/enhance/<date>/design-<id>.md` is the lane's design-stage prompt with its placeholders filled in. It reads like a finished design, so the agent treats it as one and never writes the design. After this plan the file:
   - starts with a line saying it is a brief, not a design yet;
   - ends with the five headings of the design stage's output contract (`## Approach`, `## Files to change`, `## New files`, `## Risks`, `## Open questions`), each saying `_Not written yet._`.

   The update plan's preamble and steps tell the agent to write the design into that file first.

## Work items

### 1. Naming words are kept from the feature id only

In `packages/core/src/enhance.ts`:

Find:

```text
  'use',
  'support',
  'allow',
  'when',
  'should',
  'able',
  'user',
  'users',
  'page',
  'feature',
```

Replace with:

```text
  'use',
  'allow',
  'when',
  'should',
  'able',
  'user',
  'users',
  'page',
  'feature',
```

Find:

```text
function tokens(text: string): string[] {
  const out = new Set<string>();
  for (const t of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length < 3 || STOP.has(t)) continue;
```

Replace with:

```text
/** Plan 048: filler in a summary ("add support for"), but the subject when the feature id holds it. */
const NAMING = new Set(['support']);

function tokens(text: string, keepNaming = false): string[] {
  const out = new Set<string>();
  for (const t of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length < 3 || STOP.has(t) || (!keepNaming && NAMING.has(t))) continue;
```

### 2. A target scores distinct words, not repeated entries

In `packages/core/src/enhance.ts`, inside `resolveTargets`:

Find:

```text
  const toks = tokens(`${feature.id.replace(/-/g, ' ')} ${feature.summary}`);
  if (!toks.length) return [];
  const score = new Map<string, number>();
  const bump = (target: string, text: string, weight: number): void => {
    const l = text.toLowerCase();
    const n = toks.filter((t) => l.includes(t)).length;
    if (n) score.set(target, (score.get(target) ?? 0) + n * weight);
  };
```

Replace with:

```text
  const toks = [
    ...new Set([...tokens(feature.id.replace(/-/g, ' '), true), ...tokens(feature.summary)]),
  ].sort(cmp);
  if (!toks.length) return [];
  // Plan 048: a target scores the different words it matches, so a file with many routes sharing one word does not win.
  const hits = new Map<string, { words: Set<string>; weight: number }>();
  const bump = (target: string, text: string, weight: number): void => {
    const l = text.toLowerCase();
    const found = toks.filter((t) => l.includes(t));
    if (!found.length) return;
    const h = hits.get(target) ?? { words: new Set<string>(), weight: 0 };
    for (const t of found) h.words.add(t);
    h.weight = Math.max(h.weight, weight);
    hits.set(target, h);
  };
```

Find:

```text
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
```

Replace with:

```text
  return [...hits.entries()]
    .map(([target, h]): [string, number] => [target, h.words.size * h.weight])
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
```

### 3. The design file is a brief with the design's headings at its end

In `packages/core/src/enhance.ts`:

Find:

```text
export function ticketId(f: Pick<Feature, 'id'>): string {
  return `E-${f.id}`;
}
```

Replace with:

```text
export function ticketId(f: Pick<Feature, 'id'>): string {
  return `E-${f.id}`;
}

/**
 * Plan 048: the headings of the design stage's output contract (`.incubator/lanes/<lane>/design.md`). The
 * other copies are in `scripts/guard/lane-contract.mjs` and its template-pack copy.
 */
export const DESIGN_HEADINGS: readonly string[] = [
  'Approach',
  'Files to change',
  'New files',
  'Risks',
  'Open questions',
];

/**
 * Plan 048: a delivered design file is the design stage's brief, marked as one, with the headings the
 * design is written under at its end, so it never reads as a finished design.
 */
export function designFile(ticket: string, brief: string): string {
  return [
    `> **Design brief for \`${ticket}\`: not a design yet.** The instructions below are for the design stage. Write the design at the end of this file, under the headings there, before you enrich and code this ticket.`,
    '',
    brief.trimEnd(),
    '',
    '---',
    '',
    '<!-- The design for this ticket, written at the design stage: replace each "Not written yet." -->',
    '',
    ...DESIGN_HEADINGS.flatMap((h) => [`## ${h}`, '', '_Not written yet._', '']),
  ].join('\n');
}
```

Find:

```text
      file(
        `${dir}/design-${f.id}.md`,
        fill(brief.bytes.toString('utf8'), {
```

Replace with:

```text
      file(
        `${dir}/design-${f.id}.md`,
        designFile(ticketId(f), fill(brief.bytes.toString('utf8'), {
```

Find:

```text
        }),
      ),
    );
    put(
      file(
        `.incubator/tickets/${ticketId(f)}.json`,
```

Replace with:

```text
        })),
      ),
    );
    put(
      file(
        `.incubator/tickets/${ticketId(f)}.json`,
```

### 4. The plan tells the agent to write the design first

In `packages/core/src/enhance.ts`, inside `renderPlan`:

Find:

```text
      `- Design: ${dir}/design-${f.id}.md`,
```

Replace with:

```text
      `- Design (write it first): ${dir}/design-${f.id}.md`,
```

Find:

```text
    '2. Touch only the listed targets unless the design says otherwise and gives the reason.',
```

Replace with:

```text
    "2. Touch only the listed targets and the step's design file unless the design says otherwise and gives the reason.",
```

Find:

```text
    "1. Run the design stage (`.incubator/lanes/<lane>/design.md`) on the ticket, then the lane's enrich",
    '   and codegen stages, in that order.',
```

Replace with:

```text
    "1. Write the step's design into its design file first: the file starts with the brief for the design",
    '   stage (`.incubator/lanes/<lane>/design.md`) and ends with the headings to fill in. Then run the',
    "   lane's enrich and codegen stages, in that order.",
```

### 5. Tests

In `packages/core/src/enhance.test.ts`:

Find:

```text
import {
  EXTERNAL_LANE_WORDING,
  featureIssues,
  nextPlanNumber,
  resolveTargets,
  sanitizeRequest,
  ticketId,
} from './enhance.js';
```

Replace with:

```text
import {
  DESIGN_HEADINGS,
  EXTERNAL_LANE_WORDING,
  designFile,
  featureIssues,
  nextPlanNumber,
  resolveTargets,
  sanitizeRequest,
  ticketId,
} from './enhance.js';
```

Find:

```text
    expect(plan).toContain('**Step 1:** Export the day');
    expect(plan).toContain('- Target: src/server.js');
```

Replace with:

```text
    expect(plan).toContain('**Step 1:** Export the day');
    expect(plan).toContain('- Target: src/server.js');
    expect(plan).toContain(
      '- Design (write it first): .incubator/enhance/20260501/design-export-orders.md',
    );
    expect(plan).toContain("1. Write the step's design into its design file first");
```

Find:

```text
    expect(brief).toContain('`E-export-orders`');
    expect(brief).not.toMatch(/\{\{[A-Z_]+\}\}/);
```

Replace with:

```text
    expect(brief).toContain('`E-export-orders`');
    expect(brief).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(
      brief.startsWith('> **Design brief for `E-export-orders`: not a design yet.**'),
    ).toBe(true);
    expect(brief).toContain('## Open questions\n\n_Not written yet._\n');
    const laneDesign = readFileSync(
      path.join(ws, '.incubator/lanes/enhancement/existing/design.md'),
      'utf8',
    );
    for (const heading of DESIGN_HEADINGS) expect(laneDesign).toContain(`\`## ${heading}\``);
```

Find:

```text
    expect(resolveTargets(scan, { id: 'zzz', summary: 'unrelated' })).toEqual([]);
  });
```

Replace with:

```text
    expect(resolveTargets(scan, { id: 'zzz', summary: 'unrelated' })).toEqual([]);
  });

  it('keeps "support" when the feature id names it, and drops it as filler in the summary (plan 048)', () => {
    const scan = {
      routes: [],
      commands: [],
      dataModel: [],
      entryPoints: [],
      modules: [
        { dir: 'lib/features/support', files: 3, languages: ['Dart'] },
        { dir: 'lib/features/schedule', files: 5, languages: ['Dart'] },
      ],
    } as unknown as RepoScan;
    expect(
      resolveTargets(scan, {
        id: 'support-tickets',
        summary: 'Let members send a question to the team',
      }),
    ).toEqual(['lib/features/support/']);
    expect(
      resolveTargets(scan, { id: 'csv-export', summary: 'Add support for exporting the schedule' }),
    ).toEqual(['lib/features/schedule/']);
  });

  it('does not keep "page" from the feature id, so every page file is not a target (plan 048)', () => {
    const scan = {
      routes: [
        { method: 'GET', path: '/pricing', file: 'app/pricing/page.tsx', framework: 'next' },
        { method: 'GET', path: '/about', file: 'app/about/page.tsx', framework: 'next' },
      ],
      commands: [],
      dataModel: [],
      entryPoints: [],
      modules: [],
    } as unknown as RepoScan;
    expect(
      resolveTargets(scan, { id: 'pricing-page', summary: 'Show the plans and their prices' }),
    ).toEqual(['app/pricing/page.tsx']);
  });

  it('ranks the file that matches more of the request above a file with many routes (plan 048)', () => {
    const routes = Array.from({ length: 10 }, (_, i) => ({
      method: 'GET',
      path: `/calendar/day/${i}`,
      file: 'src/routes.js',
      framework: 'node',
    }));
    routes.push({
      method: 'GET',
      path: '/billing/invoice-export',
      file: 'src/billing.js',
      framework: 'node',
    });
    const scan = {
      routes,
      commands: [],
      dataModel: [],
      entryPoints: [],
      modules: [],
    } as unknown as RepoScan;
    expect(
      resolveTargets(scan, { id: 'invoice-export', summary: 'Export invoices from the calendar' }),
    ).toEqual(['src/billing.js', 'src/routes.js']);
  });

  it("writes a design file as a brief with the design's headings at its end (plan 048)", () => {
    const text = designFile('E-x', '# Design: `enhancement/new` lane\n\nBrief text.\n');
    expect(text.startsWith('> **Design brief for `E-x`: not a design yet.**')).toBe(true);
    expect(text).toContain('Brief text.\n\n---\n');
    expect(text.match(/^## .+$/gm)).toEqual([
      '## Approach',
      '## Files to change',
      '## New files',
      '## Risks',
      '## Open questions',
    ]);
    expect(text.endsWith('_Not written yet._\n')).toBe(true);
  });
```

### 6. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/enhance.ts packages/core/src/enhance.test.ts
```

## Touched files and markers

| File                                | Marker                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/core/src/enhance.ts`      | `const NAMING = new Set(['support']);`                                                     |
| `packages/core/src/enhance.test.ts` | `ranks the file that matches more of the request above a file with many routes (plan 048)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/enhance.test.ts tests/scenarios.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
enhance.test.ts passes, including the four new plan 048 tests, the existing "resolves targets by word match" test and the Flutter targets test
tests/scenarios.test.ts passes
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                       | Why                                                        | Mechanical check                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support` is simply removed from `STOP`, so "add support for X" points at a support module | the summary's filler would then match every support folder | the new test asserts `csv-export` / "Add support for exporting the schedule" resolves to `lib/features/schedule/` only                                                        |
| `page` or `user` kept from the feature id                                                  | every `page.tsx` or `users` file would become a target     | the pricing-page test expects exactly `['app/pricing/page.tsx']`                                                                                                              |
| The score still sums repeated entries                                                      | `hits` could be keyed per entry by mistake                 | the new test has 10 routes in `src/routes.js` sharing one word and expects `src/billing.js` first; the old code returns `src/routes.js` first                                 |
| Existing targets change                                                                    | the scoring formula changed                                | the existing "resolves targets by word match" test (exact order) and the Flutter test still pass; the change was prototyped against both before this plan was written         |
| The design file's headings drift from the design template's contract                       | `DESIGN_HEADINGS` is a hand-kept copy                      | the delivery test asserts every `DESIGN_HEADINGS` entry appears, in backticks, as `## <name>` in the delivered lane `design.md`; the unit test asserts the exact heading list |
| The design file still reads as finished                                                    | the brief text is unchanged                                | the delivery test asserts the file starts with `> **Design brief for`, and ends with `## Open questions` followed by `_Not written yet._`                                     |
| A placeholder is left unfilled after wrapping                                              | `designFile` wraps `fill`'s result                         | the existing assertion `expect(brief).not.toMatch(/\{\{[A-Z_]+\}\}/)` still runs                                                                                              |

## Review rounds

| Round | Finding                                                                                                                                                                                                                        | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 2     | Opus review: keeping page/user from the id made every page file a target; headings are now checked against the delivered lane template; rule 2 of the delivered preamble names the design file; plan formatted for check:quick | CLOSED |
| 1     | Follow-ups from a real update run: "support" was a stop word and busy files won the target picking; design files came out as filled templates                                                                                  | CLOSED |
