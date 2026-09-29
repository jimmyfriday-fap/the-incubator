# Phase 0 — Bootstrap and dogfood: acceptance evidence

Plan: [docs/plans/001-phase-0-bootstrap.md](../plans/001-phase-0-bootstrap.md). Commit under test:
`46e4441` on `claude/serene-wright-9zwjvl`.

| #   | Criterion (brief §9, Phase 0)                                                                                             | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Monorepo skeleton: TypeScript, pnpm workspaces, Node 22, strict `tsc`, ESM                                                | PASS   |
| 2   | `pnpm check` runs lint, format, typecheck, unit tests, isolation lint, BOM guard and the schema pin test                  | PASS   |
| 3   | CI workflows, lefthook, CLAUDE.md/AGENTS.md, `.claude/settings.json` with SessionStart `pnpm install && pnpm check:quick` | PASS   |
| 4   | `docs/TDD.md` and ADRs written                                                                                            | PASS   |
| 5   | CI is green on push                                                                                                       | PASS   |
| 6   | A fresh cloud session can run `pnpm check` with no manual setup                                                           | PASS   |

## 1–2. `pnpm check` (full profile)

```sh
pnpm check
```

```text
── check full ──
✔ tools-fetch          pass        0.1s
✔ bom                  pass        0.1s
✔ abs-path             pass        0.1s
✔ isolation            pass        0.1s
✔ deps-boundary        pass        0.1s
✔ contracts-pin        pass        0.1s
✔ plan-lint            pass        0.1s
✔ lane-contract        pass        0.1s
✔ scenarios            pass        0.1s
✔ quarantine           pass        0.0s
✔ drift                pass        0.1s
✔ syntax               pass        0.4s
✔ workflow-lint-strict pass        0.1s
✔ format               pass        2.9s
✔ lint                 pass        3.5s
✔ typecheck            pass        1.5s
✔ build                pass        1.2s
✔ unit-coverage        pass        2.9s
✔ tests-collected      pass        0.1s
✔ completeness         pass        0.1s
✔ rule-fixtures        pass        5.6s
✔ audit                pass        0.5s
exit 0
```

Coverage (v8, `packages/*/src` + `apps/*/src`): lines 90.09 %, statements 87.94 %, functions 89.32 %,
branches 83.95 % against thresholds 80/80/80/75. Tests collected: 97 (1 `live` scenario skipped
without `INCUBATOR_LIVE=1`).

The guards failed closed during development, which is the point: the rule-fixture guard caught a
false positive in the local `incubator.no-shell-true` rule, and the abs-path guard was extended after
a test showed it missed JSON-escaped Windows paths (review rounds in the plan).

## 3. Hooks and agent config

SessionStart runs `node scripts/agent/session-start.mjs`, which runs `pnpm install --frozen-lockfile`
and then `check:quick`. It is a script instead of a `&&` one-liner so it also works on Windows shells.

```text
install (pnpm): ok
check:quick exit 0
── check quick ──
✔ bom … ✔ tests-collected   (16 steps, all pass)
exit 0
```

Stop hook veto, on a copy of the repo with a BOM file planted and active ticket `phase-0`:

```sh
echo '{"stop_hook_active":true}' | node scripts/agent/on-stop.mjs   # four times
```

```text
attempt 1 exit 2
attempt 2 exit 2
attempt 3 exit 2
attempt 4 exit 0
check:quick failed (veto 1/3). Fix it before stopping:
── check quick ──
✖ bom                  fail        0.1s
ticket phase-0 → PARKED with 4 "check-failed" remediation items
```

lefthook pre-commit over all files:

```text
✔️ bom (0.08 seconds)
✔️ abs-path (0.11 seconds)
✔️ format (4.59 seconds)
✔️ lint (5.20 seconds)
```

`pre-push` ran `check:quick` on every push (`✔️ check-quick (14.67 seconds)`).

## 5. CI

[ci run 36621356301](https://github.com/jimmyfriday-fap/the-incubator/actions/runs/36621356301) on
`46e4441`: `check (ubuntu-latest)` success, `check (windows-latest)` success,
`check (macos-latest)` success, `gate` success. The triage step was skipped (no failure).

`security-scan.yml` originally ran only on `main` and pull requests; it now also runs on branch pushes
so its evidence is recorded with Phase 1.

## 6. Fresh session

```sh
git clone <repo> fresh && cd fresh && pnpm install --frozen-lockfile && node scripts/check.mjs full
```

```text
Done in 956ms using pnpm v10.33.0
── check full ──
✔ tools-fetch          pass        19.6s   (actionlint, gitleaks, semgrep downloaded and hash-verified)
… every step pass …
exit 0
```

## Pending local verification

- Windows developer machine: the `.cmd` shim path of `exec` is unit-tested with recorded shim
  formats and exercised in the Windows CI job, but not yet against a locally installed
  `claude.cmd` / `copilot.cmd`.
