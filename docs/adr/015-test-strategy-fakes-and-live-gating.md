# ADR-015: Vitest, fakes by default, a bare-repo fake GitHub, `INCUBATOR_LIVE`

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context
The cloud session has no keychain, no logged-in CLIs, no GUI and no real GitHub target. Tests must be
meaningful without them, and live tests must exist but not run by default.

## Decision
- **Vitest 5** for all TypeScript packages. The workspace config has projects per package. The
  `unit` project stubs `net.connect`/`fetch` so unit tests can't reach the network.
- **Fakes live in the packages** (`@incubator/<pkg>/testing`). `createEngine(fakeDeps())` is the
  standard harness.
- **The fake GitHub** creates a real bare git repository in a temp dir per created repo, and pushes
  go there through real `git`. API calls are recorded for sequence snapshots, and failure injection is
  available at every method.
- **Live tests** are `*.live.test.ts`, included only when `INCUBATOR_LIVE=1`. They read
  `INCUBATOR_LIVE_ORG`, `INCUBATOR_LIVE_LEANTIME_URL` and friends, and clean up in `afterAll` even on
  failure.
- **Golden tests** use `toMatchFileSnapshot` under `__golden__/`. Updating them requires
  `pnpm test -u` plus a review of the diff.
- **Playwright** handles web e2e (Phase 5) and Electron smoke (Phase 6), using the preinstalled
  Chromium in the cloud session.

## Consequences
- Any claim in a phase doc marked PASS is backed by a test that ran in the session or in CI.
- Live paths can still break unnoticed between local verifications. That is accepted, and the gap is
  listed as `PENDING LOCAL VERIFICATION`.

## Alternatives considered
- **nock/msw-style HTTP mocks for GitHub.** Rejected as the primary fake: they test HTTP shapes, not
  behaviour. They are used only for Octokit adapter unit tests.
