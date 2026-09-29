# ADR-004: Deterministic rendering, normalization and the lockfile

- **Status:** Accepted (revised in Phase 2: render-time Prettier)
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
- ~~Formatting generated files with Prettier at render time is ruled out (it is version-sensitive).
  Instead, pack sources are formatted, and the lint on the output checks formatting.~~ Superseded;
  see the revision below.

## Revision (Phase 2): render-time Prettier, exactly pinned

Generated repositories run `prettier --check` in their own `check`. Templates with loops and
conditionals cannot be kept Prettier-clean by hand for every spec (wrapping depends on names and
feature counts), so the first rendered repositories failed their own format step.

- The renderer now formats every text file Prettier understands (`json`, `md`, `yaml`, `ts`, `tsx`,
  `js`, `mjs`, `cjs`, `css`, `html`) after normalization, using each root's rendered
  `.prettierrc.json` and `.prettierignore` (the app root and the paired tests root separately).
- Prettier is an **exact** dependency of `@incubator/templates` (`3.9.9`, no range) and the same
  version is pinned in `versions.json` for generated repositories, so the version sensitivity that
  ruled this out is controlled: a Prettier bump is a pack version bump and shows up in every golden.
- Output that Prettier cannot parse is a render error naming the file and pack (`render_format`),
  which also catches templates that emit invalid JSON or YAML.
- Determinism still holds: Prettier is pure over (text, options, version); the golden tests prove it
  per pack combination.

## Alternatives considered

- **Git tree hashes as file identity.** Rejected: SHA-1, and they tie the lockfile to git.
