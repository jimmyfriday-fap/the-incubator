# Plan 033: the title bar and the first paint follow the light or dark choice

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 10 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not touch anything under `packages/`. Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip
  or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already
  prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Plan 030 added a light/dark switch to the app. Two gaps were left:

1. The desktop window's title bar keeps the computer's colour. With a dark computer and a light choice (or the
   reverse) the title bar and the page disagree. Electron colours the title bar from `nativeTheme.themeSource`.
2. The choice is applied by `main.tsx` when the script runs, so a dark choice can paint light for a moment first.

The page already keeps the choice in a cookie, `incubator_theme` (`apps/web/src/ui/theme.ts`: `const COOKIE =
'incubator_theme';`), with the values `light` or `dark`, and no cookie for the computer's setting. This plan reads
that cookie in two places:

- the desktop main process (no IPC and no preload, ADR-012): at start, and whenever the cookie changes, it sets
  `nativeTheme.themeSource`;
- the web server: it writes `data-theme="light"` or `data-theme="dark"` onto `<html lang="en">` in the app shell it
  serves, so the stylesheet (plan 030's `:root[data-theme='dark']` rules) applies at the first paint.

## Work items

### 1. Desktop: the cookie's meaning for the window

Add at the end of `apps/desktop/src/window.ts`, after one blank line:

```ts
/** The cookie that holds the page's light or dark choice (plan 030); `apps/web/src/ui/theme.ts` writes it. */
export const THEME_COOKIE = 'incubator_theme';

/** What the window's title bar follows for a cookie value (plan 033): the choice, or the computer's setting. */
export function themeSourceFor(value: string | undefined): 'system' | 'light' | 'dark' {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The title bar's theme after a cookie change Chromium reports (plan 033); null leaves it as it is. */
export function themeSourceAfterChange(
  name: string,
  value: string,
  cause: string,
  removed: boolean,
): 'system' | 'light' | 'dark' | null {
  if (name !== THEME_COOKIE) return null;
  // why: replacing a cookie first reports the old one removed ('overwrite'), then the new one added.
  if (removed && cause === 'overwrite') return null;
  return removed ? 'system' : themeSourceFor(value);
}
```

### 2. Desktop: imports in the main process

In `apps/desktop/src/main.ts`:

Find:

```text
  Menu,
  session,
```

Replace with:

```text
  Menu,
  nativeTheme,
  session,
```

Find:

```text
  secureWebPreferences,
} from './window.js';
```

Replace with:

```text
  secureWebPreferences,
  THEME_COOKIE,
  themeSourceAfterChange,
  themeSourceFor,
} from './window.js';
```

### 3. Desktop: the title bar follows the cookie

In `apps/desktop/src/main.ts`:

Find:

```text
    const main = new BrowserWindow({
```

Replace with:

```text
    // The title bar follows the page's light or dark choice (plan 033). The page keeps it in a cookie; the window
    // reads that cookie at start and whenever it changes (no IPC, ADR-012).
    // why: a cookie store that cannot be read must not stop the app; the title bar then follows the computer.
    const saved = await session.defaultSession.cookies
      .get({ name: THEME_COOKIE })
      .catch(() => []);
    nativeTheme.themeSource = themeSourceFor(saved[0]?.value);
    session.defaultSession.cookies.on('changed', (_e, cookie, cause, removed) => {
      const next = themeSourceAfterChange(cookie.name, cookie.value, cause, removed);
      if (next) nativeTheme.themeSource = next;
    });
    const main = new BrowserWindow({
```

### 4. Desktop test

Create `apps/desktop/src/theme.test.ts` with exactly:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, themeSourceAfterChange, themeSourceFor } from './window.js';

const read = (rel: string) => readFileSync(path.join(import.meta.dirname, rel), 'utf8');

type Change = [name: string, value: string, cause: string, removed: boolean];
/** Where the title bar ends up after the changes, starting from the computer's setting. */
const follow = (changes: Change[]) =>
  changes.reduce<string>((s, c) => themeSourceAfterChange(...c) ?? s, 'system');

describe('the title bar follows the theme (plan 033)', () => {
  it('maps the page cookie to the window theme', () => {
    expect(themeSourceFor('dark')).toBe('dark');
    expect(themeSourceFor('light')).toBe('light');
    for (const other of ['', 'system', 'blue', undefined])
      expect(themeSourceFor(other)).toBe('system');
  });

  it('reads the cookie the page writes', () => {
    expect(THEME_COOKIE).toBe('incubator_theme');
    expect(read('../../web/src/ui/theme.ts')).toContain(`const COOKIE = '${THEME_COOKIE}';`);
  });

  it('follows the changes Chromium reports (recorded from Electron 44)', () => {
    const C = THEME_COOKIE;
    expect(follow([[C, 'light', 'inserted', false]])).toBe('light');
    // Light to dark: the old cookie is reported removed by the overwrite, then the new one added.
    expect(
      follow([
        [C, 'light', 'inserted', false],
        [C, 'light', 'overwrite', true],
        [C, 'dark', 'inserted', false],
      ]),
    ).toBe('dark');
    // Dark to the computer's setting: the page overwrites the cookie with an expired one.
    expect(
      follow([
        [C, 'dark', 'inserted', false],
        [C, 'dark', 'expired-overwrite', true],
      ]),
    ).toBe('system');
    // A reload writes the same value again.
    expect(
      follow([
        [C, 'dark', 'inserted', false],
        [C, 'dark', 'overwrite', true],
        [C, 'dark', 'inserted-no-value-change-overwrite', false],
      ]),
    ).toBe('dark');
    // Other cookies (the session) leave it alone.
    expect(
      follow([
        [C, 'dark', 'inserted', false],
        ['inc_session', 'tok', 'inserted', false],
        ['inc_session', 'tok', 'explicit', true],
      ]),
    ).toBe('dark');
  });

  it('is set at start and whenever the cookie changes', () => {
    const main = read('main.ts');
    expect(main).toContain('.get({ name: THEME_COOKIE })');
    expect(main).toContain("session.defaultSession.cookies.on('changed',");
    expect(main).toContain('themeSourceAfterChange(cookie.name, cookie.value, cause, removed)');
    expect(main.match(/nativeTheme\.themeSource = /g)).toHaveLength(2);
    // Before the window exists, so it opens in the right colours.
    expect(main.indexOf('nativeTheme.themeSource = ')).toBeLessThan(
      main.indexOf('const main = new BrowserWindow({'),
    );
  });
});
```

### 5. Web: stamp the choice on the app shell

Add at the end of `apps/web/src/server/static.ts`, after one blank line:

```ts
/**
 * The app shell with the owner's light or dark choice already on `<html>` (plan 033), so a dark choice is dark from
 * the first paint. `choice` is the `incubator_theme` cookie; anything but `light` or `dark` leaves the page as is.
 */
export function stampTheme(html: string, choice: string | undefined): string {
  return choice === 'light' || choice === 'dark'
    ? html.replace('<html lang="en">', `<html lang="en" data-theme="${choice}">`)
    : html;
}
```

### 6. Web: imports in the server

In `apps/web/src/server/server.ts`:

Find:

```text
import { CSRF_HEADER, Guard, SECURITY_HEADERS } from './security.js';
```

Replace with:

```text
import { CSRF_HEADER, Guard, SECURITY_HEADERS, parseCookies } from './security.js';
```

Find:

```text
import { defaultUiDir, readAsset } from './static.js';
```

Replace with:

```text
import { defaultUiDir, readAsset, stampTheme } from './static.js';
```

### 7. Web: the server stamps the app shell

In `apps/web/src/server/server.ts`:

Find:

```text
    return reply.type(asset.type).send(asset.body);
```

Replace with:

```text
    // why: the app shell carries the owner's light or dark choice, so it paints in that theme at once (plan 033);
    // no-store, because the same address answers differently once the choice changes.
    if (asset.type.startsWith('text/html'))
      return reply
        .type(asset.type)
        .header('cache-control', 'no-store')
        .send(stampTheme(asset.body.toString('utf8'), parseCookies(req.headers.cookie)['incubator_theme']));
    return reply.type(asset.type).send(asset.body);
```

### 8. Web: server test

In `apps/web/src/server/server.test.ts`:

Find:

```text
import { readAsset, resolveAsset } from './static.js';
```

Replace with:

```text
import { readAsset, resolveAsset, stampTheme } from './static.js';
```

Find:

```text
    expect(readAsset(path.join(root, 'none'), '/')).toBeNull();
  });
```

Replace with:

```text
    expect(readAsset(path.join(root, 'none'), '/')).toBeNull();
  });

  it('stamps the light or dark choice on the app shell, so it paints in that theme (plan 033)', async () => {
    const shell = '<html lang="en"><head>';
    expect(stampTheme(shell, 'dark')).toBe('<html lang="en" data-theme="dark"><head>');
    expect(stampTheme(shell, 'light')).toBe('<html lang="en" data-theme="light"><head>');
    for (const other of [undefined, '', 'system', '"><script>']) expect(stampTheme(shell, other)).toBe(shell);
    // The real app shell starts with the tag the stamp looks for.
    expect(readFileSync(path.resolve(import.meta.dirname, '../ui/index.html'), 'utf8')).toContain(
      '<html lang="en">',
    );
    const root = mkdtempSync(path.join(os.tmpdir(), 'ui-'));
    writeFileSync(path.join(root, 'index.html'), '<!doctype html>\n<html lang="en"><body></body></html>');
    const { server } = await startFakeServer({ uiDir: root });
    open.push(server);
    const api = await apiClient(server);
    const page = (cookie: string) => fetch(`${server.origin}/runs/x`, { headers: { cookie } });
    const dark = await page(`${api.cookie}; incubator_theme=dark`);
    expect(dark.status).toBe(200);
    expect(await dark.text()).toContain('<html lang="en" data-theme="dark"><body>');
    expect(dark.headers.get('cache-control')).toBe('no-store');
    expect(await (await page(api.cookie)).text()).toContain('<html lang="en"><body>');
    // Only the app shell is stamped and kept out of caches; scripts, styles and fonts are served as they are.
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'assets', 'a.js'), '// <html lang="en">');
    const js = await fetch(`${server.origin}/assets/a.js`, {
      headers: { cookie: `${api.cookie}; incubator_theme=dark` },
    });
    expect(await js.text()).toBe('// <html lang="en">');
    expect(js.headers.get('cache-control')).toBeNull();
  });
```

### 9. Web: the end-to-end theme test checks the served page

In `apps/web/e2e/web.e2e.test.ts`:

Find:

```text
    await page.reload();
    await page.getByTestId('theme-toggle').waitFor(UI);
    expect(await bg()).toBe(dark);
```

Replace with:

```text
    await page.reload();
    await page.getByTestId('theme-toggle').waitFor(UI);
    expect(await bg()).toBe(dark);
    // The server stamps the choice on the page itself, so it is dark before any script runs (plan 033).
    expect(await (await page.request.get(page.url())).text()).toContain(
      '<html lang="en" data-theme="dark">',
    );
```

### 10. Format the touched files

Run:

```powershell
pnpm exec prettier --write apps/desktop/src/window.ts apps/desktop/src/main.ts apps/desktop/src/theme.test.ts apps/web/src/server/static.ts apps/web/src/server/server.ts apps/web/src/server/server.test.ts apps/web/e2e/web.e2e.test.ts
```

## Touched files and markers

A `\|` in a marker is Markdown table escaping for a plain `|`.

| File                                 | Marker                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `apps/desktop/src/window.ts`         | `export function themeSourceFor(value: string \| undefined): 'system' \| 'light' \| 'dark' {` |
| `apps/desktop/src/main.ts`           | `themeSourceAfterChange(cookie.name, cookie.value, cause, removed)`                           |
| `apps/desktop/src/theme.test.ts`     | `the title bar follows the theme (plan 033)`                                                  |
| `apps/web/src/server/static.ts`      | `export function stampTheme(html: string, choice: string \| undefined): string {`             |
| `apps/web/src/server/server.ts`      | `.header('cache-control', 'no-store')`                                                        |
| `apps/web/src/server/server.test.ts` | `stamps the light or dark choice on the app shell, so it paints in that theme (plan 033)`     |
| `apps/web/e2e/web.e2e.test.ts`       | `The server stamps the choice on the page itself, so it is dark before any script runs`       |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit apps/desktop/src/theme.test.ts apps/web/src/server/server.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 apps/desktop apps/web
pnpm check:quick
```

```text
the unit tests pass, including "the title bar follows the theme (plan 033)" and "stamps the light or dark choice on the app shell, so it paints in that theme (plan 033)"
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                               | Why                                                                          | Mechanical check                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The desktop reads a different cookie name than the page writes                     | the name is spelled in two packages                                          | `theme.test.ts` reads `apps/web/src/ui/theme.ts` and asserts its `COOKIE` equals `THEME_COOKIE`                                                  |
| The title bar is set at start but never follows a change (or the reverse)          | two wiring sites in `main.ts`                                                | `theme.test.ts` asserts the `cookies` read, the `changed` listener calling `themeSourceAfterChange`, and exactly two `nativeTheme.themeSource =` |
| Switching from light to dark flips the title bar to the computer's colour          | Chromium reports an overwrite as a removal first                             | `theme.test.ts` replays the change sequences recorded from Electron 44 (light to dark, dark to system, reload, another cookie)                   |
| The listener ignores `removed`, or reacts to other cookies                         | a removed cookie still carries its old value; the session cookie changes too | the dark-to-system and other-cookie sequences in `theme.test.ts` fail                                                                            |
| The stamp never matches because the shell's tag differs                            | `stampTheme` looks for the literal `<html lang="en">`                        | the server test reads `apps/web/src/ui/index.html` and asserts it holds `<html lang="en">`                                                       |
| A crafted cookie injects markup into the page                                      | the cookie value lands inside an attribute                                   | `stampTheme` accepts only `light` and `dark`; the server test asserts `"><script>` leaves the shell unchanged                                    |
| The stamp is applied to scripts or stylesheets, or a stale stamped shell is cached | only HTML should be stamped, and the answer depends on the cookie            | the server test asserts a JS asset comes back unchanged with no `cache-control`, and the shell has `no-store`                                    |
| The served page is stamped in tests but not in the real built UI                   | Vite could rewrite the `<html>` tag                                          | the e2e test fetches the served page of the real build and asserts `<html lang="en" data-theme="dark">`                                          |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Plan 030 left two follow-ups: the desktop title bar keeps the computer's colour, and a dark choice can paint light before the script runs                                                                                                                                                                                                                                                                                                                                                                | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy; unit, e2e, and the release build's title bar read through DWM): FIX-FIRST. Must-fix: the plan file failed the format gate; now formatted. Also: the change logic moved into `themeSourceAfterChange` and is tested with the cookie events recorded from Electron 44 (ignoring `removed` or the cookie name was not caught before); a JS asset is asserted unstamped and cacheable; a cookie read that fails no longer stops the app | CLOSED |
