# Plan 016: retrieved stacks: a catalog, a recommendation, and creation by the official generator

## Executor preamble

Stage 4 of "standard stacks" (ADR-027). It needs plan 015 merged first.

Today a new project can be created only on one of four packs. The owner's next target is a Flutter and
Supabase app. Rather than a full pack (ADR-027), the Incubator now knows a few facts about each larger
stack, recommends one when it fits a new idea, and creates the project with the stack's own generator.

1. **Catalog.** `packages/spec/src/stacks.ts`: `STACK_CATALOG`, one entry per stack: `id`, `label`,
   `kind` (`built-in` or `retrieved`), `fits[]`, `avoidWhen[]`, `platforms[]`, `prerequisites[]` (tool,
   probe argv, install link), `detect` (analyzer ecosystem id and marker), `checks[]`, and for a retrieved
   stack `create` (tool and an argument builder over validated names). The four packs are built-in
   entries; Flutter is the first retrieved entry. A unit test keeps every built-in id a real pack.
2. **Recommendation.** At the start of a new run an advisory turn sees only the catalog and returns
   `StackRecommendation {stack, reasons[1..3], alternatives[0..2]{stack, tradeoff}}`. A gate rejects an id
   outside the catalog. The wizard shows a "Recommended stack" card; the owner confirms or picks another;
   the choice is journaled (`stack.recommended`, `stack.chosen`). A failed turn is a warning. Update runs
   recommend nothing.
3. **Creation.** For a retrieved stack in a chosen empty folder: probe the prerequisite (the run parks with
   the install link when it is missing); run the generator (for Flutter,
   `flutter create --org <org> --project-name <snake> --platforms web,android,ios .`), whose arguments are
   constants or names validated like `validateChecks`; `git init`; commit `chore: <tool> create`.
4. **Then an update run.** The owner's idea becomes the change request and the existing update workflow
   runs on the folder: the scan (plan 015), questions, review with the brief, owner-approved checks
   (`flutter analyze`, `flutter test`), the coding assistant, commit and push.
5. **Windows launcher.** `packages/runtime/src/exec.ts` cannot start a non-npm `.bat` today
   (`cmd_shim_unparseable`). A narrow path runs an allowlisted launcher through `cmd.exe /d /s /c` with
   arguments the catalog built; nothing else may use it.

No schema change and no `contracts:pin`. The spec stays `stack.pack: "other"` (ADR-024). Greenfield prompts
are unchanged, so recorded discovery fixtures keep their keys. Supabase is named by a recommendation, not
created.

## Touched files and markers

| File or directory                                            | Marker / note                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `packages/spec/src/stacks.ts`, `packages/spec/src/index.ts`  | `STACK_CATALOG`, `StackEntry`, `stackById`; built-in ids checked against the packs                |
| `packages/core/prompts/stack-recommendation.md`              | the advisory prompt, versioned and byte-pinned                                                    |
| `packages/core/src/stack-recommendation.ts`                  | `StackRecommendation`, its schema, `recommendationIssues`, the user prompt built from the catalog |
| `packages/core/src/stack-create.ts`                          | prerequisite probe, generator command builder, base commit                                        |
| `packages/core/src/engine.ts`                                | recommendation turn; `stack.recommended` and `stack.chosen` events; create then update            |
| `packages/runtime/src/exec.ts`                               | allowlisted `.bat` launcher path                                                                  |
| `apps/web/src/server/server.ts`, `apps/web/src/api-types.ts` | `GET /api/runs/:id/stack`, `POST /api/runs/:id/stack`                                             |
| `apps/web/src/ui/views/Wizard.tsx`, `StackCard.tsx`          | the recommended-stack card; prerequisite-missing message with the install link                    |
| `apps/cli/src/commands/new.ts`                               | the recommendation line; `--stack <id>`                                                           |
| `packages/core/fixtures/stack-generators/`                   | a fake `flutter` generator, like `fake-agent.mjs`                                                 |
| `docs/adr/027-retrieved-stacks.md`, `docs/TDD.md`            | the decision and its index row                                                                    |

## Acceptance commands

```sh
export PATH="/c/tools/node22:$PATH"
pnpm exec vitest run packages/spec packages/runtime packages/core apps/web apps/cli
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
ls packages/core/fixtures/discovery | wc -l
```

```text
the catalog's built-in ids are exactly the packs; a retrieved id is never a pack
a recommendation for an id outside the catalog, or "other", is refused and the turn is sent back
a new run in a chosen folder with the fake flutter generator reaches REVIEW with Dart/Flutter detected and the flutter checks proposed
a missing prerequisite parks the run with the install link and writes nothing
generator arguments built from a hostile project name stay plain tokens
the discovery fixture directory count and keys are unchanged
pnpm check exits 0
```

## Drift and hallucination guardrails

| Trap                                                  | Why                                                    | Mechanical check                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| A Flutter pack is built after all                     | ADR-027: the cost is the reason for this plan          | no `packs/stack/flutter`; no new enum in `incubator.schema.json`; `contracts-pin` unchanged        |
| The model invents a stack or recommends `other`       | `other` is for updates; the catalog is the only source | `recommendationIssues` unit test; the prompt lists only catalog ids                                |
| Generator arguments contain free text                 | threat T6: names reach a shell on Windows              | `buildCreateArgs` token test with hostile names; `cmd.exe` path accepts allowlisted launchers only |
| The Incubator installs a toolchain                    | installing software is the owner's call                | the missing-prerequisite test asserts nothing was written or run                                   |
| The run commits to the owner's folder before approval | every commit is the owner's decision (ADR-023)         | the base commit is the generator's output only; the plan and code follow the usual commit request  |
| A recommendation is shown on an update run            | an update keeps the repository's own stack             | scenario asserts no `stack.recommended` event for enhance and adopt                                |
| Greenfield prompts change                             | recorded fixture keys would change                     | `prompt-builder` greenfield output test; fixture keys unchanged                                    |
| A real `flutter` is required by tests                 | CI has no Flutter SDK                                  | tests use the fake generator fixture                                                               |

## Review rounds

| Round | Finding                                                                                                                                            | Status    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1     | A full Flutter pack touches every golden, re-keys every discovery fixture and needs a Dart test harness; replaced by retrieval (owner, 2026-10-04) | CLOSED    |
| 2     | Windows cannot start `flutter.bat` through the current runner; needs the narrow allowlisted path before creation can run on the owner's machine    | FIX-FIRST |
| 3     | The recommendation turn and the wizard card are not built; creation is not wired to the update workflow                                            | FIX-FIRST |
