# Plan 024: tabs on the run page and the Settings page

## Executor preamble

You are implementing an exact layout change. Rules for every work item:

- Change only the files named here, at the places named. Work item 9 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Copy every string exactly as written. Blocks in `text` fences carry the file's own indentation; keep it.
- Keep every existing `data-testid` exactly as it is; the browser tests find elements by them.
- Do not touch anything under `packages/`. Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or
  weaken any test (work item 8 adds tab clicks to three existing browser tests; it removes nothing).
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** At review the run page stacked the project banner, the header, the brief, the plan diff, an 18-row
editor, checks, the file tree and the log: three to four thousand pixels of scrolling (the decisions list alone is
long, so it now scrolls inside a 560 px box). The owner asked for a
standard tabbed layout. The run page gets four tabs, **Overview · Plan · Files · Log**, under the always-visible
header (state, Stop, Cancel, errors, Resume). The tab follows the run: Plan while the plan waits for review, Overview
at every other step; a tab the owner picks stays until the run moves on. Panels stay mounted and are only hidden,
so nothing is lost when switching. Settings gets three section tabs.

## Work items

### 1. The tabs component

Create `apps/web/src/ui/views/Tabs.tsx` with exactly:

```tsx
import type { ReactNode } from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Something on this tab needs the owner now: the label shows a dot. */
  attention?: boolean;
}

/** A row of tabs (plan 024). The panels stay mounted and are only hidden, so nothing is lost on a switch. */
export function Tabs<T extends string>(props: {
  name: string;
  label: string;
  tabs: readonly TabDef<T>[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="tabbar" role="tablist" aria-label={props.label}>
      {props.tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${props.name}-${t.id}`}
          data-testid={`${props.name}-${t.id}`}
          aria-selected={props.active === t.id}
          aria-controls={`${props.name}-panel-${t.id}`}
          className={props.active === t.id ? 'tabbtn on' : 'tabbtn'}
          onClick={() => props.onSelect(t.id)}
        >
          {t.label}
          {t.attention && <span className="dot" title="Needs you" />}
        </button>
      ))}
    </div>
  );
}

/** One tab's content; hidden (not removed) while another tab is active. */
export function TabPanel(props: { name: string; id: string; active: string; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      className="tabpanel"
      id={`${props.name}-panel-${props.id}`}
      aria-labelledby={`${props.name}-${props.id}`}
      data-testid={`${props.name}-panel-${props.id}`}
      hidden={props.active !== props.id}
    >
      {props.children}
    </div>
  );
}
```

### 2. Styles for the tabs

Append this block at the very end of `apps/web/src/ui/styles.css`, after one empty line:

```css
/* --- tabs (plan 024) --- */

[hidden] {
  display: none !important;
}

.tabbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s1);
  border-bottom: 1px solid var(--line);
}

.tabbar button.tabbtn {
  margin: 0 0 -1px;
  padding: var(--s3) var(--s4);
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  box-shadow: none;
  font-weight: 600;
}

.tabbar button.tabbtn:hover:not(:disabled) {
  background: transparent;
  color: var(--text);
  box-shadow: none;
}

.tabbar button.tabbtn.on {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.run > .tabpanel {
  display: grid;
  gap: var(--s5);
}

.review-grid .decisions ul {
  max-height: 560px;
  overflow: auto;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border-radius: var(--r-pill);
  background: var(--warn);
  vertical-align: middle;
}
```

### 3. The run page: imports and the followed tab

File: `apps/web/src/ui/views/RunView.tsx`

3a. Replace this exact line:

```text
import { Summary } from './Summary.js';
```

with:

```text
import { Summary } from './Summary.js';
import { TabPanel, Tabs } from './Tabs.js';
```

3b. Replace this exact line:

```text
/** One run: the step that needs you (questions, review, resume), the outcome, the tree and the log. */
```

with:

```text
type RunTab = 'overview' | 'plan' | 'files' | 'log';

/** One run: the header, then tabs for what needs you, the plan, the files and the log (plan 024). */
```

3c. Replace this exact block:

```text
  const [stopping, setStopping] = useState(false);
  const [confirming, setConfirming] = useState(false);
```

with:

```text
  const [stopping, setStopping] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState<RunTab>('overview');
```

3d. Replace this exact block:

```text
  // The stop has taken effect once the run is no longer working.
  useEffect(() => {
    if (run && !run.busy) setStopping(false);
  }, [run]);
```

with:

```text
  // The stop has taken effect once the run is no longer working.
  useEffect(() => {
    if (run && !run.busy) setStopping(false);
  }, [run]);

  // The tab follows the run (plan 024): Plan while the plan waits for review, Overview at every other step. A
  // tab the owner picks stays until the run moves on to another step.
  const step: string | null = !run
    ? null
    : run.busy
      ? 'working'
      : [run.state, run.parked?.state ?? '', run.parked?.reason ?? '', run.done ? 'done' : ''].join(':');
  useEffect(() => {
    const follow: RunTab = step?.startsWith('PARKED:REVIEW:') ? 'plan' : 'overview';
    if (step) setTab(follow);
  }, [step]);
```

### 4. The run page: the tabs and their panels

File: `apps/web/src/ui/views/RunView.tsx`. Replace this exact block (it is the end of the component, from the
`Coding` line to the `RunLog` line):

```text
      {coding && <Coding run={run} />}
      {committing && run.finish && (
```

with:

```text
      <Tabs
        name="runtab"
        label="Run sections"
        active={tab}
        onSelect={setTab}
        tabs={[
          {
            id: 'overview',
            label: 'Overview',
            attention: committing || pushing || requesting || asking || stuck || stopped,
          },
          { id: 'plan', label: 'Plan', attention: reviewing },
          { id: 'files', label: 'Files' },
          { id: 'log', label: 'Log' },
        ]}
      />
      <TabPanel name="runtab" id="overview" active={tab}>
      {coding && <Coding run={run} />}
      {reviewing && (
        <p className="muted" data-testid="overview-review-note">
          The plan is ready for your review in the Plan tab.
        </p>
      )}
      {committing && run.finish && (
```

Then replace this exact block:

```text
      {reviewing && (
        <Review
```

with:

```text
      {run.done && !run.cancelled && <Summary run={run} />}
      </TabPanel>
      <TabPanel name="runtab" id="plan" active={tab}>
      {!reviewing && (
        <p className="muted" data-testid="plan-note">
          The plan is shown here while it waits for your review.
        </p>
      )}
      {reviewing && (
        <Review
```

Then replace this exact block:

```text
      {run.done && !run.cancelled && <Summary run={run} />}
      {run.specComplete && <Tree runId={runId} rev={run.rev} />}
      <RunLog entries={entries} />
```

with:

```text
      </TabPanel>
      <TabPanel name="runtab" id="files" active={tab}>
      {run.specComplete ? (
        <Tree runId={runId} rev={run.rev} />
      ) : (
        <p className="muted" data-testid="files-note">
          The files appear here once the plan is complete.
        </p>
      )}
      </TabPanel>
      <TabPanel name="runtab" id="log" active={tab}>
      <RunLog entries={entries} />
      </TabPanel>
```

After these three replacements, `<Summary` appears exactly once in the file (inside the Overview panel), and
`<RunLog` appears exactly once (inside the Log panel).

### 5. Settings: imports and the section tab

File: `apps/web/src/ui/views/Settings.tsx`

5a. Replace this exact line:

```text
import { get, put } from '../api.js';
```

with:

```text
import { get, put } from '../api.js';
import { TabPanel, Tabs } from './Tabs.js';

type Section = 'models' | 'limits' | 'accounts';
```

5b. Replace this exact line:

```text
  const [saving, setSaving] = useState(false);
```

with:

```text
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<Section>('models');
```

### 6. Settings: the tabs and panels

File: `apps/web/src/ui/views/Settings.tsx`

6a. Replace this exact block:

```text
      <section className="card wide">
        <h3>AI for planning</h3>
```

with:

```text
      <Tabs
        name="settingstab"
        label="Settings sections"
        active={section}
        onSelect={setSection}
        tabs={[
          { id: 'models', label: 'AI models' },
          { id: 'limits', label: 'Limits & tools' },
          { id: 'accounts', label: 'Accounts & about' },
        ]}
      />
      <section className="card wide" hidden={section === 'accounts'}>
        <TabPanel name="settingstab" id="models" active={section}>
        <h3>AI for planning</h3>
```

6b. Replace this exact line:

```text
        <h3>Limits</h3>
```

with:

```text
        </TabPanel>
        <TabPanel name="settingstab" id="limits" active={section}>
        <h3>Limits</h3>
```

6c. Replace this exact line:

```text
        {problem && <p className="error">{problem}</p>}
```

with:

```text
        </TabPanel>
        {problem && <p className="error">{problem}</p>}
```

6d. Replace this exact block:

```text
      <section className="card wide">
        <h3>Tools found</h3>
```

with:

```text
      <section
        className="card wide"
        role="tabpanel"
        id="settingstab-panel-accounts"
        aria-labelledby="settingstab-accounts"
        data-testid="settingstab-panel-accounts"
        hidden={section !== 'accounts'}
      >
        <h3>Tools found</h3>
```

### 7. Browser test: the tabs

File: `apps/web/e2e/web.e2e.test.ts`

Insert this test, followed by one empty line, directly before the line
`  it('update: a GitHub remote that is not origin is suggested and pre-fills the repository field', async () => {`
(work item 9 indents it):

```ts
it('tabs: the run page opens Plan at review and switches on request; Settings has sections (plan 024)', async () => {
  const { h, page, errors } = await open({ enhance: 'export-orders' });
  const { dir } = await seedAdoptRepo(h, 'bare-node');
  await intent(page).selectOption({ label: 'Update an existing solution' });
  await page.getByTestId('folder-path').fill(dir);
  await page.getByTestId('repo-ref').fill('octo/bare-node');
  await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
  await page.getByTestId('start-enhance').click();
  await page.waitForURL(/\/runs\/[\w-]+$/);
  await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
  expect(await page.getByTestId('runtab-overview').getAttribute('aria-selected')).toBe('true');
  await page
    .getByTestId('request-text')
    .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
  await page.getByTestId('submit-request').click();

  // At review the page opens the Plan tab by itself, and the tab carries a dot.
  await page.getByTestId('review').waitFor({ timeout: 30_000 });
  expect(await page.getByTestId('runtab-plan').getAttribute('aria-selected')).toBe('true');
  expect(await page.getByTestId('runtab-plan').locator('.dot').count()).toBe(1);
  await shot(page, 'tabs-1-plan');

  // Files and Log are one click away; the review stays in place behind its tab.
  await page.getByTestId('runtab-files').click();
  await page.getByTestId('tree').waitFor(UI);
  expect(await page.getByTestId('review').isVisible()).toBe(false);
  await shot(page, 'tabs-2-files');
  await page.getByTestId('runtab-log').click();
  await page.getByTestId('run-log').waitFor(UI);
  await page.getByTestId('runtab-plan').click();
  await page.getByTestId('review').waitFor(UI);

  // Settings has section tabs.
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('coding-model').waitFor(UI);
  await page.getByTestId('settingstab-accounts').click();
  await page.getByTestId('accounts').waitFor(UI);
  expect(await page.getByTestId('coding-model').isVisible()).toBe(false);
  await page.getByTestId('settingstab-limits').click();
  await page.getByTestId('gc-days').waitFor(UI);
  await shot(page, 'tabs-3-settings');
  expect(errors, errors.join('\n')).toEqual([]);
});
```

### 8. Browser tests that click inside the Files or Log tab

File: `apps/web/e2e/web.e2e.test.ts`. These existing tests click elements that now live behind a tab. Add the tab
click; change nothing else.

8a. Replace this exact block:

```text
    // The tree preview exists at REVIEW and opens files from memory.
    await page.getByTestId('tree').getByRole('button', { name: 'CLAUDE.md', exact: true }).click();
    await expect.poll(() => page.getByTestId('file-view').textContent(), UI).toContain('Stockroom');
```

with:

```text
    // The tree preview exists at REVIEW and opens files from memory.
    await page.getByTestId('runtab-files').click();
    await page.getByTestId('tree').getByRole('button', { name: 'CLAUDE.md', exact: true }).click();
    await expect.poll(() => page.getByTestId('file-view').textContent(), UI).toContain('Stockroom');
    await page.getByTestId('runtab-plan').click();
```

8b. Replace this exact line:

```text
    await page.getByTestId('log-filter').selectOption('warn');
```

with:

```text
    await page.getByTestId('runtab-log').click();
    await page.getByTestId('log-filter').selectOption('warn');
```

8c. Replace this exact block:

```text
    await tree
      .getByRole('button', { name: 'docs/plans/001-enhance-20260501.md', exact: true })
      .click();
    await expect.poll(() => page.getByTestId('file-view').textContent(), UI).toContain('Step 1');
    await shot(page, 'enhance-2-review');
```

with:

```text
    await page.getByTestId('runtab-files').click();
    await tree
      .getByRole('button', { name: 'docs/plans/001-enhance-20260501.md', exact: true })
      .click();
    await expect.poll(() => page.getByTestId('file-view').textContent(), UI).toContain('Step 1');
    await shot(page, 'enhance-2-review');
    await page.getByTestId('runtab-plan').click();
```

8d. Replace this exact line (in the stop-and-cancel test):

```text
    await shot(page, 'stop-1-coding');
```

with:

```text
    await shot(page, 'stop-1-coding');
    // A tab picked while the agent works stays picked as the run refreshes (plan 024).
    await page.getByTestId('runtab-log').click();
    const progress = await page.getByTestId('coding-progress').textContent();
    await expect.poll(() => page.getByTestId('coding-progress').textContent(), UI).not.toBe(progress);
    expect(await page.getByTestId('runtab-log').getAttribute('aria-selected')).toBe('true');
```

### 9. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write apps/web/src/ui/views/Tabs.tsx apps/web/src/ui/styles.css apps/web/src/ui/views/RunView.tsx apps/web/src/ui/views/Settings.tsx apps/web/e2e/web.e2e.test.ts
```

## Touched files and markers

| File                                 | Marker                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `apps/web/src/ui/views/Tabs.tsx`     | `export function TabPanel(`                                                                   |
| `apps/web/src/ui/styles.css`         | `/* --- tabs (plan 024) --- */`                                                               |
| `apps/web/src/ui/views/RunView.tsx`  | `<TabPanel name="runtab" id="files" active={tab}>`                                            |
| `apps/web/src/ui/views/Settings.tsx` | `name="settingstab"`                                                                          |
| `apps/web/e2e/web.e2e.test.ts`       | `the run page opens Plan at review and switches on request; Settings has sections (plan 024)` |

## Acceptance commands

```sh
pnpm exec vitest run apps/web/src/ui
pnpm exec tsc -p apps/web/src/ui/tsconfig.json --noEmit
pnpm exec eslint --max-warnings=0 apps/web
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; pnpm test:e2e
(Select-String -SimpleMatch -Path apps/web/src/ui/views/RunView.tsx '<Summary').Count
(Select-String -SimpleMatch -Path apps/web/src/ui/views/RunView.tsx '<RunLog').Count
(Select-String -SimpleMatch -Path apps/web/e2e/web.e2e.test.ts "getByTestId('runtab-").Count
pnpm check:quick
```

```text
the UI unit tests pass (including the stylesheet token test) and the UI typechecks
eslint on apps/web exits 0
the e2e suite passes, including "the run page opens Plan at review and switches on request; Settings has sections (plan 024)"
both Select-String counts print 1
the runtab count prints 13 (work items 7 and 8 add 13 runtab references; none existed before)
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                        | Why                                                         | Mechanical check                                                                                                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A panel unmounts its content and loses edits                                | the review editor and answers must survive a tab switch     | `TabPanel` hides with the `hidden` attribute; the e2e switches away from Plan and back to `review`                                                                    |
| `display: grid` defeats `hidden`                                            | a class display rule overrides the browser's `hidden` style | the `[hidden] { display: none !important; }` rule; the e2e asserts `review.isVisible()` is false in Files                                                             |
| The page does not open the step that needs the owner                        | at review the Approve button is in the Plan tab             | the e2e asserts `runtab-plan` is selected at review and `runtab-overview` at the change request; the stop test then waits for `commit-request` after a tab was picked |
| A picked tab snaps back, or never moves on                                  | the effect must key on the step, not on the run object      | the stop test's `runtab-log` guard (picked tab survives refreshes), then the `commit-request` wait after resume                                                       |
| Grid panels inside the Settings card stretch buttons and double the spacing | `.tabpanel` grid would apply inside cards too               | the rule is `.run > .tabpanel` only; the `tabs-3-settings` screenshot is checked in review                                                                            |
| An existing test now clicks something hidden                                | the tree and the log moved behind tabs                      | work item 8 adds the tab clicks; the whole e2e suite runs                                                                                                             |
| Summary or the log renders twice or not at all                              | the replacements move them into panels                      | the two `Select-String` counts are exactly 1                                                                                                                          |
| A token is used without being defined                                       | the new CSS uses the stylesheet's tokens                    | the stylesheet test `defines every token it uses`                                                                                                                     |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                    | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The run page at review was 3,000–4,000 px of scrolling; the owner asked for a standard tabbed layout                                                                                                                                                                                                       | CLOSED |
| 2     | Review: a picked tab snapped back on every refresh (commit request hidden behind Log), the panel grid stretched Settings, and one check was human-judged; the effect now keys on the step, panels are `.run > .tabpanel`, a stop-test guard and a counted check were added, and the decisions list scrolls | CLOSED |
