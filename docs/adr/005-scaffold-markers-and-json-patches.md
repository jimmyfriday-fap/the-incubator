# ADR-005: Comment markers for text files, declarative JSON patches for JSON

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context
Later packs must modify earlier packs' files only through scaffold markers (brief §6). Generated
projects also use markers for their own registries (brief §3.5). JSON files such as `package.json`,
`composer.json` and `tsconfig.json` can't carry comments.

## Decision
- **Marker grammar.** A line whose trimmed content is `<c> <scaffold:NAME>` opens a region, and
  `<c> </scaffold:NAME>` closes it. `<c>` is `//`, `#` or `<!--`/`-->`, chosen by file extension from
  a fixed table. `NAME` matches `[a-z0-9-]+`.
- **Marker patches** (`{file, region, entries: [{id, text}]}`) replace the region body with the
  union of existing and new entries, keyed by `id`, sorted by `id`. Each entry is delimited by an
  inner `<c> @id` line, so re-applying is idempotent and removal is possible.
- **JSON patches** (`{file, pointer, op: set|merge|append-unique, value}`) apply in composition order.
  `append-unique` compares with JCS. Output uses sorted keys (ADR-004).
- The drift check requires every declared region to appear exactly once and to be well-formed. An
  unclosed or duplicate region is a `ToolError` at render time, or exit 2 in a generated repo's guard.

## Consequences
- The same code implements the Incubator's pack composition and the generated `scripts/scaffold.mjs`.
  It lives in the base pack's guard toolkit and is imported by `packages/templates`. That is dogfood.

## Alternatives considered
- **JSON with a `"//scaffold"` key.** Rejected: pollutes user-facing manifests and tools strip it.
- **Three-way text merge.** Rejected: nondeterministic under conflicts.
