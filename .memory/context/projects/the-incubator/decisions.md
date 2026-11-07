---
name: the-incubator-decisions
tier: project
description: Decisions local to the-incubator, newest first. Read before changing how the-incubator does something.
last_verified: 2026-11-06
---

# the-incubator decisions

- [2026-11-06] [claude-code] Store mode (several repositories, one store) and Add member keep everything local: the Incubator makes the store's commits and pushes nothing, because the store repository may not exist yet and the push stays the owner's decision. (src: docs/adr/032-memory-by-default.md)
- [2026-11-06] [claude-code] A new build scaffolds .memory/ before the coding session and bootstraps it after the code, so the session reads INDEX.md first and decisions.md holds the owner's stated choices instead of (unconfirmed) guesses. (src: docs/adr/032-memory-by-default.md)
- [2026-11-06] [claude-code] Memory destination order for a run: toggle off is none; a known system picked is member; code inside an existing repository or a Backshack tool is target (no new store); otherwise repo. Update runs on a project with no memory offer Add memory and never install it. (src: packages/core/src/memory-destination.ts)
- [2026-11-06] [claude-code] Memory is on by default for every new build with a folder, because the first coding session makes the early decisions worth keeping; the choice and its reason are journaled as memory.plan before any code is generated. (src: docs/adr/032-memory-by-default.md)
- [2026-11-04] [bootstrap] TypeScript is pinned to ~6.0.3, pnpm 10 through packageManager, and Node to >=22.12 <23 through engines and .nvmrc; upgrade TypeScript to 7.x when typescript-eslint supports it. (src: docs/adr/001-monorepo-toolchain.md, .nvmrc)
- [2026-11-04] [bootstrap] which(name) resolves a Windows cmd shim by parsing the shim and spawning process.execPath with the script, because subprocesses are shell-less. (src: docs/adr/008-subprocess-spawning.md)
- [2026-11-04] [bootstrap] The local UI binds 127.0.0.1 on an OS-picked port; its launch token travels in ?t= and is exchanged once for an HttpOnly SameSite=Strict cookie. (src: docs/adr/011-localhost-ui-security.md)
- [2026-11-04] [bootstrap] On a passing Stop the active ticket moves forward one legal state at a time (TAGGED_TO_RELEASE, ENRICHMENT_IN_PROGRESS, DEV_IN_PROGRESS, then READY_FOR_TEST); a parked or finished ticket is left alone. (src: docs/adr/017-agent-hooks-and-tracker-loop.md)
- [2026-11-04] [bootstrap] The portfolio is one small JSON file written atomically with mode 0600; a damaged file is renamed portfolio.json.damaged-<time> and a new one starts, so it never stops a run. (src: docs/adr/028-project-portfolio-and-repo-marker.md)
- [2026-11-04] [bootstrap] Add memory runs default to claude-opus-5-5 at effort high, because a deploy runs once and its mistakes reach every later session; effort is applied only where the CLI has a flag for it. (src: docs/adr/031-add-memory-runs.md)
- [2026-11-04] [bootstrap] After an Add memory install, memory.installed records the store, policy and seed version on the portfolio project, and later update runs start with a line that points the agent at .memory/INDEX.md. (src: docs/adr/031-add-memory-runs.md)
