# Context files created at install

Create each with `templates/context-file.md`, filling in `name`, `tier`, and `description` from this table.

## Platform (one set per store)

| File | name | tier | description |
| --- | --- | --- | --- |
| context/platform/architecture.md | architecture | platform | Components and how they connect; in a multi-repo system, one line per repo and every cross-repo edge. Read before structural changes. |
| context/platform/conventions.md | conventions | platform | Rules that hold everywhere: naming, data access, error handling, UI and styling constraints. Read before writing code. |
| context/platform/decisions.md | decisions | platform | Decisions that affect more than one repo, with reasons, newest first. Read before proposing an alternative approach. |
| context/platform/failures.md | platform-failures | platform | Mistakes that recur across repos, and their fixes. Read before debugging. |

## Project (one set per member repo; `<repo>` = the repo's name)

| File | name | tier | description |
| --- | --- | --- | --- |
| context/projects/<repo>/overview.md | <repo>-overview | project | What <repo> is, its entry points, and exact build/run/test commands. Read first when working in <repo>. |
| context/projects/<repo>/decisions.md | <repo>-decisions | project | Decisions local to <repo>, newest first. Read before changing how <repo> does something. |
| context/projects/<repo>/failures.md | <repo>-failures | project | Recurring mistakes in <repo> and their fixes. Read before debugging <repo>; append when you fix something likely to recur. |
| context/projects/<repo>/status.md | <repo>-status | project | Current state of in-flight work in <repo>. Read at session start for orientation. |

`context/platform/failures.md` and `status.md` files may be empty after bootstrap. Every other context file should have at least one line.
