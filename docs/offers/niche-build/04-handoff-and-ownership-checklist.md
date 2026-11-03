# Handoff and ownership checklist (Custom Build)

INTERNAL ONLY. Legal items are PLACEHOLDERS for the operator and a lawyer. Nothing here is legal advice.

## Decide per job (before the build)

- Where the repo lives during the build: operator GitHub account (private) by default.
- Final owner: the customer's GitHub user or org. Get the exact login on the call (01, question 13).
- Hosting at launch: we hand over only. The app is not hosted by Backshack. The Incubator deploy classes (`vps-tailscale`, `docker-host`) are tailnet-only and internal; do not point a customer app at them. Offer optional monthly support after handover (fixes and small changes), not hosting, until a public customer host is a separate decision.

## Repo transfer

The Incubator has no transfer feature. Options, in order of preference:

1. Build in a repo owned by the operator, then use GitHub's repository transfer to the customer (they must accept; transfer keeps history and issues). Do this only after final payment.
2. If the customer created an empty private repo, push the delivered branch and tags to it, then archive our copy.
3. Never share the operator token. Customer uses their own account.
   Also transfer the paired `<slug>-tests` repo if the run created one. Branch protection on private repos needs the customer plan to support it; note that in the handover email.

## Before transfer

- [ ] Final payment cleared.
- [ ] Customer acceptance in writing.
- [ ] No secrets in the repo (run gitleaks; Actions variables are created as `__INCUBATOR_UNSET__` and secrets are listed in `DEPLOY.md` only).
- [ ] Strip or keep agent files by agreement (see 03).
- [ ] Licence file decided and added (see below).
- [ ] Sample data is invented, not customer data.
- [ ] README and operating guides name the customer, not Backshack internals.

## What the customer receives

App for the quoted scope, feature document, operating guides, markdown inventory, source repository on request.

## Acceptance steps

1. Customer receives the product brief (screenshots) before final payment.
2. Customer replies in writing: accepted, or a list of missing items within scope.
3. We fix in-scope gaps. Out-of-scope requests go to a change quote.
4. Final invoice paid; handover sent.

## Support after handover (to be defined by the operator)

Suggested wording for the quote: [N] days of fixes for defects against the agreed scope at no charge; after that, optional monthly plan covering bug fixes and small changes, response within [N] business days. Hosting, backups and security patching are the customer's unless agreed in writing.

## Placeholders needing a lawyer

- Ownership of delivered code and any licence back to Backshack for reusable parts.
- The generated templates and packs have no stated licence policy and the Incubator repo has no LICENSE file; nothing in the repo settles ownership of AI-assisted code. Get advice before the first sale.
- Third-party open source notices for the dependencies shipped.
- Warranty, limitation of liability, refunds, confidentiality, data handling, governing law.
- Terms page on the website (none exists today) and consent wording on the form (privacy policy is linked).
