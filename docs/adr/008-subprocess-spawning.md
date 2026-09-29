# ADR-008: Shell-less subprocesses and Windows shim resolution

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

The brief requires `shell: false` with argument arrays on all OSes, and treats Windows as first-class.
Since Node's CVE-2024-27980 fix, `spawn` of a `.cmd`/`.bat` file with `shell: false` throws `EINVAL`.
Many npm-installed CLIs on Windows are `.cmd` shims.

## Decision

- `runtime/exec.ts` is the only module allowed to import `node:child_process` (ESLint
  `no-restricted-imports` everywhere else). Its options type has no `shell` field, and it always
  passes `shell: false` and `windowsHide: true`.
- **`which(name)`:**
  1. walks `PATH`;
  2. on Windows, tries `PATHEXT` extensions in the order `.exe`, `.com`, then the rest;
  3. returns `{path, kind: 'native' | 'cmd-shim' | 'script'}`.
- **cmd shims:** parse the npm `cmd-shim` format (`"%dp0%\node_modules\...\cli.js" %*` or the
  `node.exe` variant) to recover the script path, then spawn `process.execPath [script, ...args]`.
  An unparseable shim raises a `ToolError` naming the file. There is **never** a shell fallback.
- **Kill trees:** on POSIX, `detached: true` then `process.kill(-pid, 'SIGTERM')` and after 5 s
  `SIGKILL`; on Windows, `taskkill /PID <pid> /T /F` via `exec`.
- Every call has `timeoutMs` (a required parameter), `maxBuffer` and optional `stdin`. The redacting
  tee applies to both streams.

## Consequences

- Windows works without shells or users needing `.exe` installs.
- One place to audit for injection.

## Alternatives considered

- **`cross-spawn` / `execa`.** Rejected: they may use `cmd.exe` for shims, which violates the
  constraint.
