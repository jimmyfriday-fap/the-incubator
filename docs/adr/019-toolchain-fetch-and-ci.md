# ADR-019: Hash-pinned tool fetching and the CI layout

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context
`pnpm check` must run in a fresh cloud session with no manual setup (Phase 0), yet some checks need
non-npm binaries: actionlint, gitleaks and semgrep. Remote installers must be hash-pinned and never
piped into a shell.

## Decision
- `tools/tools.lock.json` lists `{name, version, platform-arch: {url, sha256}}` for actionlint and
  gitleaks, plus the semgrep wheel set.
- `node scripts/tools-fetch.mjs` (run by `pnpm check` via `pretools`) downloads into `.tools/`
  (gitignored) with `fetch` and verifies the SHA-256 before extracting:
  - tar via the Node `tar` module (a dev dependency);
  - zip via `yauzl`;
  - semgrep is installed into `.tools/venv` with `pip install --require-hashes`.
  A missing network gives `ToolError` exit 1, with a clear message. It never skips silently.
- **CI (`ci.yml`):**
  - `check` job on the OS matrix;
  - `packs` job (Phase 2, 8 cells);
  - `web-e2e` (Phase 5);
  - `gate` job (`needs: all`, `if: always()`, explicit result check).
- **`security-scan.yml`:** runs on PRs, pushes to `main` and a weekly schedule.
- **`desktop.yml`** (Phase 6).
- All `uses:` are SHA-pinned from `packages/templates/actions-lock.json`, the same file the packs use.

## Consequences
- The cloud session and CI run identical tool versions.

## Alternatives considered
- **Requiring pre-installed tools.** Rejected: violates "no manual setup".
