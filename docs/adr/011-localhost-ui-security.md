# ADR-011: Localhost UI: token → cookie, Host/Origin checks, synchronizer CSRF

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context
`incubator ui` exposes an API that can create GitHub repos and spawn agent CLIs. Browsers let any
website send requests to `127.0.0.1`, and DNS rebinding can make a hostile origin resolve there. The
brief requires 127.0.0.1, a random port, a per-launch token in the URL, and Origin and CSRF checks.

## Decision
- Bind to `127.0.0.1` on port `0` (the OS picks the port). Never bind `0.0.0.0` or `localhost`,
  since the latter may resolve to `::1`.
- The launch token is 32 random bytes, base64url, sent in the URL `?t=`. The first valid request
  exchanges it for an `inc_session` cookie (HttpOnly, `SameSite=Strict`, Path=/) and **invalidates
  the token**. The UI strips `?t=` with `history.replaceState`.
- **Every request:** the `Host` header must equal `127.0.0.1:<port>`, and a valid session cookie is
  required (except for the one-time bootstrap).
- **When `Origin` is present, and always for non-GET requests:** it must equal
  `http://127.0.0.1:<port>`. A missing Origin on a mutating request is rejected.
- **Mutations** need `X-Incubator-CSRF` equal to the session's CSRF token (from `GET /api/session`),
  compared in constant time.
- No CORS headers. `Content-Security-Policy: default-src 'self'; connect-src 'self'`.
  `X-Frame-Options: DENY`.
- `/file?path=` is resolved with `resolveInside(workspace, path)`. A `..` path or an absolute path is
  a 400.

## Consequences
- Phase 5 tests cover each rejection path. Electron reuses the exact server (ADR-012).
- Reopening the UI needs a new launch URL, so `incubator ui` prints it again.

## Alternatives considered
- **Token-only via header on every request.** Rejected: SSE `EventSource` can't set headers.
