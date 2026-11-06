---
name: write-executor-plan
description: Writes a new executor plan under docs/plans that passes the plan-lint guard. Use when a change is handed to a smaller model or another session to carry out.
---

# Write an executor plan

1. Pick the next number: list `docs/plans/` and take the highest `NNN` plus one. The file is `docs/plans/NNN-kebab-slug.md`, never at the repository root.
2. Include the five required sections with these exact headings: `Executor preamble`, `Touched files and markers` (a table), `Acceptance commands` (a command block, then an expected-output block), `Drift and hallucination guardrails` (a table with the columns Trap, Why and Mechanical check) and `Review rounds` (a table where every row ends in FIX-FIRST or CLOSED).
3. Use repository-relative paths only; the abs-path guard rejects absolute machine paths.
4. Run `node scripts/guard/plan-lint.mjs` and fix every finding, then run `pnpm exec prettier --write` on the plan file.

Status: stub from bootstrap; confirm with the owner on first real use.
