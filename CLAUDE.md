<!-- <scaffold:memory> -->

## Memory

This repo has a memory store in `.memory/`.

- At the start of any non-trivial task, read `.memory/INDEX.md` and open only the files relevant to the task.
- Before writing code, check `.memory/context/platform/conventions.md`. Before debugging, check the `failures.md` files.
- At the end of a task, if you made a decision, fixed something likely to recur, or were corrected, use the `write-memory` skill.
- Never write memory about other repos or systems.

<!-- </scaffold:memory> -->

<!-- Generated from .incubator/agent/INSTRUCTIONS.md by scripts/agent/sync-instructions.mjs. Edit the source. -->
<!-- <scaffold:agent-instructions> -->

# Agent instructions: the-incubator

The Incubator is a locally run engine that turns a plain-English idea and/or an existing repository
into a scaffolded GitHub repository following the Backshack Canonical Pattern. The design lives in
[docs/TDD.md](docs/TDD.md); decisions live in [docs/adr/](docs/adr/).

## Verification loop (mandatory)

1. After every change, run `pnpm check:quick`.
2. If it fails, the change is vetoed: fix it before doing anything else. The Stop hook enforces this
   and records the failure through the tracker (`.incubator/tickets/`).
3. Before declaring work done, run `pnpm check` (the full gate, including coverage and security fixtures).

## Exit-code contract

Every command and script exits `0` pass, `1` the tool itself broke, `2` a policy or gate finding,
`130` interrupted. Library code returns codes; only launchers call `process.exit`.

## Never do these (denied actions)

- Force-push or rewrite history; delete, skip or weaken a test; disable or weaken a gate.
- Add a flake-quarantine entry without an owner and an expiry.
- Commit secrets, real `.env` files, or absolute machine paths. Use repository-relative paths only.
- Spawn subprocesses through a shell. Use `Exec` from `@incubator/runtime` (`shell: false`).
- Put plan files at the repository root.
- Link (junction or symlink) a worktree or scratch folder into a checkout.
- Plan-file executors: output only the edits the plan lists; resolve every path and symbol first; no new dependencies without approval; stop on any find/replace mismatch; never commit or push unless asked.

## Human-only actions

Promote or roll back production, rotate secrets, edit `security/accepted-risks.json`, re-pin
contracts (`pnpm contracts:pin`), change run ceilings. Stop and ask a human.

## Where things live

- Packages: `packages/*` (engine), `apps/*` (CLI, web, desktop). Dependency rules: `config/deps-boundary.json`.
- Tests: next to sources as `*.test.ts`; scenarios in `tests/scenarios/<feature>/`, adapters in `tests/adapters/`.
- Run profiles: `config/run-profiles.json` (`pnpm test:profile <name>`). Live tests need `INCUBATOR_LIVE=1`.
- Work lanes and prompt templates: `.incubator/lanes/`; agent limits: `.incubator/agent-profile.json`.
- Executor plans: `docs/plans/NNN-slug.md` (checked by `scripts/guard/plan-lint.mjs`). Phase evidence: `docs/phases/`.
- AGENTS.md wins for commands and policy. Operator memory wins for current-state observations. A contradiction is drift: fix this file or promote the note.

<!-- </scaffold:agent-instructions> -->
