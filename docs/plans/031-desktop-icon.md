# Plan 031: the desktop app gets the Incubator icon

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 7 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not touch anything under `packages/`. Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip
  or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already
  prints v22; do not change PATH.

**Why.** The desktop app shows Electron's default icon in the taskbar and the window. Plan 023 drew the Incubator
mark (`apps/web/src/ui/public/favicon.svg`: an indigo egg with a smile), but packaging needs a raster image, which
the repository did not have.

This plan adds:

- a small script that renders the favicon to a 512×512 transparent PNG (`apps/desktop/build/icon.png`) with the
  headless browser the e2e tests already use;
- the PNG itself;
- `icon:` entries in `electron-builder.yml` for Windows, macOS and Linux;
- the window icon (`BrowserWindow` `icon`), so the taskbar shows the mark in the unpacked build too;
- `signExecutable: false` in place of `signAndEditExecutable: false`, so the Windows `.exe` (and the Start-menu
  and desktop shortcuts that point at it) carry the icon. Nothing is signed either way; only the executable's
  resources are edited, which electron-builder already does for the asar integrity record.

Code signing stays off (open question Q5 is still the owner's): `signExecutable: false` skips signing but lets
electron-builder write the icon into the executable.

## Work items

### 1. The script that renders the icon

Create `apps/desktop/scripts/make-icon.mjs` with exactly:

```js
#!/usr/bin/env node
// Renders the app icon, build/icon.png (512×512, transparent), from the web UI's favicon.svg (plan 031). Run it by
// hand after the favicon changes: node apps/desktop/scripts/make-icon.mjs. It needs a browser, as the e2e tests do:
// set INCUBATOR_E2E_CHANNEL=chrome to use the installed Chrome.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const repo = path.resolve(import.meta.dirname, '../../..');
const svg = readFileSync(path.join(repo, 'apps/web/src/ui/public/favicon.svg'), 'utf8');
const out = path.join(repo, 'apps/desktop/build/icon.png');
mkdirSync(path.dirname(out), { recursive: true });
const channel = process.env['INCUBATOR_E2E_CHANNEL'];
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const sized = svg.replace('<svg ', '<svg width="512" height="512" ');
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  await page.screenshot({
    path: out,
    omitBackground: true,
    clip: { x: 0, y: 0, width: 512, height: 512 },
  });
} finally {
  await browser.close();
}
process.stdout.write(`wrote ${path.relative(repo, out)}\n`);
```

### 2. Render the icon

Run exactly (PowerShell, from the repository root):

```powershell
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; node apps/desktop/scripts/make-icon.mjs
```

It prints `wrote apps\desktop\build\icon.png` (or with forward slashes). The file is new; leave it uncommitted with
the rest of this plan's changes.

### 3. Packaging uses the icon

File `apps/desktop/electron-builder.yml`.

Find:

```text
  category: Development
```

Replace with:

```text
  category: Development
  icon: build/icon.png
```

Find:

```text
  category: public.app-category.developer-tools
```

Replace with:

```text
  category: public.app-category.developer-tools
  icon: build/icon.png
```

Find:

```text
  target: [nsis]
```

Replace with:

```text
  target: [nsis]
  icon: build/icon.png
```

Find:

```text
  signAndEditExecutable: false
```

Replace with:

```text
  signExecutable: false
```

### 4. The packaged app carries the icon

File `apps/desktop/scripts/build.mjs`.

Find:

```text
copy('packages/analyzer/canonical.json', 'canonical.json');
```

Replace with:

```text
copy('packages/analyzer/canonical.json', 'canonical.json');
copy('apps/desktop/build/icon.png', 'icon.png');
```

### 5. The window shows the icon

File `apps/desktop/src/main.ts`.

Find:

```text
      title: 'The Incubator',
      show: false,
```

Replace with:

```text
      title: 'The Incubator',
      // The taskbar and window icon (plan 031); the packaged app carries it next to the UI.
      icon: path.join(appRoot, 'icon.png'),
      show: false,
```

### 6. Test: the icon, and every place that names it

Create `apps/desktop/src/icon.test.ts` with exactly:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktop = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(path.join(desktop, rel), 'utf8');

describe('the app icon (plan 031)', () => {
  it('is a 512×512 PNG with transparency', () => {
    const png = readFileSync(path.join(desktop, 'build/icon.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
    // Colour type 6 is RGBA: the corners stay transparent around the egg.
    expect(png[25]).toBe(6);
  });

  it('is named by the packaging config, copied into the app, and shown by the window', () => {
    const yml = read('electron-builder.yml');
    expect(yml).toMatch(/^linux:\n(?: {2}.*\n)*? {2}icon: build\/icon\.png$/m);
    expect(yml).toMatch(/^mac:\n(?: {2}.*\n)*? {2}icon: build\/icon\.png$/m);
    expect(yml).toMatch(/^win:\n(?: {2}.*\n)*? {2}icon: build\/icon\.png$/m);
    expect(yml.match(/icon: build\/icon\.png/g)).toHaveLength(3);
    // The .exe carries the icon without being signed (signExecutable, not signAndEditExecutable).
    expect(yml).toMatch(/^ {2}signExecutable: false$/m);
    expect(yml).not.toContain('signAndEditExecutable');
    expect(read('scripts/build.mjs')).toContain("copy('apps/desktop/build/icon.png', 'icon.png');");
    expect(read('src/main.ts')).toContain("icon: path.join(appRoot, 'icon.png'),");
  });
});
```

### 7. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write apps/desktop/scripts/make-icon.mjs apps/desktop/scripts/build.mjs apps/desktop/src/main.ts apps/desktop/src/icon.test.ts apps/desktop/electron-builder.yml
```

## Touched files and markers

| File                                 | Marker                                             |
| ------------------------------------ | -------------------------------------------------- |
| `apps/desktop/scripts/make-icon.mjs` | `Renders the app icon, build/icon.png`             |
| `apps/desktop/electron-builder.yml`  | `icon: build/icon.png`                             |
| `apps/desktop/scripts/build.mjs`     | `copy('apps/desktop/build/icon.png', 'icon.png');` |
| `apps/desktop/src/main.ts`           | `icon: path.join(appRoot, 'icon.png'),`            |
| `apps/desktop/src/icon.test.ts`      | `the app icon (plan 031)`                          |
| `apps/desktop/build/icon.png`        | binary, 512×512 RGBA (created by work item 2)      |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit apps/desktop/src/icon.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 apps/desktop
pnpm --filter @incubator/desktop dist:dir
node -e "const b=require('fs').readFileSync('apps/desktop/release/win-unpacked/resources/app.asar');const h=JSON.parse(b.subarray(16,16+b.readUInt32LE(12)).toString());console.log('icon.png' in h.files)"
pnpm check:quick
```

```text
the icon test passes (PNG, 512×512, RGBA; named three times in the packaging config, copied by build.mjs, shown by the window)
pnpm typecheck and eslint on apps/desktop exit 0
dist:dir finishes; the asar check prints true (the packaged app holds icon.png at its root)
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                     | Why                                                                       | Mechanical check                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The script is written but never run, so the PNG is missing               | the icon is a generated file                                              | the icon test reads `build/icon.png` and fails when it is absent                                                     |
| The PNG has a white square behind the egg                                | the screenshot must omit the background                                   | the test asserts colour type 6 (RGBA)                                                                                |
| The PNG is the wrong size, so the installer rejects it                   | electron-builder needs 512×512 for macOS and at least 256×256 for Windows | the test reads the IHDR width and height                                                                             |
| An `icon:` line is added at the wrong indentation and is ignored         | YAML nesting decides which platform reads it                              | the test counts three two-space-indented `icon: build/icon.png` lines; `dist:dir` runs                               |
| An `icon:` line lands under the wrong platform key (for example `nsis:`) | YAML nesting decides which platform reads it                              | the test matches each `icon:` line inside its own `linux:`, `mac:` and `win:` block; `dist:dir` validates the schema |
| The `.exe` keeps Electron's icon                                         | `signAndEditExecutable: false` skips the executable's resources           | the test asserts `signExecutable: false` and no `signAndEditExecutable`                                              |
| The window names an icon the packaged app does not carry                 | `build.mjs` must copy it next to the UI                                   | the test checks the copy line; the asar header lists `icon.png` (the node one-liner prints true)                     |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The desktop app showed Electron's icon; plan 023 left the raster icon as a follow-up                                                                                                                                                                                                                                                                                                                                                                                                                             | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy; full dist and NSIS build): FIX-FIRST. Must-fix: the asar Select-String counted the bundled string "icon.png" and passed with the file missing; now the asar header is read. Also: `signExecutable: false` puts the icon on the .exe and its shortcuts without signing (verified by dist:dir and an extracted icon), the test ties each icon line to its platform, the PNG is listed, and item 2 no longer reads as an instruction to commit | CLOSED |
