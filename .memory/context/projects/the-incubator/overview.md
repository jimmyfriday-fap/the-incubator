---
name: the-incubator-overview
tier: project
description: What the-incubator is, its entry points, and exact build/run/test commands. Read first when working in the-incubator.
last_verified: 2026-11-04
---

# the-incubator overview

- [2026-11-04] [bootstrap] Local project genesis engine: a plain-English narrative and/or an existing repository in, a canonical GitHub repository out. (src: package.json)
- [2026-11-04] [bootstrap] TypeScript ESM monorepo on pnpm 10 workspaces and Node >=22.12 <23, with Vitest 5, ESLint 10, Prettier 3.9.9 and lefthook. (src: package.json, .nvmrc)
- [2026-11-04] [bootstrap] Entry points: the CLI incubator (apps/cli/bin/incubator.mjs), the localhost web UI (apps/web) and the Electron desktop app (apps/desktop). (src: apps/cli/package.json, config/deps-boundary.json)
- [2026-11-04] [bootstrap] Install dependencies with pnpm; the session-start hook installs with the frozen lockfile. (src: package.json, docs/adr/017-agent-hooks-and-tracker-loop.md)
- [2026-11-04] [bootstrap] Build with pnpm build (tsc -b tsconfig.build.json); typecheck with pnpm typecheck. (src: package.json)
- [2026-11-04] [bootstrap] Unit tests: pnpm test (Vitest project unit); browser tests: pnpm test:e2e; desktop smoke tests: pnpm test:desktop-smoke; named run profiles: pnpm test:profile <name>. (src: package.json, vitest.config.ts)
- [2026-11-04] [bootstrap] CI is GitHub Actions: ci.yml runs check on three operating systems; desktop.yml, security-scan.yml, deploy-production.yml and promote-to-production.yml cover the rest. (src: .github/workflows, .incubator/dogfood-exceptions.json)
- [2026-11-04] [bootstrap] External services: GitHub (token from the keychain, then gh auth token, then GITHUB_TOKEN) and coding-agent or model CLIs whose flags are probed at run time. (src: docs/adr/009-secrets-and-redaction.md, docs/adr/007-llm-adapters-probing-and-sandboxing.md)
- [2026-11-04] [bootstrap] Docs: design in docs/TDD.md, decisions in docs/adr/, executor plans in docs/plans/, and the Add memory spec in docs/incubator-memory-feature.md. (src: docs/adr/README.md, docs/plans/README.md)
