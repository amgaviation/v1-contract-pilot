# Pricing — proposal for Tony to confirm

**Status: PROPOSAL. Nothing here is decided.** Decision #10 in `docs/PLAN.md` locked the
*shape* — solo flat rate, business per-seat — and left the numbers as "env/config, not code"
under Open items. This document proposes the numbers and shows the work. The owner picks
them; an agent does not get to price the product.

All competitor figures below were read from the live vendor page on the date stamped against
them. Where a number could not be verified from a live source it is marked
**[UNVERIFIED]** and left blank rather than estimated. A missing number in this document is
deliberate.

---

## 1. What is already wired, so this is a change-or-confirm and not a blank page

`docs/BILLING.md` documents **$29/month solo, card-required 7-day trial**, and that is what is
configured today. If the answer to this memo is "$29 is right", nothing changes. If it is any
other number, the blast radius is three places and none of them is a schema change:

- the Stripe Price object behind `STRIPE_PRICE_ID_SOLO` (a **new** Price — see §7),
- `PRICE_LABEL` in `app/(auth)/welcome/page.tsx`, the one place the amount is written into copy,
- the `$29/month` line in `docs/BILLING.md`.

The per-seat business plan has no Price and no env var yet, on purpose — `docs/BILLING.md`
explains why an empty `STRIPE_PRICE_ID_BUSINESS_SEAT` would be worse than an absent one.

---

## 2. Live competitor pricing, read 2026-08-10

### Wave

Read from <https://www.waveapps.com/pricing> and <https://www.waveapps.com/payments> on
2026-08-10.

| Item | Price |
|---|---|
| Starter plan | **$0/month** |
| Pro plan | **$19/month**, or **$190/year**; promotional **$9.50/month for the first 3 months** |
| Receipts add-on | **$8/month** on Pro ($72/year), **$11/month** on Starter ($96/year) |
| Payroll add-on | from **$25/month** (Starter), from **$40/month** (Pro) |
| Wave Advisors (bookkeeper) | from **$149/month** USD |

Payments, per transaction:

| Rail | Starter | Pro |
|---|---|---|
| Credit card (Visa/MC/Discover) | 2.9% + $0.60 | 2.9% + $0 for the first 10 transactions/month, then 2.9% + $0.60 |
| American Express | 3.4% + $0.60 | 3.4% + $0 for the first 10 transactions/month, then 3.4% + $0.60 |
| Bank payment (ACH/EFT) | 1% (minimum $1.00) | 1% (minimum $1.00) |

The reason the payments row matters to us is that **we do not compete on it.** Under decision
#8 the pilot is merchant of record on Stripe Connect Standard and we take no application fee,
so the pilot pays Stripe's published rate directly — **2.9% + 30¢** for domestic online cards
and **0.8% ACH direct debit capped at $5.00** (<https://stripe.com/pricing>, read 2026-08-10).
Against Wave that is a straight win on ACH for any invoice over $100 and a wash on cards.
It is a talking point, not a pricing input, because none of it accrues to us.

### QuickBooks

Read from <https://quickbooks.intuit.com/solopreneur/> and
<https://quickbooks.intuit.com/pricing/> on 2026-08-10. Both pages were showing a "Summer
Savings" promotion stated to end 8/27.

| Plan | List price | Promotional price |
|---|---|---|
| Solopreneur | **$20/month** | $2/month for 3 months (90% off) |
| Simple Start | **$38/month** | $3.80/month for 3 months (90% off) |
| Essentials | $85/month | $8.50/month for 3 months |
| Plus | $140/month | $14/month for 3 months |
| Advanced | $340/month | $34/month for 3 months |

Essentials and above are listed for context only; a one-person contract pilot business has no
use for them. **The two numbers that bound our decision are $20 and $38.** Solopreneur is the
product a contract pilot is most often told to buy, and Simple Start is where they end up once
they want real invoices.

Intuit's 90%-off-for-three-months habit is worth naming: a pilot comparison-shopping in August
sees $2/month next to whatever we charge. That is a sales problem to answer with the trial,
not a reason to discount to meet it.

### LogTen (pilot logbook)

Read from <https://logten.com/pricing/> on 2026-08-10.

| Tier | Price |
|---|---|
| LogTen Basic | **$79.99/year** (the page frames it as "less than $7/month") |
| LogTen Pro | **$129.99/year** (framed as "less than $11/month") |

**[UNVERIFIED]** No monthly subscription option was displayed on the pricing page. Whether a
monthly in-app purchase exists through the App Store was not confirmed.

### ForeFlight — context for what this customer already pays

Read from <https://foreflight.com/pricing/> and <https://foreflight.com/pricing/business/> on
2026-08-10.

| Plan | Price |
|---|---|
| Starter | **$130/year** |
| Essential | **$260/year** |
| Premium | **$390/year** |
| Business Pro | **$280/year per pilot licence**, minimum 2 licences, excludes VAT |
| Business Performance | **$400/year per pilot licence**, minimum 2 licences, excludes VAT |

Two caveats on this one, both worth carrying:

1. The consumer pricing page states that plan **names** were recently updated while "prices and
   features remain exactly the same as before." Older third-party summaries (post the March
   2025 increase) circulate the names Basic Plus / Pro Plus / Performance Plus at figures
   slightly below the ones above. **I did not open those third-party pages and cannot reconcile
   the difference** — treat only the live page's Starter/Essential/Premium figures as verified,
   and re-read the page before any of this goes into marketing copy.
2. ForeFlight is **not a competitor to v1** and we should never position against it. It is the
   evidence that this customer buys aviation software at a professional price point without
   flinching, and the precedent for a **two-licence minimum on a business plan** — see §5.

### Direct competitor: CrewRoo

Read from <https://www.crewroo.com/> on 2026-08-10. This is the only product I found that is
purpose-built for contract pilot expense reporting and invoicing.

| Plan | Price | Scope |
|---|---|---|
| Essentials | **$9.99/month** | Receipt scanning, expense reports by date range, clients, report/invoice generation, email send, cloud storage |
| Pro | **$19.99/month** | Adds trips with daily rates and work days, flight legs, RON nights, mileage, receipts attached to specific trip days, full contractor billing workflow |

Both plans advertise a **14-day free trial with no credit card required**.

**[UNVERIFIED]** No annual price was displayed. Company size, funding, customer count and
traction are all unverified — I found no source for any of them.

CrewRoo Pro is the closest thing to a direct comparable that exists, and its feature list reads
close to our Phase 3–5 (trips, day rates, work days, legs, receipts, invoices). What it does
not appear to carry is the logbook, the FAA currency surface, or the per-operator 135 check
tracking that `pilot.operator_qualifications` already holds. That is the differentiation the
price has to be justified by — and it is only partly shipped today (see §6).

### The rest of the field

Searched on 2026-08-10 across contract-pilot invoicing, crew expense and pilot logbook
software. Beyond CrewRoo I found no second product purpose-built for contract pilot invoicing.
Per the positioning rule in the aviation research (`market-landscape.md`), **do not turn that
into a "the only" claim** — an absence in one day's searching is not proof the space is empty,
and small entrants in this niche are easy to miss. The defensible sentence is "existing tools
are either generic accounting or a logbook; ours starts from the pilot's business."

Logbook competitors other than LogTen exist (ForeFlight's built-in logbook, MyFlightbook,
ZuluLog and others). I did not verify their current prices, and they do not bound our decision
because we are not selling a logbook on its own. **[UNVERIFIED]**

### What a working contract pilot already spends, from the verified figures only

ForeFlight Essential $260/yr + LogTen Pro $129.99/yr + QuickBooks Solopreneur $240/yr =
**$629.99/year**, already being paid, before v1 exists. v1 credibly replaces the third line and
eventually the second. It never replaces the first.

---

## 3. Recommendation

| | Monthly | Annual | Effective monthly on annual |
|---|---|---|---|
| **Solo** (flat) | **$39/month** | **$390/year** | $32.50 |
| **Business** (per seat) | **$35/seat/month**, minimum 2 seats | **$350/seat/year** | $29.17 |

Annual is two months free (16.7%). The business floor is therefore $70/month or $700/year.

### Why $39 for solo

- It clears the generic-accounting anchors ($20 Solopreneur, $19 Wave Pro) by enough that we
  are visibly not a cheaper QuickBooks. We are not — we do one persona's whole job, and a tool
  that prices at $19 invites the buyer to evaluate it as a QuickBooks substitute on
  QuickBooks' terms, which is a comparison we lose (they have banks, payroll, an accountant
  ecosystem and twenty years).
- It sits just above CrewRoo Pro at $19.99 without doubling it. Roughly 2× a direct comparable
  is defensible when the scope is genuinely wider; 3× is not, on day one, without a track
  record.
- It is below Simple Start at $38/month by a dollar, which is the number a pilot who has
  outgrown Solopreneur is about to pay anyway. That is a comfortable place to stand.
- Against the customer's own economics it is close to noise. The one vendor-published daily
  rate table I could find (<https://www.crewblast.co/daily-rate>, read 2026-08-10) shows PIC
  day rates from roughly $1,200–$1,500 on a King Air 200 to $2,000–$2,500 on a G550/G450/GV to
  $4,000–$4,500 on a GVIII. **Treat those with suspicion**: CrewBlast is a crew-sourcing vendor
  publishing its own survey, the page states no methodology, no sample size and no last-updated
  date, and I found no independent corroboration. But even at the bottom of that range, a
  year of v1 at $390 is under a third of one day's billing, and one unbilled trip day or one
  lost receipt recovered pays for several years. That argument supports $39 comfortably. It
  would also support $59 — see §4 for why I am not proposing that yet.

### Why $35 per seat for business, and why that is lower than solo

Per-seat below the solo flat rate is the normal shape and it is right here: the second seat on
an account costs us nothing and the account total still rises. The arbitrage worry — a solo
pilot declaring himself a "business" to get $35 — is closed by the **two-seat minimum**, which
puts the cheapest business account at $70/month, comfortably above solo. ForeFlight runs a
two-licence minimum on both of its business plans, so this is the convention in this exact
market rather than something we invented to protect a price.

Who actually buys it: a two-pilot LLC flying an owner's aircraft, a small management shop
running a contractor bench, or a pilot who adds a bookkeeper seat. `pilot.account_members`
already carries the `bookkeeper` role, so the second seat has a real job on day one.

### On annual

Recommended, for a reason specific to this customer rather than for the cash: **contract pilot
income is lumpy.** A slow quarter is exactly when a monthly subscription gets cancelled, and it
is also exactly when the pilot most needs the receipts and the invoice chase. Annual removes
that decision from the worst month of the year. It also gives them one clean deductible line
instead of twelve.

One caution: annual plus a card-required trial makes the first charge $390 rather than $39.
That is a real trial-abandonment risk on a product with no brand yet. **My suggestion is to
offer annual as an in-app upgrade after the first month, not as a choice at signup** — but
that is decision 5 in §8, not something I should settle.

---

## 4. Alternatives, with the trade-off of each

### Alternative A — the low anchor: Solo $29, Business $25/seat (2-seat minimum)

**For it.** It is already configured, already documented, already in the signup copy — zero
change cost and no Stripe work at all. It sits just above QuickBooks Solopreneur ($20) and Wave
Pro ($19) and just above CrewRoo Pro ($19.99), so the price never becomes the objection in a
conversation. It leans on volume: get a lot of pilots cheaply, learn from them, raise later.

**Against it.** The volume leg of that argument is the part I cannot support with evidence —
**[UNVERIFIED]**: I have no defensible figure for how many US contract pilots exist or how many
are addressable, and I am not going to invent one. A volume strategy priced without knowing the
volume is a guess wearing a spreadsheet. Separately, raising a price later is materially harder
than launching high and discounting: existing subscribers stay on their old Price object unless
migrated, so a launch at $29 means carrying a $29 cohort indefinitely or running a migration
conversation with the first and most loyal customers. And $29 quietly tells the buyer this is a
utility, when the pitch is "your business runs on this."

### Alternative B — the high anchor: Solo $59, Business $49/seat

**For it.** It leans entirely on the day-rate argument, and that argument is strong: this
customer bills four figures a day, and the tool pays for itself the first time it catches one
unbilled trip day or one hotel receipt that would otherwise have gone unreimbursed. $59/month
is $708/year against a single G550 day at $2,000–$2,500. It also puts us above ForeFlight
Essential ($260/yr), which is a statement: this is the business system of record, not an
accessory. High prices attract the serious end of the market and fewer, better-fit customers.

**Against it, and this is why I am not recommending it for launch:** the feature set that
justifies $59 is not shipped. The logbook CSV import is unbuilt (`docs/PLAN.md` calls it "the
biggest piece of work in the build"), Phase 7 currency ships dark behind a flag and is blocked
on the missing airman record, and 135.267 duty and rest is not modelled at all. At $59 the
first question is "what am I getting that CrewRoo's $19.99 doesn't give me," and today the
honest answer is "trips, invoices, expenses, documents, per-operator qualification tracking,
and a logbook you can't import into yet." That answer is worth $39. **Revisit $59 as the price
after Phase 6 and Phase 7 are actually enabled** — that is a real reason to raise, and telling
early customers "the price goes up when import and currency land, you keep yours" is a
genuinely good story rather than a squeeze.

### Alternative C — a free tier

**Recommend against, on architecture rather than on strategy.** Decision #6 is card-required
trial and decision #7 makes the Stripe webhook the only path that provisions a tenant. A free
tier needs a second provisioning path that no webhook fires for, and it collides with the
convention in `docs/BILLING.md` where **`stripe_customer_id IS NULL` is the mark of a comped
internal account**. Free tenants would make that column meaningless and would make "how many
paying customers do we have" the hard question that convention exists to keep easy. If free
acquisition is wanted, the lever is trial length (§8, decision 4), not a free tier.

### Alternative D — usage-based (per trip or per invoice)

**Recommend against.** It punishes exactly the behaviour the product depends on. The thesis in
`docs/PLAN.md` is "log the trip once"; charging per trip gives the pilot a reason to log fewer,
and a logbook with gaps in it is worse than no logbook. Noted here only so it is visibly
considered and closed.

---

## 5. What the price does not have to carry

Worth stating so it does not get priced in by accident. Stripe Connect Standard takes **no
application fee** (decision #8) and we never touch the pilot's funds. There is no second
revenue line hiding in the payments flow, and there should not be one — the moment we take a
cut of a pilot's invoice we are a participant in their client relationship, which is the exact
boundary `docs/PLAN.md` opens by drawing. **The subscription is the whole business model.**

---

## 6. What the buyer is actually paying for on the day we launch

State this plainly in any pricing page, because pricing above the direct comparable obliges us
to be accurate about scope:

- Shipped: clients, trips with day types and rate cards, expenses with rebill/deduct and the
  unassigned queue, invoices with PDF and Connect payment links, documents with expiry, the
  year-end packet, and per-client 135.293/.297/.299 qualification tracking.
- Not shipped: logbook CSV import (ForeFlight/LogTen/generic mapper), the Phase 7 currency
  engine, any duty and rest output.

Nothing on the pricing page may imply the second list exists, and no copy may state or imply
that the product determines whether a pilot is legal to fly. That framing is a standing gate in
`docs/PLAN.md`, and it binds marketing at least as hard as it binds the UI.

---

## 7. Stripe wiring — test mode only

**Create the Products and Prices in TEST mode only.** No live-mode object gets created until
the standing counsel gate in `docs/PLAN.md` clears ("counsel review before the product takes
revenue"). Pricing is not the thing that unblocks revenue; counsel is.

Rules that follow from what is already built:

- **Price IDs come from env config, by name, never from a literal in code.** `STRIPE_PRICE_ID_SOLO`
  exists and is read in `lib/stripe/server.ts`, which already fails loudly with a specific
  message when it is unset. Annual and business tiers need their own variables on the same
  pattern; add each one only when the code path that reads it exists, exactly as
  `docs/BILLING.md` argues for `STRIPE_PRICE_ID_BUSINESS_SEAT` today. An empty variable that
  reads as configured is worse than a missing one.
- **This document names no Price ID value and no key value, and neither should any other file
  in the repo.** Values live in the Vercel project and in `.env.local`.
- **Keep every Stripe variable in the same mode.** The webhook rejects any event whose
  `livemode` disagrees with the key's mode, so a test event can never mutate live data — but
  that guard only holds if test and live values are not mixed across variables.
- **A price change is a new Price object, never an edit.** Stripe Price amounts are immutable,
  so changing the number means creating a Price and pointing the env var at it. Existing
  subscribers stay on the old Price until deliberately migrated — which is the mechanical
  reason §4's "raise it later" is harder than it sounds.
- **Amounts are entered in cents**, consistent with the house rule that money is integer cents
  everywhere. $39.00 is `3900`.

---

## 8. What I need from you

Eight decisions. Everything above is input to them; none of them is mine to make.

1. **Solo monthly price.** Proposed **$39**. Currently configured: $29. Alternatives: $29 (A),
   $59 (B).
2. **Business per-seat price and the seat minimum.** Proposed **$35/seat/month with a 2-seat
   minimum**. Confirm the minimum specifically — it is what stops a solo account buying the
   cheaper per-seat rate.
3. **Annual: offer it or not, and at what discount.** Proposed **yes, two months free** —
   $390/year solo, $350/seat/year business.
4. **Trial length.** Currently 7 days, and `docs/BILLING.md` already flags that as possibly
   shorter than the time it takes a contract pilot to fly a trip, invoice it and get paid.
   CrewRoo advertises 14 days with no card. Options: keep 7, go to 14, or go to 30 to cover a
   full trip-to-payment cycle. This is a pricing decision, not an engineering one.
5. **Is annual offered at signup, or only as an in-app upgrade after the first month?** I lean
   upgrade-only, to keep the first charge small on a card-required trial.
6. **Grandfathering policy.** If the price rises after Phase 6/7 land, do early customers keep
   their price permanently, for a fixed term, or not at all? Answer this before the first
   customer signs up, not after — it is much cheaper to promise deliberately than to be asked.
7. **Confirm that no live-mode Stripe Product or Price is created until counsel clears revenue.**
   I have assumed this and built the section above around it.
8. **Confirm we are not pricing for the unshipped features.** §6 is the scope the launch price
   is for. If you want to price for the logbook import and the currency engine, the price is a
   different conversation and it happens when they ship.

Once 1–3 are answered I can create the test-mode Products and Prices and wire the env vars —
but say the word explicitly, because creating them is the point at which a proposal starts
looking like a decision.
