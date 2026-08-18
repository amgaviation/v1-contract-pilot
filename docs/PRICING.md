# Pricing — three-tier proposal for Tony to confirm

**Status: PROPOSAL. The tier *structure* (three tiers, more features per tier) is the
owner's order of 2026-08-11; the numbers in it are not signed.** This document supersedes
the 2026-08-10 two-plan memo (solo flat + deferred per-seat business): the owner has since
ordered three plan tiers, and the builders are wiring `STRIPE_PRICE_ID_SOLO` /
`STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_BUSINESS` in this session. This document proposes
the numbers and the feature split and shows the work. The owner picks the numbers; an agent
does not get to price the product.

All competitor figures below were read from the live vendor page on the date stamped
against them. Where a number could not be verified from a live first-party source it is
marked **[UNVERIFIED]** and its origin is named. A missing number in this document is
deliberate.

---

## 1. What is wired today, so this is a change-or-confirm and not a blank page

`docs/BILLING.md` documents **$29/month solo, card-required 7-day trial**, wired to
`STRIPE_PRICE_ID_SOLO` and read in `lib/stripe/server.ts`. The landing, pricing, and
welcome pages print $29 (`PRICE_LABEL`, three hand-synced copies). Under this proposal
**that Price object and that cohort survive untouched**: Solo stays $29, and the three-tier
ladder is *additive* — two new Price objects (`_PRO`, `_BUSINESS`), no migration of anyone,
no re-papering of the copy that already charges money (`docs/LAUNCH-GATES.md` G2 stays
satisfied for Solo). That is the single biggest operational argument for the numbers below,
and it is stated up front so it is weighed as a feature of the proposal, not discovered as
a convenience later.

---

## 2. Live competitor research

Everything in this section was re-read or newly read on **2026-08-11** except where an
older stamp is shown and stated to be still-standing.

### 2.1 Wave — the horizontal free-tier anchor, and what actually gates its tiers

Read from <https://www.waveapps.com/pricing> on 2026-08-11; identical to the 2026-08-10
read.

| Item | Price |
|---|---|
| Starter | **$0/month** |
| Pro | **$19/month** or **$190/year** (promo $9.50/mo first 3 months) |
| Receipts add-on | **$8/mo** on Pro ($72/yr), **$11/mo** on Starter |
| Payroll add-on | from **$25/mo** (Starter), from **$40/mo** (Pro) |
| Wave Advisors | from **$149/mo** |

What gates Starter → Pro (the split itself, read from the live comparison table):

- **Starter keeps the records free**: unlimited invoices, unlimited estimates, unlimited
  bookkeeping records, manual transaction entry, link/PDF invoice sending.
- **Pro sells automation and connection**: auto-import bank transactions, auto-merge and
  categorization, automated late-payment reminders (3/7/14 days), branded invoices,
  deposit collection, multiple users with role permissions, waived per-transaction fee on
  the first 10 card payments/month, live chat support.

The lesson Wave teaches is structural, not numeric: **the free/paid line is drawn at
automation and connectivity, never at the customer's own records.** We adopt the same line
between our tiers (§4) — we just do not adopt the $0.

Payments rails (unchanged from 2026-08-10): Wave cards 2.9% + $0.60, ACH 1% ($1 min). Not
a pricing input for us — under decision #8 the pilot is merchant of record on Stripe
Connect Standard with **no application fee**, paying Stripe's published 2.9% + 30¢ cards /
0.8% ACH capped at $5.00 (<https://stripe.com/pricing>, read 2026-08-10). A straight win
on ACH for any four-figure invoice; a talking point, not revenue.

### 2.2 QuickBooks — the ladder the buyer already understands

Read from <https://quickbooks.intuit.com/pricing/> and
<https://quickbooks.intuit.com/solopreneur/> on 2026-08-11. The Solopreneur page now
labels the plan "Lite"; same $20 price. The 90%-off-for-3-months promotion is still
running on every tier.

| Plan | List | What it adds over the tier below (live page) |
|---|---|---|
| Solopreneur ("Lite") | **$20/mo** | 1 user, no accountant access; unlimited invoices, receipts, mileage; Schedule-C posture |
| Simple Start | **$38/mo** | Accountant access, general reports, cash-flow history, recurring payments, 1 sales channel |
| Essentials | **$85/mo** | **3 users**, enhanced reports, bill management, employee time on invoices |
| Plus | $140/mo | 5 users, inventory, projects, budgets (context only) |
| Advanced | $340/mo | 25 users, workflow automation (context only) |

The three numbers that bound our ladder are **$20, $38, and $85**: Solopreneur is what a
contract pilot is told to buy, Simple Start is where they land once they want real
invoices and an accountant in the books, and Essentials is the price of the first
multi-user tier. Note what Intuit gates upward: **users, accountant access, and report
depth** — not the ability to keep records.

### 2.3 LogTen — the aviation ladder that refuses to paywall safety

Read from <https://logten.com/pricing/> on 2026-08-11.

| Tier | Price | Gate |
|---|---|---|
| Basic | **$79.99/yr** | Full logging, analysis, reporting, backup |
| Pro | **$129.99/yr** | Adds Mac app, airline schedule import, batch editing, advanced smart filters, custom reports |

The load-bearing observation: **"Currency, Duty & Rest Tracking" and the full report set
appear in *both* tiers on the live comparison table.** LogTen's ladder is workflow depth
(platforms, import, batch tooling) — it does not make a pilot pay more to know whether
they are current. That is the convention in this exact market, and §4 adopts it as a
stated principle. First 50 flight hours free; volume pricing above 5 pilots.
**[UNVERIFIED]** whether a monthly App Store purchase path exists — not shown on the page.

### 2.4 ForeFlight — what this customer already pays without flinching

Read from <https://foreflight.com/pricing/> on 2026-08-11; same names and figures as the
2026-08-10 read.

| Plan | Price | Gate |
|---|---|---|
| Starter | **$130/yr** | Planning, charts, weather, **digital logbook** |
| Essential | **$260/yr** | Geo-referenced approaches, synthetic vision, hazard advisor |
| Premium | **$390/yr** | Performance profiles, autorouting, takeoff/landing performance, JetFuelX |
| Business Pro | **$280/yr/pilot licence**, min 2 licences | — |
| Business Performance | **$400/yr/pilot licence**, min 2 licences | — |

Carried caveat from 2026-08-10: the page states plan names were recently updated with
"prices and features … exactly the same"; older third-party summaries circulate different
names at slightly different figures. Treat only the live page as verified. ForeFlight is
**not a competitor** and we never position against it. It contributes three things: proof
this persona pays $260–$390/yr for professional software; the **logbook sits in every
tier including the cheapest** (record-keeping is never the upsell); and the **two-licence
minimum on business plans** is normal in this market.

### 2.5 Vertical SaaS for one-person trades — how solo → pro → business is actually split

The closest structural analogues to "software that runs a one-person licensed trade" are
the home-services platforms. Read 2026-08-11.

**Jobber** (<https://www.getjobber.com/pricing/>, annual-prepaid figures; monthly ~20–40%
higher):

| Plan | 1 user | 5 users | Gate |
|---|---|---|---|
| Core | **$24/mo** | — | Scheduling, quoting, invoicing, payments, basic reporting |
| Connect | **$80/mo** | $120/mo | **Automations** (client reminders, auto-payments), time/expense tracking, **QuickBooks sync** |
| Grow | **$112/mo** | $160/mo | Job costing, workflow automations, SMS, quote upsells |
| Plus | — | $320/mo | Marketing suite, AI receptionist, premium support |

**Housecall Pro** (<https://www.housecallpro.com/pricing/>, annual figures; monthly in
parens):

| Plan | Price | Gate |
|---|---|---|
| Basic | **$59/mo** ($79) | Booking, invoicing, payments, estimates, scheduling |
| Essentials | **$149/mo** ($189) | **QuickBooks sync**, checklist automations, photo reports, GPS, commissions |
| MAX | **$299/mo** ($329) | Recurring service plans, route optimization, API access, dedicated onboarding |

**ServiceTitan** — no published pricing anywhere; sales-demo gated. Third-party 2026
write-ups (projul.com, tooleduppro.com, procured.us and others, searched 2026-08-11)
converge on three tiers (Starter / Essentials / The Works) at roughly **$245–$500 per
technician per month** plus five-figure implementation. **[UNVERIFIED]** — no first-party
source exists by design; carried only as the ceiling of the category, not as an input.

The pattern across all three, and it is remarkably consistent: **the entry tier contains
the complete core workflow** (schedule → quote → invoice → get paid), and the ladder sells
(1) automation, (2) accounting-system connection, (3) job-costing / report depth, and
(4) seats. Nobody cripples the trade's own records to force an upgrade. The multiple
between entry and mid tier runs 2.5×–3.3× (Jobber $24→$80, Housecall $59→$149). Our
ladder in §3 uses the same currency at a gentler multiple, because our entry tier is not a
loss-leader.

### 2.6 Direct competitor: CrewRoo

Read from <https://www.crewroo.com/> on 2026-08-11; identical to the 2026-08-10 read.

| Plan | Price | Scope |
|---|---|---|
| Essentials | **$9.99/mo** | Receipt scanning (AI extraction), expense reports, clients, invoice generation, email send, cloud storage |
| Pro | **$19.99/mo** | Adds trips with daily rates and work days, flight legs, RON nights, mileage, receipts attached to trip days |

Both plans: **14-day free trial, no credit card required.** No annual price displayed.
Company traction **[UNVERIFIED]** — no source found. CrewRoo Pro remains the closest
direct comparable. What it does not appear to carry — and what this session's builds
widened — is the logbook with ForeFlight/LogTen import, the currency engine, per-operator
135 check tracking, client statements, estimates, bank-statement import, or a full-account
export (`docs/WAVE-PARITY.md` §9). That delta is what any price above $19.99 must be
justified by, and as of this branch it is substantially shipped rather than promised.

### 2.7 The rest of the field, and the standing positioning rule

Searched 2026-08-10 across contract-pilot invoicing and crew expense software; no second
purpose-built product found beyond CrewRoo. Per `market-landscape.md`, that is **not** a
"the only" claim — the defensible sentence remains "existing tools are either generic
accounting or a logbook; ours starts from the pilot's business."

### 2.8 The persona's economics — what the price is actually against

What a working contract pilot already spends on verified figures alone: ForeFlight
Essential $260 + LogTen Pro $129.99 + QuickBooks Solopreneur $240 = **$629.99/year**,
before v1 exists. v1 credibly replaces the QuickBooks line and the LogTen line; never the
ForeFlight line.

Day rates (kept from 2026-08-10, with the same suspicion): the one vendor-published table
found (<https://www.crewblast.co/daily-rate>) shows PIC day rates ~$1,200–$1,500 (King
Air 200) to $2,000–$2,500 (G550) to $4,000–$4,500 (G700-class). CrewBlast is a
crew-sourcing vendor publishing its own survey with no stated methodology — treat as
directional only. But even at the bottom of the range the conclusion is insensitive to
the error bars: **a year of the top proposed tier is less than half of one flying day.**
The pricing question is never "is this cheaper than Wave" — Wave's $0 tier is not the
alternative, an unbilled trip day is. Price against the value of never losing one.

---

## 3. Recommendation — the three tiers

### 3.1 Names, and the one place display names map

Working set stays **Solo / Pro / Business**. "Solo" is the one genuinely aviation-native
name on any competitor's page — every pilot remembers their first solo — and "Pro" /
"Business" are what the buyer's other tools (LogTen Pro, Wave Pro, ForeFlight Business
Pro) already call the same rungs, which makes the ladder legible in a five-second scan.
Aviation-flavored alternates were considered ("PIC", "Captain", "Crew", "Fleet") and
rejected: "Crew"/"Fleet" over-promise crew-scheduling features v1 does not have, and a
pricing page is the wrong place to make a professional decode a metaphor.

If the owner wants different display names, **change them in exactly one place**: the
plan map (env var → display name), to live in `lib/plans.ts` (or equivalent) when the
builders land it. Env names never change; copy never hardcodes a tier name.

| Env var (fixed) | Display name (owner-changeable, one place) | Billing shape |
|---|---|---|
| `STRIPE_PRICE_ID_SOLO` | **Solo** | flat |
| `STRIPE_PRICE_ID_PRO` | **Pro** | flat |
| `STRIPE_PRICE_ID_BUSINESS` | **Business** | per seat, quantity on the one Price, **2-seat minimum** |

### 3.2 The numbers

| | Monthly | Annual | Effective monthly on annual |
|---|---|---|---|
| **Solo** | **$29/mo** | **$290/yr** | $24.17 |
| **Pro** | **$49/mo** | **$490/yr** | $40.83 |
| **Business** | **$39/seat/mo**, min 2 seats | **$390/seat/yr** | $32.50/seat |

Annual is two months free (16.7%) on every tier. The Business floor is $78/mo or $780/yr.

**Why Solo stays $29.** It is already configured, already in the signup copy, already what
the existing cohort pays — the ladder costs zero migration and no grandfathering
conversation. It clears every generic anchor ($19 Wave Pro, $20 Solopreneur, $19.99
CrewRoo Pro) enough to say "not the cheap option," sits under Simple Start's $38, and —
critically — it is a *complete product* at that price (§4): full records, full logbook,
full currency. The part-time pilot flying 40 days a year gets nothing crippled.

**Why Pro is $49.** Three anchors converge on it:

1. **The replacement math**: QuickBooks Simple Start ($38/mo) + LogTen Pro (~$10.83/mo
   equivalent) ≈ **$48.83/mo** — the exact stack Pro replaces for a full-time contract
   pilot, priced at parity with what they'd otherwise assemble, with the trip-native glue
   neither half has.
2. **The vertical-SaaS multiple**: entry→mid runs 2.5–3.3× at Jobber and Housecall; our
   $29→$49 is 1.7×, deliberately gentler because Solo is not a loss-leader and the
   persona is price-rational, not price-sensitive.
3. **~2.5× CrewRoo Pro** ($19.99), defensible now that the width is shipped: on this
   branch the logbook import (ForeFlight/LogTen/generic), estimates, client statements,
   bank-statement import, sales-tax report, and the ten-file account export are code, not
   roadmap (`docs/WAVE-PARITY.md` §§1–7). The 2026-08-10 memo argued $59 was unearned
   while those were unbuilt; most of that objection has been overtaken. $49 rather than
   $59 because the currency board still ships dark behind the counsel gate (G1) and the
   notification/mobile gaps are real — revisit $59 when currency is publicly enabled.

   Against the persona's economics, $490/yr is a fraction of one day's billing; one
   recovered unbilled trip day or one rebilled hotel folio that would have been eaten
   funds Pro for years.

**Why Business is $39/seat with a 2-seat minimum.** Per-seat below the Pro flat rate is
the normal shape — the second seat costs us nothing and the account total still rises.
The arbitrage (a solo pilot buying one $39 "Business" seat to dodge $49 Pro) is closed by
the **two-seat minimum**, ForeFlight's exact convention on both of its business plans. The
floor ($78) sits above Pro ($49) and just under QuickBooks Essentials ($85), which is the
incumbent price of "my bookkeeper needs a login." Who buys it: the two-pilot LLC on an
owner's aircraft, a small management shop's contractor bench, a pilot adding a bookkeeper
seat — `pilot.account_members` has carried `owner/member/bookkeeper` roles since the
first migration, so the second seat has a real job on day one.

**On annual.** Recommended for a persona-specific reason: contract-pilot income is lumpy,
and the slow quarter that cancels a monthly subscription is the quarter the pilot most
needs the receipts and the invoice chase. Annual moves that decision out of the worst
month and gives them one clean deductible line. Caution unchanged from 2026-08-10: annual
at signup on a card-required trial makes the first charge $290–$490+, a real abandonment
risk with no brand — the lean is **annual as in-app upgrade after the first month**, but
that is the owner's decision 4 in §8.

---

## 4. Feature matrix

### The principle, stated so it binds the matrix

**Safety and compliance record-keeping is never the upsell.** The logbook, the currency
board, documents with expiry, and per-operator 135 qualification tracking sit in **every
tier**, including Solo. A pricing page that reads "pay more to know if you're current"
ransoms safety, poisons the trust the product runs on, and is beneath the industry norm —
LogTen ships currency tracking in its cheapest tier (§2.3) and ForeFlight ships the
logbook in Starter (§2.4). The ladder sells **business depth** instead: estimate/statement
workflow, the accounting layer, tax and report depth, automation, and seats — exactly the
currency Wave, Intuit, Jobber, and Housecall gate (§2.1, §2.2, §2.5). Data egress is also
never gated: **every tier exports everything.** A tool holding a pilot's legal records
hostage to a subscription tier would deserve the reputation it got.

Features marked ● ship today on this branch; ○ = built this session and lands with it;
◐ = implemented dark behind its gate. "All tiers" rows are the principle above in force.

| Feature | Solo $29 | Pro $49 | Business $39/seat |
|---|---|---|---|
| **Records & safety — never gated** | | | |
| Clients, trips, day types, rate cards, per-diem, guarantees ● | ✓ | ✓ | ✓ |
| Expenses + receipt OCR (in-browser), rebill/deduct, unassigned queue ● | ✓ | ✓ | ✓ |
| Mileage (IRS standard rates, pilot-entered) ● | ✓ | ✓ | ✓ |
| Logbook: manual + trip-derived entries, FAR-correct fields ● | ✓ | ✓ | ✓ |
| Logbook import (ForeFlight / LogTen / generic CSV) + CSV export ● | ✓ | ✓ | ✓ |
| **Currency board** (61.57/61.56/61.23) ◐ — public only after gate G1 clears | ✓ | ✓ | ✓ |
| Per-operator 135.293/.297/.299 qualification tracking ● | ✓ | ✓ | ✓ |
| Documents with expiry ladder + credential packet share link ● | ✓ | ✓ | ✓ |
| Overview dashboard + attention queue ● | ✓ | ✓ | ✓ |
| **Full account export** (ten streaming CSVs) ○ | ✓ | ✓ | ✓ |
| **Get paid — core in Solo** | | | |
| Invoices: draft-from-trip, PDF, email, public share link ● | ✓ | ✓ | ✓ |
| Stripe payment links — pilot as merchant of record, **zero platform fee** ● | ✓ | ✓ | ✓ |
| Manual/partial payments, audit-honest corrections ● | ✓ | ✓ | ✓ |
| One-click overdue reminder ● | ✓ | ✓ | ✓ |
| Profit & loss report (cash-basis) + CSV ● | ✓ | ✓ | ✓ |
| W-9 status per client ● | ✓ | ✓ | ✓ |
| **Business depth — the ladder** | | | |
| **Estimates**: full state machine, convert-to-invoice ○ | — | ✓ | ✓ |
| **Client statements** (+ print view) ○ | — | ✓ | ✓ |
| Recurring invoice schedules (draft queue, human confirms) ● | — | ✓ | ✓ |
| Invoice extras as they ship: message templates, receipts-on-invoice, viewed/paid tracking | — | ✓ | ✓ |
| **Accounting layer**: bank statement import (CSV/OFX), review queue, remembered categorization ○ | — | ✓ | ✓ |
| Sales-tax report ○ | — | ✓ | ✓ |
| Quarterly estimated-tax planner ● | — | ✓ | ✓ |
| Year-end accountant packet + 1099-NEC reconciliation ● | — | ✓ | ✓ |
| **Team — Business only** | | | |
| Seats with roles (owner / member / bookkeeper), invite UI (G10 unblocks) | — | — | ✓ |
| Priority support | — | — | ✓ |

Two honesty rules carried forward unchanged: nothing on the pricing page may imply an
unshipped feature exists, and no copy may state or imply the product determines whether a
pilot is legal to fly (standing gate; it binds marketing as hard as the UI). The currency
board row ships in every tier *when* G1 clears — until then it appears on no public page.

---

## 5. Trial policy, downgrade, and cancellation

**Trial: 14 days, card required, every self-serve tier — and the trial runs at Pro
feature level.** Reasoning:

- 7 days (configured today) is shorter than the persona's trip → invoice → payment cycle;
  `docs/BILLING.md` already flags this. CrewRoo advertises 14 days no-card; matching the
  length while keeping the card answers the comparison without opening a second
  provisioning path (card-required stays — decisions #6/#7 make the Stripe webhook the
  only path that provisions a tenant, and a no-card trial would need the second path the
  architecture deliberately refuses).
- Trialing at Pro level means every trialist *sees* estimates, statements, and the
  accounting layer before the tier choice bites; conversion lands them on the tier they
  chose. This is the standard vertical-SaaS move and costs nothing to build beyond the
  plan gate itself.
- Trial length is the owner's decision 3 in §8 (7 / 14 / 30); 14 is the recommendation.

**Downgrade: data is never deleted — read-only is the norm, and the pricing page says so
in those words.**

- **Pro → Solo**: everything created on Pro-gated surfaces (estimates, statements,
  imported bank transactions, tax reports) remains **visible and exportable forever**;
  creating *new* ones is what stops. No record is hidden behind the higher tier after the
  fact.
- **Business → Pro/Solo**: additional seats deactivate (sign-in revoked for non-owner
  members) but every record a seat created stays, attributed, in the account.
- **Hold (added 2026-08-18)**: an owner who has been billing two months or
  more may pause for up to two months. Billing stops at Stripe
  (`pause_collection`, behavior `void`, so no debt accrues for the paused
  period) and the account goes read-only. Nothing is deleted while it runs.
  If the window closes without the pilot resuming or paying to retain,
  the **commercial** records are purged: clients, trips, invoices,
  estimates, expenses, the ledger and the bank-import tables. The
  **airman** records are kept unconditionally — logbook, documents,
  aircraft, operator qualifications, currency — because a subscription
  lapse may never destroy a 14 CFR 61.51 record. That split is enforced in
  the database and asserted by `scripts/account-lifecycle-db-verify.mjs`,
  not merely intended.
- **Cancellation**: the account goes **read-only with export still working** — logbook,
  currency history, documents, invoices, all of it viewable and downloadable, deleted
  never. A pilot's logbook is a legal record; a subscription lapse cannot be the thing
  that destroys it. (Retention schedule and any eventual purge policy are owner + counsel
  decisions, not defaults.)
- Because the safety surfaces live in every tier, **no downgrade between paid tiers ever
  touches the logbook, currency, documents, or qualification records.**

---

## 6. What the price does not have to carry

Unchanged and still load-bearing: Stripe Connect Standard takes **no application fee**
(decision #8) and v1 never touches the pilot's funds. There is no second revenue line in
the payments flow and there must not be one — taking a cut of a pilot's invoice makes us
a participant in their client relationship. **The subscription is the whole business
model**, which is exactly why the ladder above has to be priced like it.

---

## 7. Stripe wiring — test mode only

**Create Products and Prices in TEST mode only.** No live-mode object until the standing
counsel gate clears ("counsel review before the product takes revenue"). Pricing is not
what unblocks revenue; counsel is.

- **Price IDs come from env, by name, never a literal in code.** `STRIPE_PRICE_ID_SOLO`
  exists and fails loudly when unset (`lib/stripe/server.ts`). `_PRO` and `_BUSINESS`
  follow the same pattern, added **only when the code path that reads them exists** — an
  empty variable that reads as configured is worse than a missing one (`docs/BILLING.md`).
- **Business is one Price with `quantity` = seats** (licensed per-seat), minimum 2
  enforced in the checkout code, not by trusting the widget.
- **Annual are separate Price objects** (`_SOLO_ANNUAL`, `_PRO_ANNUAL`,
  `_BUSINESS_ANNUAL`), added only when the annual code path lands — which per §3.2 may be
  post-launch as an in-app upgrade.
- **No Price ID value or key value appears in this document or any file in the repo.**
  Values live in Vercel and `.env.local`.
- **Keep every Stripe variable in the same mode** — the webhook's `livemode` guard only
  holds if test and live are never mixed across variables.
- **A price change is a new Price object, never an edit.** Amounts are immutable;
  subscribers stay on their old Price until deliberately migrated. (Which is why Solo
  staying at $29 is free, and why every number above should be signed as if it will be
  carried for years.)
- **Amounts are integer cents.** $29 = `2900`, $49 = `4900`, $39 = `3900`.

---

## 8. Open items — genuinely the owner's

Everything above is input; none of it is an agent's to sign.

1. **The numbers.** Solo **$29** / Pro **$49** / Business **$39/seat** monthly; $290 /
   $490 / $390-per-seat annual. This is the sign-off that unblocks the builders' Price
   creation (test mode).
2. **The seat minimum.** Proposed **2** — it is the only thing stopping a solo account
   from buying one cheap Business seat instead of Pro.
3. **Trial length.** Proposed **14 days** (from 7), card required, trial-at-Pro-level.
   Options: 7 / 14 / 30.
4. **Annual at signup or as in-app upgrade after month one.** Lean: upgrade-only, to
   keep the first charge small on a card-required trial.
5. **Display names.** Solo / Pro / Business proposed; change only the one plan map if
   another set is wanted.
6. **Grandfathering statement.** Existing $29 subscribers *are* the Solo tier — no
   migration — but say deliberately whether early Pro/Business customers keep their
   launch price if numbers rise after the currency board goes public. Cheaper to promise
   deliberately than to be asked.
7. **Confirm no live-mode Stripe object until counsel clears revenue** (assumed
   throughout §7), and that the currency board appears in no public pricing copy until
   G1 clears (assumed throughout §4).
8. **Confirm the matrix line for "invoice extras"** — templates, receipts-on-invoice,
   viewed/paid tracking gate to Pro *as they ship*; nothing unshipped goes on the page.
