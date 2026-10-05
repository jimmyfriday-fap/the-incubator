# ADR-027: Larger stacks are retrieved from their own generator, not built in as packs

- **Status:** Proposed
- **Date:** 2026-10-04
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7, §9; amends [ADR-026](026-stack-pack-catalog-and-recommendation.md)

## Context

ADR-026 planned every new stack (Flutter, Next.js, Go) as a full stack pack: a manifest with a catalog
block, templates, a test harness, combo fixtures with goldens, schema enum values and an owner re-pin.
Scoping the Flutter pack showed what that costs. It needs a Dart port of the scenario harness, edits to the
shared base and deploy templates that change every existing golden, new spec enums that re-key every
recorded discovery fixture, a gate toolkit written for Node, Python and PHP, a deploy target nothing
fits, and a way to start `flutter.bat` on Windows. The Incubator would grow into a large maintenance
surface for each language it supports.

The owner's direction: keep the Incubator narrow and agile. Small stacks are built in; larger ones are
retrieved from the stack's own official tooling; the Incubator keeps just enough knowledge of a stack to
recognise it, recommend it when it fits, and create it.

## Decision

1. **Two kinds of stack.** A _built-in_ stack is a pack that renders the whole project (the four existing
   packs). A _retrieved_ stack is created by the stack's own official generator (`flutter create`); the
   Incubator adds only its light layer: lane templates, the plan, the project marker and the owner-approved
   check commands.
2. **A small catalog in code.** `packages/spec/src/stacks.ts` lists the stacks the Incubator knows. Each
   entry has an id, a label, its kind, what it fits and avoids, its platforms, its prerequisites (a tool
   and a probe command), the analyzer ecosystem and marker that detect it, its check commands, and for a
   retrieved stack the generator command. It is a code constant, not a pinned contract, so adding a
   retrieved stack changes no schema and needs no `contracts:pin`.
3. **Recommendation for a new tool.** An advisory model turn at the start of a new run sees only the
   catalog and returns a stack id, one to three reasons and up to two alternatives. A gate rejects any id
   outside the catalog. The owner confirms or picks another; the choice is journaled. A failed turn is a
   warning and the owner picks from the list. An update run recommends nothing: its stack is what the scan
   detects.
4. **Creation by the official generator.** For a retrieved stack in a chosen folder: probe the
   prerequisite; if it is missing the run parks with the install link and nothing is installed for the
   owner. Otherwise run the catalog's generator command, whose arguments are constants or validated names
   and never free text, in the empty folder, `git init`, and commit the result as the base commit.
5. **Then it is an update run.** The owner's idea becomes the change request and the existing update
   workflow applies unchanged: scan, questions, plan review, owner-approved checks, the coding assistant,
   commit and push. The spec keeps `stack.pack: "other"` with the detected ecosystem label (ADR-024).
6. **The stack's own tools are the checks** (ADR-025): for Flutter, `flutter analyze` and `flutter test`,
   approved by the owner. No Node gate is installed inside a retrieved-stack project.
7. **Running a Windows launcher.** `flutter` and `dart` are `.bat` files on Windows. Only a command the
   catalog built and validated may be run through `cmd.exe /d /s /c`; no repository or user text ever
   reaches that shell.
8. **When a stack becomes a pack.** A retrieved stack is promoted to a built-in pack only if it needs the
   Incubator's canonical files, tests harness or deploy rendering. That is a separate decision with its own
   ADR.

## Alternatives considered

- **A full Flutter pack (ADR-026 as written).** Uniform with the other four, but the largest change in the
  project and a recurring cost per language. Rejected for now.
- **A pinned starter repository per stack.** Gives wiring such as Supabase out of the box, but the
  Incubator would have to vet and maintain the list. The official generator stays current by itself.
- **Download the toolchain for the owner.** Convenient, but installing software on the owner's machine is
  not the Incubator's call; it parks with the install link.
- **Keep a hand-written list of stacks in several places.** The duplication ADR-026 set out to remove.

## Consequences

- Plan 015 (Dart/Flutter scanning) is needed first and changes no contract. Plan 016 delivers the catalog,
  the recommendation and creation, with no schema change and no re-key of recorded fixtures.
- ADR-026's manifest catalog (plan 013) remains the way built-in packs describe themselves; the code
  catalog may later read it. Plan 014's recommender is delivered in this slimmer form over the code
  catalog. ADR-026 stays Proposed, amended by this record.
- The portfolio decision, which was numbered ADR-027 in earlier planning, is ADR-028.
- A new stack is added by a catalog entry, a recorded recommendation fixture and a fake generator for tests,
  not by templates.
- Supabase and other services are named in a recommendation but not created; the owner's first change
  request can add them.
