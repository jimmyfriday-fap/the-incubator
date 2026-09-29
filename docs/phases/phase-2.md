# Phase 2 — Templates and scaffold: acceptance evidence

Plan: [docs/plans/003-phase-2-templates-and-scaffold.md](../plans/003-phase-2-templates-and-scaffold.md).

| #   | Criterion (TDD §10, Phase 2)                                                        | Status                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Byte identity over two runs                                                         | PASS (render tests + per-combination golden manifests)                                                                                            |
| 2   | Matrix: each cell's own `check`, test count > 0, completeness ≥ threshold           | PASS locally and in CI: all 10 `packs` cells green ([run 36640729016](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36640729016)) |
| 3   | Security fixtures fire (semgrep via the hash-pinned tools fetch)                    | PASS (`rule-fixtures` inside each cell's `check full`)                                                                                            |
| 4   | actionlint clean on every rendered workflow                                         | PASS (`workflow-lint-strict` inside each cell's `check full`)                                                                                     |
| 5   | `incubator scaffold <spec> --out <dir> [--dry-run] [--validate-only]`               | PASS                                                                                                                                              |
| 6   | This repo's `scripts/guard/` is a render of `base` (dogfood drift test)             | PASS                                                                                                                                              |
| —   | WordPress `unit-coverage` (needs PCOV/Xdebug) and Docker/compose integration suites | WordPress `unit-coverage`: PASS in CI (PCOV); Docker/compose suites: PENDING LOCAL VERIFICATION (no daemon here)                                  |

## 1. Determinism

```sh
pnpm vitest run --project unit packages/templates
```

```text
✓ render > is byte-identical across runs and changes the lock when the spec changes
✓ pack combinations > node-lib.in-repo.package-release renders to its golden manifest
✓ pack combinations > node-lib.paired-repo.package-release renders to its golden manifest
✓ pack combinations > node-web.in-repo.docker-host renders to its golden manifest
✓ pack combinations > node-web.in-repo.vps-tailscale renders to its golden manifest
✓ pack combinations > node-web.paired-repo.vps-tailscale renders to its golden manifest
✓ pack combinations > python-service.in-repo.vps-tailscale renders to its golden manifest
✓ pack combinations > python-service.paired-repo.docker-host renders to its golden manifest
✓ pack combinations > wordpress-plugin.in-repo.vps-tailscale renders to its golden manifest
✓ pack combinations > wordpress-plugin.paired-repo.vps-tailscale renders to its golden manifest
✓ pack combinations > wordpress-theme.in-repo.docker-host renders to its golden manifest
```

Goldens (`packages/templates/__golden__/*.txt`) pin `sha256 mode path` for every rendered file,
including `.incubator/lock.json` (which records each pack's integrity hash). The same tests assert:
the specs are schema- and semantics-valid; the packs selected are base → stack → deploy → test-home;
every `uses:` in a rendered workflow is `@<40-hex> # <tag>`; and every `secrets.*` / `vars.*` a rendered
workflow reads is declared in a pack manifest's `settings` (publish creates those variables).

## 2. The pack matrix

Driver: `scripts/packs-matrix.mjs <combo>` scaffolds through the real CLI, installs the toolchain
(pnpm / uv / composer), and runs the generated repository's own `node scripts/check.mjs` — in the app
and, for paired cells, in the tests repository with the app checked out at `app/`.

```sh
node scripts/packs-matrix.mjs <combo> --profile full
```

| Combination                                  | Local result (this container)                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `node-web.in-repo.vps-tailscale`             | app `check full` exit 0                                                      |
| `node-web.paired-repo.vps-tailscale`         | app exit 0, tests exit 0 (`full`)                                            |
| `node-web.in-repo.docker-host`               | app exit 0 (`full`)                                                          |
| `node-lib.in-repo.package-release`           | app exit 0 (`full`); `package-smoke` packs, installs and imports the tarball |
| `node-lib.paired-repo.package-release` (CLI) | app exit 0, tests exit 0 (`full`)                                            |
| `python-service.in-repo.vps-tailscale`       | app exit 0 (`full`)                                                          |
| `python-service.paired-repo.docker-host`     | app exit 0, tests exit 0 (`full`)                                            |
| `wordpress-plugin.in-repo.vps-tailscale`     | app exit 0 (`quick`)                                                         |
| `wordpress-plugin.paired-repo.vps-tailscale` | app exit 0, tests exit 0 (`quick`)                                           |
| `wordpress-theme.in-repo.docker-host`        | app exit 0 (`quick`)                                                         |

A representative `check full` table from a generated node-lib repository:

```text
── check full ──
✔ tools-fetch          pass       19.7s
✔ bom … drift          pass
✔ workflow-lint-strict pass        0.1s   (actionlint, hash-pinned)
✔ syntax               pass        0.4s
✔ rule-fixtures        pass        4.8s   (semgrep, hash-locked wheels)
✔ format               pass        1.8s
✔ lint                 pass        2.6s
✔ typecheck            pass        1.2s
✔ build                pass        1.1s
✔ unit-coverage        pass        1.0s
✔ tests-collected      pass        0.1s
✔ completeness         pass        0.1s
✔ audit                pass        0.6s
exit 0
```

Completeness scores seen: node-web 88–98, python-service 88 (98 for paired apps), WordPress 88 (98
for the paired app); threshold 70. WordPress cells ran `quick` locally because `unit-coverage` needs
PCOV or Xdebug, which this container lacks; everything else in their `full` profile passed in the
agent run (rule-fixtures, actionlint, `composer audit`). CI runs every combination with `--profile
full` and PCOV; the run is recorded below.

Generated repositories also pass their own scaffolder round trip: in each stack,
`node scripts/scaffold.mjs feature export-json --summary "Export as JSON"` followed by `check quick`
exits 0 (the scaffolder now runs the repo's configured formatter over what it writes).

**CI:** the `packs` matrix job in `.github/workflows/ci.yml` (gated by `gate`). All 10 cells passed
`check full` at commit `45e15d7`, the WordPress cells included (with PCOV):
[run 36640729016](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36640729016).

## 3–4. Security fixtures and actionlint

Inside every `check full` above: `rule-fixtures` runs the pack's local Semgrep rules against
`security/fixtures/<rule>/{bad,good}.*` (TypeScript rules for node stacks; `incubator.py-*` for Python;
`incubator.php-*` for WordPress) and fails unless each rule fires on `bad` and stays silent on `good`;
`workflow-lint-strict` requires actionlint (fetched hash-pinned) and fails closed when it is missing:

```text
$ node scripts/guard/workflow-lint.mjs --require-actionlint   (without .tools/)
✔ workflow-lint: ok
actionlint not found in .tools/ (run: node scripts/tools-fetch.mjs)
exit 1
```

## 5. `incubator scaffold`

```text
$ incubator scaffold packages/templates/fixtures/combos/python-service.paired-repo.docker-host.json --validate-only
ℹ 26 default(s) filled in (recorded as source "default" in incubator.json decisions)
✔ spec is valid; 217 files would be rendered (base@1.0.0, stack/python-service@1.0.0, deploy/docker-host@1.0.0, test-home/paired-repo@1.0.0)
exit 0

$ incubator scaffold …/wordpress-plugin.in-repo.vps-tailscale.json --dry-run
3c36880e024e  0644  base                   tools/semgrep.in
9b8a934b3f96  0644  base                   tools/tools.lock.json
• dry run: 172 files (base@1.0.0, stack/wordpress@1.0.0, deploy/vps-tailscale@1.0.0, test-home/in-repo@1.0.0); nothing written

$ incubator scaffold …/node-web.in-repo.vps-tailscale.json --out <dir>/stockroom
✔ scaffolded 176 file(s) into <dir>/stockroom
  packs      base@1.0.0, stack/node-web@1.0.0, deploy/vps-tailscale@1.0.0, test-home/in-repo@1.0.0
exit 0
$ (same again)
PolicyError [out_not_empty]: <dir>/stockroom is not empty (use --force to write into it)
exit 2
```

`apps/cli/src/main.test.ts` covers these paths, the paired tests repository written next to the app,
invalid specs (exit 2), and re-rendering from the generated `incubator.json` reproducing
`.incubator/lock.json` byte for byte.

## 6. Dogfood

```sh
pnpm vitest run --project unit scripts/dogfood.test.mjs
```

```text
✓ dogfood > every exception states a reason
✓ dogfood > pack copies of the toolkit equal the repository (scripts/packs-sync.mjs --check)
✓ dogfood > base renders this repository's own files byte for byte
```

The repository now has its own `incubator.json` (platform `cli`, stack `node-lib`, deploy
`package-release`). Rendering it, every file the `base` pack owns (more than 70, including the whole
guard toolkit, `scripts/check.mjs`, schemas, tool locks, `.gitattributes`, `.claude/settings.json`,
`lefthook.yml`, `.incubator/agent-profile.json`) equals the repository byte for byte. The nine
exceptions in `.incubator/dogfood-exceptions.json` each carry a reason (monorepo CI, the repo's own
README/agent instructions/config, and the release lane that lands in Phase 6); stale exceptions fail
the test.

## Deviations and known gaps

- **Psalm instead of PHPStan** for WordPress typecheck: `phpstan/phpstan` ships only as a GitHub
  zipball, which this container's proxy blocks. Swapping back is a small pack change.
- **Python e2e** is HTTP-level (`httpx2`), not Playwright for Python.
- In a **paired** app, `scripts/scaffold.mjs` creates the feature in the app repo; the adapter has to
  be added in the tests repository by hand (all stacks).
- Feature ids that would render to reserved words (`delete`, `import`, `list`, …) are now rejected by
  spec semantics (`feature_identifier`).
- Registry-based `semgrep p/default` could not run here (semgrep.dev is blocked by the proxy); local
  rules and gitleaks run clean, and CI's security-scan runs the registry rules.

## `pnpm check`

```text
── check full ──  (22 steps) … exit 0
tests 295; coverage: lines 93.89 %, statements 92.60 %, functions 92.63 %, branches 85.10 %
```
