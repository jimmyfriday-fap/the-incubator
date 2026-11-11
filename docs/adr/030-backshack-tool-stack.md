# ADR-030: The Backshack tool stack is built in a backshack-dev worktree, under the Backshack Build Contract

- **Status:** Proposed
- **Date:** 2026-11-02
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7, §9; [`docs/incubator-research.md`](../incubator-research.md);
  amends [ADR-026](026-stack-pack-catalog-and-recommendation.md) for this one stack only

## Context

When a description was really a Backshack tool (a multi-tenant AI workflow sold to Backshack members), the
Incubator had no way to say so. The closest catalog entry was `wordpress`, so the COI Tracker run built a
standalone WordPress plugin in a new repository, with its own namespace and its own tables. It diverged from
the Backshack tool package at the first file and had to be rebuilt by hand as The Gauge.

Backshack now writes down what a conforming tool is in one generic document, the Backshack Build Contract
(`docs/BACKSHACK_CONTRACT.md` in the backshack-generator repository). The contract must reach the coding agent
only when Backshack is the target, and from the first file; every other stack must be unaffected.

The Incubator decides the stack once, before any code (`stackRecommend`, owner confirmation), and never
re-plans after CODE starts. ADR-026 keeps the recommendation only in the turn and the journal.

## Decision

1. **A third kind of stack.** `packages/spec/src/stacks.ts` gains `kind: 'workspace'`: a stack built inside a
   fresh worktree of an existing repository the owner configures. Its one entry is `backshack-tool`, which fits
   when the description names Backshack, a Backshack tool or rack as the target, or describes a multi-tenant AI
   workflow for paying members (staged confirm-and-proceed, AI pipes, a handoff export, purchasable access).
   The recommendation prompt states that rule and asks, for this stack only, for the tool's shape
   (`backshackFit`: name, slug, prefix, rack, stages, AI pipes, handoff schema).
2. **The decision is durable (amends ADR-026 point 7 for this stack).** When the owner approves
   `backshack-tool`, the run folder gets `incubator-recommendation.yaml` (target, rationale, `backshack_fit`,
   `decided_at`) and the journal a `stack.approved` entry. `incubator.json` still gains no field. Every value in
   the YAML is quoted, so owner or model text cannot change its shape.
3. **Where the build happens.** The paths come from `~/.incubator/config.json` (`backshack.devRepo`,
   `backshack.generatorRepo`, optional `backshack.worktreeRoot`, default `<incubator home>/worktrees`), never
   from code. Approval fetches `origin/main` in backshack-dev and adds a worktree on
   `incubator/backshack-<slug>`; an existing folder is refused, never reused or removed. The run is the
   existing in-place update (enhance) flow on that folder, except: no repository is created, the
   canonical-pattern files (stack packs) are never added, the plan commit stays in the run's own clone (the
   plan is inlined in the coding prompt, and the tool is built on the worktree's own branch with no
   `incubator/enhance-*` branch added), the run's `.incubator/` guides and tickets are copied into the worktree
   under a nested `.incubator/.gitignore` of `*`, the Incubator's guides (`WHAT-NOW.md`, design doc,
   stand-up guide) stay out of the repository, and after the owner's commit the run ends committed locally with
   no push and no pull request. The handoff to staging (contract Section 5, the local gate, push, the ship
   skills) is the owner's.
4. **The contract reaches the coding agent verbatim.** For a `backshack-tool` run only, the coding prompt ends
   with `prompts/handoff-backshack.md` (read the contract first, it wins over the plan, run Section 5 before
   declaring done) followed by the contract file as it is on disk. `prompts/handoff.md` and
   `prompts/handoff-external.md` are unchanged, so no other stack's prompt changes by a byte.
5. **No contract, no build.** The contract is read when the owner approves the stack, again before the scan,
   and again before each coding part. A missing or empty file parks the run (`backshack_contract_missing`) with
   the path in the message; a worktree is never created without it.
6. **The run is checked, not trusted.** A run that says `stack: 'backshack-tool'` must be an update run in the
   worktree computed from its own slug, carry the owner's decision, and be `noPublish` without canonical
   files; anything else is refused before the run is created.

## Alternatives considered

- **A `backshack` stack pack (built-in).** It would render a tool package from templates, but the package is
  defined by backshack-dev's own conventions and changes with them; a pack would drift. Rejected.
- **A new repository per tool, ported later.** What happened with the COI Tracker; it is the problem.
- **Loading the contract through a pack's agent instructions.** Packs apply to repositories the Incubator
  renders; a backshack-dev worktree is not one, and the contract would land in every generated file tree.
- **Copying the contract into the Incubator.** Two copies drift. It is read from the generator repository,
  where it is maintained.
- **Pushing the branch to backshack-dev's origin.** Backshack ships by push to `main` after the local gate; a
  pushed side branch has no use there. The operator decided: commit only.

## Consequences

- Adding another workspace stack means another catalog entry and its own run checks; the kind is generic, the
  run rules here are Backshack's.
- The enhance plan files (`docs/plans/NNN-*.md`, `.incubator/tickets/`, `.incubator/lanes/`) and the
  active-ticket marker never reach backshack-dev: the branch holds only the tool's commit (amended 2026-11-03,
  operator decision). The agent and the code verify still need the designs and tickets the plan names, so they
  are copied into the worktree and hidden by the nested ignore file, which works in any repository and writes
  nothing to backshack-dev's shared `.git` (a linked worktree shares `info/exclude` and config with the owner's
  main checkout). Amended 2026-11-11: the first live run kept them in the run's clone only, and the agent
  stopped because the files the plan named were not in its folder.
- The coding agent runs only the check commands the owner approves for backshack-dev (ADR-025). The scan proposes
  the contract's group-guard lint first (`php wp-content/plugins/backshack-datalake/bin/lint-group-guard.php
--enforce --tool=<slug>`, so a warning fails the Incubator's own run of it); `node --check` cannot be an
  approved check (a flag where a subcommand is required), so the agent does the contract's searches with its own
  file search and names any Section 5 command it could not run.
- The coding agent is held to a token cap (Amended 2026-11-11). The dollar ceiling cannot stop a run: the agent
  reports its cost only in its final message, and live run 2 spent about $27 at list price against a $10 ceiling.
  A Backshack build therefore gets a default cap of 15M tokens (input, output, cache writes and cache reads, counted
  reply by reply), which does stop it mid-run. The owner sets their own in `~/.incubator/config.json` under
  `agents.ceilings` (`tokens`, and `turns`, `toolCalls`, `minutes`, `usd`); those win over the spec, and
  `tokens: 0` turns the cap off. The cost here is plan usage, not an API bill, so the figures to track are the
  token counts by kind that `handoff.result` now records beside the list-price estimate.
- Tests: the catalog holds `backshack-tool`; a `node-web` run's coding prompt has no contract text; a
  `backshack-tool` run's prompt has it verbatim; a missing contract parks the run.
