# Plan 014: recommend a stack for a new tool; keep the repository's own for an update

## Executor preamble

> Amended by ADR-027 (2026-10-04): the recommender is first delivered over the small code catalog of plan
> 016, which can later read this catalog. The rules below still describe a recommendation for a built-in pack.

Stage 2 of "standard stack packs" (ADR-026). It needs plan 013 (the catalog) merged first.

For a **new** tool, discovery today shows the model bare enum values and the stack is chosen without
stated reasons or alternatives. A bad combination is caught only at `finalize`, which parks the run, and
the only way for the owner to change the stack is the raw JSON editor at review.

Now: the model proposes a pack with reasons and one or two alternatives, chosen from the catalog. A
deterministic check on every turn sends a bad proposal back to the model. The review screen shows the
pick, the reasons and the alternatives with their trade-offs, and the owner can switch to any compatible
catalog entry; the switch is journaled.

For an **update** (adopt or enhance) nothing is recommended. The repository's own stack stands: a pack
when one fits, `other` otherwise (ADR-024). When the repository matches a pack but differs from it (a
different framework or package manager), the review lists the differences. The repository is never
converted to the pack.

The recommendation lives in the discovery turn and the run journal. `incubator.json` keeps only the
`stack.pack` decision row (`inferred`, or `user` after an override).

**Human step.** `packages/spec/schema/discovery-turn.schema.json` is pinned. The executor stops after the
schema edit and asks the owner to run `pnpm contracts:pin`. Raising the discovery prompt version changes
the recorded fixture keys; re-key the fixtures by hand-editing, never by deleting any.

## Touched files and markers

| File or directory                                                                     | Marker / note                                                                                              |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/spec/schema/discovery-turn.schema.json`, `packages/spec/src/schemas.ts`     | optional `stackRecommendation {pack, platform, reasons[1..3], alternatives[0..2]{pack, tradeoff}}`; pinned |
| `packages/core/src/discovery/prompt-builder.ts`, `packages/core/prompts/discovery.md` | "Stack catalog" section (new projects only); prompt version 1.1.0                                          |
| `packages/core/src/discovery/stack.ts`                                                | `stackIssues`: the per-turn rules check                                                                    |
| `packages/core/src/engine.ts`                                                         | `draftStep` `extraCheck`; `stack_recommended` and `stack_overridden` journal events; `switchStack`         |
| `apps/web/src/server/server.ts`, `apps/web/src/api-types.ts`                          | `POST /api/runs/:id/stack`; recommendation and divergence in the review payload                            |
| `apps/web/src/ui/views/Review.tsx`                                                    | `StackCard`: pick, reasons, alternatives, picker                                                           |
| `apps/cli/src/{summary,prompter}.ts`                                                  | recommendation line; "switch stack" at review; `--yes` keeps the pick                                      |
| `packages/analyzer/src/{detectors,divergence}.ts`                                     | `StackGuess` gains observed framework and package manager; `stackDivergence`                               |
| `packages/core/fixtures/discovery/*`                                                  | re-keyed for prompt 1.1.0; recommendation added to the new-project turns                                   |
| `tests/scenarios/discovery/`, `tests/adapters/`                                       | override scenario; invalid-recommendation scenario; no recommendation on enhance and adopt                 |
| `docs/adr/026-stack-pack-catalog-and-recommendation.md`, `docs/TDD.md`                | section 7 discovery text; the review screen                                                                |

## Acceptance commands

```sh
export PATH="/c/tools/node22:$PATH"
pnpm exec vitest run --project unit packages/core packages/analyzer packages/spec apps/web apps/cli
ls packages/core/fixtures/discovery | wc -l
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
```

```text
a new-project turn without a valid stackRecommendation is sent back to the model
a recommendation for "other", a pack outside the catalog, or a platform the pack does not support is refused
the review shows the pick, its reasons and the alternatives; switching sets the stack to the chosen pack's catalog defaults and journals stack_overridden
enhance and adopt journal no stack_recommended event and show divergence notes when the repository differs from its pack
the discovery fixture directory count equals the count before the plan
pnpm check exits 0
```

## Drift and hallucination guardrails

| Trap                                                   | Why                                              | Mechanical check                                                                         |
| ------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| The recommender runs on an update                      | the repository's stack is a fact, not a choice   | scenario asserts no `stack_recommended` event for enhance and adopt                      |
| The model recommends `other`                           | `other` is for updates only (ADR-024)            | `stackIssues` unit test; the Allowed values section still hides `other`                  |
| The model recommends a pack and drafts another         | the review would show reasons for the wrong pack | `stackIssues` compares `draftSpec.stack.pack` with the recommendation; unit test         |
| An override leaves stale framework or database values  | the old pack's defaults would remain             | override test asserts all five stack fields equal the new pack's catalog defaults        |
| An override is not journaled                           | the choice would be invisible at resume          | override scenario asserts the `stack_overridden` event and the `user` decision source    |
| A fixture is deleted or its turns are weakened to pass | recorded fixtures are the regression net         | the fixture directory count is unchanged; `git diff` shows only the added field and keys |
| Catalog text in the prompt is hand-copied              | it would drift from the manifests (plan 013)     | `prompt-builder` test builds the section from `STACK_CATALOG` and compares               |
| The owner's pin is skipped                             | `pnpm contracts:pin` is human-only               | stop after the schema edit; `contracts-pin` is green only after the owner runs it        |
| Divergence converts the repository to the pack         | updates must respect the existing stack          | enhance scenario asserts the spec stack equals the detected stack, notes only            |

## Review rounds

| Round | Finding                                                                                                               | Status    |
| ----- | --------------------------------------------------------------------------------------------------------------------- | --------- |
| 1     | Discovery picks the stack with no reasons or alternatives and the only override is raw JSON; found in the 013 scoping | FIX-FIRST |
