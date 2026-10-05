# Plan 016: retrieved stacks: a catalog, a recommendation, and creation by the official generator

## Executor preamble

Stage 4 of "standard stacks" (ADR-027). It needs plan 015 merged first.

Until now a new project could be created only on one of four packs. The owner's next target is a Flutter and
Supabase app. Rather than a full pack (ADR-027), the Incubator now knows a few facts about each larger stack,
recommends one when it fits a new idea, and creates the project with the stack's own generator.

1. **Catalog.** `packages/spec/src/stacks.ts`: `STACK_CATALOG`, one entry per stack: `id`, `label`, `kind`
   (`built-in` or `retrieved`), `fits[]`, `avoidWhen[]`, `platforms[]`, `detect` (analyzer ecosystem id and a
   marker), `checks[]`, and for a retrieved stack `prerequisites[]` (tool, probe argv, install link, home
   directories) and `create` (tool, an argument builder over validated names, and files it must leave behind).
   The four packs are built-in entries; Flutter is the first retrieved entry. `validStackNames` makes a snake_case
   project name that is not a Dart keyword and a reverse-domain organisation, or returns nothing.
2. **Recommendation.** At the start of a new project in the wizard, an advisory turn sees only the catalog and the
   owner's words (fenced as data) and returns `StackRecommendation {stack, reasons[1..3], alternatives[0..2]}`.
   The schema restricts ids to the catalog; a rule rejects an alternative that repeats the pick. The wizard shows
   the suggestion and the owner confirms or picks another. A failed turn is a warning with a message, and the
   owner picks from the list. Update runs recommend nothing.
3. **The tool.** `locateTool` looks on PATH, then at `toolPaths` in `~/.incubator/config.json`, then in the
   directories the catalog names under the owner's home (Flutter is often unpacked there and not on PATH).
   `probeStack` runs the probe. The Incubator never installs software.
4. **Creation.** `createStackProject` refuses a folder that holds files, a relative path and unusable names;
   returns `missing` (with the install link, writing nothing) when the tool is absent; runs the generator
   (for Flutter `flutter create --org <org> --project-name <snake> --platforms=web,android,ios .`) in the empty
   folder; checks the files it should leave; `git init`; commits `chore: flutter create`.
5. **Then an update run.** The wizard starts an update run on the folder with the owner's idea as the change
   request, so the scan (plan 015), questions, review with the brief, owner-approved checks (`flutter analyze`,
   `flutter test`), the coding assistant, commit and push all apply unchanged.
6. **The agent can run the checks.** When an approved tool was found by `toolPaths` or under home, `toolPathEnv`
   puts its directory in front of the coding agent's PATH (one `Path` key on Windows), so `flutter analyze` works
   there as it does for the owner.
7. **Windows launcher.** `packages/runtime/src/exec.ts` could not start a non-npm `.bat` (`cmd_shim_unparseable`).
   `allowBatch` runs a launcher through `cmd.exe /d /s /c` only when every argument matches a safe alphabet
   (`SAFE_BATCH_ARG`) and the launcher path has no shell characters; nothing else may use it.

No schema change and no `contracts:pin`. The spec stays `stack.pack: "other"` (ADR-024). Greenfield prompts are
unchanged, so recorded discovery fixtures keep their keys. Supabase is named by a recommendation, not created.
The command line has no `--stack` option; the web and desktop wizard is the only way in for now.

## Touched files and markers

| File or directory                                                           | Marker / note                                                                                         |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/spec/src/stacks.ts`, `packages/spec/src/index.ts`                 | `STACK_CATALOG`, `StackEntry`, `stackById`, `validStackNames`; built-in ids checked against the packs |
| `packages/runtime/src/exec.ts`                                              | `allowBatch`, `SAFE_BATCH_ARG`, `batchCommand`                                                        |
| `packages/core/src/stacks.ts`                                               | `locateTool`, `probeStack`, `createStackProject`, `toolPathEnv`                                       |
| `packages/core/src/stack-recommendation.ts`                                 | `StackRecommendation`, schema over catalog ids, `recommendationIssues`, fenced user prompt            |
| `packages/core/prompts/stack-recommendation.md`                             | the advisory prompt, versioned and byte-pinned                                                        |
| `packages/core/src/engine.ts`, `config.ts`, `live.ts`                       | `stackRecommend`, `stackProbe`, `stackCreate`; `tools` dependency; `toolPaths` in the config          |
| `packages/core/src/handoff.ts`                                              | `HandoffPlan.env`, passed to the agent                                                                |
| `apps/web/src/server/server.ts`, `apps/web/src/api-types.ts`                | `GET /api/stacks`, `POST /api/stacks/{recommend,probe,create}`                                        |
| `apps/web/src/ui/views/Wizard.tsx`, `StackChoice.tsx`                       | the stack picker, the suggestion card, the missing-tool notice, create then start                     |
| `packages/core/src/testing.ts`, `apps/web/src/testing-fixtures/fake-web.ts` | `fakeStackTools`, `fixtureDir`, `stacks` options                                                      |
| `packages/core/fixtures/stacks/`                                            | recommendation turns, and a mixed set for the create-then-plan flow                                   |
| `docs/adr/027-retrieved-stacks.md`, `docs/TDD.md`                           | the decision and its index row                                                                        |

## Acceptance commands

```sh
export PATH="/c/tools/node22:$PATH"
pnpm exec vitest run packages/spec packages/runtime packages/core apps/web
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
ls packages/core/fixtures/discovery | wc -l
```

```text
the catalog's built-in ids are exactly the packs; a retrieved id is never a pack
a recommendation for an id outside the catalog, or an alternative that repeats the pick, is sent back to the model
a new project in the wizard with the fake generator reaches REVIEW with Dart/Flutter detected and the flutter checks proposed
a missing tool writes nothing, runs no generator and shows the install link; a non-empty folder is refused
generator arguments built from a hostile project name are plain tokens; cmd.exe accepts only safe arguments
an approved tool found under home is first on the agent's PATH
the discovery fixture directory count and keys are unchanged
pnpm check exits 0
```

## Drift and hallucination guardrails

| Trap                                                  | Why                                            | Mechanical check                                                                                |
| ----------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A Flutter pack is built after all                     | ADR-027: the cost is the reason for this plan  | no `packs/stack/flutter`; no new enum in `incubator.schema.json`; `contracts-pin` unchanged     |
| The model invents a stack                             | the catalog is the only source                 | schema enum over catalog ids; `stack-recommendation.test.ts` rejects `react-native`             |
| The owner's words forge the prompt fence              | the idea reaches the model                     | `stackRecommendationUserPrompt` test: one closing fence marker only                             |
| Generator arguments contain free text                 | threat T6: names reach a shell on Windows      | `validStackNames` and `batchCommand` tests with hostile names; the real `.bat` test             |
| The Incubator installs a toolchain                    | installing software is the owner's call        | the missing-tool tests assert nothing was written or run                                        |
| The generator writes into a folder that has files     | the owner's files are never overwritten        | the non-empty folder test: the file is unchanged and no generator ran                           |
| The run commits to the owner's folder before approval | every commit is the owner's decision (ADR-023) | only the generator's own output is the base commit; the plan and code follow the usual requests |
| A real `flutter` is required by tests                 | CI has no Flutter SDK                          | tests use `fakeStackTools`; the `.bat` test runs a stand-in launcher                            |
| The agent cannot find the approved tool               | the owner's PATH may lack it                   | the agent-environment test asserts the directory is first and `Path` is not duplicated          |

## Review rounds

| Round | Finding                                                                                                                                                | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1     | A full Flutter pack touches every golden, re-keys every discovery fixture and needs a Dart test harness; replaced by retrieval (owner, 2026-10-04)     | CLOSED |
| 2     | Windows could not start `flutter.bat` through the runner; the allowlisted `.bat` path now runs one, tested with a real launcher whose path has a space | CLOSED |
| 3     | The recommendation turn, the wizard card and creation then update were not built; they are, and tested end to end in the browser                       | CLOSED |
| 4     | The owner's Flutter is not on PATH, so an approved `flutter analyze` would fail inside the coding agent; the agent now gets the tool's directory       | CLOSED |
| 5     | The owner's words in the recommendation prompt could forge the fence; they are cleaned and tested                                                      | CLOSED |
