# ADR-009: Token resolution, `SecretString`, env-based git auth, the Redactor

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

The GitHub token grants broad power. The brief requires resolution in the order keychain → `gh auth
token` → `GITHUB_TOKEN`, never writing it to disk in plain text, never logging it, and redacting it in
all logs.

## Decision

- **Resolution:** `@napi-rs/keyring` (service `incubator`, account `github`), then `gh auth token`,
  then `GITHUB_TOKEN`. The source (never the value) is reported by `doctor` and journaled. There is no
  file fallback.
- **`SecretString`:** a class holding the value in a private `#field`. `toString`, `toJSON` and
  `[util.inspect.custom]` return `[REDACTED]`. `reveal()` registers the value with the Redactor on
  first use.
- **Redactor:** a process-global. It replaces registered values plus their URL-encoded and
  Base64(`x-access-token:` + value) forms, and the patterns `gh[opusr]_[A-Za-z0-9]{20,}`,
  `github_pat_[A-Za-z0-9_]{20,}`, `sk-ant-[A-Za-z0-9-_]{20,}` and `(?i)authorization:\s*\S+\s+\S+`.
  It is applied at the logger sink, the exec tee, journal writes, SSE emission and error
  serialization.
- **git authentication:** the environment variables `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/
  `GIT_CONFIG_VALUE_0` set `http.https://github.com/.extraheader` for that single process, plus
  `GIT_TERMINAL_PROMPT=0`. Remote URLs are always token-free.
- **Octokit errors** are mapped to `ToolError` with request headers removed.

## Consequences

- The Phase 3 leak test (scan all run artifacts and captured output for the fake token and its
  encodings) is meaningful because every sink passes through one Redactor.

## Alternatives considered

- **Token in the remote URL.** Rejected: it persists in `.git/config` and shows in `ps`.
- **`GIT_ASKPASS` script.** Rejected: it needs a helper file on disk and is awkward on Windows
  without a shell.
