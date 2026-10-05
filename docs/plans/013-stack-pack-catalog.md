# Plan 013: a declared stack pack catalog

## Executor preamble

> Amended by ADR-027 (2026-10-04): the manifest catalog described here is how the four built-in packs
> describe themselves. Stacks beyond them are retrieved from their own generator through a small catalog in
> code (plan 016), so this plan no longer gates them.

Stage 1 of "standard stack packs" (ADR-026). The list of stack packs, and the rules about which
frameworks, package managers, databases and deploy targets go with each, are hardcoded in about a dozen
places: the schema enums, `packages/spec/src/{constants,defaults,semantics}.ts`, the analyzer's
`PACKED_ECOSYSTEMS`, the CI matrix and the combo fixtures. Adding a pack means finding all of them.

This plan moves that knowledge into one place: an optional `catalog` block in each stack pack's
`pack.json`. A script generates `packages/spec/src/catalog.gen.ts` from the blocks, the existing tables
are derived from it with identical values, and a new guard (`pack-catalog`) fails when the schema enums,
the combo fixtures or the CI matrix disagree with the catalog.

**No behaviour change.** The four packs keep their ids, defaults and rules. Goldens, discovery fixture
keys and semantics messages stay byte-identical. The recommender is plan 014; new packs are plans
016 to 018.

**Human step.** `packages/templates/schema/pack.schema.json` is a pinned contract. The executor stops
after the schema edit and asks the owner to run `pnpm contracts:pin`.

The catalog block (every list is ordered; the first entry is the default):

- `label`, `summary`: short human text.
- `fits[]`, `avoidWhen[]`: what the pack suits and does not suit (used by plan 014's prompt).
- `platforms[]`, `frameworks[]`, `packageManagers[]`, `databases[]`, `auth[]`, `deployTargets[]`.
- `e2e`: `playwright` or `none`.
- `prerequisites[]`, `testTools[]`.
- `ecosystem`: the `detectEcosystem` id this pack covers.

## Touched files and markers

| File or directory                                                                       | Marker / note                                                              |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/templates/schema/pack.schema.json`                                            | optional `catalog` object; pinned, owner re-pins                           |
| `packages/templates/packs/stack/{node-web,node-lib,python-service,wordpress}/pack.json` | one `catalog` block each, values copied from today's constants             |
| `scripts/gen-catalog.mjs`, `package.json`                                               | writes `packages/spec/src/catalog.gen.ts`; `pnpm catalog:gen`              |
| `packages/spec/src/catalog.gen.ts`                                                      | generated `STACK_CATALOG`; never edited by hand                            |
| `packages/spec/src/{constants,defaults,semantics}.ts`                                   | tables derived from `STACK_CATALOG`; rule codes and messages unchanged     |
| `packages/analyzer/src/detectors.ts`                                                    | `PACKED_ECOSYSTEMS` derived from the catalog                               |
| `scripts/guard/pack-catalog.mjs`, `config/checks.json`                                  | the guard, in the quick and full profiles                                  |
| `scripts/guard/guards.test.mjs`                                                         | guard tests: stale generated file, enum drift, missing combo, matrix drift |
| `packages/templates/src/packs.test.ts`                                                  | combo coverage per pack and deploy target                                  |
| `docs/adr/026-stack-pack-catalog-and-recommendation.md`, `docs/TDD.md`                  | the decision; the pack section points at the catalog                       |

## Acceptance commands

```sh
export PATH="/c/tools/node22:$PATH"
pnpm catalog:gen && git diff --exit-code packages/spec/src/catalog.gen.ts
git diff --exit-code packages/templates/__golden__ packages/core/prompts packages/core/fixtures
pnpm exec vitest run --project unit packages/spec packages/analyzer packages/templates
node scripts/guard/pack-catalog.mjs
pnpm check:quick
pnpm check
```

```text
the generated catalog is current and the goldens, prompts and discovery fixtures are unchanged
the existing semantics tests pass without edits
pack-catalog reports: enums, defaults, combos and the CI matrix agree with the catalog
pnpm check:quick exits 0
pnpm check exits 0 (after the owner re-pins the pack schema)
```

## Drift and hallucination guardrails

| Trap                                             | Why                                                       | Mechanical check                                                                  |
| ------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A derived table differs from today's constant    | "no behaviour change" is the whole promise                | a test compares each derived table with a literal copy of the old value           |
| Goldens or rendered files change                 | manifests gained a field the renderer might pick up       | `git diff --exit-code packages/templates/__golden__`                              |
| The discovery prompt text changes                | fixture keys are hashes of the prompt (ADR-024 section 3) | `git diff --exit-code packages/core/prompts packages/core/fixtures`               |
| A new pack id or enum value sneaks in            | new packs belong to plans 016 to 018                      | the `incubator.schema.json` hash in `contracts.lock.json` is unchanged            |
| `packages/spec` imports `packages/templates`     | deps-boundary forbids it; the script generates instead    | `deps-boundary` guard stays green                                                 |
| `catalog.gen.ts` is edited by hand               | it would drift from the manifests                         | the guard regenerates in memory and compares                                      |
| The CI matrix and the combo fixtures drift apart | no check covers it today                                  | guard test: remove one matrix row, expect a finding                               |
| A guard that cannot fail                         | a guard with no failing test proves nothing               | each of the five checks has a test that makes it fail                             |
| The owner's pin is skipped                       | `pnpm contracts:pin` is human-only                        | stop after the schema edit; `contracts-pin` is green only after the owner runs it |

## Review rounds

| Round | Finding                                                                                                | Status    |
| ----- | ------------------------------------------------------------------------------------------------------ | --------- |
| 1     | Pack knowledge is duplicated across the spec, analyzer, templates and CI; found while scoping plan 014 | FIX-FIRST |
