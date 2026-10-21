# Delivery runbook (Custom Build)

INTERNAL ONLY. Run on the operator dev PC; the Incubator has no hosted service. Facts below come from the Incubator repo (TDD, ADRs, phase docs). Items marked UNVERIFIED are documented as pending local verification: confirm on a pilot before relying on them for a paid job.

## Reality check

- A scaffold-only run gives a repo with stubbed features (node-web routes return 501 with `TODO(scaffold)`). Working features come from the coding-agent handoff (`incubator handoff --launch`). Do not promise a working app from scaffold alone.
- No screenshots, no hosted preview, no "product brief" artifact are produced. A human stands the app up and writes them (steps 4 and 5).
- Time and model cost of a full build are UNMEASURED. Run two pilot builds on invented briefs and record tokens, wall-clock time and your hours before fixing prices.

## Steps

| #   | Step                                                                                                                                                                                | Who            | Output                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------- |
| 0   | Quote accepted, 50% paid (Square invoice). Set status "50% paid".                                                                                                                   | You            | Payment record              |
| 1   | Build `incubator.json` from the call (see 01). Validate.                                                                                                                            | You            | Spec                        |
| 2   | Discovery with prefilled spec (`--yes`), scaffold, verify, publish to a PRIVATE repo under the operator GitHub account (or customer org if they gave a token owner; see 04).        | Incubator      | Repo with tickets, docs, CI |
| 3   | Coding-agent handoff for each feature ticket (`.incubator/tickets/F-*.json`). Review each pull request. Ceilings default to 150 turns, 400 tool calls, 45 minutes, $10 per session. | Agent plus you | Working features            |
| 4   | Stand the app up locally per `docs/STAND-UP.md` (Docker, package manager, database). Seed realistic sample data (never real customer data).                                         | You            | Running app on localhost    |
| 5   | Capture screenshots of each core flow at desktop width. Write the PRODUCT BRIEF (template below). Set status "Brief sent". Send the brief with the second invoice.                  | You            | Brief PDF                   |
| 6   | Customer reviews. Fix gaps within scope. On acceptance and payment of the second invoice, set "Paid in full".                                                                       | You            | Acceptance                  |
| 7   | Prepare the FULL HANDOVER package (below). Transfer the repo (see 04). Set "Delivered".                                                                                             | You            | Package                     |

Do not release the repo, documents or app to the customer before the final payment clears.

## Product brief template (sent before final payment)

1. One-paragraph summary of what was built.
2. Screenshots with a caption each, in order of use.
3. Feature list with status (done, partly done and why).
4. How it handles roles and logins.
5. What is not included (matches the quote).
6. What happens next: payment, handover, repo transfer, support.

Keep it watermark-light, but export screenshots at reduced size so the brief is useful for review and not a substitute for the app.

## Full handover package (after final payment)

| Item                    | Source                                                                                           | What you do                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature document        | `docs/DESIGN.md` (idea, personas, features, stack), plus the quote scope                         | Rewrite in plain language for the customer; remove internal wording                                                                        |
| Operating guides        | `DEPLOY.md`, `TESTING.md`, `docs/STAND-UP.md`, `WHAT-NOW.md`                                     | Tailor: their hosting target, secrets they must set, backup and restore, who to call                                                       |
| Markdown inventory      | None generated                                                                                   | You author: list of files and folders, routes, tables, scheduled jobs, environment variables (names only), third-party services            |
| Source repo             | The published repo                                                                               | Transfer (see 04); include paired `-tests` repo if one exists                                                                              |
| Removed before transfer | `.incubator/lanes`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.github/copilot-instructions.md` | Decide per job; strip anything that exposes how the project was produced, unless the customer asks to keep the agent files. CI files stay. |

## Repo audit offer

Use the adopt flow: it produces `adopt/gap-report.md` and an additive pull request (`incubator/adopt-<date>`; conflicting files arrive as `.incubator-proposed`, nothing overwritten). Needs a pack match; otherwise use enhance, which gives a plan and tickets but no canonical files. Send the gap report in plain language with the PR link. Run it with a read-only token to start, push access only if the customer asks for the PR.

## Pilot checklist (do before the first paid job)

1. Two invented briefs: one small, one standard (use the pack table in 01).
2. For each: record model tokens and dollars, wall-clock time, human hours, number of fix rounds.
3. Confirm UNVERIFIED items: live GitHub publish, live `handoff --launch`, stand-up on this machine.
4. Set the price bands in 02 from the actuals.
