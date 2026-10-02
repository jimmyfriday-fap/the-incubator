# Plan 012: owner-approved check commands for the coding agent

## Executor preamble

Stage 2 of "update any repository" (plan 011, ADR-025). On a repository the Incubator did not build, the
coding agent's prompt and tool list named Incubator scripts that do not exist there, so it could edit
and never test. Now the scan proposes the repository's own check commands from built-in constants, the
owner approves them at review (or with `--check` on the CLI), and the agent's allowed tools are exactly
the edit tools, the approved commands, and read-only git. Nothing approved means nothing runs, with a
visible warning. An Incubator-built repository keeps its gate unchanged.

The approval is a journal entry (`enhance.checks`), not spec: no pinned contract changes.

## Touched files and markers

| File or directory                                                           | Marker / note                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/analyzer/src/checks.ts`                                           | `proposeChecks`: built-in commands chosen by manifest presence                        |
| `packages/core/src/checks.ts`                                               | `validateChecks`, `externalTools`, `isCanonicalRepo`, `normalizeChecks`               |
| `packages/core/src/handoff.ts`, `packages/core/prompts/handoff-external.md` | tool list parameter; the external prompt with "Approved check commands"               |
| `packages/core/src/{engine,enhance,finish}.ts`                              | `submitChecks`, `checksDetail`, `handoffChecks`; `checks_unenforceable`; lane wording |
| `apps/web/src/server/server.ts`, `apps/web/src/api-types.ts`                | `POST /api/runs/:id/checks`; `enhance.checks`; `finish.agent.checks`                  |
| `apps/web/src/ui/views/{Review,RunView,FinishChanges}.tsx`                  | the "Commands the coding agent may run" section; the result label                     |
| `apps/cli/src/commands/{checks,enhance,resume}.ts`, `apps/cli/src/main.ts`  | `--check <command>` (repeatable), `--no-checks`, the hint                             |
| `tests/adapters/local-folder.ts`, `tests/scenarios/local-folder/`           | approved, none without approval, unsafe refused                                       |
| `docs/adr/025-owner-approved-check-commands.md`, `docs/TDD.md`              | the decision; §7.5, §8, the T6 row                                                    |

## Acceptance commands

```sh
pnpm exec vitest run packages/core/src/checks.test.ts packages/core/src/folder-runs.test.ts packages/core/src/handoff.test.ts
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
```

```text
the agent's --allowedTools list equals the edit tools, Bash(<approved>:*) for each approved command, and git status/diff
with no approval (including --yes) there is no Bash entry other than git status and git diff, and a warning is journaled
an Incubator-built repository gets the unchanged Incubator tool list and prompt
unsafe commands (separators, pipes, shells, git, bare runners, "..", absolute paths) are refused
a CLI without an allowed-tools flag parks checks_unenforceable and launches nothing
pnpm check exits 0
```

## Drift and hallucination guardrails

| Trap                                                          | Why                                             | Mechanical check                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Repository text becomes a command                             | prompt injection from repository content (T6)   | `proposeChecks` tests with hostile manifests: the output matches constants only             |
| `--yes` or the defaults approve commands                      | consent must be the owner's                     | folder-runs test: `yes: true` gives mode `none` and no extra `Bash` entry                   |
| An approved line widens the tool list                         | the list is comma-joined and uses `Bash(...:*)` | `validateChecks` refuses `,` `:` `(` `)`; test asserts every entry matches a strict pattern |
| A command chains another                                      | `;`, `&&`, pipes, substitution                  | `checks.test.ts` table of refused commands; scenario `validation-checks-unsafe-refused`     |
| The agent runs unrestricted when the CLI cannot be held to it | not every agent CLI has an allowed-tools flag   | park `checks_unenforceable`; test asserts no `handoff.launch` entry                         |
| Incubator-built repositories lose their gate                  | one code path serves both                       | folder-runs test: a new solution's tool list is exactly `HANDOFF_ALLOWED_TOOLS`             |
| The lane rewording rots when a template changes               | the phrases are matched as text                 | test asserts both source phrases still exist in the rendered base templates                 |
| Commands approved after the agent started                     | the list would not match what ran               | `submitChecks` refuses once `code.start` is journaled; tested                               |

## Review rounds

| Round | Finding                                                                                                  | Status |
| ----- | -------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The coding step assumed an Incubator-built repository; found while planning the "other" stack (plan 011) | CLOSED |
