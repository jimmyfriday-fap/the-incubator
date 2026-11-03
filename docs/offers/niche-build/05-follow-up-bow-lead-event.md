# Follow-up: send Custom Build requests to BOW and Leantime

Status: NOT BUILT. v1 stores requests in WordPress (table `backshack_build_requests`, admin screen "Build requests") and emails the operator and the requester. Nothing goes to BOW or Leantime.

## Why it is separate

The Backshack support plugin posts `support.request_created` to BOW (`/api/platform/events`, headers `X-Platform-Ingress-Secret`, `X-Shared-Secret`) and BOW creates the Leantime ticket. A lead event needs a NEW event type handled on the BOW side (repo `backshack-bow`). Which event types BOW accepts lives outside the website repo, and the ticket-creating handler for a new type was not confirmed.

## Proposed work

1. BOW: accept `lead.build_request_created` (payload: request id, company, name, email, offer, size band, timeline band, UTM fields; no free text beyond a short excerpt), create a Leantime ticket in a sales or inbound project, and return the ticket id.
2. WordPress plugin: after insert, post the event with the same helper pattern as `maybe_enqueue_support_platform_event()` (3 second timeout, deferred after the response), store the returned ticket id in a new column, and show it in the admin list. Gate with an option so it can be switched off.
3. Test in the generator repo only (no PHPUnit in the site tree), plus the local-stack smoke path.
4. Mind the ticket progress contract in the workspace CLAUDE.md (claim, `LT#` commit messages) if the work becomes a Leantime ticket.

Privacy: the form tells people the details are used to contact them about their request. Sending them to BOW and Leantime stays inside Backshack systems; update the form wording if that changes.

## TODO (idea, not scheduled): build queue for paid requests

Wire the request form to a queuing platform (possibly a Backshack WordPress plugin) that takes every PAID build request and queues it up for the Incubator run (spec prefill, run, handoff, brief). Status: idea only, no design or code yet.
Open questions for when it is picked up:

- What marks a request as paid (Square invoice paid webhook, or the operator sets status "50% paid" by hand)?
- Where the queue lives (a WP table beside `backshack_build_requests`, BOW, or the Leantime backlog) and who consumes it. The Incubator runs only on the operator dev PC today, so a consumer there must pull jobs; nothing may push into it from the public site.
- What a queue item holds: request id, call-guide answers mapped to `incubator.json` fields, quote scope, status history. Keep customer data off any public path.
- Ordering, retries, and a human gate before any paid model run (ceiling about $10 and 45 minutes per agent session).
  Related: the BOW and Leantime lead event above would be the natural way to feed such a queue.
