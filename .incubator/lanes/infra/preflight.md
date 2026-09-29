# Preflight: `infra` lane

Before enrichment, establish the facts the `infra` lane depends on: deploy workflows, environments and lanes; respect the promotion rules in DEPLOY.md.

## Checklist

1. Reproduce or locate the evidence (failing command, finding fingerprint, workflow run).
2. Name the blast radius: which environments, workflows and users are affected.
3. Confirm no human-only action (see `.incubator/agent-profile.json`) is required. If one is,
   stop and hand the ticket to a human.

## Output

A short `PREFLIGHT:` note with the evidence, the blast radius and `PROCEED` or `STOP: <reason>`.
