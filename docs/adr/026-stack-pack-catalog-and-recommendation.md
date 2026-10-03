# ADR-026: A stack pack catalog, and a recommended stack for a new tool

- **Status:** Proposed
- **Date:** 2026-10-02
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7, §9

## Context

The Incubator ships four stack packs (`node-web`, `node-lib`, `python-service`, `wordpress`). Which
pack exists, and which framework, package manager, database, auth and deploy target belong with it, is
written down in about a dozen places: the schema enums, `constants.ts`, `defaults.ts`, `semantics.ts`,
the analyzer, base templates, the combo fixtures and the CI matrix. The pack manifests themselves
declare only when they apply.

For a new tool, discovery shows the model bare enum values. The stack is chosen without stated reasons
or alternatives, a bad combination is caught only at `finalize` (the run parks), and the owner's only
way to change it is the raw JSON editor at review. The owner's first real target is a Flutter and
Supabase app, and Next.js and Go services are expected next, so the number of packs will grow.

## Decision

1. **The catalog lives in the stack pack manifests.** Each `packs/stack/*/pack.json` gets an optional
   `catalog` block: label, summary, what it fits and avoids, platforms, frameworks, package managers,
   databases, auth, deploy targets, `e2e`, prerequisites, test tools and the analyzer ecosystem it
   covers. The first entry of each list is the default.
2. **Spec reads a generated copy.** `scripts/gen-catalog.mjs` writes `packages/spec/src/catalog.gen.ts`.
   `PACK_FOR_PLATFORM`, `STACK_DEFAULTS`, `FRAMEWORKS_FOR_PACK`, `PACKAGE_MANAGERS_FOR_PACK` and the
   semantic rules are derived from it. A script is used because `packages/spec` may not import
   `packages/templates` (deps-boundary).
3. **A guard keeps everything else in step.** `pack-catalog` fails when the generated file is stale,
   when the schema enums differ from the catalog, when a pack and deploy target pair has no combo
   fixture, or when the CI `packs` matrix differs from the combos.
4. **For a new tool the model proposes and rules check.** Discovery receives the catalog and returns
   `stackRecommendation` (pack, platform, one to three reasons, up to two alternatives with their
   trade-offs). A deterministic check on every turn sends the model back when the recommendation is
   missing, names `other` or a pack outside the catalog, does not match the drafted stack, or breaks a
   stack rule.
5. **The owner overrides at review.** The review shows the pick, the reasons and the alternatives. The
   owner may switch to any catalog entry; the stack becomes that pack's catalog defaults, the
   `stack.pack` decision becomes `user`, and the run journals `stack_overridden`.
6. **An update recommends nothing.** Adopt and enhance keep the repository's stack: a pack when one fits,
   `other` otherwise (ADR-024). When a repository matches a pack but differs (framework, package
   manager), the review lists the differences. The repository is never converted.
7. **Where the recommendation is stored.** In the discovery turn and the run journal. `incubator.json`
   gains no field; it keeps the `stack.pack` decision row.
8. **Contract changes are staged and owner-pinned.** Plan 013 changes `pack.schema.json`; plan 014
   changes `discovery-turn.schema.json`. Each new pack (plans 016 to 018) adds enum values to
   `incubator.schema.json`. The owner runs `pnpm contracts:pin` each time.

## Alternatives considered

- **A deterministic scorer only.** Reproducible, but brittle against varied narratives, and every new
  signal needs code. Kept as a possible later check, not the recommender.
- **A scorer that ranks and the model only explains.** Most predictable, least flexible; the owner chose
  a model proposal checked by rules.
- **One central `catalog.json`.** Easy to read, but the facts about a pack would live apart from its
  templates, and a pack could be added without one.
- **Keeping the constants and extending them.** Leaves the duplication that makes adding a pack error
  prone.
- **Storing the recommendation in `incubator.json`.** A larger contract change that lands in every
  generated repository, for text that matters only during the run.
- **One plan for catalog and recommender.** Too large; the catalog is a no-behaviour-change refactor and
  can be proven alone with unchanged goldens.

## Consequences

- Adding a pack needs a manifest `catalog` block, templates, combo fixtures with goldens, CI matrix rows,
  schema enum values and an owner re-pin. The guard enforces the first, third and fourth.
- Plan order: 013 catalog, 014 recommender, 015 Dart/Flutter scanning, 016 Flutter and Supabase pack,
  017 Next.js pack, 018 Go pack. Plans 015 and 016 were numbered 013 and 014 in ADR-024.
- Plan 016 introduces the first new enum values. Provisional: a `mobile` platform, a `flutter` pack and
  framework, `pub` as package manager, `supabase` for database and auth, and a deploy target for
  mobile releases. They are settled in that plan.
- The discovery prompt grows, and the recorded discovery fixtures are re-keyed once (plan 014).
- Existing repositories are unaffected: nothing is recommended to them and nothing is converted.
