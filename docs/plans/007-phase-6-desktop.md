# Plan 007: Phase 6 — Electron desktop

## Executor preamble

Package the web UI as an Electron 44 app with the engine running in-process (TDD §9.3):

- **Main process.** It builds the live engine through `createLiveEngine` (shared with the CLI),
  starts the localhost server and loads its single-use URL in a sandboxed `BrowserWindow`.
- **Renderer.** It gets no Node, no preload, and navigation locked to the server's origin. External
  links open only for https GitHub or a spec's Leantime host.
- **Build.** esbuild bundles the main process. electron-builder 26 produces unsigned installers:
  nsis, dmg + zip, AppImage + deb.
- **Test build.** It carries the fakes behind a launch flag. A Playwright `_electron` smoke test
  drives a fake greenfield run to DONE against the packaged executable.
- **CI and release.** `desktop.yml` builds and smoke-tests on all three OSes. The repository's own
  release lane (`promote-to-production` → `deploy-production`) drafts a GitHub Release with the
  installers.

## Touched files and markers

| File or directory                                                         | Marker / note                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/desktop/src/main.ts`                                                | Electron main (bundled; excluded from tsc build and coverage)            |
| `apps/desktop/src/{window,packs-archive}.ts`                              | navigation / external-link policy; packs archive create + extract        |
| `apps/desktop/src/testing-fixtures/fakes.ts`                              | fake wiring, bundled only when `INCUBATOR_TEST_BUILD=1`                  |
| `apps/desktop/scripts/build.mjs`, `electron-builder.yml`                  | staging (bundle, assets, packs.json, vendored keyring); packaging config |
| `apps/desktop/smoke/desktop.smoke.test.ts`                                | Playwright `_electron` smoke (vitest project `desktop-smoke`)            |
| `packages/core/src/{live,config}.ts`                                      | `createLiveEngine` / `loadConfig`, moved from the CLI                    |
| `packages/templates/src/registry.ts`                                      | `packsDir()`: `INCUBATOR_PACKS_DIR` override                             |
| `.github/workflows/{desktop,deploy-production,promote-to-production}.yml` | 3-OS build + smoke; the Incubator's own release lane                     |

## Acceptance commands

```sh
pnpm --filter @incubator/web build:ui
INCUBATOR_TEST_BUILD=1 pnpm --filter @incubator/desktop dist:test   # test build, unpacked
pnpm --filter @incubator/desktop dist                               # release build + installers
INCUBATOR_DESKTOP_EXE=… INCUBATOR_DESKTOP_TEST_EXE=… xvfb-run -a pnpm test:desktop-smoke
```

```text
release build: launches, renderer has no require/process, window.open denied, off-origin navigation
blocked; refuses the test-fakes flag (exit 2); test build: fake greenfield run reaches DONE
desktop.yml: the same smoke on ubuntu, macos and windows against the packaged executables
```

## Drift and hallucination guardrails

| Trap                                                | Why                                              | Mechanical check                                                                    |
| --------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Fakes ship in a release build                       | A user run against a fake GitHub                 | build-time constant drops the branch; smoke asserts the release refuses the flag    |
| The packager silently drops template files          | `.github/` workflows missing from rendered repos | packs travel as `packs.json`; archive round-trip test; packaged smoke renders       |
| Renderer compromise reaches Node or other origins   | Threat T9                                        | sandbox, context isolation, no preload; smoke checks `require`/`process`/navigation |
| The workspace `node_modules` lands in the installer | 36 MB of dev dependencies in the asar            | `files: !node_modules`; the asar holds only the staged app                          |
| Native keychain module fails inside the asar        | Keychain silently unavailable                    | vendored next to its loader and `asarUnpack`ed                                      |
| Release published without review                    | Unsigned binaries go public                      | deploy-production only drafts; publishing is a human action                         |

## Review rounds

| Round | Finding                                                                                              | Status |
| ----- | ---------------------------------------------------------------------------------------------------- | ------ |
| 1     | electron-builder walked up to the workspace and packed its node_modules (36 MB asar)                 | CLOSED |
| 2     | electron-builder dropped `.github/`, `.gitignore`, `.gitattributes` from packs; packs now an archive | CLOSED |
| 3     | The release bundle still contained the fake wiring (unguarded dynamic import)                        | CLOSED |
| 4     | CI's Chrome requested `/favicon.ico` (404 console error failed the Phase 5 e2e on every OS)          | CLOSED |
| 5     | Windows runners pushed git-heavy unit tests past 30 s; the unit timeout is 120 s on win32            | CLOSED |
