# Incubator income ideas (internal, never released)

The Incubator stays internal. Money comes from selling what it builds, not the tool itself.

## Chosen routes

1. Backshack niche subscription apps, built with the Incubator as a factory (offering page planned in the "Niche Tools" session).
2. Staff-run productized builds: "spreadsheet to real app" (setup fee plus monthly hosting and support) and a per-repo audit/adopt service.

## Niche app candidates

| Candidate                                  | Pricing unit                          | Validation                     |
| ------------------------------------------ | ------------------------------------- | ------------------------------ |
| Food safety and temperature logs           | per location                          | show five local kitchens       |
| Daily fleet pre- and post-trip inspections | per vehicle                           |                                |
| Property move-in / move-out inspections    | per door                              |                                |
| Quote follow-up for trades                 | monthly or share of recovered revenue | pairs with the estimating tool |

Not a candidate: subcontractor compliance tracker (already live as The Gauge).

Name ideas, unchecked against the catalog, trademarks or domains: Probe (food safety), Bevel or Scribe (property), Torque (fleet).

## Parked ideas

- **Compliance CI GitHub Action**: guard toolkit per repo per month.
- **White-label scaffolding for agencies.**
- **Stack-pack marketplace**: user not sold.
- **Hosted self-serve launcher**: dropped, per-run model cost.

## Caveats

Demand is unproven. Each customer run costs model tokens. The Incubator runs only on the dev PC.

## Shortlist and validation (2026-10-20)

**Pick: food safety and temperature logs (Probe).** Clearest per-location price, the buyer feels audit pain, and validation is cheap: show a working mock to five local kitchens and ask for a paid pilot. Stop if fewer than two want one.

- Fleet inspections is second (per-vehicle price, but needs offline photo capture).
- Property inspections is third (heavier photo and report output).
- Quote follow-up is last until it can pair with the estimating tool.

**Naming check:** no existing catalog tool uses Probe, Bevel, Scribe or Torque (checked `src/Tools` and generator config; the only hits are the ordinary word "probe" in tests). Trademarks and domains are still unchecked.
