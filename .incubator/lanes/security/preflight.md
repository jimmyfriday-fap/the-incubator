# Preflight: `security` lane

Before enrichment, establish the facts the `security` lane depends on: vulnerabilities, secrets, hardening and scanner findings (cite the finding fingerprint).

## Checklist

1. Reproduce or locate the evidence (failing command, finding fingerprint, workflow run).
2. Name the blast radius: which environments, workflows and users are affected.
3. Confirm no human-only action (see `.incubator/agent-profile.json`) is required. If one is,
   stop and hand the ticket to a human.

## Output

A short `PREFLIGHT:` note with the evidence, the blast radius and `PROCEED` or `STOP: <reason>`.
