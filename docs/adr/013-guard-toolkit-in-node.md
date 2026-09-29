# ADR-013: A single Node guard toolkit for every generated stack

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

Generated repos need the same guardrails whatever their stack: BOM, isolation, completeness, drift,
policy gate, quarantine, plan lint, lane contract, deploy tasks and so on. Writing each guard three
times (JS, PHP, Python) triples the code and the bugs, and the three copies would drift.

## Decision

- The guards are **zero-dependency Node ESM scripts** (`scripts/guard/*.mjs`,
  `scripts/run-deploy-tasks.mjs`, `scripts/scaffold.mjs`, `scripts/agent/*.mjs`), owned by the `base`
  pack and rendered verbatim into every repo.
- **Node 22 is a declared dev prerequisite for every generated repo**, including PHP and Python. It is
  also needed for lefthook, Prettier (Markdown/YAML) and Playwright.
- Stack-native tools (PHPUnit, pytest, Ruff, PHP-CS-Fixer and so on) are invoked _by_ the guards,
  shell-less.
- The Incubator repo carries the identical files. From Phase 2, a dogfood test renders `base` and
  byte-compares them.

## Consequences

- One tested implementation. The generated repo's `check:quick` is `node scripts/check.mjs quick` in
  every stack, and each stack's task runner (`composer`/`uv`/`pnpm`) aliases it.
- PHP and Python developers must have Node installed. That is common in practice for WordPress asset
  builds, and documented in the generated README.

## Alternatives considered

- **Per-language guards.** Rejected: triple maintenance and drift.
- **Bash scripts.** Rejected: Windows is first-class.
