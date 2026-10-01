# ADR-022: Native capabilities reach the UI as HTTP routes backed by a host hook

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context doc:** [`docs/TDD.md`](../TDD.md) §9

## Context

The wizard needs the operating system's folder dialog in two hosts: the Electron app (where
`dialog.showOpenDialog` is available to the main process) and `incubator ui` (a plain browser, which
cannot open a native dialog). ADR-012 keeps the renderer free of Node, IPC and a preload bridge, and the
server's security model (token, cookie, Host/Origin, CSRF) is the only transport.

## Decision

- `ServerOptions.host?: { pickFolder?(purpose): Promise<string | null> }`. `GET /api/session` reports
  `capabilities.pickFolder`; `POST /api/folders/pick` calls the hook. The route is a POST because it opens
  a window, so the usual Origin and CSRF checks apply.
- **Electron** supplies `dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })`.
- **`incubator ui`** supplies a picker that spawns the OS dialog through `Exec` with `shell: false` and a
  constant script: PowerShell `FolderBrowserDialog` on Windows (`-EncodedCommand`), `osascript` on macOS,
  `zenity` or `kdialog` on Linux. No user input enters a script. With none available the capability is
  off and the UI shows only the paste-a-path field.
- `POST /api/folders/inspect` validates a path (`inspectFolder`), whichever way it was chosen.

## Consequences

- The renderer's security model is unchanged: one transport, no preload.
- Any page that could drive the API could pop a dialog; it cannot, because the Origin and CSRF checks
  already refuse it (the cross-origin e2e test covers the API).
- The OS dialog is not exercised in CI; it is PENDING LOCAL VERIFICATION on Windows.

## Alternatives considered

- **Preload IPC bridge.** Rejected by ADR-012: it doubles the transport and widens the renderer's surface.
- **`<input webkitdirectory>`.** Rejected: browsers expose file lists, not a usable absolute path.
