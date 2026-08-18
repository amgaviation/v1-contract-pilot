# Product Marketing Context

**Document version:** v1
**Last updated:** 2026-08-18

Grounded entirely in this repo as of the commit checked out on the date above. Every
claim below cites the file it came from; anything not traceable to a file is marked
**(inferred)**. Where this document and `docs/MARKETING.md` (the signed strategy for the
public site) disagree, `docs/MARKETING.md` wins for public-copy decisions — this document
is the broader context digest other marketing skills read. See **## Discrepancies** at the
bottom for every place the codebase disagrees with itself or with common assumptions about
this product.

---

## Product Overview

**One-liner** (verbatim, `docs/MARKETING.md` §1):
> V1 is the books for a flying business of one: who owes you, what you earned, what you
> spent, and the year-end packet your CPA asks for — every figure off the trips the pilot
> flies.

**What it does.** A SaaS product for an independent contract pilot to run their own 1099
business: clients, trips (legs + typed day records), estimates with convert-to-invoice,
invoices (sequential numbering, PDF, email delivery with manual reminders, share links with
view tracking, recurring schedules, Stripe Connect payment links), expenses (receipt OCR,
bank/card statement import with a review queue, mileage), a full logbook (manual entries,
trip-derived drafts, CSV import/export), per-client statements, documents with expiry
tracking, per-operator FAA Part 135 qualification records, three plan tiers with
entitlement gating, and a double-entry accounting layer (aviation-shaped chart of accounts,
journal with derived postings, bank reconciliation, balance sheet, cash flow). Reports: P&L,
quarterly estimated tax, sales tax, a year-end packet with 1099 reconciliation, a CPA travel
log, and cross-operator 135.267 flight-time totals (`README.md` "Status"). An FAA
currency/recency engine is built and ships dark behind `CURRENCY_ENGINE_ENABLED` — it is
never shown on any public page until a counsel review gate clears (`README.md`;
`app/(marketing)/pricing/pricing-model.ts` `PUBLIC_CLAIM_FILTER`; `docs/PRICING.md` §4).

**The core mechanic** ("two generated, one organised" — `docs/MARKETING.md` §5 rule 1;
`app/(marketing)/page.tsx` `RECORDS` array): a trip **generates** its invoice lines and a
per-leg logbook draft; receipts are **organised** against the trip by the pilot (scanned or
imported, then attached) — nothing in the product creates an expense from a trip. This rule
is enforced by comment and by a prior correction: `README.md` records that an earlier
version of the copy claimed a third generated output ("expense file all post from it") and
that this was false and has been corrected across the landing hero, the Trips feature card,
`/welcome`, and `app/layout.tsx`'s meta description.

**Product category.** Books/accounting software for a one-person aviation business —
deliberately positioned in the same category as QuickBooks/Wave, not as logbook software or
workflow/scheduling software: *"The category is books, not workflow software. Pilots
already pay for the category… V1 is the version of it that knows what a trip, a leg, a day
rate and a travel day are."* (`docs/MARKETING.md` §3).

**Product type.** Vertical SaaS, single-tenant-per-account (one `pilot.accounts` row per
customer), Next.js App Router + Supabase, with a signed-out marketing site
(`app/(marketing)/`) in front of an authenticated product gated by `requireAccount()`
(`README.md` "Layout").

**Business model.** Self-serve subscription, monthly or annual, card required at signup, no
free trial. The trial was removed in favor of an intro-price offer:
> "THE INTRO OFFER, which replaced the 7-day free trial… the FIRST month of a new monthly
> subscription is charged at $5, and the regular price applies from month two."
> (`lib/stripe/server.ts`, comment above `INTRO_FIRST_MONTH_CENTS`/`INTRO_FIRST_MONTH_LABEL`)

Annual plans get no intro price (charged the plain annual amount from day one; same file).
The pilot is merchant of record on their own Stripe Connect **Standard** account for client
payments, with **zero platform application fee** — "V1 never touches the pilot's funds…
there is no second revenue line in the payments flow" (`docs/PRICING.md` §6). The
subscription is the entire revenue model.

---

## Target Audience — the two sides of the product, as the codebase actually draws them

The task framing this document was requested under describes "aircraft operators and
contract pilots" as two prospect sides. The codebase supports only one of those as a
marketed, paying ICP. Both sides are documented below precisely as the evidence shows them
— see **Discrepancy 1** for the full reconciliation.

### Side A — the actual ICP: the independent contract pilot (who V1 markets to, signs up, and bills)

Verbatim, `docs/MARKETING.md` §2:
> "The U.S.-based independent contract pilot running as a one-person 1099 business — flying
> day rates for several owners, management companies and Part 135 operators, invoicing each
> of them, keeping a logbook, and filing the quarterlies on all of it. Today they run a
> logbook app *plus* a spreadsheet *plus* QuickBooks or Wave, and **they are personally the
> integration between the three.**"
>
> "Secondary: the same pilot who has grown to a second pilot, or who wants a bookkeeper in
> the books (Business)."
>
> "**Explicitly not:** flight departments, crew scheduling, operators buying for their
> pilots, or hobby/student logbook users."

Landing-page eyebrow (the page's own one-line audience statement, rendered above the H1):
"For independent contract pilots" (`app/(marketing)/page.tsx`).

Root meta description, the one sentence crawlable on every public page: "…Built for
independent contract pilots." (`app/layout.tsx`).

Schema confirms a single customer-facing account shape: `pilot.accounts.kind` is
constrained to `'solo'` or `'business'` — these describe the *size of the pilot's own
account* (one pilot vs. a small team with seats), not a pilot/operator split
(`supabase/migrations/20260802190437_pilot_schema_tenancy.sql`).

### Side B — aircraft operators, owners, management companies: touched by the product, not marketed to

Operators appear in the product in exactly three ways, none of them a marketed or
self-serve customer relationship:

1. **`pilot.clients` rows.** A free-text CRM record the pilot enters for each business that
   pays them — name, contact info, default day rate, per-diem, payment terms. No login, no
   account, no operator-side user at all
   (`supabase/migrations/20260805070000_phase3_clients_trips_expenses.sql`).
2. **`pilot.operator_qualifications` rows.** The pilot's own record of their currency and
   qualification status under a specific operator's Part 135 certificate (135.293/.297/.299
   checks) — again, data the pilot keeps *about* the operator, not an operator account
   (`supabase/migrations/20260807060000_operator_qualifications.sql`).
3. **Four unauthenticated, tokenized share-link surfaces** the pilot proactively sends to a
   client's accounts-payable desk: `/invoice/[token]`, `/estimate/[token]` (accept/decline),
   `/packet/[token]` (credential/insurance expiry packet), and `/vendor/[token]` (a
   per-client rollup). The vendor page's own header comment names the audience directly:
   > "The CLIENT-FACING vendor page — the per-client rollup **a 135 operator's AP desk**
   > wants instead of re-asking a pilot for the same information every few weeks."
   > (`app/vendor/[token]/page.tsx`)

   All four routes are explicitly built with "NO SESSION ASSUMED" — no signup, no account,
   no pricing is ever shown to the visitor on any of them.

There is no operator-facing marketing page, pricing, or signup flow anywhere in
`app/(marketing)`. Two further, independent pieces of internal research corroborate this is
by design, not an oversight: `docs/research/FLIGHTDEPTPRO-AUDIT.md` studies a real
operator-facing product (FlightDeptPro) and states plainly that it is *"the exact mirror
image of V1's user: FlightDeptPro's tenant is the company that hires contract pilots and
receives the CP-numbered invoices; V1's user is the contract pilot who sends them"* — i.e.
the operator side is a different product being researched for ideas, not a side of V1. And
`docs/RESEARCH-ROADMAP-2026-08-13.md`'s own build-filter criteria explicitly exclude
"marketplace/operator-scheduling" from V1's roadmap.

---

## Personas

Self-serve product with one signer/buyer/user per account — there is no multi-stakeholder
B2B buying committee in evidence (card-required checkout completed by the same person who
signs up; `app/(auth)/welcome/`). The table below is the pilot-side persona plus the
non-ICP client party, not a champion/economic-buyer split.

| Persona | Cares about | Challenge | Value V1 promises |
|---|---|---|---|
| Independent contract pilot (Solo — the core ICP) | Getting paid for every day flown; a real set of books behind a 1099 business | Runs a logbook app + a spreadsheet + QuickBooks/Wave and is "personally the integration" between them (`docs/MARKETING.md` §2) | Trip-native books: invoice lines and a logbook draft both come off the trip record (`docs/MARKETING.md` §3) |
| Growing pilot / small pilot business (Pro or Business tier) | Business depth: recurring billing, estimates, statements, bank import, real accounting, a bookkeeper or second-pilot seat | Outgrowing a one-person workflow; `pilot.account_members` supports `owner`/`member`/`bookkeeper` roles (`docs/PRICING.md` §3.2) | Pro adds "the business office"; Business adds "double-entry accounting with reconciliation and financial statements" (`lib/entitlements.ts` `TIER_DISPLAY`) |
| Operator AP desk / aircraft owner / management company (client of the pilot — **not** a V1 ICP) | Getting an invoice, estimate, or proof of current insurance/certs without re-asking the pilot every time | Re-requesting the same paperwork repeatedly (`app/vendor/[token]/page.tsx`, citing "research roadmap item #12") | A no-login, tokenized link to view, pay, or accept/decline — nothing to sign up for |

---

## Problems & Pain Points

**Core problem** (`docs/MARKETING.md` §2–§3): the pilot runs three disconnected tools — a
logbook app, a spreadsheet, and QuickBooks or Wave — and is personally the integration layer
between them, re-entering the same trip facts more than once.

**Why alternatives fall short** (`docs/PRICING.md` §2 competitor research; `docs/MARKETING.md`
§3):
- Generic accounting software (QuickBooks, Wave) has no concept of a trip, a leg, a day
  rate, or a travel day — a pilot adapts a generic invoicing tool to a flying business by
  hand.
- Aviation logbook/planning apps (ForeFlight, LogTen) do not do money at all — no invoicing,
  no expenses, no accounting.
- Nothing "purpose-built" existed for this persona beyond one direct competitor as of the
  2026-08-10/11 research pass: *"existing tools are either generic accounting or a logbook;
  ours starts from the pilot's business"* (`docs/PRICING.md` §2.7, citing
  `market-landscape.md`).

**What it costs them** (grounded, not invented): unbilled trip days and expenses that slip
through a manual process; unbilled-money tracking is explicitly named as the Overview
screen's lead module (`README.md`; `app/(marketing)/product-shot.tsx` alt text describing
the real Overview capture: *"'Owed to you' shows $11,634.00 of unbilled work across 3
completed trips…"* — illustrative data, not a real figure, per the same file's caption
rule).

**Emotional tension.** No direct emotional-language evidence exists in the repo (there are
no testimonials or customer interviews on file; `docs/MARKETING.md` claim rule 8 states
outright "There are no customers yet"). **(Inferred)** from the "personally the integration"
framing: the implied frustration is administrative — reconciling three tools by hand and the
risk of a flown day going unbilled or a receipt going unfiled.

**Note on framing:** an earlier version of the landing page argued this problem as
*duplicate data entry* ("Log the trip once," "Stop entering the same trip three times").
That argument was **deliberately retired 2026-08-17 at the owner's direction**:
> "The workflow wedge itself… what left is the claim that saved data entry is the reason to
> buy." (`docs/MARKETING.md` §7)

Current positioning leads with money (who owes you, what you earned) and treats the
trip-native mechanic as supporting proof, not the headline argument — see **Positioning**
below.

---

## Competitive Landscape

All figures below are as read and dated in `docs/PRICING.md` §2 (a competitor-research
memo, most reads dated 2026-08-10/11) — treat as directional, not live pricing.

**Direct competitor:**
- **CrewRoo** (`docs/PRICING.md` §2.6) — Essentials $9.99/mo (receipt scanning, expense
  reports, clients, invoicing), Pro $19.99/mo (adds trips with daily rates/work days, flight
  legs, RON nights, mileage, receipts attached to trip days). Called "the closest direct
  comparable." As of that read, it lacked logbook import (ForeFlight/LogTen), a currency
  engine, per-operator 135 check tracking, client statements, estimates, bank-statement
  import, and full-account export — the delta V1's higher price is meant to be justified by.

**Secondary (different solution, same problem) — generic small-business accounting:**
- **QuickBooks** (`docs/PRICING.md` §2.2) — Solopreneur/"Lite" $20/mo, Simple Start $38/mo,
  Essentials $85/mo (3 users). Gates on users, accountant access, and report depth — not on
  record-keeping itself.
- **Wave** (`docs/PRICING.md` §2.1) — Starter free, Pro $19/mo. Gates on automation/bank
  connectivity, not on the customer's own records.

**Indirect / adjacent — explicitly not positioned against:**
- **ForeFlight** and **LogTen** (`docs/PRICING.md` §2.3–2.4) — the pilot's existing
  planning/logbook tools. Stated explicitly: *"ForeFlight is not a competitor and we never
  position against it."* V1 imports their logbook exports rather than replacing them (landing
  FAQ, `app/(marketing)/page.tsx`: *"Import a ForeFlight or LogTen Pro export, or any CSV
  through the column mapper, and carry on from there."*).

**Structural pricing analogues only (not competitors in this market):**
- Jobber, Housecall Pro, ServiceTitan — vertical SaaS for one-person licensed trades, used
  only to benchmark how a solo→pro→business ladder is typically split (`docs/PRICING.md`
  §2.5).

**Mirror-image research subject — not a competitor at all:**
- **FlightDeptPro**, audited in depth in `docs/research/FLIGHTDEPTPRO-AUDIT.md` and
  `docs/research/FLIGHTDEPTPRO-INSPIRATION.md`: ops/money/compliance software **for flight
  departments and aircraft-management companies** (i.e., built for the operator side of the
  exact relationship V1's pilot users are in). Explicitly logged as feature-inspiration
  research, not a competitor to position against.

**Standing public-copy rule** (`docs/MARKETING.md` claim rule 7): *"The comparison is
workflow only. No competitor pricing, and no claim that a named tool is bad at its own job."*
None of the above appears by name on any live marketing page today — the pricing research is
internal.

---

## Differentiation

**Key differentiators** (grounded in code/schema, not adjectives):
- **Trip-native generation.** Invoice lines and a per-leg logbook draft both mechanically
  generate off one trip's legs and day records ("two generated, one organised" —
  `docs/MARKETING.md` rule 1; `app/(marketing)/page.tsx` `RECORDS`).
- **Aviation-shaped vocabulary as product surface, not marketing decoration**: day types
  (flight/travel/standby/off), PIC and SIC tracked separately, rebill-vs-deduct expense
  tagging, per-operator 135.293/.297/.299 qualification tracking
  (`docs/MARKETING.md` §3; `lib/entitlements.ts`;
  `supabase/migrations/20260807060000_operator_qualifications.sql`).
- **Safety/legal records are never a paid-tier upsell.** Logbook, documents wallet, the
  currency engine (once public), and 135 qualification tracking are all `minTier: "solo"` in
  `lib/entitlements.ts`. Stated principle: *"Safety and compliance record-keeping is never
  the upsell… A pricing page that reads 'pay more to know if you're current' ransoms
  safety."* (`docs/PRICING.md` §4).
- **Full data export on every tier, including Solo** — called out as "the one upsell this
  product refuses" (`docs/MARKETING.md` rule 6; `lib/entitlements.ts` comment on
  `account_export`, deliberately `minTier: "solo"`).
- **Zero platform take-rate.** The pilot is merchant of record on their own Stripe Connect
  Standard account; V1 charges no application fee on client payments (`docs/PRICING.md` §6).

**Why customers would choose V1 over alternatives** (`docs/PRICING.md` §2.8): a full year of
V1's most expensive published tier costs less than half of one flying day's rate at the
low end of researched day-rate figures. V1 is framed as credibly replacing the QuickBooks
line and the LogTen line in a pilot's toolstack — "never the ForeFlight line."

---

## Objections

Built directly from the objections V1 has chosen to answer on its own public pages — these
are the objections the product owner judged real enough to pre-empt in copy.

| Objection | V1's public answer | Source |
|---|---|---|
| "I already keep a logbook — do I have to start over?" | No. Import a ForeFlight or LogTen Pro export, or any CSV through the column mapper. | `app/(marketing)/page.tsx` FAQ |
| "Does it decide whether I'm current or legal to fly?" | No, and it never will present itself that way. It tracks the expiry dates you entered off your own documents; currency and airworthiness decisions stay yours. | `app/(marketing)/page.tsx` FAQ; `CURRENCY_DISCLAIMER` in `lib/brand.ts` |
| "What happens if I cancel or downgrade?" | Nothing is deleted. Downgrading stops new work on higher-tier screens (existing records stay visible/exportable). Cancelling makes the account read-only, with export still working. | `app/(marketing)/page.tsx` FAQ; `app/(marketing)/pricing/page.tsx` `buildFaq()` |
| "What does the first month cost?" | $5 on any monthly plan; regular price from month two. Annual bills the plain annual price from day one. Cancel in month one and nothing more is charged. | `pricing/page.tsx` `buildFaq()`; `INTRO_FIRST_MONTH_LABEL` |
| "What happens if I put my account on hold?" | Up to two months of paused billing, read-only. Past that window, commercial records (clients, trips, invoices, estimates, expenses, ledger) are purged, but logbook, documents, aircraft, and operator qualifications are kept unconditionally. | `pricing/page.tsx` `buildFaq()`; `supabase/migrations/20260818200000_monthly_hold.sql` |
| "Can I get my data out?" | Yes, on every plan — one CSV per record type, the full logbook, every report, and every uploaded file. | `pricing/page.tsx` `buildFaq()` |

**Anti-persona** (verbatim, `docs/MARKETING.md` §2): "flight departments, crew scheduling,
operators buying for their pilots, or hobby/student logbook users."

---

## Switching Dynamics (JTBD Four Forces)

- **Push:** running a logbook app plus a spreadsheet plus QuickBooks/Wave, and being
  "personally the integration" between the three (`docs/MARKETING.md` §2).
- **Pull:** the trip-native mechanic (two generated, one organised) plus a real double-entry
  books layer that natively models a trip, a leg, a day rate, and a travel day
  (`docs/MARKETING.md` §3).
- **Habit (inferred):** sunk setup already in QuickBooks/Wave and an existing logbook app —
  historical clients, rates, and logbook entries already live there. Not stated directly,
  but implied by the FAQ's own habit-breaking answer: *"I already keep a logbook. Do I have
  to start over? No."* (`app/(marketing)/page.tsx` FAQ), which exists specifically to remove
  this friction via ForeFlight/LogTen/CSV import.
- **Anxiety:** addressed head-on in copy and in absolute claim rules — fear that the product
  oversteps into deciding legal-to-fly status (rule 4 / `CURRENCY_DISCLAIMER`), and fear of
  losing legal records to a cancelled card: *"A pilot's logbook is a legal record; a lapsed
  card will never be the thing that destroys one."* (`app/(marketing)/page.tsx` FAQ;
  `pricing/page.tsx` FAQ, near-identical wording in both).

---

## Customer Language

**No verbatim customer quotes exist in this repo.** The product is pre-launch, and this is
a standing, absolute rule, not a gap to fill later:
> "No testimonials, no invented statistics, no FAA-approval or compliance language, no
> founder-credibility boast. There are no customers yet." (`docs/MARKETING.md` claim rule 8)

Do not source testimonial-style language for this product from anywhere other than a real,
future customer interview.

**Product/domain vocabulary used deliberately to signal belonging** (not customer quotes —
the copy's own vocabulary choices, per `docs/MARKETING.md` §3's "Voice and constraints"):
"day records typed flight, travel, standby or off" · "PIC and SIC kept distinct" · "tag it
rebill or deduct."

**Retired phrasing — do not revive** (`docs/MARKETING.md` §7, cut 2026-08-17 at the owner's
direction): "Log the trip once," "Stop entering the same trip three times," and any
duplicate-entry framing.

**Absolutely prohibited phrasing** (claim rule 10 — a tax-outcome claim rule that "exists
because the 2026-08 rewrite introduced exactly that sentence while replacing a correct
one"): "lowers your taxable income," "is deductible," "saves you $X at tax time." The only
allowed framing is that something "lands in the year's deductible total" (describing the
software's bookkeeping action, not a tax outcome).

**Glossary** (grounded in schema and product code):

| Term | Meaning | Source |
|---|---|---|
| Trip | The core record: a client, aircraft, legs, and day records (flight/travel/standby/off) | `app/(marketing)/page.tsx`; phase3/phase9 migrations |
| Day type | Flight, travel, standby, or off — how one day of a trip is classified for billing | `lib/entitlements.ts`; `day_types` table |
| Rebill / deduct | Expense-treatment tag: bill the cost to the client, or keep it as the pilot's own deductible record | `app/(app)/expenses/actions.ts`; `docs/MARKETING.md` rule 10 |
| Draft (logbook) | A per-leg logbook entry generated from a completed trip leg, held for the pilot to review before it posts | `app/(marketing)/page.tsx` `RECORDS`; `README.md` |
| Currency board | The FAA recency/currency tracking screen — built, shipped dark behind `CURRENCY_ENGINE_ENABLED`; absent from every public page until a counsel gate clears | `README.md`; `PUBLIC_CLAIM_FILTER` in `pricing-model.ts` |
| Operator qualification | The pilot's own 135.293/.297/.299 currency record under one specific operator's certificate | `supabase/migrations/20260807060000_operator_qualifications.sql` |
| Vendor page | The unauthenticated, tokenized per-client rollup an operator's AP desk can open with no login | `app/vendor/[token]/page.tsx` |
| Hold | A billing pause (up to 2 months) that puts an account read-only without deleting anything; commercial records purge only if the window lapses unresumed | `supabase/migrations/20260818200000_monthly_hold.sql`; `pricing/page.tsx` FAQ |

---

## Brand Voice

**Tone:** peer-to-peer, no luxury-jet clichés, no compliance-authority claims — stated
directly as a copy rule attached to the tier blurbs: *"Copy rules: peer-to-peer, no
luxury-jet clichés, no compliance claims."* (`lib/entitlements.ts`, comment above
`TIER_DISPLAY`).

**Style:** direct, short, belonging proved through correct vocabulary and defaults rather
than adjectives or boasts:
> "Belonging is still proved by vocabulary and defaults… never by an unsigned boast that
> pilots built it." (`docs/MARKETING.md` §3)

**Personality (inferred** from the claim-rule discipline observed throughout
`docs/MARKETING.md` §5 — no urgency or scarcity mechanics, no testimonials, no invented
statistics, no named-competitor disparagement): precise, restrained, quietly
domain-fluent, trust-first.

**Visual identity** (grounded in brand/theme source files): navy `#0B1F33` ground (see
`app/globals.css` brand constants), the V1 wordmark, Archivo for display type, Azeret Mono
for identifiers, tabular numerals on money figures. Brand strings are single-sourced —
*"No component may render a literal 'V1' or 'AMG' string outside this file"* (`lib/brand.ts`
header comment). `BRAND.attribution` ("powered by AMG Aviation") appears in exactly two
places, the marketing footer and the in-app footer, nowhere else
(`docs/MARKETING.md` rule 9; `app/(marketing)/site-footer.tsx`).

---

## Proof Points

**Metrics:** none. No usage counts, customer counts, or performance benchmarks appear
anywhere in this product's public-facing copy — consistent with claim rule 8's explicit ban
on invented statistics. **Do not fabricate metrics for this product.**

**Customers / logos:** none. Pre-launch (`docs/MARKETING.md` claim rule 8: "There are no
customers yet").

**Testimonials:** none, and permanently prohibited while that remains true (same rule).

**Value themes with grounded (non-metric) supporting evidence:**

| Theme | Grounded proof | Source |
|---|---|---|
| Trip-native automation | Invoice lines and a per-leg logbook draft mechanically generate off one trip's legs/days | `app/(marketing)/page.tsx` `RECORDS`; `docs/MARKETING.md` rule 1 |
| No take-rate on client payments | Stripe Connect Standard, explicitly zero application fee | `docs/PRICING.md` §6 |
| Nothing deleted on downgrade, cancel, or hold | Enforced at the database level and asserted by `scripts/account-lifecycle-db-verify.mjs` — not just promised in copy | `docs/PRICING.md` §5; `README.md` |
| Full export on every tier, including Solo | `account_export` is `minTier: "solo"` in the entitlements table the product itself gates on | `lib/entitlements.ts` |
| Public claims are code-derived, not hand-typed | Every landing-page/pricing-page feature line and tier tag is generated from `FEATURES`/`lib/entitlements.ts`, so a claim cannot outrun shipped code | `app/(marketing)/page.tsx` `specGroups()`; `pricing-model.ts` |
| Verified guarantees behind the FAQ's promises | 526 unit assertions, an RLS tenancy sweep, and dedicated verify scripts for billing, trip generation, customisation, and reminders | `README.md` "Verification" |

---

## Goals

**Business goal (inferred** from the pricing structure and `docs/PRICING.md`): convert
self-serve subscribers across three tiers — Solo $29/mo, Pro $49/mo, Business $39/seat/mo
(2-seat minimum) — displacing a pilot's QuickBooks/Wave-plus-LogTen spend.

**Key conversion action:** complete signup and reach Stripe checkout at `/welcome`. Every
marketing CTA on the site terminates at `/signup`, which flows to `/welcome` for plan
selection and payment (`app/(marketing)/page.tsx`; `app/(marketing)/site-header.tsx`;
`app/(marketing)/site-footer.tsx`; `app/(marketing)/pricing/page.tsx`;
`app/(auth)/welcome/page.tsx`).

**Current metrics:** none in the repo. The product is pre-launch by its own claim rules
(`docs/MARKETING.md` claim rule 8). The signup blocker this section used to name is
RESOLVED as of 2026-08-18: mail sends from the verified `mail.amgaviationgroup.com`, and a
real password-recovery email through Supabase Auth's SMTP relay proved the path. See
Discrepancy 3 below, which is kept as a closed record rather than deleted.

---

## Funnel entry points — every CTA destination on the marketing surface

| Location | CTA text (rendered) | Destination | File |
|---|---|---|---|
| Landing hero | "Try V1 — $5 first month" | `/signup` | `app/(marketing)/page.tsx` |
| Landing hero | "View plans" | `/pricing` | `app/(marketing)/page.tsx` |
| Landing "spec block" | "Compare all features" | `/pricing` | `app/(marketing)/page.tsx` |
| Landing close band | "Try V1 — $5 first month" | `/signup` | `app/(marketing)/page.tsx` |
| Site header (all 4 marketing pages) | "How it works" | `/#how-it-works` (anchor into landing section 2) | `app/(marketing)/site-header.tsx` |
| Site header | "Pricing" | `/pricing` | `site-header.tsx` |
| Site header | "Log in" | `/login` | `site-header.tsx` |
| Site header | "Get started" | `/signup` | `site-header.tsx` |
| Footer — Product column | "How it works" / "Pricing" | `/#how-it-works`, `/pricing` | `site-footer.tsx` |
| Footer — Account column | "Log in" / "Get started" | `/login`, `/signup` | `site-footer.tsx` |
| Footer — Legal column | "Terms of Service" / "Privacy Policy" | `/terms`, `/privacy` (both `noindex` placeholders pending counsel) | `site-footer.tsx`; `terms/page.tsx`; `privacy/page.tsx` |
| Pricing page — all 3 tier cards | "Start for $5" | `/signup` | `app/(marketing)/pricing/page.tsx` |
| Pricing page — closing band | "Start with your next trip." | `/signup` | `pricing/page.tsx` |

**Post-signup path** (not itself a marketing CTA, but where every entry above eventually
lands): `/signup` → email confirmation at `/check-email` → `/welcome` (plan picker + Stripe
checkout, `$5` intro applied on monthly plans) → the dashboard, or the setup wizard at
`/(onboarding)/onboarding` (`README.md`; `app/(auth)/welcome/page.tsx`;
`app/(onboarding)/onboarding/page.tsx`).

**Confirmed absent:** no demo-booking link, no contact form, no newsletter signup, and no
social links anywhere on the marketing surface (verified by a full read of
`site-header.tsx`, `site-footer.tsx`, `page.tsx`, and `pricing/page.tsx`).

---

## Discrepancies

Every place marketing copy, product code, and internal documentation disagree with each
other, or with the framing this document was requested under. Downstream review agents
should treat this section as the punch list.

1. **ICP framing mismatch — this document's own request brief vs. the codebase.** This
   audit was requested on the premise that V1's prospects are "aircraft operators and
   contract pilots" — a two-sided framing. The codebase does not support a second,
   operator-facing ICP: `pilot.accounts.kind` has exactly two values, `'solo'` and
   `'business'`, both describing the *pilot's own* account size, not an operator/pilot split
   (`supabase/migrations/20260802190437_pilot_schema_tenancy.sql`). There is no operator
   signup flow, no operator pricing, and no operator-facing page anywhere under
   `app/(marketing)`. Operators/owners/management companies appear only as (a)
   `pilot.clients` rows the pilot types in about their own customers
   (`supabase/migrations/20260805070000_phase3_clients_trips_expenses.sql`), and (b)
   unauthenticated recipients of tokenized links the pilot sends them (`/invoice/[token]`,
   `/estimate/[token]`, `/packet/[token]`, `/vendor/[token]`). `docs/MARKETING.md` §2 states
   outright that "operators buying for their pilots" are "explicitly not" the target.
   `docs/research/FLIGHTDEPTPRO-AUDIT.md` independently corroborates this by describing an
   actual operator-facing product (FlightDeptPro) as *"the exact mirror image of V1's
   user"* — research into a different product's audience, not evidence of a second V1
   audience — and `docs/RESEARCH-ROADMAP-2026-08-13.md`'s build filters explicitly exclude
   "operator-scheduling" from V1's own roadmap. **Treat V1 as single-sided (contract pilots
   only)** for all downstream marketing work unless the product owner has since ordered a
   second, operator-facing product surface that this repo does not yet reflect.

2. **A code comment claims no self-serve cancellation exists; two shipped features and the
   public pricing FAQ contradict it.** `app/(marketing)/terms/page.tsx`'s comment states
   "there is no self-serve cancellation path" as justification for not claiming "cancel
   anytime" ahead of real Terms of Service. This is contradicted by shipped code:
   `app/(app)/settings/billing/actions.ts` implements a real, user-facing
   cancel-at-period-end/resume toggle, and `app/(app)/settings/account-actions.ts`
   implements a real, user-facing immediate `stripe.subscriptions.cancel()` on account
   deactivation. The public pricing page's own FAQ ("What happens if I downgrade or
   cancel?", "What happens if I put my account on hold?" — `pricing/page.tsx`
   `buildFaq()`) describes cancelling as a normal, self-serve action with no
   contact-support caveat. The Terms placeholder's comment reads as stale — written before,
   or without accounting for, those shipped features.

3. **RESOLVED 2026-08-18 — the signup mail blocker.** This entry recorded that every
   marketing CTA terminated at a `/signup` whose confirmation email failed with
   `550 — the sending domain is not verified`, so no new pilot could complete signup and
   invoice delivery was blocked with it. Both are fixed: mail sends from
   `mail.amgaviationgroup.com` as `v1-support@mail.amgaviationgroup.com`, verified with DKIM
   and SPF, with `INVOICE_FROM_EMAIL` and the Supabase Auth SMTP sender both pointed at it.
   Kept here rather than deleted because it is the reason several other documents in this repo
   still carry "the funnel may not convert" caveats — those are now stale, and this is where a
   reader finds out. The funnel converts as documented.

   One standing configuration fact survives the fix and is worth knowing: two systems send
   mail and only one reads this repo's config. Product mail uses `INVOICE_FROM_EMAIL`;
   confirmation and recovery come from Supabase Auth's own SMTP relay, set in the Supabase
   dashboard. Setting one and not the other leaves signup broken while invoices work.

4. **`docs/PRICING.md`'s trial-length section is superseded by shipped code.** §5 of
   `docs/PRICING.md` recommends a 14-day card-required trial and frames trial length as
   still open ("owner's decision 3"). Shipped code has no free-trial concept at all:
   `lib/stripe/server.ts`'s comment on `INTRO_FIRST_MONTH_CENTS`/`INTRO_FIRST_MONTH_LABEL`
   states the $5-first-month offer "replaced the 7-day free trial," and no marketing or auth
   copy mentions a trial anywhere. `docs/PRICING.md` is a dated proposal memo, not
   shipped-copy documentation, so this is a documentation-lag issue rather than a live
   public-copy defect — but a reader who takes `docs/PRICING.md` §5 at face value without
   checking `lib/stripe/server.ts` would describe the billing model incorrectly.

5. **The pre-existing `.agents/product-marketing.md` this document replaces already had the
   ICP right.** Before this rewrite, the file in place at this path correctly scoped the ICP
   to contract pilots only and explicitly excluded operators — consistent with what this
   independent audit of the app and schema found. Noted so it's clear Discrepancy 1
   originates in this task's request framing, not in prior drift of this context file.

---

## Changelog

*Newest first. One line per revision: what changed and why.*

- v1 (2026-08-18) — Full rewrite grounded directly in the codebase (marketing pages, README,
  docs/, Supabase migrations, Stripe/entitlements code), superseding the prior informal
  digest at this path. Established: single-sided ICP is contract pilots only, with aircraft
  operators as a touched-but-not-marketed client party (flagged as Discrepancy 1 against this
  task's own "two ICP sides" framing); full pricing/tier/feature grounding; verbatim
  positioning quotes with file citations; complete marketing-CTA funnel map; competitor
  landscape from `docs/PRICING.md`; five-item Discrepancies list including a stale
  no-self-serve-cancellation code comment and a live signup blocker every funnel CTA depends
  on.
