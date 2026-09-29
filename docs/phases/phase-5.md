# Phase 5 — Localhost web UI: acceptance evidence

Plan: [docs/plans/006-phase-5-web-ui.md](../plans/006-phase-5-web-ui.md).

| #   | Criterion (brief §9 and TDD §10, Phase 5)                                                        | Status                              |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 1   | Playwright e2e covers greenfield and brownfield runs to DONE on the fakes                        | PASS (locally; CI on the next push) |
| 2   | Requests without the token, or with the wrong Origin, are rejected (401/403)                     | PASS                                |
| 3   | Also rejected: a bad cookie, a wrong Host, a missing or wrong CSRF header                        | PASS                                |
| 4   | `incubator ui` with the wizard, tree preview, spec diff and live run log (SSE), reusing the core | PASS                                |
| 5   | Opening the user's own browser from `incubator ui`                                               | PENDING LOCAL VERIFICATION (no GUI) |

## 1. Playwright e2e

```sh
pnpm test:e2e     # builds the UI, then: vitest run --project e2e
```

```text
✓ web UI (Playwright, fakes) > greenfield: narrative → questions → review with diff and owner → published DONE
✓ web UI (Playwright, fakes) > brownfield: repository → review with delta statuses → pull request DONE
✓ web UI (Playwright, fakes) > a page on another origin cannot drive the API, and a reused launch link is refused
Tests  3 passed (3)
```

Headless Chromium (Playwright 1.56) runs against the built UI (`apps/web/dist/ui`). The server is on
a random loopback port and is wired to the fakes: recorded discovery turns (`saas-web`), `FakeGitHub`
backed by bare repositories, real git, a passing verifier and a fake tracker.

**Greenfield.** The test walks the whole flow:

1. It enters the narrative.
2. It picks a non-recommended answer in round 1 of CLARIFY.
3. At REVIEW, the test checks:
   - the diff has rows, and against the empty revision it shows `/project/slug`;
   - the decisions carry source badges;
   - `CLAUDE.md` opens from the in-memory tree;
   - Approve stays disabled until the GitHub owner is set, and setting it rewrites the editor's
     JSON.
4. It approves. The run reaches `DONE`, and the repo link is `https://github.com/octo/stockroom`,
   which exists on the fake.
5. The run log contains `run.done`, and the `warn` filter shows only parks.
6. The home page lists the run.

**Brownfield.** The `bare-node` fixture sits in a git repository whose origin is on the fake. The
test adopts it:

- At REVIEW, the owner is inferred as `octo`, and the tree shows both `create` and `proposed`
  statuses.
- After approval, the run reaches DONE with `https://github.com/octo/bare-node/pull/1`, and the gap
  report is shown.

Both flow tests fail on any browser console error or page error. This is how the CSP (no inline
script or style) is enforced at runtime.

**Cross-origin page.**

1. A page served from a second loopback origin sends a `no-cors` POST, a CORS POST and a GET to the
   API.
2. Each one is blocked or gets an opaque response, and no run is created.
3. Opening the launch URL again returns 401, because the token is single-use.

Each run writes screenshots to `.reports/e2e/*.png`, which git ignores.

## 2–3. Request security

`apps/web/src/server/server.test.ts` checks these responses over real HTTP against the listening
server:

| Request                                     | Result |
| ------------------------------------------- | ------ |
| `/` or `/api/runs` with no cookie           | 401    |
| The launch URL a second time                | 401    |
| `?t=wrong`                                  | 401    |
| `inc_session=forged`                        | 401    |
| GET with `Origin: http://evil.example`      | 403    |
| POST without an Origin header               | 403    |
| POST with Origin `http://localhost:<port>`  | 403    |
| POST without `X-Incubator-CSRF`             | 403    |
| POST with a wrong `X-Incubator-CSRF`        | 403    |
| `Host: evil.example:<port>` (DNS rebinding) | 403    |

The same file also checks:

- **Bootstrap.** The response is a 302 to `/`, with
  `Set-Cookie: inc_session=<43 chars>; HttpOnly; SameSite=Strict; Path=/`.
- **Headers.** Responses carry `Content-Security-Policy: default-src 'self'; …` and no
  `Access-Control-Allow-Origin`.
- **SSE.** The stream replays the journal and resumes after `Last-Event-ID`. Neither the GitHub
  token nor the launch token appears in it.
- **Static assets.** The UI asset resolver refuses `../` and `%2e%2e` paths and malformed encodings.

```text
✓ request security > rejects a missing token, a used token, a bad cookie, a wrong Origin or Host, and a missing CSRF header
✓ request security > sets an HttpOnly SameSite=Strict cookie and redirects the token away
✓ request security > guard and cookie helpers
✓ greenfield over the API > discovers, clarifies, reviews, previews and publishes to DONE
✓ brownfield over the API > adopts a repository through a pull request and shows delta statuses
✓ run events (SSE) > replays the journal, resumes after Last-Event-ID and streams status; the token never appears
✓ helpers > diffs specs by JSON pointer
✓ helpers > serves UI assets confined to the UI directory
```

## 4. `incubator ui`

```text
✓ publish, handoff, auth, gc > ui serves the localhost UI until stopped, printing the single-use link with --no-open
✓ publish, handoff, auth, gc > opens the browser with the platform opener and no shell
```

`incubator ui --no-open` prints `http://127.0.0.1:<port>/?t=<token>` on stdout and serves until
Ctrl+C, which exits with 130. Without `--no-open`, it hands the link to `open`, `xdg-open` or
`rundll32 url.dll,FileProtocolHandler`, with argv only. Every path from the browser goes through the
same engine as the CLI.

**PENDING LOCAL VERIFICATION:** the actual browser launch on a desktop. This container has no GUI.

## `pnpm check`

`check full` gained three steps: `typecheck-ui`, `ui-build` and `e2e`. `typecheck-ui` is also in
`check quick`.

```text
── check full ──  (26 steps) … exit 0
Tests 341 passed | 2 skipped (343); e2e 3 passed
coverage: lines 93.29 %, statements 91.72 %, functions 92.3 %, branches 82.33 %
completeness: 94/100 (threshold 70)
```
