# ADR-004: Deterministic rendering, normalization and the lockfile

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

The brief requires that the same `incubator.json` and the same pack versions produce byte-identical
output. It also requires a lockfile that `incubator sync` can use to upgrade packs without
overwriting user changes.

## Decision

- `render(spec, packSet) → Map<posixPath, Uint8Array>` is pure. It takes no clock, env, fs (packs are
  preloaded into memory), network or randomness.
- **Normalization** applies to every text file:
  - UTF-8 without a BOM;
  - CRLF/CR → LF;
  - trailing whitespace stripped, except Markdown's two-space hard breaks;
  - exactly one trailing LF.
- A file counts as binary if the manifest says `binary: true` or the source contains NUL; binary
  files are copied byte for byte.
- **Ordering:** files are sorted by POSIX path using code-unit comparison, which avoids
  locale-dependent `localeCompare`.
- **JSON output** goes through one serializer: 2-space indent and LF. Key order is schema order for
  `incubator.json` and sorted for everything else.
- The **spec hash** is `sha256:` + hex(SHA-256(JCS(spec))), per RFC 8785.
- The **pack integrity** is the SHA-256 of the sorted `path\0sha256\n` lines for all pack files.
- **`.incubator/lock.json`** holds `lockVersion`, `incubatorVersion`, `specHash`,
  `packs[{id, version, integrity}]` and `files{path: {sha256, pack, mode}}`, excluding itself.
- File modes are declared in the manifest, not read from disk, because Windows has no executable
  bit. At publish, `git update-index --chmod=+x` sets them.

## Consequences

- Two renders compare equal with a simple byte comparison, and golden tests store hashes.
- `sync` can tell user-modified files (the hash differs from the lock) from pristine ones.
- Formatting generated files with Prettier at render time is ruled out (it is version-sensitive).
  Instead, pack sources are formatted, and the lint on the output checks formatting.

## Alternatives considered

- **Git tree hashes as file identity.** Rejected: SHA-1, and they tie the lockfile to git.
