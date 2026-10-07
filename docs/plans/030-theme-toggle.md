# Plan 030: a light and dark switch in the top bar

## Executor preamble

You are implementing an exact UI change. Rules for every work item:

- Change only the files named here, at the places named. Work item 9 builds the UI and runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Keep every existing `data-testid`. Do not touch anything under `packages/` or `apps/cli/`. Do not commit, push, or
  run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** The app follows the computer's light or dark setting and nothing else (plan 023). The owner wants to pick.
This plan adds a theme button to the navy top bar, after the version number. It cycles through three choices:
**same as the computer → light → dark → same as the computer**.

- The choice is kept in a cookie, `incubator_theme`. Every launch listens on a new random port, and local storage
  is kept per origin (port included), so it would forget the choice; cookies are kept per host. It is a per-viewer
  convenience, and the app works without it.
- Native controls and scrollbars follow the choice too (`color-scheme`).
- The stylesheet's dark palette now applies when the computer is dark and the owner has not picked light
  (`:root:not([data-theme='light'])` inside the media query), or when the owner picked dark
  (`:root[data-theme='dark']`).
- The two copies of the dark palette must stay identical. A unit test compares them.

## Work items

### 1. Stylesheet: the dark palette follows the owner's choice

File `apps/web/src/ui/styles.css`.

Find:

```text
@media (prefers-color-scheme: dark) {
  :root {
```

Replace with:

```text
/* The dark palette (plan 030): the computer's setting unless the owner picked light, or the owner picked dark. The
   two blocks must stay identical; styles.test.ts compares them. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
```

Find:

```text
    --shadow-md: 0 8px 20px rgba(0, 0, 0, 0.45);
  }
}
```

Replace with:

```text
    --shadow-md: 0 8px 20px rgba(0, 0, 0, 0.45);
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --primary: #818cf8;
  --primary-dark: #6366f1;
  --primary-soft: rgba(99, 102, 241, 0.16);
  --primary-ring: rgba(129, 140, 248, 0.35);
  --on-primary: #0f172a;
  --ink: #f8fafc;
  --text: #e2e8f0;
  --body: #cbd5e1;
  --muted: #94a3b8;
  --line: #273449;
  --line-strong: #334155;
  --bg: #0b1120;
  --card: #111a2e;
  --tint: #16213a;
  --nav: #0f172a;
  --ok: #4ade80;
  --ok-soft: rgba(74, 222, 128, 0.14);
  --warn: #fbbf24;
  --warn-soft: rgba(251, 191, 36, 0.14);
  --bad: #f87171;
  --bad-soft: rgba(248, 113, 113, 0.14);
  --info: #2dd4bf;
  --info-soft: rgba(45, 212, 191, 0.14);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 8px 20px rgba(0, 0, 0, 0.45);
}

:root[data-theme='light'] {
  color-scheme: light;
}
```

### 2. The theme module

Create `apps/web/src/ui/theme.ts` with exactly:

```ts
/** The light or dark choice (plan 030): the computer's setting unless the owner picks one, kept in this browser. */
export type Theme = 'system' | 'light' | 'dark';

// why: a cookie, not local storage. Every launch listens on a new random port, and local storage is kept per
// origin (port included), so it would forget the choice on the next launch; cookies are kept per host.
const COOKIE = 'incubator_theme';

/** What a stored value means; anything unknown is the computer's setting. */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** The choice in a `document.cookie` string. */
export function themeFromCookie(cookie: string): Theme {
  const pair = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  return parseTheme(pair?.slice(COOKIE.length + 1));
}

/** The order the top-bar button cycles through. */
export function nextTheme(t: Theme): Theme {
  return t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system';
}

/** How the button names a choice. */
export const THEME_LABEL: Record<Theme, string> = {
  system: 'same as the computer',
  light: 'light',
  dark: 'dark',
};

/** The stored choice; the computer's setting when nothing is stored or cookies are blocked. */
export function readTheme(): Theme {
  try {
    return themeFromCookie(document.cookie);
  } catch {
    return 'system';
  }
}

/** Shows a choice and remembers it in this browser (a choice still applies when cookies are blocked). */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    document.cookie =
      t === 'system'
        ? `${COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`
        : `${COOKIE}=${t}; Path=/; Max-Age=31536000; SameSite=Strict`;
  } catch {
    // why: blocked site data can refuse the cookie; the choice then lasts until the page closes.
  }
}
```

### 3. Unit test for the theme module

Create `apps/web/src/ui/theme.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { nextTheme, parseTheme, themeFromCookie } from './theme.js';

describe('the theme choice (plan 030)', () => {
  it('reads only light or dark from storage, else the computer setting', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('purple')).toBe('system');
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme(undefined)).toBe('system');
  });

  it('finds the choice among other cookies', () => {
    expect(themeFromCookie('inc_session=abc; incubator_theme=dark')).toBe('dark');
    expect(themeFromCookie('incubator_theme=light')).toBe('light');
    expect(themeFromCookie('incubator_theme=')).toBe('system');
    expect(themeFromCookie('other_incubator_theme=dark')).toBe('system');
    expect(themeFromCookie('')).toBe('system');
  });

  it('cycles from the computer setting to light, then dark, then back', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});
```

### 4. Icons for the button

File `apps/web/src/ui/views/Icon.tsx`.

Find:

```text
export type IconName = 'home' | 'folder' | 'list' | 'gear' | 'back' | 'forward';
```

Replace with:

```text
export type IconName =
  | 'home'
  | 'folder'
  | 'list'
  | 'gear'
  | 'back'
  | 'forward'
  | 'sun'
  | 'moon'
  | 'monitor';
```

Find:

```text
  back: ['M15 18l-6-6 6-6'],
  forward: ['M9 18l6-6-6-6'],
};
```

Replace with:

```text
  back: ['M15 18l-6-6 6-6'],
  forward: ['M9 18l6-6-6-6'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2',
    'M12 20v2',
    'M4.9 4.9l1.4 1.4',
    'M17.7 17.7l1.4 1.4',
    'M2 12h2',
    'M20 12h2',
    'M4.9 19.1l1.4-1.4',
    'M17.7 6.3l1.4-1.4',
  ],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  monitor: ['M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M8 20h8', 'M12 16v4'],
};
```

### 5. Apply the stored choice before React renders

File `apps/web/src/ui/main.tsx`.

Find:

```text
import './styles.css';
```

Replace with:

```text
import './styles.css';
import { applyTheme, readTheme } from './theme.js';

// The owner's light or dark choice (plan 030), before React renders.
applyTheme(readTheme());
```

### 6. The button in the top bar

File `apps/web/src/ui/App.tsx`.

Find:

```text
import { Icon, Logo, type IconName } from './views/Icon.js';
```

Replace with:

```text
import { THEME_LABEL, applyTheme, nextTheme, readTheme, type Theme } from './theme.js';
import { Icon, Logo, type IconName } from './views/Icon.js';
```

Find:

```text
  const [version, setVersion] = useState('');
```

Replace with:

```text
  const [version, setVersion] = useState('');
  const [theme, setTheme] = useState<Theme>(readTheme);
```

Find:

```text
          <span className="version">{version}</span>
```

Replace with:

```text
          <span className="version">{version}</span>
          <button
            className="icon"
            data-testid="theme-toggle"
            data-theme-choice={theme}
            aria-label={`Theme: ${THEME_LABEL[theme]}`}
            title={`Theme: ${THEME_LABEL[theme]}. Click for ${THEME_LABEL[nextTheme(theme)]}.`}
            onClick={() => {
              const t = nextTheme(theme);
              applyTheme(t);
              setTheme(t);
            }}
          >
            <Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor'} />
          </button>
```

### 7. Stylesheet test: the two dark palettes match

File `apps/web/src/ui/styles.test.ts`.

Find:

```text
  it('carries the Backshack palette and the Inter font', () => {
```

Replace with:

```text
  it('uses the same dark palette for the computer setting and the owner choice (plan 030)', () => {
    const squash = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const media = /:root:not\(\[data-theme='light'\]\) \{([^}]*)\}/.exec(css)?.[1];
    const chosen = /:root\[data-theme='dark'\] \{([^}]*)\}/.exec(css)?.[1];
    expect(squash(media)).toContain('--bg: #0b1120;');
    expect(squash(chosen)).toBe(squash(media));
  });

  it('carries the Backshack palette and the Inter font', () => {
```

### 8. Browser test: the switch wins over the computer setting and is remembered

File `apps/web/e2e/web.e2e.test.ts`.

Find:

```text
  it('update: a GitHub remote that is not origin is suggested and pre-fills the repository field', async () => {
```

Replace with:

```text
  it('theme: the top-bar switch picks light or dark over the computer setting, and remembers it (plan 030)', async () => {
    const { page, errors } = await open();
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const toggle = page.getByTestId('theme-toggle');
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await bg();
    await page.emulateMedia({ colorScheme: 'light' });
    const light = await bg();
    expect(dark).not.toBe(light);
    expect(await toggle.getAttribute('data-theme-choice')).toBe('system');
    // Light wins over a dark computer.
    await toggle.click();
    expect(await toggle.getAttribute('data-theme-choice')).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await bg()).toBe(light);
    // Dark wins over a light computer, and survives a reload.
    await toggle.click();
    expect(await toggle.getAttribute('data-theme-choice')).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await bg()).toBe(dark);
    // Native controls and scrollbars follow the choice too.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      'dark',
    );
    await page.reload();
    await page.getByTestId('theme-toggle').waitFor(UI);
    expect(await bg()).toBe(dark);
    expect(await page.getByTestId('theme-toggle').getAttribute('data-theme-choice')).toBe('dark');
    await shot(page, 'theme-dark');
    // The next launch listens on another port (another origin); the choice is still there.
    const { server: next } = await startFakeServer({
      uiDir: UI_DIR,
      host: { pickFolder: () => Promise.resolve(null) },
    });
    servers.push(next);
    await page.goto(next.url);
    await page.getByTestId('theme-toggle').waitFor(UI);
    expect(await page.getByTestId('theme-toggle').getAttribute('data-theme-choice')).toBe('dark');
    expect(await bg()).toBe(dark);
    // Back to the computer setting.
    await page.getByTestId('theme-toggle').click();
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))).toBe(false);
    expect(await bg()).toBe(light);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('update: a GitHub remote that is not origin is suggested and pre-fills the repository field', async () => {
```

### 9. Build the UI and format the touched files

Run exactly:

```powershell
pnpm --filter @incubator/web build:ui
pnpm exec prettier --write apps/web/src/ui/styles.css apps/web/src/ui/theme.ts apps/web/src/ui/theme.test.ts apps/web/src/ui/views/Icon.tsx apps/web/src/ui/main.tsx apps/web/src/ui/App.tsx apps/web/src/ui/styles.test.ts apps/web/e2e/web.e2e.test.ts
```

## Touched files and markers

| File                             | Marker                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/web/src/ui/styles.css`     | `:root[data-theme='dark'] {`                                                                           |
| `apps/web/src/ui/theme.ts`       | `export function applyTheme(t: Theme): void {`                                                         |
| `apps/web/src/ui/theme.test.ts`  | `the theme choice (plan 030)`                                                                          |
| `apps/web/src/ui/views/Icon.tsx` | `moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],`                                              |
| `apps/web/src/ui/main.tsx`       | `applyTheme(readTheme());`                                                                             |
| `apps/web/src/ui/App.tsx`        | `data-testid="theme-toggle"`                                                                           |
| `apps/web/src/ui/styles.test.ts` | `uses the same dark palette for the computer setting and the owner choice (plan 030)`                  |
| `apps/web/e2e/web.e2e.test.ts`   | `theme: the top-bar switch picks light or dark over the computer setting, and remembers it (plan 030)` |

## Acceptance commands

```sh
pnpm exec vitest run apps/web/src/ui
pnpm exec tsc -p apps/web/src/ui/tsconfig.json --noEmit
pnpm exec eslint --max-warnings=0 apps/web
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; pnpm test:e2e
(Select-String -SimpleMatch -Path apps/web/src/ui/styles.css ":root:not([data-theme='light'])").Count
pnpm check:quick
```

```text
the UI unit tests pass, including the theme tests and the dark-palette comparison
the UI typechecks and eslint on apps/web exits 0
the e2e suite passes, including the plan 030 theme test and plan 023's dark-mode look test
the Select-String count prints 1
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                    | Why                                                                                                       | Mechanical check                                                                                                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The two dark palettes drift apart                       | the palette is written twice                                                                              | the stylesheet test compares the blocks                                                                                                                                                       |
| A picked theme does not win over the computer           | the media block must exclude `data-theme='light'`, and the dark block must not sit inside the media query | the e2e sets light under a dark computer and dark under a light computer, and compares the body background (the e2e, not the styles test, catches a dark block placed inside the media query) |
| The choice is lost on reload or on the next launch      | each launch listens on a new port, and local storage is per origin                                        | the e2e reloads, then opens a second server on another port, and expects dark both times; the unit test parses the cookie among others                                                        |
| Native controls stay in the computer's colours          | `:root` says `color-scheme: light dark`                                                                   | both dark blocks set `color-scheme: dark` (compared by the styles test) and the e2e asserts the computed `color-scheme` is `dark` under a light computer                                      |
| "Same as the computer" leaves an attribute behind       | `applyTheme('system')` must remove it                                                                     | the e2e asserts `data-theme` is gone                                                                                                                                                          |
| Blocked cookies break the page                          | the reads and writes must be wrapped                                                                      | HUMAN (code review): the catch branches are not run by a test; the unit tests cover the parser for unknown values                                                                             |
| plan 023's look test (dark mode by the computer) breaks | it emulates a dark computer with no choice made                                                           | the whole e2e suite runs                                                                                                                                                                      |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The owner asked for a light and dark switch (a follow-up from plan 023, which only followed the computer setting)                                                                                                                                                                                                                                                                                                                                                                                                                                                                | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy, full e2e): FIX-FIRST. Must-fix: local storage is per origin and every launch takes a new random port, so the choice was forgotten at each launch while the reload-only test passed; it is now a cookie, and the e2e opens a second server on another port. Also: `color-scheme` follows the choice (native controls, scrollbars), the 'before the first paint' claim is now 'before React renders', and the blocked-storage row is labelled HUMAN. Left for later: Electron's title bar keeps the OS colour | CLOSED |
