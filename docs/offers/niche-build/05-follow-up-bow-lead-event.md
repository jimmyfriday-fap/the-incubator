# Custom App requests: from the website to a Leantime ticket to an Incubator run

Status: BUILT across three repositories (the website plugin, BOW and the Incubator). This file keeps its old name so existing links still work; it now describes the design that shipped. The earlier version of this page said nothing went to BOW; that is no longer true.

## The flow

1. **WordPress.** A visitor fills in the build request form. The request is stored in the `backshack_build_requests` table (admin screen "Build requests") and the operator and the requester are emailed, as before.
2. **Platform event.** After the row is saved, the plugin posts the platform event `custom_app.request_created` to BOW, using the same pattern as the support plugin's `support.request_created` (a short timeout, deferred until after the response). The payload carries the request id and the form fields, and nothing the form did not collect.
3. **BOW creates the ticket.** BOW handles the event and creates a ticket in the Leantime project `custom-app-request` from its `custom_app.v1` template. The ticket is spec-shaped: sections for the request summary, who, the problem today, the wanted outcome, the spec draft, open questions, contact and the progress contract. The spec draft is a fenced block labelled `incubator-spec-draft` holding a JSON partial spec (project name, narrative, personas, core features, platform and stack when known).
4. **BOW calls WordPress back** with the ticket number. WordPress stores it on the request and shows it in the "Build requests" list, so the operator can find the ticket from the request and the request from the ticket.
5. **Incubator, Requests page.** The operator opens the Requests tab, types the ticket number and the Incubator reads that one ticket from Leantime. It shows who asked, the problem and the wanted outcome, the spec draft and a list of gaps (anything missing or invalid, such as no features or no narrative). The operator can edit the narrative and the features.
6. **Deposit gate.** "Begin development" stays disabled until the operator ticks "50% deposit received". Taking the deposit is the operator's own step (see 02 and the status "50% paid"); the Incubator only records that it was confirmed.
7. **Begin development.** The Incubator starts a run from the edited spec and records the Leantime ticket number and the deposit confirmation on the run. The run uses the runbook ceiling from 03: about $10, 45 minutes, 150 turns and 400 tool calls per agent session. The Incubator server writes those four numbers into the spec's run ceilings, whatever the ticket or the page says.

## What the Incubator checks

- The ticket must be in the configured project; a ticket from any other project is refused.
- Only the `incubator-spec-draft` block is machine-critical. The other sections are read by heading, and a missing one is reported as a gap, not an error.
- A spec block that is not valid JSON, is not an object or is larger than 32 KB is refused. A block that parses but does not fit the spec schema is left out and reported as a gap, and the defaults are used.
- When the run starts, the server reads the ticket again and takes only the narrative, personas and features from the page. Everything else in the spec comes from the ticket and the defaults.
- The ticket number must be digits only.

## Setting it up on the operator PC

1. Add the Leantime project to `~/.incubator/config.json`:
   ```json
   {
     "intake": {
       "leantime": { "baseUrl": "https://<your Leantime host>", "projectId": 0 }
     }
   }
   ```
   Replace `projectId` with the numeric id of the `custom-app-request` project. The address must be https (http is accepted only on localhost) and must not contain a user name or password.
2. Store the Leantime API key in the OS keychain with `incubator auth set leantime` (or set `INCUBATOR_LEANTIME_TOKEN` for a session). The key is never part of the config file or the page.
3. Restart the Incubator. The desktop app adds the configured https host to the links it may open outside its own window.
4. Open the Requests tab. Without the config the page says requests are not set up.

## Privacy

The form tells people the details are used to contact them about their request. WordPress, BOW, Leantime and the Incubator are all Backshack systems. The Incubator runs only on the operator PC and pulls the one ticket it is given; nothing is pushed into it from the public site. Keep customer contact details out of the spec block, which becomes part of the project's own files.

## Not covered

- Marking a request as paid is manual (the deposit checkbox). Nothing reads a Square invoice or a payment webhook.
- There is no queue: the operator picks the next ticket by number.
- Ticket progress follows the progress contract in the ticket body (claim, commit messages that start with the ticket number, Ready for Test when merged).
