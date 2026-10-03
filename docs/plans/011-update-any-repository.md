# Plan 011: update any repository (spec value `other`)

## Executor preamble

"Update an existing solution" parked at ANALYZE with `no_stack` for every repository outside the four
stack packs (the owner's test was a Flutter/Dart app with Supabase). The owner's brief is that any
existing repository can be scanned and updated through the same discovery pattern. This plan is stage 1
of four; each stage ships green on its own.

1. **This plan.** The spec gains an honest `other` value, valid only for `mode: "enhancement"`. An update
   of such a repository runs scan, request, discovery, review, delivery, coding, commit and push; the
   canonical-pattern files are unavailable by rule, and `adopt` keeps refusing with a clearer message.
2. Plan 012: on a repository the Incubator did not build, the coding agent may run only check commands the
   owner approved.
3. Plan 015 (was 013; renumbered by ADR-026): real Dart/Flutter scanning (languages, pubspec dependencies, tests, conventions).
4. Plan 016 (was 014; renumbered by ADR-026): a Flutter stack pack with canonical files.

Decisions (ADR-024):

- `other` is added to `platform`, `stack.pack`, `stack.framework`, `stack.packageManager`,
  `stack.database`, `stack.auth` and `deploy.target`. It is all-or-nothing, and `testing.e2e` is `none`.
- The discovery prompt lists `other` only when the draft already has pack `other`, so every existing
  prompt stays byte-identical and no recorded fixture key changes.
- The schema is a pinned contract. The change is made in the working tree; `pnpm contracts:pin` is the
  owner's action, and `check:quick` is red on `contracts-pin` until they run it.
- Lane templates come from a lane-only render of the base pack: no stub stack pack, no new combo,
  golden or CI matrix row.
- A gaps request on an `other` repository is turned off with a recorded warning; it never parks.
- An ecosystem label ("Dart/Flutter") comes from root manifest presence only, from built-in constants.
  Repository text never becomes a label or a command.

## Touched files and markers

| File or directory                                                              | Marker / note                                                                       |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `packages/spec/schema/incubator.schema.json`, `packages/spec/src/types.gen.ts` | `"other"` in seven enums; regenerated types                                         |
| `packages/spec/src/{constants,defaults,semantics}.ts`                          | exhaustive tables; rules `other_mode`, `other_deploy`, `other_fields`               |
| `packages/core/src/discovery/prompt-builder.ts`                                | `allowedValues(includeOther)`: hidden unless the draft's pack is `other`            |
| `packages/analyzer/src/{detectors,draft,repo-view,report,scan-report}.ts`      | `detectEcosystem`; `allowOther`; more skipped build directories; the label          |
| `packages/analyzer/fixtures/flutter-app/`                                      | a small Flutter-shaped repository                                                   |
| `packages/templates/src/render.ts`                                             | `renderLanes`: the lane templates without a stack pack                              |
| `packages/core/src/{adopt,engine,enhance,folders}.ts`                          | no `no_stack` park for enhance; lane-only delivery; gaps off; `FolderVerdict.stack` |
| `packages/core/prompts/enhance.md`                                             | version 1.1.0: `other` means the stack has no pack                                  |
| `apps/web/src/{api-types.ts,ui/views/{Wizard,Review}.tsx}`, `apps/cli/src/*`   | gaps and adopt disabled with the reason; placeholder banner; summary line           |
| `tests/scenarios/enhance-existing/`                                            | `happy-unsupported-stack`, `validation-gaps-unavailable-other`                      |
| `docs/adr/024-spec-value-other.md`, `docs/TDD.md`                              | the contract decision; §5.3, §7.3, §7.4                                             |
| `contracts.lock.json`                                                          | re-pinned by the owner                                                              |

## Acceptance commands

```sh
pnpm exec vitest run packages/spec packages/analyzer packages/templates packages/core/src/enhance.test.ts
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
```

```text
before the owner pins: check:quick fails on contracts-pin only (one finding, the spec schema)
after the pin: check:quick and pnpm check exit 0
an enhance run on the flutter-app fixture reaches REVIEW with stack.pack "other" and delivers the plan,
the lane templates and the tickets, and no canonical file
adopt on the same fixture is refused and names the ecosystem
a greenfield or adopted spec with "other" is rejected with other_mode
the three live-claude-bookclub fixture keys are unchanged
```

## Drift and hallucination guardrails

| Trap                                                           | Why                                                       | Mechanical check                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `other` leaks into new projects or adopt                       | the discovery model could pick it; a spec could be edited | `other_mode` in `validateSemantics`; tests for greenfield, adopt and an edited spec                  |
| Half an `other` spec                                           | seven enums changed independently                         | existing `platform_pack`/`pack_framework`/`pack_package_manager` plus `other_deploy`, `other_fields` |
| A recorded fixture key changes                                 | enum values are printed into the discovery prompt         | `git diff --stat packages/core/fixtures` is empty; the replay test passes unre-keyed                 |
| Lane-only render drifts from the full render                   | two code paths for the same files                         | parity test: `renderLanes` is byte-equal to `render()` for all four packs                            |
| Canonical files proposed into a repository with no pack        | `withGaps` is requested from the UI or CLI                | scenario `validation-gaps-unavailable-other`; delivery asserted to hold no canonical file            |
| Repository text becomes a label                                | prompt injection from repository content (T6)             | labels are constants keyed on file presence; test with a hostile `pubspec.yaml` name field           |
| `adopt` starts accepting unsupported stacks                    | it shares `Adopter.inspect` with enhance                  | `allowOther` defaults to false; adopt test on the fixture still fails                                |
| A pinned contract is committed unpinned, or pinned by an agent | `contracts:pin` is human-only                             | `contracts-pin` guard is red until the owner runs it; nothing is committed before                    |

## Review rounds

| Round | Finding                                                                                        | Status |
| ----- | ---------------------------------------------------------------------------------------------- | ------ |
| 1     | Owner's Flutter repository parked at ANALYZE (`no_stack`); design explored and planned on Opus | CLOSED |
