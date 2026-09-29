# ADR-016: A `package-release` deploy class for non-server projects

- **Status:** Proposed (needs approval: TDD Q1)
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context
The canonical lanes (brief §3.1) assume a server: staging hosts, VPS or docker deploys, smoke checks.
`node-lib` projects, CLI tools and this repo itself (a desktop and CLI app with no server) have no
host to deploy to. Forcing `vps-tailscale`/`docker-host` onto them would generate dead workflows. The
brief says that if the Incubator can't meet its own standard, fix the standard.

## Decision
Add `deploy.target: "package-release"`, keeping the same lane *shape*:
- **staging** = on push to `main`, build and test artifacts (npm tarball, wheel, Electron installers),
  upload them as workflow artifacts, and publish a prerelease (`vX.Y.Z-rc.<run>` or an npm `next`
  tag) when configured;
- **prod** = `promote-to-production.yml` (manual, dry run by default) merges into `production` and
  dispatches `release-production.yml` (no push trigger), which creates the GitHub Release and
  publishes to npm or PyPI with provenance;
- **rollback** = verify the target is the latest promote merge, then deprecate the bad version or
  move the `latest` dist-tag or release pointer back;
- `.deploy-tasks.json` and `run-deploy-tasks.mjs` stay (for example, post-release docs publishing).

## Consequences
- Adds a third deploy pack to Phase 2. The golden matrix grows from 32 to 48 combinations, and the CI
  cell count is unchanged.
- The Incubator repo can dogfood promote and rollback.

## Alternatives considered
- **Treat libraries as `docker-host`.** Rejected: nonsensical output.
- **No deploy pack for libraries.** Rejected: loses promotion hygiene.
