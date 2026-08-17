# Product marketing context — V1

Read by the marketing skills in `.claude/skills/` before any marketing
task. **This file is a digest, not an authority.** The signed strategy is
`docs/MARKETING.md`; where the two disagree, this file is wrong and
should be re-synced from there. Aviation domain correctness comes from
the `aviation-expert` skill, which outranks every general marketing
pattern on terminology and regulatory claims.

## Product

**V1** — the brand is strictly the name; there is no descriptor. Books
for an independent contract pilot's business: trips, invoice lines, a
per-leg logbook draft, receipts, documents and expirations, reports, and
double-entry accounting, all off the trip record. SaaS, three tiers
(Solo / Pro / Business), $5 first month then regular price (from
`INTRO_FIRST_MONTH_LABEL` — never type the figure). Built by AMG
Aviation; "powered by AMG Aviation" appears in exactly two footers and
nowhere else.

## Audience (ICP)

The U.S.-based independent contract pilot running as a one-person 1099
business: day rates for several owners, management companies, and Part
135 operators. They invoice each client, keep a logbook, file
quarterlies. Today they run a logbook app plus a spreadsheet plus
QuickBooks or Wave, and they are personally the integration.
Explicitly not: flight departments, crew scheduling, operators buying
for pilots, hobby/student loggers.

## Position (2026-08-17, hold this angle)

**Money, not workflow.** V1 is the books for a flying business of one:
who owes you, what you earned, what you spent, the year-end packet your
CPA asks for. The category is books — pilots already pay for it — and
V1 is the version that knows what a trip, a leg, a day rate, and a
travel day are. The trip-native mechanic is proof, never headline.

- H1: "Flying is the job. This is the business."
- Tagline: "The books for your flying business." (footer, auth, metadata
  only — never in page body)
- Retired and not to be revived: "Log the trip once", "Stop entering the
  same trip three times", any duplicate-entry framing.

## Voice and constraints

- Belonging is proved by vocabulary and defaults (day types, PIC/SIC,
  rebill or deduct, tail numbers, ICAO identifiers) — never by boasts.
- `docs/MARKETING.md` §5 claim rules are absolute and survive every
  repositioning: two generated one organised; nothing beyond shipped
  code; no currency board on public pages; never imply the product
  decides legality to fly; no testimonials or invented statistics; no
  tax outcomes; figures interpolated from code constants, never typed.
- No urgency, scarcity, or countdown mechanics. No competitor named as
  bad at its own job.
- Distinctive assets, kept ruthlessly consistent: navy #0B1F33 ground,
  the V1 mark, Archivo display, Azeret Mono identifiers, tabular
  numerals on money.

## Sources of truth

| Fact | Where |
|---|---|
| Strategy, hierarchy, claim rules, budgets | `docs/MARKETING.md` |
| Brand strings | `lib/brand.ts` (only file that may say "V1"/"AMG") |
| Offer price | `INTRO_FIRST_MONTH_LABEL`, `lib/stripe/server.ts` |
| Public amounts | `TIER_PRICE_COPY`, `app/(marketing)/pricing/pricing-model.ts` |
| Feature claims / tier gating | `lib/entitlements.ts` (derived, never typed) |
| Domain correctness | `aviation-expert` skill |
