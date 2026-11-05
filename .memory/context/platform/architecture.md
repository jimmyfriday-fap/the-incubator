---
name: architecture
tier: platform
description: Components and how they connect; in a multi-repo system, one line per repo and every cross-repo edge. Read before structural changes.
last_verified: 2026-11-04
---

# Architecture

- [2026-11-04] [bootstrap] The repository is a pnpm monorepo of eight engine packages (analyzer, core, git, llm, runtime, spec, templates, tracker) and three apps (cli, desktop, web). (src: config/deps-boundary.json)
- [2026-11-04] [bootstrap] Dependencies point one way: runtime depends on nothing; spec and git on runtime; llm, tracker and templates on runtime and spec; analyzer on those plus templates and git; core on all seven other packages; the apps sit on top, and apps/cli also depends on apps/web. (src: config/deps-boundary.json)
- [2026-11-04] [bootstrap] packages/runtime is the shared kernel: error and exit-code types, exec.ts (the only module allowed to import node:child_process), a logger with the redactor at its sink, SecretString, and path helpers. (src: docs/adr/002-runtime-kernel-package.md, docs/adr/008-subprocess-spawning.md)
- [2026-11-04] [bootstrap] packages/core/src/engine.ts holds the Engine class that drives a run; packages/spec holds the JSON Schema for incubator.json and the stack catalog in src/stacks.ts. (src: packages/core/src/engine.ts, docs/adr/006-spec-schema-source-of-truth.md, docs/adr/030-backshack-tool-stack.md)
- [2026-11-04] [bootstrap] Each run writes an append-only journal at runs/<runId>/journal.jsonl and resumes by replaying it through a pure reducer; the project portfolio is a separate file, portfolio.json in the Incubator home folder, that incubator gc never removes. (src: docs/adr/010-run-journal-and-resume.md, docs/adr/028-project-portfolio-and-repo-marker.md)
- [2026-11-04] [bootstrap] packages/templates/packs holds the base pack and the stack packs that render a new repository with Eta; the guard toolkit under scripts/ is copied byte for byte into the base pack by scripts/packs-sync.mjs. (src: scripts/packs-sync.mjs, docs/adr/013-guard-toolkit-in-node.md)
- [2026-11-04] [bootstrap] The command line is apps/cli/bin/incubator.mjs, the localhost web UI is apps/web, and the Electron desktop app runs the same Fastify server in-process. (src: apps/cli/package.json, docs/adr/012-electron-in-process-server.md)
- [2026-11-04] [bootstrap] assets/memory-seed/ is the memory seed (version 1.0.1) that the Incubator ships and copies, read-only, into each Add memory run; it is an asset the Incubator ships, not this repository's own memory. (src: docs/adr/031-add-memory-runs.md, docs/incubator-memory-feature.md)
- [2026-11-04] [bootstrap] An Add memory run copies the seed into its run folder, lets a coding-agent session follow the deploy-repo playbook (prompt in packages/core/prompts/memory-repo.md, allowed commands in MEMORY_ALLOWED_TOOLS in packages/core/src/memory.ts), then checks the result and parks memory_rules_broken or memory_verify_failed on a failure. (src: docs/adr/031-add-memory-runs.md, docs/plans/071-add-memory-repo-mode.md)
