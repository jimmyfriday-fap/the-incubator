# Quote template (Custom Build)

INTERNAL TEMPLATE. All amounts and legal wording below are PLACEHOLDERS for the operator and a lawyer to set. Do not send a quote containing an unfilled [bracket].

Quotes and both invoices are made by hand in the Square dashboard. There is no automation.

## Quote document (send as PDF or email)

**Quote for [Company]. Prepared [date]. Valid for 30 days.**

1. **What we will build.** [One paragraph in the customer's words from the call.]
2. **Features included.** [3 to 10 bullets, each a testable behaviour. Use the same list as `intent.coreFeatures`.]
3. **Users and roles.** [Roles and approximate number of users.]
4. **Reports and exports.** [List.]
5. **Not included.** [Anything discussed and declined: integrations, mobile app, hosting, data migration beyond one import, training, etc.]
6. **Assumptions.** [For example: we receive a sample file and answers to questions within X business days; one named contact approves.]
7. **What you receive.** The working app for the scope above; a feature document; operating guides; a markdown inventory; the source repository on request.
8. **Timeline.** Build starts after the first payment. Screenshots and product brief by [date or N business days]. Handover within [N] business days of final payment.
9. **Price.** [$ total fixed]. 50% ([$]) due to begin. 50% ([$]) due before handover. [Taxes if any.]
10. **Changes.** Changes to the scope above are quoted separately before work on them starts. [Hourly rate or fixed change request fee.]
11. **Support after handover.** [None included / optional monthly plan at $ per month covering X.]
12. **Ownership and licence.** [PLACEHOLDER: who owns the delivered code, any licence to Backshack for reusable components, third-party open source notice.]
13. **Acceptance.** You review the screenshots and brief and tell us in writing within [N] days whether the scope is met or what is missing. Final payment is due on acceptance.
14. **Warranty, liability, refunds, confidentiality.** [PLACEHOLDERS: lawyer to supply.]
15. **Data.** We use data you share only to build this project and delete working copies at handover. [Lawyer to confirm.]

Acceptance line: "Agreed by [name], [title], [date]."

## Price bands for the operator to set (not published)

Decide after two pilot builds (see 03). Suggested structure only:

| Band                    | Typical scope                              | Price | Notes                        |
| ----------------------- | ------------------------------------------ | ----- | ---------------------------- |
| Small                   | 1 role set, 3 to 4 features, import/export | [$]   |                              |
| Standard                | 3 roles, 5 to 7 features, reports, email   | [$]   |                              |
| Larger                  | 8 to 10 features, one integration          | [$]   |                              |
| Repo audit              | per repository                             | [$]   | gap report plus pull request |
| Support plan (optional) | monthly                                    | [$]   | fixes and small changes only |

## Cost floor check before quoting

Estimate: model cost of discovery and the coding handoff (agent runs capped at about $10 and 45 minutes per session by default; real totals are unmeasured), plus your hours for the call, stand-up, screenshots, briefs and handover, plus payment fees. Price must clear this with margin. Record actuals after each job to improve the bands.

## Status tracking

Admin screen "Build requests": New, Call booked, Quoted, 50% paid, Building, Brief sent, Paid in full, Delivered, Not proceeding.
