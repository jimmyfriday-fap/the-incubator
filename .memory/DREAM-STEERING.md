---
name: dream-steering
tier: platform
description: Tells the dream pass which patterns matter in this system and which to ignore. The most leveraged file in the store; the human edits it.
last_verified: 2026-11-04
---

## Care about

- (drafted by bootstrap; replace with this system's real failure types)

## Ignore

- One-off typos and formatting nits.
- Failures caused by the environment (network, auth expiry) unless they recur 3+ times.

## Thresholds

- Propose a change only for a pattern with at least 3 occurrences across at least 2 sessions.
- A pattern seen in 2 or more repos goes to `context/platform/`; otherwise to that repo's project files.
- Propose deleting a line when no transcript in 90 days touched its subject, or a newer line contradicts it.
