# Plan 018: moving around the app, and settings with the model each job used

## Executor preamble

Delivers the navigation and settings parts of ADR-029. It changes no contract, spec schema or pack.

The owner's first real update run showed that the app had no back or forward, no way to reach another area, no
list of runs, and no way to see or choose the model that does the work.

1. **Navigation.** The header has Back and Forward buttons (disabled when there is nowhere to go, from the
   Navigation API), the brand link, and tabs Home, Projects, Runs and Settings. `/projects` lists the portfolio;
   `/runs` lists every run with a filter (all, in progress, waiting for you, finished, cancelled) and the project
   each belongs to. The run and project pages carry a breadcrumb. In the desktop window the mouse's back and
   forward buttons, Alt+Left and Alt+Right (Cmd+[ and Cmd+] on macOS) move through the history, and a small menu
   replaces the default one. There is still no preload and no IPC (ADR-012).
2. **Which model did each job.** The coding agent's `system`/`init` event is read for its model; the CLI
   adapter reads the models Claude reports in `modelUsage`. `Engine.models(runId)` lists the tool and model per
   job from the journal, and the run page shows "Models used".
3. **Choosing models.** `agents.primary` and `agents.model` join `llm.preferred` and `llm.cliModel` in
   `config.json`. A coding model is passed with the CLI's model flag, or the run parks `model_unsupported`.
4. **Settings.** `ConfigStore` (read on every use, atomic 0600 writes), `applySettings` (one validator),
   `Settings` (what is chosen, what the next run uses, the tools found, where accounts come from). `GET` and
   `PUT /api/settings`; the Settings page; `incubator config [get|set]`; `incubator doctor` prints what is in
   use. Secrets are never shown or written.

## Touched files and markers

| File or directory                                                                            | Marker / note                                                              |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/web/src/ui/App.tsx`, `nav.ts`, `nav.test.ts`, `styles.css`                             | `historyState`, `areaOf`, the header tabs and buttons                      |
| `apps/web/src/ui/views/Runs.tsx`, `Projects.tsx`, `Settings.tsx`, `ModelsUsed.tsx`           | `Runs`, `ProjectsPage`, `Crumbs`, `Settings`, `ModelsUsed`                 |
| `apps/desktop/src/main.ts`, `window.ts`, `window.test.ts`                                    | `historyActionForKey`, `historyActionForCommand`, the application menu     |
| `packages/core/src/config.ts`, `settings.ts`, `settings.test.ts`                             | `ConfigStore`, `MODEL_ID`, `applySettings`, `Settings`                     |
| `packages/core/src/handoff.ts`, `engine.ts`                                                  | `buildHandoffArgv(… model)`, `CeilingMonitor.model`, `Engine.models`       |
| `packages/llm/src/cli-adapter.ts`, `registry.ts`                                             | `modelUsage`, a model and configuration read on every call                 |
| `apps/web/src/server/server.ts`, `api-types.ts`, `apps/web/src/testing-fixtures/fake-web.ts` | `/api/settings`, `RunDetail.models`, `RunListItem.project`, `fakeSettings` |
| `apps/cli/src/commands/config.ts`, `doctor.ts`, `main.ts`                                    | `incubator config`, the doctor lines                                       |
| `docs/adr/029-stop-cancel-and-settings.md`, `docs/TDD.md`                                    | the decision, the routes and views                                         |

## Acceptance commands

```sh
export PATH="/c/tools/node22:$PATH"
pnpm exec vitest run packages/core/src/settings.test.ts packages/core/src/handoff.test.ts apps/web apps/cli apps/desktop/src
INCUBATOR_E2E_CHANNEL=chrome pnpm test:e2e
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
```

```text
Back and Forward are disabled when there is nowhere to go; a run page is reachable from the Runs tab and its project
a model id that is not a plain token is refused by the page, the server, the command line and the argv builder
a coding model is passed only when the CLI has a model flag; otherwise the run parks model_unsupported
a settings change is read by the next run without a restart; unknown keys in config.json survive a save
no secret value appears in /api/settings
the run page lists the tool and model of the questions, the analysis and the coding
pnpm check exits 0
```

## Drift and hallucination guardrails

| Trap                                                  | Why                                                 | Mechanical check                                                                       |
| ----------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A model id reaches a shell                            | threat T6                                           | `MODEL_ID` in `applySettings` and in `buildHandoffArgv`; tests with `;`, `--`, spaces  |
| A secret is shown or accepted by Settings             | secrets come from the keychain, a prompt or the env | the server test searches the body for the token; the page offers no secret field       |
| The settings file loses keys the app does not know    | the owner may hand-edit it                          | `ConfigStore` test: unknown keys survive a save                                        |
| A bad hand-edit stops a run in progress               | settings are read on every use                      | `ConfigStore.get` keeps the last good copy when the file is damaged                    |
| The new header breaks the e2e links                   | tests find the link named "The Incubator"           | the brand link is unchanged; the e2e suite covers tabs, back and forward               |
| The desktop window gains a preload or IPC for history | ADR-012                                             | history is handled in the main process from window events only; `secureWebPreferences` |
| The model shown is a guess                            | an unreported model must not look like a known one  | `ModelsUsed` shows "default model" when the tool did not say                           |

## Review rounds

| Round | Finding                                                                                                                                                        | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The coding agent was never given a model and the interface never showed one; both are built, and a CLI with no model flag parks instead of ignoring the choice | CLOSED |
| 2     | `config.json` was read once at start, so a saved change needed a restart; the engine now reads it per use                                                      | CLOSED |
