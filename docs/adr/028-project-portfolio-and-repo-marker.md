# ADR-028: A project portfolio, and a marker in the repository that ties a folder to it

- **Status:** Proposed
- **Date:** 2026-10-05
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7.6, §9; relates to [ADR-010](010-run-journal-and-resume.md),
  [ADR-023](023-local-folder-workflow.md)

## Context

Every run is a folder under `~/.incubator/runs/`. That is the right unit for resuming one piece of work, and
the wrong one for the owner's question "what has the Incubator done for this project?". Runs on the same
repository were unrelated lists of ids; a run's name was a timestamp; `incubator gc` removes finished runs, so
the history of a project disappeared with them. The owner asked for one entry per project, with its summary,
repository and the runs that worked on it, shown at the top of a run and as a dashboard of cards on the home
page. A project that comes back later must be recognised as the same one, and a repository that existed
before but was never used with the Incubator must still get its own entry.

## Decision

1. **A portfolio file, outside the runs.** `~/.incubator/portfolio.json`, beside `config.json`: `{ version:
1, projects: [...] }`, written atomically (temporary file, then rename) with mode 0600. It is not under
   `runs/`, so `incubator gc` never removes it. A damaged file is renamed `portfolio.json.damaged-<time>` and
   the portfolio starts again; it never stops a run. ADR-010's rejection of a database stands: this is a small
   JSON document the owner can read.
2. **One entry per project.** `PortfolioProject`: `id` (a UUID), `name`, `summary`, `origin`
   (`created`, `adopted` or `existing`: how the Incubator first met it), `repo` (`dir`, `remote`, `ref`, `url`),
   a `stack` label, timestamps and `runs`, newest first. Each `PortfolioRun` carries the run id, kind, the
   owner's request, state, whether it is done, and the outcome (commit, branch, pull request, or the folder
   the work was left in).
3. **A marker in the repository.** `.incubator/project.json`: `{ "incubatorProject": "<id>", "name": "<name>" }`.
   An update run adds it to the files it delivers, so it arrives in the commit the owner already approves. It
   is a delivered file, not a template output, so no pack and no golden changes.
4. **Matching order, never by name.** A run's folder is matched to a project by (1) the id in its marker,
   (2) the normalised git remote (`git@github.com:o/r.git`, `https://github.com/o/r` and
   `ssh://git@github.com/o/r.git` are one remote), (3) the resolved folder path. Two projects with the same
   name are different projects. A folder that matches nothing becomes a new project, with `origin: existing`
   when the Incubator did not make it.
5. **Kept in step from the journal, best effort.** The portfolio listens to the run's own journal entries
   (state changes, parking, failure, completion, the request, the commit, the pull request, the final spec and
   the analysis summary) and updates the project and its run. A failure to write the portfolio is a logged
   warning, never a reason for a run to fail.
6. **First use fills it from the runs already on disk.** When the file does not exist, the runs on disk are
   replayed through the same code, oldest first. Earlier work appears at once, and only once.
7. **Surfaces.** `GET /api/portfolio` and `GET /api/portfolio/:id`; `RunDetail.project` and the folder check's
   `project` (so the wizard can say "Recognised: <name>"); the dashboard home shows the opening wizard and a
   card per project; `/projects/:id` shows the project and its history; the run page shows only its own
   project at the top; `incubator portfolio [project] [--json]`.
8. **Off unless wired.** The engine takes the portfolio as an optional dependency. Without it nothing is
   recorded and no marker is delivered, which keeps every existing test and delivery byte-identical.

## Alternatives considered

- **Match on the repository name.** Names collide and change. Rejected.
- **Store the project in the repository only.** A repository the owner never let the Incubator write to would
  have no record, and the history would live in git. The file outside the runs plus a small marker covers both.
- **A database.** ADR-010: a document of this size does not justify one.
- **Keep the history in the run folders.** `incubator gc` deletes them, which was the problem.

## Consequences

- A project the Incubator created through a pack (a new solution) is recognised by its remote and folder until
  its first update run, which stamps the marker. Delivering the marker with a new solution or an adopt pull
  request is a follow-up, because those deliveries come from the pack render and the adopt delta.
- A run whose folder was removed by `gc` still appears in its project's history, without a link.
- The portfolio records what the owner asked and what the run did, as plain cleaned text (T6): request text is
  length-capped and passes the same `clean` as other repository text before it is stored or shown.
- Moving a repository to another folder is recognised by its marker or remote. A copy made with the marker
  intact is the same project by design.
