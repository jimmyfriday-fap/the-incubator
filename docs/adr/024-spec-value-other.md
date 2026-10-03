# ADR-024: The spec value `other`, for a repository with no stack pack

- **Status:** Accepted
- **Date:** 2026-10-02
- **Context doc:** [`docs/TDD.md`](../TDD.md) §5.3, §7.3, §7.4

## Context

"Update an existing solution" parked at ANALYZE (`no_stack`) for every repository outside the four
stack packs. The owner's first real folder was a Flutter/Dart app. The brief is that any existing
repository can be scanned and updated through the same discovery pattern.

Only one part of an update needs a pack: the optional commit that adds the missing canonical-pattern
files. The scan, the change request, discovery, review, the plan and tickets, coding, commit and push do
not. The park existed because an update builds a spec, and the spec schema names a pack.

## Decision

1. **An honest value.** `other` is added to `platform`, `stack.pack`, `stack.framework`,
   `stack.packageManager`, `stack.database`, `stack.auth` and `deploy.target`. It means "the Incubator
   has no pack for this", not a guess. `testing.e2e` uses the existing `none`.
2. **Enhancement only, all or nothing.** `validateSemantics` rejects `other` anywhere outside
   `mode: "enhancement"` (`other_mode`), requires `deploy.target` to be `other` exactly when the pack
   is (`other_deploy`), and ties `database`, `auth` and `e2e` to the pack (`other_fields`). The existing
   pack tables enforce the rest, and they stay exhaustive, so a missing case is a compile error.
3. **A model never picks it.** The discovery prompt lists `other` only when the draft's pack already
   is `other`, and a turn that sets it is sent back (`stack.other`). Every existing prompt is therefore
   byte-identical, and no recorded fixture key changes.
4. **No canonical files.** With pack `other` the delivery takes the lane templates from a lane-only
   render of the base pack (`renderLanes`, proven byte-equal to the full render for every pack). A
   request for the canonical gaps is turned off with a recorded warning (`enhance.gaps_unavailable`);
   it does not park. `adopt`, whose whole job is those files, keeps refusing and now names the ecosystem.
5. **A label, not an inference.** `detectEcosystem` names what the repository is ("Dart/Flutter") from
   which root manifest exists. The id and label are built-in constants: no text from the repository
   reaches a label, a prompt heading or a command (threat T6). A low-confidence `node-lib` guess from a
   stray `package.json` gives way to another ecosystem's root manifest, for enhance only.
6. **The owner pins.** The schema is a pinned contract. The change is made in the working tree and the
   owner runs `pnpm contracts:pin`; nothing is committed while `contracts-pin` is red.

## Alternatives considered

- **An internal placeholder pack (no schema change).** The run would carry `node-lib` for a Flutter app
  and remember separately that it was not real. No pin, but the review screen would show a false stack,
  and every reader of the spec would need to know about the side flag.
- **Making `stack` optional for enhancements.** It changes the spec's shape, so every `spec.stack.*`
  reader needs a guard and mistakes surface at run time. A value keeps the shape and fails at compile time.
- **A stub `stack/other` pack.** It satisfies pack selection, but adds a combination, a golden manifest
  and a CI matrix row for a pack that renders nothing.

## Consequences

- `deploy`, `testing` and `lanes` still carry default values for an `other` repository. They drive only
  canonical rendering, which is skipped; the review screen says so.
- The scan still understands only TypeScript, JavaScript, Python and PHP sources. For another ecosystem
  it reports the label, coverage and layout, and little else, until that language is added (plan 015).
- The coding agent's prompt and allowed tools still assume an Incubator-built repository (plan 012).
- Adding a real pack later (plan 016, Flutter) turns those repositories from `other` into that pack with
  no further contract change beyond the new enum value.
