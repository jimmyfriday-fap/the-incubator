# Custom Build terms: working draft

INTERNAL DRAFT, not legal advice. Plain-English starting point for a lawyer to review and rewrite. Each section lists the choice the operator has to make. Wording in [brackets] is open. Do not publish or attach to a quote until a lawyer has signed off.

The public text must never name the internal build tooling.

## 1. Decisions for the operator first

| #   | Decision                               | Options                                                                                                                                                                                                  | Effect on the wording |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Who owns the delivered code            | DECIDED: customer owns it on final payment                                                                                                                                                               | Section 5             |
| 2   | Reusable parts                         | DECIDED: Backshack keeps generic reusable parts; customer gets a licence to use them in the delivered app. Backshack may also use them commercially                                                      | Section 5             |
| 3   | Is the build fixed price or time-boxed | Fixed price with a defined scope (the quote template assumes this)                                                                                                                                       | Sections 2, 4         |
| 4   | Refunds                                | DECIDED: the first 50% is not refundable once work starts                                                                                                                                                | Section 7             |
| 5   | Liability cap                          | DECIDED: no liability once the app is signed off; 30-day good-faith warranty from final payment. Cap at fees paid for anything before sign-off [lawyer]                                                  | Section 8             |
| 6   | Governing law and venue                | DECIDED: Texas law; venue Harris County                                                                                                                                                                  | Section 10            |
| 7   | Hosting                                | Handoff only at launch (no hosting, no uptime duty)                                                                                                                                                      | Section 6             |
| 8   | AI use                                 | DECIDED: disclose AI use; no sensitive personal data; paid API providers, which to the operator's knowledge do not train on inputs (re-confirm the current terms of each provider before the first sale) | Section 9             |

## 2. Scope and quote

- Work is limited to the written quote. The quote lists what is included, what is not, and the assumptions.
- The quote is valid for [30] days.
- Anything outside the quote is a change request, quoted separately before work starts.

## 3. Payment

- 50% before work begins, 50% before handover. [Taxes extra.]
- Work starts on receipt of the first payment. Handover happens after the final payment.
- Late invoices: [interest or pause of work after N days].

## 4. Delivery and acceptance

- Backshack sends screenshots and a product brief. The customer has [N] business days to confirm in writing that the scope is met, or to list what is missing.
- If the customer says nothing within [N] days, the work is treated as accepted. [Lawyer to confirm this default.]
- Warranty: for 30 days after final payment is received, Backshack will make a good-faith effort to resolve defects against the written scope. Everything else is a change request.

## 5. Ownership and licence

- On final payment, the customer owns the delivered code and documents, except for the reusable parts below.
- Reusable parts: generic components, templates and tools that Backshack had before or builds for general use stay Backshack's. The customer gets a perpetual, non-exclusive licence to use them as part of the delivered app. Backshack may use and license the same parts to others commercially.
- Open-source components keep their own licences. Backshack provides a list of them with the handover.
- The customer's own data, content and brand stay the customer's.
- Backshack may say it built an app of this type, without naming the customer or showing their data, unless the customer opts out in writing. [Decide.]
- Open question for the lawyer: ownership of AI-assisted code is not settled law everywhere. Ask what Backshack can promise, and how to word it.

## 6. After handover

- No hosting, monitoring or support is included at launch. The customer receives the working app, source on request, and the operating guides, and runs it themselves.
- Optional support plan, if offered: [scope, price, term].

## 7. Cancellation and refunds

- Before work starts: full refund of any payment.
- After work starts: the first payment is not refundable.
- The customer can stop at any point. Work done to that point is invoiced at [the staged percentage].

## 8. Warranty and liability

- Backshack will build to the written scope with reasonable skill and care.
- No other warranty, including that the app will be error-free or suit any purpose beyond the written scope. [Lawyer to check what can lawfully be excluded.]
- Once the customer signs off the app, Backshack has no further liability for it, other than the 30-day good-faith warranty above. Before sign-off, liability is capped at the fees paid for the project, with no liability for lost profits or indirect loss. [Lawyer to confirm both limits hold in Texas.]
- The customer is responsible for the lawfulness of their own data and use, and for checking results before relying on them for legal, tax, safety or financial decisions.

## 9. Data and confidentiality

- Backshack uses what the customer shares only to build and deliver the project, keeps it confidential, and deletes working copies at handover.
- The customer should not send sensitive personal data (health, government IDs, card numbers) unless the quote says it will be handled. Use sample or anonymised data instead.
- Some work uses AI tools. [State which categories of data may be sent to AI providers, and confirm the providers' retention terms before the first sale.]
- Privacy policy link on the form stays in place.

## 10. General

- Governing law: Texas. Venue: state and federal courts in Harris County, Texas. [Lawyer: add mediation first if wanted.]
- Changes to these terms apply to quotes issued after the change.
- Entire agreement: the quote plus these terms.

## 11. Short notice for the request form (consent line)

"By sending this request you agree that Backshack may contact you about it. Sending it is not an order. A project begins only when you accept a written quote."
(Plain language, no legal promise. The form already links the privacy policy.)

## 12. Where this text goes

- Terms page on the website (none exists today) linked from the Custom Build page and the quote.
- Quote template items 12 to 15 take their wording from sections 5, 8 and 9.
- Handoff checklist (04) item "Licence file decided and added" follows decision 1.
