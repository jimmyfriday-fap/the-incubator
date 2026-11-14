Build card: a Node web service (Incubator canonical pattern). Use it instead of searching the repository.

- One feature = one folder: `src/features/<id>/index.ts`, scenarios in `tests/scenarios/<id>/`, the adapter in `tests/adapters/<id>.ts`.
- A feature that is not in the scaffold yet: `node scripts/scaffold.mjs feature <id> --summary "..."` writes all three with `TODO(scaffold)` markers. Replace every marker in the files you touch.
- Turn the four scenarios of a feature from `"status": "todo"` into real assertions.
- Check after each step: `node scripts/check.mjs quick`. The full gate is `node scripts/check.mjs full`.
- Read: the step's own feature folder and its scenarios. Do not read: other features, `scripts/`, `.incubator/lanes/`, `docs/`.
