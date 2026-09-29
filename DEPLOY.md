# Deploy

## Deploy class

**`package-release`** (ADR-016). The Incubator runs on the user's machine; there is no server. The
canonical lanes keep their shape, but "deploy" means publishing build artifacts:

| Lane    | Branch       | What happens                                                                                                                                                                                                           |
| ------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| local   | any          | `pnpm check` on the developer machine; `pnpm build` produces the CLI; the desktop app builds locally.                                                                                                                  |
| staging | `main`       | Every push runs CI on Linux, Windows and macOS. From Phase 6, CI also builds the desktop installers and uploads them as workflow artifacts (a prerelease).                                                             |
| prod    | `production` | Only reachable through `promote-to-production.yml` (manual, dry run by default). It merges `main` into `production` and dispatches `release-production.yml`, which has no push trigger and creates the GitHub Release. |

## Promotion rules

1. Promotion is a human-only action (`.incubator/agent-profile.json`).
2. `promote-to-production.yml` runs with `execute_tasks: false` by default and only prints the plan.
3. `rollback-production.yml` verifies the target is the latest promote merge, then re-points the
   `latest` release to the previous one and marks the bad release as a prerelease.
4. Post-release tasks are declared in `.deploy-tasks.json` and run by `scripts/run-deploy-tasks.mjs`
   (dry run by default; `--yes` to execute), logged per `(name, env, sha)`.

The promote, release and rollback workflows ship with Phase 6. Until then `main` is the only lane.

## Required settings

None yet. Release signing certificates are an open question (TDD Q5).
