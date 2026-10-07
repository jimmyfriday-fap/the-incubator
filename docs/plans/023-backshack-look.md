# Plan 023: the Backshack look for the web and desktop app

## Executor preamble

You are implementing an exact visual change. Rules for every work item:

- Change only the files named here. Where a work item says "replace the whole file", write exactly the content
  shown. Elsewhere, replace only the exact text named. Work item 11 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Copy every string exactly as written. Blocks in `text` fences carry the file's own indentation; keep it.
- Keep every `data-testid` exactly as it is, and keep the brand link text exactly `The Incubator`: the browser tests
  find elements by them.
- No UI framework and no CSS library: plain CSS only (TDD §9.2). Nothing is loaded from the internet at runtime
  (the app's Content-Security-Policy allows only its own origin), so the font is installed as a package and bundled.
- Do not touch anything under `packages/`. Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or
  weaken any test.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** The app looked basic: a generic palette, system fonts, flat cards, no graphics, and no spacing scale. The
owner asked for the Backshack brand (backshack.ai): Indigo `#4f46e5` / `#4338ca`, Slate text and lines, a slate-800
navigation bar, the Inter font, 8 and 12 px radii, soft shadows and pill buttons. This plan replaces the stylesheet
with a token-based one, adds a navy top bar with a logo mark and icons, a hero with an illustration on Home, empty
states with a small illustration, and the Inter font.

## Work items

### 1. The Inter font

Run exactly:

```powershell
pnpm --filter @incubator/web add -D @fontsource-variable/inter@5.3.0
```

Then, in `apps/web/src/ui/main.tsx`, replace this exact line:

```text
import './styles.css';
```

with:

```text
import '@fontsource-variable/inter';
import './styles.css';
```

### 2. The stylesheet

Replace the whole file `apps/web/src/ui/styles.css` with exactly the content of
`docs/plans/assets/023-styles.css` (copy that file byte for byte over `apps/web/src/ui/styles.css`; do not retype
it). Run exactly:

```powershell
Copy-Item -Force docs/plans/assets/023-styles.css apps/web/src/ui/styles.css
```

### 3. Icons, the logo mark and the illustrations

Create `apps/web/src/ui/views/Icon.tsx` with exactly:

```tsx
/** Small inline icons, the logo mark and the illustrations (plan 023). Inline SVG: nothing is fetched. */

export type IconName = 'home' | 'folder' | 'list' | 'gear' | 'back' | 'forward';

const PATHS: Record<IconName, string[]> = {
  home: ['M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01'],
  gear: [
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    'M12 2v3',
    'M12 19v3',
    'M4.2 4.2l2.1 2.1',
    'M17.7 17.7l2.1 2.1',
    'M2 12h3',
    'M19 12h3',
    'M4.2 19.8l2.1-2.1',
    'M17.7 6.3l2.1-2.1',
  ],
  back: ['M15 18l-6-6 6-6'],
  forward: ['M9 18l6-6-6-6'],
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The Incubator mark: an indigo egg with a smile and a spark. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="inc-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <path
        d="M16 3c-5.5 0-10 8.2-10 14.5C6 23.3 10.5 29 16 29s10-5.7 10-11.5C26 11.2 21.5 3 16 3z"
        fill="url(#inc-logo)"
      />
      <path
        d="M11 18.5c1.6 1.6 3.2 2.4 5 2.4s3.4-.8 5-2.4"
        stroke="#fff"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="21.5" cy="10.5" r="1.6" fill="#fff" opacity="0.85" />
    </svg>
  );
}

/** The Home illustration: an egg under a glass dome on a console, with circuit traces. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 220" aria-hidden="true" data-testid="hero-art">
      <defs>
        <linearGradient id="hero-egg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id="hero-dome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#eef2ff" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect x="40" y="168" width="240" height="24" rx="12" fill="#1e293b" />
      <rect x="64" y="176" width="40" height="8" rx="4" fill="#818cf8" />
      <circle cx="252" cy="180" r="5" fill="#22c55e" />
      <path
        d="M70 168c0-62 40-112 90-112s90 50 90 112z"
        fill="url(#hero-dome)"
        stroke="#c7d2fe"
        strokeWidth="2"
      />
      <path
        d="M160 70c-22 0-40 34-40 60 0 24 18 38 40 38s40-14 40-38c0-26-18-60-40-60z"
        fill="url(#hero-egg)"
      />
      <path
        d="M145 118l10 10 20-22"
        stroke="#fff"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g stroke="#818cf8" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7">
        <path d="M20 60h30l10 10" />
        <circle cx="16" cy="60" r="4" />
        <path d="M300 96h-28l-10 10" />
        <circle cx="304" cy="96" r="4" />
        <path d="M24 130h22" />
        <circle cx="20" cy="130" r="3" />
      </g>
      <g fill="#fbbf24">
        <circle cx="230" cy="40" r="4" />
        <circle cx="96" cy="34" r="3" />
        <circle cx="270" cy="140" r="3" />
      </g>
    </svg>
  );
}

/** An empty list: a small illustration and a sentence. */
export function Empty({ text }: { text: string }) {
  return (
    <div className="empty" data-testid="empty">
      <svg viewBox="0 0 120 90" aria-hidden="true">
        <rect
          x="14"
          y="18"
          width="92"
          height="58"
          rx="10"
          fill="none"
          stroke="#c7d2fe"
          strokeWidth="2"
          strokeDasharray="6 5"
        />
        <path
          d="M60 28c-8 0-14 12-14 21 0 8 6 13 14 13s14-5 14-13c0-9-6-21-14-21z"
          fill="#eef2ff"
          stroke="#818cf8"
          strokeWidth="2"
        />
        <circle cx="96" cy="16" r="4" fill="#fbbf24" />
      </svg>
      <p>{text}</p>
    </div>
  );
}
```

### 4. The top bar

Replace the whole file `apps/web/src/ui/App.tsx` with exactly:

```tsx
import { useEffect, useState } from 'react';
import { getSession } from './api.js';
import { areaOf, historyState, navigate, type Area } from './nav.js';
import { Home } from './views/Home.js';
import { Icon, Logo, type IconName } from './views/Icon.js';
import { ProjectView } from './views/ProjectView.js';
import { ProjectsPage } from './views/Projects.js';
import { RunView } from './views/RunView.js';
import { Runs } from './views/Runs.js';
import { Settings } from './views/Settings.js';

const runPath = /^\/runs\/([A-Za-z0-9-]+)$/;
const projectPath = /^\/projects\/([A-Za-z0-9-]+)$/;

const TABS: { area: Area; label: string; to: string; icon: IconName }[] = [
  { area: 'home', label: 'Home', to: '/', icon: 'home' },
  { area: 'projects', label: 'Projects', to: '/projects', icon: 'folder' },
  { area: 'runs', label: 'Runs', to: '/runs', icon: 'list' },
  { area: 'settings', label: 'Settings', to: '/settings', icon: 'gear' },
];

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [version, setVersion] = useState('');
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    getSession()
      .then((s) => setVersion(s.version))
      .catch(() => setVersion('session expired: reopen the link from `incubator ui`'));
    return () => window.removeEventListener('popstate', on);
  }, []);
  const m = runPath.exec(path);
  const p = projectPath.exec(path);
  const area = areaOf(path);
  // why: read on every render; a navigation always changes `path`, which re-renders the header.
  const { canBack, canForward } = historyState();
  return (
    <>
      <header className="topbar">
        <div className="top">
          <div className="history" role="group" aria-label="History">
            <button
              className="icon"
              data-testid="nav-back"
              aria-label="Back"
              title="Back"
              disabled={!canBack}
              onClick={() => window.history.back()}
            >
              <Icon name="back" />
            </button>
            <button
              className="icon"
              data-testid="nav-forward"
              aria-label="Forward"
              title="Forward"
              disabled={!canForward}
              onClick={() => window.history.forward()}
            >
              <Icon name="forward" />
            </button>
          </div>
          <a
            href="/"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <Logo className="brand-mark" />
            The Incubator
          </a>
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <a
                key={t.area}
                href={t.to}
                data-testid={`tab-${t.area}`}
                aria-current={area === t.area ? 'page' : undefined}
                className={area === t.area ? 'tab on' : 'tab'}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(t.to);
                }}
              >
                <Icon name={t.icon} />
                {t.label}
              </a>
            ))}
          </nav>
          <span className="version">{version}</span>
        </div>
      </header>
      <main className="app">
        {m ? (
          <RunView runId={m[1]!} key={m[1]} />
        ) : p ? (
          <ProjectView id={p[1]!} key={p[1]} />
        ) : path === '/projects' ? (
          <ProjectsPage />
        ) : path === '/runs' ? (
          <Runs />
        ) : path === '/settings' ? (
          <Settings />
        ) : (
          <Home />
        )}
      </main>
    </>
  );
}
```

### 5. The hero on Home

File: `apps/web/src/ui/views/Home.tsx`

5a. Replace this exact line:

```text
import { ProjectGrid } from './Projects.js';
```

with:

```text
import { HeroArt } from './Icon.js';
import { ProjectGrid } from './Projects.js';
```

5b. Replace this exact line:

```text
      <Wizard start={start} />
```

with:

```text
      <section className="hero" data-testid="hero">
        <div>
          <span className="hero-eyebrow">Backshack · The Incubator</span>
          <h1>Turn an idea or a repository into working software</h1>
          <p>
            Describe what you want. The Incubator plans it with you, shows you the plan in plain
            English, and a coding assistant builds it on a branch you approve.
          </p>
        </div>
        <HeroArt className="hero-art" />
      </section>
      <Wizard start={start} />
```

### 6. Empty states

6a. File: `apps/web/src/ui/views/Projects.tsx`. Replace this exact line:

```text
import { navigate } from '../nav.js';
```

with:

```text
import { navigate } from '../nav.js';
import { Empty } from './Icon.js';
```

Then replace this exact block:

```text
        <p className="muted">
          No projects yet. Start a run from Home and the project appears here.
        </p>
```

with:

```text
        <Empty text="No projects yet. Start a run from Home and the project appears here." />
```

6b. File: `apps/web/src/ui/views/Runs.tsx`. Replace this exact line:

```text
import { navigate } from '../nav.js';
```

with:

```text
import { navigate } from '../nav.js';
import { Empty } from './Icon.js';
```

Then replace this exact line:

```text
        <p className="muted">No runs here.</p>
```

with:

```text
        <Empty text="No runs here." />
```

### 7. The favicon

Replace the whole file `apps/web/src/ui/public/favicon.svg` with exactly this single line (and a final newline):

```text
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs><path d="M16 3c-5.5 0-10 8.2-10 14.5C6 23.3 10.5 29 16 29s10-5.7 10-11.5C26 11.2 21.5 3 16 3z" fill="url(#g)"/><path d="M11 18.5c1.6 1.6 3.2 2.4 5 2.4s3.4-.8 5-2.4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="21.5" cy="10.5" r="1.6" fill="#fff" opacity="0.85"/></svg>
```

### 8. A test that keeps the tokens honest

Create `apps/web/src/ui/styles.test.ts` with exactly:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(import.meta.dirname, 'styles.css'), 'utf8');

describe('the stylesheet (plan 023)', () => {
  it('defines every token it uses', () => {
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((t) => !defined.has(t))).toEqual([]);
  });

  it('carries the Backshack palette and the Inter font', () => {
    expect(css).toContain('--primary: #4f46e5;');
    expect(css).toContain('--nav: #1e293b;');
    expect(css).toContain("'Inter Variable'");
  });
});
```

### 9. Browser test: the hero and the bar

File: `apps/web/e2e/web.e2e.test.ts`

Insert this test directly before the line
`  it('update: a GitHub remote that is not origin is suggested and pre-fills the repository field', async () => {`
(work item 11 indents it):

```ts
it('look: the navy bar with the logo, the hero illustration, and the Inter font (plan 023)', async () => {
  const { page, errors } = await open();
  await page.getByTestId('hero').waitFor(UI);
  expect(await page.getByTestId('hero-art').count()).toBe(1);
  expect(await page.locator('.brand svg').count()).toBe(1);
  expect(await page.locator('.tab svg').count()).toBe(4);
  const bar = await page.locator('.topbar').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bar).toBe('rgb(30, 41, 59)');
  // why: fonts.check() is true when no @font-face matches at all, so assert a face really loaded.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          await document.fonts.load('16px "Inter Variable"');
          return [...document.fonts].some(
            (f) => f.family === 'Inter Variable' && f.status === 'loaded',
          );
        }),
      UI,
    )
    .toBe(true);
  await shot(page, 'look-1-home');
  await page.getByTestId('tab-runs').click();
  await page.getByTestId('empty').waitFor(UI);
  await shot(page, 'look-2-empty');
  // Dark mode: the active tab keeps dark text on its white pill.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => page.locator('.topbar').evaluate((el) => getComputedStyle(el).backgroundColor), UI)
    .toBe('rgb(15, 23, 42)');
  await expect
    .poll(
      () =>
        page
          .getByTestId('tab-runs')
          .evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]),
      UI,
    )
    .toEqual(['rgb(15, 23, 42)', 'rgb(255, 255, 255)']);
  expect(errors, errors.join('\n')).toEqual([]);
});
```

Also in the same file, replace this exact line (the screenshot helper near the top):

```text
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
```

with:

```text
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true, animations: 'disabled' });
```

(Screenshots then show finished states, not mid-transition ones; work item 11's formatter wraps the line.)

### 10. The plan's stylesheet asset is already in place

`docs/plans/assets/023-styles.css` is part of this plan (written with it). Do not edit it.

### 11. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write apps/web/src/ui/main.tsx apps/web/src/ui/styles.css apps/web/src/ui/views/Icon.tsx apps/web/src/ui/App.tsx apps/web/src/ui/views/Home.tsx apps/web/src/ui/views/Projects.tsx apps/web/src/ui/views/Runs.tsx apps/web/src/ui/styles.test.ts apps/web/e2e/web.e2e.test.ts
```

## Touched files and markers

| File                                 | Marker                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `apps/web/package.json`              | `"@fontsource-variable/inter": "5.3.0"`                                            |
| `pnpm-lock.yaml`                     | `'@fontsource-variable/inter@5.3.0': {}`                                           |
| `apps/web/src/ui/main.tsx`           | `import '@fontsource-variable/inter';`                                             |
| `apps/web/src/ui/styles.css`         | `The Incubator: Backshack look (plan 023)`                                         |
| `apps/web/src/ui/views/Icon.tsx`     | `export function HeroArt(`                                                         |
| `apps/web/src/ui/App.tsx`            | `<Logo className="brand-mark" />`                                                  |
| `apps/web/src/ui/views/Home.tsx`     | `Turn an idea or a repository into working software`                               |
| `apps/web/src/ui/views/Projects.tsx` | `<Empty text="No projects yet.`                                                    |
| `apps/web/src/ui/views/Runs.tsx`     | `<Empty text="No runs here." />`                                                   |
| `apps/web/src/ui/public/favicon.svg` | `#4f46e5`                                                                          |
| `apps/web/src/ui/styles.test.ts`     | `the stylesheet (plan 023)`                                                        |
| `apps/web/e2e/web.e2e.test.ts`       | `the navy bar with the logo, the hero illustration, and the Inter font (plan 023)` |

## Acceptance commands

```sh
pnpm exec vitest run apps/web/src/ui/styles.test.ts
pnpm exec tsc -p apps/web/src/ui/tsconfig.json --noEmit
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; pnpm test:e2e
git status --porcelain -- packages
(Get-FileHash -Algorithm SHA256 docs/plans/assets/023-styles.css).Hash
git diff --no-index --exit-code docs/plans/assets/023-styles.css apps/web/src/ui/styles.css
Select-String -SimpleMatch -Path pnpm-lock.yaml "'@fontsource-variable/inter@5.3.0': {}"
pnpm check:quick
```

```text
the stylesheet test passes: every var(--token) is defined, the palette and the font are present
the UI typechecks
the e2e suite passes, including "the navy bar with the logo, the hero illustration, and the Inter font (plan 023)"
git status --porcelain -- packages prints nothing, or only these 10 lines left uncommitted by plan 021:
   M packages/core/src/discovery.test.ts
   M packages/core/src/discovery/merge.ts
   M packages/core/src/discovery/prompt-builder.ts
   M packages/core/src/discovery/questions.test.ts
   M packages/core/src/engine.ts
   M packages/core/src/enhance.test.ts
   M packages/core/src/review-summary.ts
  ?? packages/core/fixtures/discovery/review-changes/
  ?? packages/core/fixtures/enhance/review-changes/
  ?? packages/core/src/review-summary.test.ts
the asset hash prints 52AA597D8F0810B93C0CF280F38AD9DD6DE3B5E5D1478231213F1AC2633377FF (the asset was not edited)
git diff --no-index between the asset and apps/web/src/ui/styles.css prints nothing and exits 0
Select-String finds exactly 1 line in pnpm-lock.yaml (the font package has no dependencies)
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                   | Why                                               | Mechanical check                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stylesheet is retyped and a token is misspelled    | a 700-line file is easy to garble by hand         | it is copied from the asset; `defines every token it uses` fails on any `var(--x)` without `--x:`                                                               |
| The font loads from the internet and the CSP blocks it | Google Fonts is how the website loads Inter       | the font is a bundled package; the e2e waits for `document.fonts.load` and asserts a face named `Inter Variable` has status `loaded` (fails without the import) |
| Dark mode hides the active tab or buttons              | `--ink` is near-white in dark mode                | the e2e emulates dark mode and asserts the active tab is `rgb(15, 23, 42)` on `rgb(255, 255, 255)`                                                              |
| The brand link or a tab loses its test id or name      | the e2e finds `The Incubator` and `tab-*`         | the whole e2e suite runs; App.tsx is written whole from the plan                                                                                                |
| The navy bar is not applied                            | a class name typo leaves the page unstyled        | the e2e asserts the `.topbar` background is `rgb(30, 41, 59)`                                                                                                   |
| A new dependency brings a known vulnerability          | the font is a new package                         | `Select-String` finds `'@fontsource-variable/inter@5.3.0': {}` in `pnpm-lock.yaml` (no dependencies; `--prod` audit does not cover devDependencies)             |
| The engine is touched                                  | this plan is visual only                          | `git status --porcelain -- packages` prints nothing beyond plan 021's 10 listed lines                                                                           |
| The stylesheet asset is edited                         | the asset is untracked, so git cannot see an edit | the asset's SHA256 is fixed in the acceptance text, and `git diff --no-index` proves the copy matches                                                           |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                               | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The app looked basic next to the Backshack website; the owner asked for its colours, font and spacing                                                                                                                                                 | CLOSED |
| 2     | Review: the font check passed without the font, dark mode hid the active tab and lowered button contrast, the bar overflowed when narrow, and three acceptance checks were vacuous or failed on the uncommitted plan 021; all fixed (asset re-hashed) | CLOSED |
