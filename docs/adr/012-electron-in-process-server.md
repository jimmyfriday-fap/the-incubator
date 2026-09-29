# ADR-012: Electron runs the same Fastify server in-process

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

The desktop app must use the same web UI with the engine running in-process (brief §1). The options
are IPC via a preload bridge, or loading the local HTTP server.

## Decision

- The Electron main process imports `@incubator/core` and `@incubator/web`'s `startServer`, binds to
  127.0.0.1 on a random port, and loads the tokenized URL in a `BrowserWindow`.
- `webPreferences`: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload.
- Navigation lockdown and a vetted `shell.openExternal` allowlist.
- `@napi-rs/keyring` is Node-API, so it needs no Electron rebuild. electron-builder handles the
  `asarUnpack` for its `.node` binary.
- The desktop build bundles the UI's Vite output. The server serves it with `@fastify/static`.

## Consequences

- One security model and one UI transport. Any fix to the server applies to both surfaces.
- There is a small cost of an HTTP hop inside one process, which is negligible.

## Alternatives considered

- **Preload IPC bridge.** Rejected: it doubles the transport code and widens the renderer's
  attack surface.
