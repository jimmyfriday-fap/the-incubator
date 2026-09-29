# Plan 003: Phase 2 — templates and scaffold

## Executor preamble

Build the deterministic renderer in `packages/templates` (Eta under a restricted-template lint,
normalization, render-time Prettier, scaffold markers, JSON patches, relocation into a paired tests
repository, lockfile and contracts lock) and the packs `base`, `stack/{node-web,node-lib,
python-service,wordpress}`, `deploy/{vps-tailscale,docker-host,package-release}` and
`test-home/{in-repo,paired-repo}`. Add `incubator scaffold <spec> --out <dir> [--dry-run]
[--validate-only] [--force]`. Every rendered repository must pass its **own** `check`. Source of truth:
`docs/TDD.md` §2.2, §3, §3.5 and ADRs 003, 004 (revised), 005, 013, 016, 018. Never copy code from
any Backshack repository: every pack file is written fresh.

## Touched files and markers

| File or directory                                        | Marker / note                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/templates/src/*`                               | renderer, markers (parity with `scripts/guard/lib/markers.mjs`), patches, writer |
| `packages/templates/schema/pack.schema.json`             | pack manifest contract (pinned in `contracts.lock.json`)                         |
| `packages/templates/packs/**`                            | packs; toolkit copies synced by `scripts/packs-sync.mjs`                         |
| `packages/templates/{actions-lock,versions}.json`        | SHA-pinned actions, dependency versions for generated repos                      |
| `packages/templates/fixtures/combos/*.json`              | the pack combinations: goldens, CLI tests and the CI `packs` matrix              |
| `packages/templates/__golden__/*.txt`                    | `sha256 mode path` per rendered file, refreshed with `INCUBATOR_GOLDEN_UPDATE=1` |
| `packages/core/src/scaffold.ts`, `apps/cli/src/commands` | `scaffoldSpec` and `incubator scaffold`                                          |
| `scripts/{scaffold,run-deploy-tasks,packs-matrix}.mjs`   | generated-repo scaffolder, deploy tasks, matrix cell driver                      |
| `scripts/deploy/*`, `scripts/release/*`                  | preflight, smoke (`--path`), promote-target check                                |
| `incubator.json`, `.incubator/dogfood-exceptions.json`   | the Incubator's own spec and the reasoned dogfood exceptions                     |
| `.github/workflows/ci.yml`                               | `packs` matrix job gated by `gate`                                               |

## Acceptance commands

```sh
pnpm vitest run --project unit packages/templates scripts apps/cli
node scripts/packs-matrix.mjs <combo> --profile full    # one cell; CI runs every combo
```

```text
templates: markers/patches/when/helpers/render/writer unit tests; every combo renders to its golden
dogfood: base renders this repo's own files byte for byte (reasoned exceptions only)
each cell: incubator scaffold → install → the generated repo's own `check full` exits 0
```

## Drift and hallucination guardrails

| Trap                                              | Why                                         | Mechanical check                                                                |
| ------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| Template reads the clock, env or does I/O         | Output must be a pure function of the spec  | `lintTemplate` over every pack + shadowed globals at runtime                    |
| Renderer and generated scaffolder disagree        | Markers must round-trip between both        | `markers.test.ts` parity cases against `scripts/guard/lib/markers.mjs`          |
| Pack copy of the toolkit drifts from the repo     | Generated repos must run the same guards    | `scripts/dogfood.test.mjs` (packs-sync check)                                   |
| The Incubator stops meeting its own standard      | "Fix the standard" must be a failing test   | dogfood render of `incubator.json` vs the repo, exceptions need reasons         |
| A pack change silently changes generated repos    | Reviewers must see output changes           | golden `sha256 mode path` manifests per combination                             |
| A generated repo fails its own gate               | The product is repos that pass their checks | CI `packs` matrix runs each combination's own `check full`                      |
| Unpinned or mutable action refs in rendered YAML  | Supply-chain hygiene                        | golden test asserts `@<40-hex> # <tag>`; generated `workflow-lint` + actionlint |
| Remote deploy arguments reach a shell on the host | Injection through workflow inputs           | `docker-remote.mjs` safe-argument check, unit-tested with hostile inputs        |

## Review rounds

| Round | Finding                                                                                                       | Status |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Rendered repos failed their own `prettier --check`; ADR-004 revised to render-time Prettier (exact pin)       | CLOSED |
| 2     | Eta reserved names (`layout`) and escaped backticks broke template compilation; the lint now rejects both     | CLOSED |
| 3     | Paired app repo scored completeness against run profiles that live in the tests repo; now skipped when absent | CLOSED |
| 4     | `incubator scaffold` could not re-render its own output: the spec schema rejected `test-home/*` pack ids      | CLOSED |
| 5     | `scaffold.mjs` wrote JSON that failed the generated repo's format check; it now runs the configured formatter | CLOSED |
| 6     | JSON patch `remove` of an absent path threw; removal is now a no-op, as idempotence requires                  | CLOSED |
| 7     | `when` conditions could read inherited properties (`constructor`); lookups are own-property only              | CLOSED |
