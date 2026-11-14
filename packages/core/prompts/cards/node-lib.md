Build card: a Node library (Incubator canonical pattern). Use it instead of searching the repository.

- One feature = one module: `src/features/<id>.ts`, scenarios in `tests/scenarios/<id>/`, the adapter in `tests/adapters/<id>.ts`.
- A feature that is not in the scaffold yet: `node scripts/scaffold.mjs feature <id> --summary "..."` writes all three with `TODO(scaffold)` markers. Replace every marker in the files you touch.
- Turn the four scenarios of a feature from `"status": "todo"` into real assertions.
- Check after each step: `node scripts/check.mjs quick`. The full gate is `node scripts/check.mjs full`.
- Read: the step's own module and its scenarios. Do not read: other features, `scripts/`, `.incubator/lanes/`, `docs/`.
