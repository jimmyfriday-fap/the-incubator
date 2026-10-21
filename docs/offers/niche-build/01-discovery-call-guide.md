# Discovery call guide (Custom Build)

INTERNAL ONLY. Never share this file, name the Incubator, or describe how the build is made to a customer.

Purpose: in a 30 to 45 minute call, collect enough to (a) decide fit, (b) write a fixed quote, and (c) fill `incubator.json` for a build run. Source of the request: the website form (table `backshack_build_requests`, admin screen "Build requests"). Read the row first and pre-fill what you can.

## Before the call (5 minutes)

- Open the request in admin. Set status "Call booked".
- If they gave a sample link, open it. Note columns, tabs, formulas, who edits it.
- Decide the likely offer: app (spreadsheet or manual process) or repo audit.

## Fit check (ask first, decline early if it fails)

Say yes only when the work is a small to mid-sized internal tool for one team or process. Say no, or quote as a separate custom project, if any of these is true:

- Native mobile app, or heavy offline use.
- Payments or card data, medical records (HIPAA), or student records (FERPA) without a plan for them.
- Real-time sync with many external systems, or large data (millions of rows).
- They want us to host and operate it now (we hand over at launch; see 04).
- The scope cannot be written in one page.

Pack fit, from the Incubator's four packs:

| Need                                         | Pack           | `stack.pack` / framework                             |
| -------------------------------------------- | -------------- | ---------------------------------------------------- |
| Web app with logins, records, forms, reports | node-web       | `node-web` / `fastify-react`, postgres, session auth |
| API or background job, no UI                 | python-service | `python-service` / `fastapi`                         |
| Customer already runs WordPress              | wordpress      | `wordpress` / plugin or theme, mariadb               |
| Shared code or command line tool             | node-lib       | `node-lib` / `typescript-lib`, no database           |
| Existing repo (audit)                        | adopt flow     | needs a pack match, else enhance only                |

## Question set and where each answer goes

Ask in this order. Write answers in the customer's words, then map them.

| #   | Question                                                             | Listen for                  | Goes into                                                                                      |
| --- | -------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Walk me through one real job from start to finish today.             | Steps, handoffs, pain       | `intent.narrative` (free text, keep their words)                                               |
| 2   | Who touches it, and what does each person do?                        | Roles, approvers, outsiders | `intent.personas` (max 10 short strings) and `stack.auth`                                      |
| 3   | If it did only three things well, what are they? (up to 10)          | The must-haves              | `intent.coreFeatures` [{id, summary, lane}] (max 20), lane usually `ui/feature` or `workspace` |
| 4   | Show me the sheet or form. What breaks or gets lost?                 | Columns, rules, duplicates  | narrative plus feature summaries; request a sample by email                                    |
| 5   | How much? Records per month, users, attachments.                     | Volume                      | sizing note in narrative; pack/database choice                                                 |
| 6   | Any sensitive data? Customer, staff, health, money, children.        | Compliance                  | `security` block, `project.visibility`, go/no-go                                               |
| 7   | What must it connect to? Email, accounting, calendar, import/export. | Integrations                | extra features; flag anything beyond import/export and email as scope risk                     |
| 8   | Who logs in, and how do they get an account?                         | Roles, SSO need             | `stack.auth` (`session` default, `wordpress` if WP)                                            |
| 9   | Reports or exports they must have.                                   | Outputs                     | feature summaries                                                                              |
| 10  | Where do you want it to live? Do you have IT?                        | Hosting                     | `deploy.target` (`vps-tailscale`, `docker-host`, `package-release`); we hand over at launch    |
| 11  | What does success look like in 90 days?                              | Acceptance                  | success measures in narrative; becomes acceptance checklist                                    |
| 12  | Timeline, budget range, who decides?                                 | Commercial                  | quote only; do not write into the spec                                                         |
| 13  | Who owns the GitHub account for the repo?                            | Transfer                    | `project.owner` {type user or org, login}; `project.visibility` private                        |

Defaults to confirm, not ask: `stack.database` postgres, `stack.packageManager` pnpm (node-web) or uv (python), `testing.e2e` playwright, `security.scanners` semgrep, trivy, gitleaks.

## End of call

Say back the three features and the out-of-scope list. State the next step: a fixed quote within two business days. Set status "Quoted" when sent. Save notes in the admin Notes field.

## After the call: build the spec

1. Create `incubator.json` from the answers (greenfield mode). Keep `intent.narrative` factual and in plain English.
2. Run discovery with a prefilled spec (`--yes`) so no extra questions are asked; check the recommended defaults against the call.
3. Validate the spec. Fix semantic errors (pack and framework match, `deploy.target` rules).
