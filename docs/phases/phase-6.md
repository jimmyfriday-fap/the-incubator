# Phase 6 — Electron desktop: acceptance evidence

Plan: [docs/plans/007-phase-6-desktop.md](../plans/007-phase-6-desktop.md).

| #   | Criterion (brief §9 and TDD §10, Phase 6)                                             | Status                                           |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | The app builds for Windows, macOS and Linux (electron-builder)                        | PASS on Linux locally; 3 OSes: PENDING CI        |
| 2   | A smoke test launches it headless and completes a fake greenfield run                 | PASS (Linux, packaged, xvfb); 3 OSes: PENDING CI |
| 3   | Engine in-process; renderer sandboxed, no Node, navigation locked                     | PASS                                             |
| 4   | Fakes only in test builds; release builds refuse the test flag                        | PASS                                             |
| 5   | Installer UX (install, first launch from the OS menu, uninstall), keychain on each OS | PENDING LOCAL VERIFICATION                       |

## 1. Builds

```sh
pnpm --filter @incubator/web build:ui
pnpm --filter @incubator/desktop dist                                # release: installers
INCUBATOR_TEST_BUILD=1 pnpm --filter @incubator/desktop dist:test     # test build, unpacked
```

```text
build.mjs: staged apps/desktop/app (release build)
build.mjs: staged apps/desktop/app-test (test build: fakes included)
release/the-incubator-0.1.0-linux-x86_64.AppImage   (129 MB)
release/the-incubator-0.1.0-linux-amd64.deb         (102 MB; Depends: libgtk-3-0, libnss3, libsecret-1-0, …)
```

The asar holds only the staged app (9.4 MB). What goes in, and what was fixed on the way:

- **Main process.** esbuild bundles it into `dist/main.mjs`.
- **Assets.** The schemas, prompts, `canonical.json` and the built UI sit next to the bundle.
- **Packs.** They ship as the `packs.json` archive. electron-builder silently dropped 19 pack
  files, all under `.github/`, `.gitignore` or `.gitattributes`, and explicit include patterns did
  not override it.
- **Keychain.** The keychain binding sits in `vendor/keyring`, with its native binary unpacked.
- **No workspace dependencies.** An early build packed the workspace's `node_modules` (a 36 MB
  asar); `files: !node_modules` stops that.

`desktop.yml` builds the same on `ubuntu-latest`, `macos-latest` and `windows-latest`, runs the
smoke test against the packaged executables and uploads the installers. **PENDING CI:** the run URL
is recorded below once it completes.

## 2. Smoke test

```sh
INCUBATOR_DESKTOP_EXE=$PWD/apps/desktop/release/linux-unpacked/the-incubator \
INCUBATOR_DESKTOP_TEST_EXE=$PWD/apps/desktop/release-test/linux-unpacked/the-incubator \
xvfb-run -a pnpm test:desktop-smoke --reporter verbose
```

```text
✓ desktop smoke > release build: launches, locks the renderer down and shows the app 1138ms
✓ desktop smoke > release build: refuses the test-fakes flag 375ms
✓ desktop smoke > test build: completes a fake greenfield run to DONE 3060ms
Tests  3 passed (3)
```

The test-build case drives the packaged app with Playwright `_electron`. The run goes from the
narrative to questions ("Accept all defaults"), then review (GitHub owner set), then DONE, with the
repository published to the in-memory GitHub. The pack templates are rendered from the extracted
archive, which proves the packaged app carries every pack file.

## 3. Renderer lockdown

In the release build, the smoke test checks that:

- `typeof require` and `typeof process` are `undefined` in the page;
- `window.open('https://example.com/')` returns `null`;
- assigning an off-origin `location` leaves the URL unchanged;
- exactly one window exists.

Unit tests cover the policy functions:

```text
✓ secureWebPreferences > locks the renderer down
✓ navigation lockdown > keeps in-app navigation on the local origin
✓ navigation lockdown > opens only https GitHub and spec-named Leantime links externally
✓ navigation lockdown > collects https Leantime hosts from specs
✓ packs archive > round-trips every pack file byte for byte, dotfiles included
✓ packs archive > refuses paths that escape the target and unknown formats
```

The main process has further protections:

- The renderer sandbox is forced unless `--no-sandbox` is passed explicitly (root in containers).
- Permission requests are denied.
- `<webview>` is refused.
- It holds a single-instance lock.
- It starts the same localhost server as `incubator ui`, with the token, cookie, Origin and CSRF
  checks, and loads its single-use URL.

## 4. Test builds only

The fakes sit behind `__INCUBATOR_TEST_BUILD__`, which esbuild replaces at build time. In the
release bundle, `fakePublishEngine` and the recorded fixtures do not appear at all:

```text
apps/desktop/app/dist/main.mjs:      fakePublishEngine=0 saas=0
apps/desktop/app-test/dist/main.mjs: fakePublishEngine=2 saas=1
```

A release build given `--incubator-test-fakes` exits 2 with `is refused: this is not a test build`,
before any window or server starts. The smoke test covers this.

## 5. Release lane (dogfood)

- `.github/workflows/promote-to-production.yml` is now the base render for this repository's
  `incubator.json`, adopted verbatim. Its dogfood exception is removed, and the dogfood test passes.
- `.github/workflows/deploy-production.yml` runs only on `production`, dispatched by the promote
  workflow. It reuses `desktop.yml` through `workflow_call` to build installers on three OSes, then
  **drafts** a GitHub Release. Publishing it stays a human action; builds are unsigned (Q5).

**PENDING LOCAL VERIFICATION:**

- Installer UX on real desktops: nsis install and uninstall, dmg drag-install, deb and AppImage
  launch from the menu.
- The OS keychain inside the packaged app.
- A first real promote. It needs a `production` branch and environment, which is a human's setup.

## Also in this phase

- **Shared live wiring.** It moved from the CLI to `createLiveEngine` in `packages/core`, used by
  the CLI and the desktop, and has a unit test.
- **Windows unit-test timeout.** Windows CI pushed git-heavy integration tests past 30 s (8–18 s
  each was observed, and three crossed 30 s under load). The unit timeout is now 120 s on win32
  only, and no assertion changed.

## `pnpm check`

```text
── check full ──  (26 steps) … exit 0
Tests 349 passed | 2 skipped (351); e2e 3 passed
coverage: lines 94.01 %, statements 92.4 %, functions 92.54 %, branches 82.91 %
```
