# Plan 015: the scan understands Dart and Flutter apps

## Executor preamble

Stage 3 of "standard stack packs" (ADR-026, ADR-027). It needs no other plan and changes no contract.

Until now the scan read only TypeScript, JavaScript, Python and PHP. For a Dart/Flutter app it knew the
ecosystem label and the file layout, and nothing else, so an update run could not say what the app does
or who it is for: the review summary for the owner's first real update (a Flutter and Supabase web app)
said it "couldn't identify the app's existing screens", and the coding assistant's file targets were
empty.

Now the scan reads, with line-based regexes only (the analyzer has no third-party dependency, and no
repository code is executed):

- the `go_router` routes in app code, each traced to the screen widget's file, and the feature area from
  `lib/features/<area>/`;
- the screens, including those no route points at;
- the user roles the app declares, from SQL `create type ... role ... as enum` and Dart `enum ...Role`;
- the `pubspec.yaml` dependencies of every package in the repository;
- Riverpod providers, `args` commands, SQL tables without their schema prefix;
- Dart entry points, test runners (`flutter_test`, `dart_test`) and test cases (`test`, `testWidgets`);
- `analysis_options.yaml` lint rules, `dart format`, and strict analysis;
- one module per feature (`lib/features/<x>`), and relative and `package:` import edges between modules.

Directories of other checkouts that agent tools keep inside a project (`.claude/worktrees`) are skipped.
Tests build mock routers of their own, so route extraction reads app code only.

Screens and roles are new optional `RepoScan` fields, written only when found, and the report sections
and digest keys appear only then, so a scan of any other repository is byte-identical to before (the
`node-service-rich` golden is unchanged). Repository text still only selects among built-in constants and
every string goes through `clean()` (threat T6).

No stack pack is added (ADR-027). `stack.pack` for a Flutter repository stays `other`.

## Touched files and markers

| File or directory                                               | Marker / note                                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/analyzer/src/scan.ts`                                 | `dart` in `LANGUAGES` and `SOURCE_LANGS`; `moduleOf` Dart rule; `dartPackages`, `dartTargets`         |
| `packages/analyzer/src/scan.ts`                                 | `pubDependencies`; `'pub'` manager; go_router, args, Riverpod, role-enum extractors; `ScreenInfo`     |
| `packages/analyzer/src/scan.ts`                                 | `RoleInfo`; `screens` and `roles` caps and notes; Dart entry points; Dart conventions                 |
| `packages/analyzer/src/detectors.ts`                            | `TEST_FILE` and `detectTests`: `_test.dart`, `testWidgets`, `flutter_test` and `dart_test` runners    |
| `packages/analyzer/src/scan-report.ts`                          | "Screens" and "Roles" report sections; `screens`, `roles`, `pubPackages` digest keys, only when found |
| `packages/analyzer/src/repo-view.ts`                            | `SKIP_PATHS`: `.claude/worktrees`                                                                     |
| `packages/analyzer/fixtures/flutter-supabase/`                  | a Flutter and Supabase app with a CLI package, mock-router test and a non-literal route               |
| `packages/analyzer/fixtures/golden/flutter-supabase.*`          | golden scan and report                                                                                |
| `packages/analyzer/src/scan.test.ts`                            | `Dart and Flutter (plan 015)`: every extractor, hostile text, byte-identity for other repositories    |
| `packages/core/src/enhance.test.ts`                             | `resolveTargets` points a Flutter request at the feature module, its screens and its providers        |
| `docs/TDD.md` (section 7.4), `docs/adr/024-spec-value-other.md` | the scan covers Dart/Flutter; the skipped worktrees                                                   |

## Acceptance commands

```sh
export PATH="/c/tools/node22:$PATH"
pnpm exec vitest run packages/analyzer packages/core/src/enhance.test.ts
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
```

```text
a scan of the flutter-supabase fixture lists its go_router routes, each with its screen's file, the screens, the UserRole enums, the pubspec dependencies, providers, tables and commands
mock routers in test files and checkouts under .claude/worktrees are not read
a repository with no Dart has no screens, roles or pubPackages in its scan, report or digest; node-service-rich golden unchanged
resolveTargets for a Flutter request returns the feature module, its screens and its providers
pnpm check exits 0
```

A scan of the owner's real Flutter app (read-only) lists 15 routes, 25 screens, the four roles (`admin`,
`coach`, `spectator`, `athlete`), 48 CLI commands, 85 providers and 45 SQL tables.

## Drift and hallucination guardrails

| Trap                                                       | Why                                                        | Mechanical check                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A Dart parser or YAML library is added                     | the analyzer has no third-party dependency                 | `deps-boundary` guard; line-based `pubDependencies` and unit tests                    |
| Repository text becomes a label, a command or a spec field | threat T6: repository text is data                         | hostile pubspec, route and role test; every string through `clean()`                  |
| Other repositories' scans change                           | goldens and the scan hash would drift for every repository | `node-service-rich` golden is byte-identical; fields are omitted when empty           |
| Mock routers in tests are listed as routes                 | the app would seem to have routes it does not              | the fixture's `test/router_test.dart` declares `/mock`; the test asserts it is absent |
| A route form the scan cannot read is guessed               | a wrong route is worse than a missing one                  | the fixture has a constant-path route; a scan note says how many were not listed      |
| Other checkouts inside the project are scanned             | duplicate routes, tables and roles inflate every list      | `.claude/worktrees` skip test with the skip accounting                                |
| The pubspec name or description feeds the draft spec       | it would change every Flutter spec and its tests           | not done; the draft still takes its name from the repository                          |
| The digest grows for every repository                      | prompts and fixture keys would change                      | digest keys are conditional; `plain` digest test                                      |

## Review rounds

| Round | Finding                                                                                                                                                          | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | A real update run said it could not identify the app's screens or roles; the Dart scan was empty                                                                 | CLOSED |
| 2     | A scan of the real app walked four stale `.claude/worktrees` copies and read mock routers in tests, inflating routes and tables; both are now skipped and tested | CLOSED |
| 3     | `moduleOf` collapsed every feature into `lib/features`; each feature is now its own module                                                                       | CLOSED |
