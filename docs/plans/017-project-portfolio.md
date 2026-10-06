# Plan 017: the project portfolio, and the marker that ties a folder to it

## Executor preamble

Delivers ADR-028. It needs no other plan and changes no contract, spec schema or pack.

Every run was an unrelated folder under `~/.incubator/runs/`, and `incubator gc` removed the finished ones, so
the Incubator could not say what it had done for a project. The owner asked for one entry per project (name,
summary, repository, the runs that worked on it), recognised again when the project comes back, shown at the top
of a run, as cards on the dashboard home, and from the command line.

1. **Store.** `packages/core/src/portfolio.ts`: `Portfolio` over `~/.incubator/portfolio.json` (atomic write,
   mode 0600, a damaged file is set aside), `match` by marker id, then normalised remote, then folder path
   (never by name), `create`, `update`, `attachRun`, `forRun`; `markerText`, `readMarker`, `normalizeRemote`.
2. **Engine.** The `portfolio` dependency is optional. `advance` files a run under a matched or new project
   (`linkPortfolio`); the run's own journal entries keep the project and its run current (`syncPortfolio`);
   `portfolioBackfill` files the runs already on disk the first time; `portfolioFor(dir)` answers "is this
   folder a project we know"; `inspectFolder` returns it as `project`. An update run delivers the marker
   `.incubator/project.json` with its plan, in the commit the owner approves.
3. **API.** `GET /api/portfolio`, `GET /api/portfolio/:id`, `RunDetail.project`, the folder check's `project`.
   `startServer` runs the backfill before it listens.
4. **UI.** The dashboard home keeps the wizard and shows a card per project (the run list only while there are
   no projects); `/projects/:id` shows the project, its history and "Update again"; the run page shows its
   project and this run's request at the top; the wizard says "Recognised: <name>" for a known folder.
5. **CLI.** `incubator portfolio [project] [--json]`; a project is given by id, the start of its id, or its name.

No schema change and no `contracts:pin`. Greenfield and adopt deliveries do not carry the marker yet (see
ADR-028, Consequences); those projects are matched by remote and folder until their first update.

## Touched files and markers

| File or directory                                                                  | Marker / note                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/core/src/portfolio.ts`, `portfolio.test.ts`, `index.ts`                  | `Portfolio`, `MARKER_PATH`, `markerText`, `readMarker`, `normalizeRemote`            |
| `packages/core/src/engine.ts`, `folders.ts`, `live.ts`, `testing.ts`               | `linkPortfolio`, `syncPortfolio`, `portfolioBackfill`, `portfolioFor`, `markerFor`   |
| `apps/web/src/server/server.ts`, `server.test.ts`, `apps/web/src/api-types.ts`     | `/api/portfolio`, `/api/portfolio/:id`, `RunDetail.project`, `ProjectCard`           |
| `apps/web/src/ui/views/Projects.tsx`, `ProjectView.tsx`, `Home.tsx`, `RunView.tsx` | `ProjectGrid`, `ProjectBanner`, `ProjectView`; test ids `projects`, `project-banner` |
| `apps/web/src/ui/views/Wizard.tsx`, `App.tsx`, `styles.css`                        | `recognised`, the `/projects/:id` route                                              |
| `apps/web/src/testing-fixtures/fake-web.ts`, `apps/web/e2e/web.e2e.test.ts`        | the fake server runs with the portfolio on; the update flow checks it end to end     |
| `apps/cli/src/commands/portfolio.ts`, `apps/cli/src/main.ts`, `main.test.ts`       | `incubator portfolio`                                                                |
| `docs/adr/028-project-portfolio-and-repo-marker.md`, `docs/TDD.md`                 | the decision, §7.6 and its index row                                                 |

## Acceptance commands

```sh
export PATH="/c/tools/node22:$PATH"
pnpm exec vitest run packages/core/src/portfolio.test.ts apps/web apps/cli
INCUBATOR_E2E_CHANNEL=chrome pnpm test:e2e
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
```

```text
a run on a new folder makes one project; a second run on it joins the same project
a copy of the repository with the marker intact, in another folder, is the same project; a folder of the same name elsewhere is not
git@github.com:o/r.git, https://github.com/o/r and ssh://git@github.com/o/r.git are one remote
the update delivery carries .incubator/project.json naming the project; with the portfolio off nothing is added
the first start with the portfolio on files the runs already on disk, once
a damaged portfolio file is set aside and the next run still works
/api/portfolio lists the project; the run page and the wizard name it; incubator portfolio lists it
pnpm check exits 0
```

## Drift and hallucination guardrails

| Trap                                                | Why                                                 | Mechanical check                                                                      |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Projects are matched by name                        | names collide and change (ADR-028)                  | `portfolio.test.ts`: the same folder name in another place is not a match             |
| A portfolio failure stops a run                     | the portfolio is a record, not a gate               | the engine wraps every portfolio write; a test with the portfolio off and one damaged |
| The marker changes every delivery                   | existing goldens and tests must stay byte-identical | the marker is added only when the portfolio is wired; the portfolio-off test          |
| `incubator gc` removes the history                  | the history must outlive finished runs              | the file sits beside `config.json`, not under `runs/`                                 |
| Request or repository text reaches the page unclean | threat T6                                           | requests pass `sanitizeRequest` and a length cap before they are stored               |
| The marker names a path outside the repository      | an id is read from the repository                   | `readMarker` accepts only a 36-character id of hex and dashes                         |
| The UI shows every project on a run page            | owner: only the active project is shown there       | the run page renders `RunDetail.project`, one project                                 |

## Review rounds

| Round | Finding                                                                                                                                             | Status    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1     | `normalizeRemote` left `.git` on a remote that ended `.git/`; two spellings of one remote did not match. The slash is now removed before and after. | CLOSED    |
| 2     | The marker is delivered only by update runs. New solutions and adopt pull requests are matched by remote and folder until their first update        | FIX-FIRST |
