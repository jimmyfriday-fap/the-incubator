# Phase 6 — Electron desktop: acceptance evidence

Plan: [docs/plans/007-phase-6-desktop.md](../plans/007-phase-6-desktop.md).

| #   | Criterion (brief §9 and TDD §10, Phase 6)                                             | Status                                                                                                              |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | The app builds for Windows, macOS and Linux (electron-builder)                        | PASS on 3 OSes in CI ([run 36652835225](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36652835225)) |
| 2   | A smoke test launches it headless and completes a fake greenfield run                 | PASS on 3 OSes in CI, against the packaged apps                                                                     |
| 3   | Engine in-process; renderer sandboxed, no Node, navigation locked                     | PASS                                                                                                                |
| 4   | Fakes only in test builds; release builds refuse the test flag                        | PASS                                                                                                                |
| 5   | Installer UX (install, first launch from the OS menu, uninstall), keychain on each OS | PENDING LOCAL VERIFICATION                                                                                          |

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
smoke test against the packaged executables and uploads the installers. The CI runs are in §6.

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

## 6. CI

**First run.** [desktop run 36648027099](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36648027099) at `692b42c`:

- **ubuntu-latest and windows-latest: passed.** Both built the installers, and all 3 smoke tests
  passed against the packaged executables.
- **macos-latest: failed.** It built the dmg and zip, and the two release-build smoke tests
  passed. The test build then never opened a window:
  `electronApplication.firstWindow: Timeout 30000ms exceeded`.

**First fix: separate `userData`.** Both builds used the same `userData` directory, which holds
Electron's single-instance lock. A test build that shares it with a running instance hands off and
quits. I reproduced this locally with a running release instance:

```text
same userData as release: launch failed: electron.launch: Target page, context or browser has been closed
test build default userData: window opened
```

Changes:

- Test builds default to their own `userData` (`<userData> (test build)`).
- `INCUBATOR_DESKTOP_USER_DATA` overrides the directory.
- Every smoke launch gets a fresh home and `userData`.
- Teardown kills an app that does not close within 15 s.

That was a real defect, but it was not what broke macOS.
[desktop run 36650480192](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36650480192)
at `4869209` failed the same way on macOS, while Linux and Windows passed again.

**Root cause: a space in the app path.** macOS is the only platform whose packaged path contains
a space (`The Incubator.app`).

1. `discoveryFixtureDir` (`packages/core/src/testing.ts`) built its path from
   `new URL(import.meta.url).pathname`, which keeps the space as `%20`.
2. The fake wiring then failed to find its recorded discovery turns.
3. The startup error went to a modal `dialog.showErrorBox`, which blocks, so no window ever
   opened.

I reproduced this on Linux by copying the packaged test build under a directory with a space:

```text
with a space:    electron.launch: Timeout 20000ms exceeded
without a space: window opened
```

**Fix.**

- `discoveryFixtureDir` uses `fileURLToPath`. Elsewhere, the guard library already decoded its
  path, and no other code builds a file path from a URL pathname.
- A startup error is always written to stderr.
- Test builds exit without the modal; release builds still show the dialog.

With both packaged executables copied under `/tmp/…/sp ace/`, the Linux smoke test passes:

```text
✓ release build: launches, locks the renderer down and shows the app
✓ release build: refuses the test-fakes flag
✓ test build: completes a fake greenfield run to DONE
Tests  3 passed (3)
```

**Green on all three OSes.** At `ac095a9`, [desktop run 36652835225](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36652835225) passed. For each of
ubuntu-latest, macos-latest and windows-latest, the job:

- built the test build and the release installers;
- passed all 3 smoke tests against the packaged executables;
- uploaded the installers as artifacts: AppImage and deb, dmg and zip, nsis exe.

[ci run 36652835168](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36652835168) and
[security-scan run 36652835167](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36652835167)
also passed at that commit.

[ci run 36648027006](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36648027006) (check on 3 OSes, `packs`, `gate`) and
[security-scan run 36648026979](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36648026979) passed at the same commit.

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
