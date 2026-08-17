# Marketing — positioning, message hierarchy, claim rules

The approved strategy for the signed-out surface, written down once so
future copy has a source. It was signed off in the 2026-08 rewrite and is
what `app/(marketing)/page.tsx`, `app/(marketing)/pricing/page.tsx` and the
`app/(auth)/` shell are written against. **Read this before editing a word
of public copy.** Every rule below exists because the previous version of
the page broke it.

**`app/(auth)/` is inside the scope, not adjacent to it.** §5's claim rules
bind `/signup`, `/login`, `/forgot-password`, `/reset-password` and
`/welcome` exactly as hard as they bind the landing page, and harder in
practice: a pilot on `/signup` is one screen from a card. Nothing mechanical
checks the auth copy, and the gap has already cost once — the signup screen
shipped "your next trip bills itself" while the landing page it links from
carefully said nothing of the kind. Read the auth strings against §5 by
hand whenever they change.

---

## 1. The one-liner

> V1 is the books for an independent contract pilot: log the trip once, and
> the invoice lines, the logbook draft and the filed receipts all come off
> that one record.

## 2. Who it is for

**The U.S.-based independent contract pilot running as a one-person 1099
business** — flying day rates for several owners, management companies and
Part 135 operators, invoicing each of them, keeping a logbook, and filing
the quarterlies on all of it. Today they run a logbook app *plus* a
spreadsheet *plus* QuickBooks or Wave, and **they are personally the
integration between the three.**

Secondary: the same pilot who has grown to a second pilot, or who wants a
bookkeeper in the books (Business).

**Explicitly not:** flight departments, crew scheduling, operators buying
for their pilots, or hobby/student logbook users. The exclusion belongs on
`/pricing` if anywhere — never on the front door, where it costs words and
buys nothing.

## 3. The wedge

One trip generates three records — a logbook entry, a billable line, and
expenses — and every general-purpose tool makes the pilot enter it three
times, because none of them knows what a trip, a leg, a day rate or a
travel day is.

V1 is **trip-native**: the trip is the record, the invoice lines and the
logbook draft are generated from it, and receipts attach to it.

The wedge is *not* "cheaper than Wave". It is that a tool for this one
profession exists at all — and **belonging is proved by vocabulary and
defaults**, never by an unsigned boast that pilots built it:

> "day records typed flight, travel, standby or off" · "PIC and SIC kept
> distinct" · "tag it rebill or deduct"

Sell the mechanic. Name exactly what you type and exactly what comes out.

---

## 4. Message hierarchy

| Rank | Beat | Where it lives |
|---|---|---|
| 1 | What the product is and who it serves | Hero |
| 2 | The problem it removes | Hero subhead |
| 3 | The workflow, and the cost of not having it | Section 2 |
| 4 | Depth as evidence of belonging | Section 3 spec block |
| 5 | The three barriers left | Section 4 FAQ |
| 6 | Cost, and the promise that outlives the card | Section 5 close |

**Hero copy, verbatim:**

- **Eyebrow** — Built for independent pilots
- **H1** — Stop entering the same trip three times.
- **Subhead** — V1 keeps your trips, invoices, logbook, receipts, and
  year end records together, so the business side of flying takes less work.
- **Fine line** — Plans start at $29/month. Card required.

`BRAND.tagline` ("Log the trip once.") stays in the footer, the auth
column and metadata. The H1 says what the product is for instead of asking
a slogan to do that work.

**Beats 3 and 6 each used to be two sections, and are now one.** The
workflow beat had a "what one trip produces" section AND a comparison
table naming the same three records in the same order one screen later;
the cost beat had a plans band whose whole content was one line and a link,
sitting two screens above a closing call to action. Both merges are
described in §7.

---

## 5. The claim rules

These are absolute. A page that breaks one is not shippable.

1. **Two generated, one organised.** A trip GENERATES invoice lines and a
   logbook draft. Receipts are ORGANISED by it — the pilot scans or imports
   an expense and assigns it. Nothing in this product creates an expense
   from a trip. Never claim three generated.

2. **Nothing beyond shipped code.** Every feature line on the landing page
   declares the `FeatureId` it describes (`lib/entitlements.ts`), so its
   tier tag is *derived* rather than typed, and any feature the public-claim
   filter removes or entitlements marks `comingSoon` drops out of the page
   mechanically.

   **Know what the test does and does not cover.**
   `tests/marketing-pricing-model.test.mjs` walks every published claim
   *that declares a gated route* against the real app tree — and only
   those. Ten of the seventeen features carry `routePatterns: []`, including
   `trips`, `invoices`, `expenses`, `clients`, `logbook`, `documents` and
   `reports_core`, i.e. every feature the landing page's largest claims rest
   on. Those arrays are empty **deliberately** (see the note above
   `featureForPath` in `lib/entitlements.ts`: solo-tier routes stay out of
   `routePatterns` so route gating can never paywall a safety record), so
   the walk structurally cannot reach an ungated feature and never will.
   Nothing reads the landing page's `SPEC` array either — the prose-to-
   `FeatureId` association on every line is hand-typed. **Deleting
   `/logbook/import` would leave the ✓, the landing line and the FAQ answer
   standing with the suite green.** Check those claims by hand; the suite is
   not doing it for you.

3. **The currency board appears on no public page**, in no form — not as a
   row, not as "coming soon". It is absent, not hedged, until its counsel
   gate clears (`PUBLIC_CLAIM_FILTER` in `pricing/pricing-model.ts`).

4. **Never state or imply the product decides whether a pilot is legal to
   fly.** It tracks dates the pilot entered off their own documents.
   Currency and airworthiness decisions stay theirs. The substance of
   `CURRENCY_DISCLAIMER` (`lib/brand.ts`, counsel-reviewed) survives in the
   landing FAQ and the pricing FAQ.

5. **Seats are a billing fact, not a feature.** `multi_seat` is
   `comingSoon: true` with no invite UI. The Business per-seat price and the
   two-seat minimum may be stated. "Invite your bookkeeper" may not be
   claimed anywhere.

6. **Export is on every plan, and say so.** `account_export` is
   `minTier: "solo"` deliberately — "Gating export is the one upsell this
   product refuses". The old FAQ said "Pro and Business add the
   account-wide export", which contradicted the code and understated the
   product's strongest trust claim. That sentence must never come back.

7. **The comparison is workflow only.** No competitor pricing, and no claim
   that a named tool is bad at its own job. A logbook app is good at
   logbooks. The cost being named is the seam between three tools that do
   not know about each other.

8. **No testimonials, no invented statistics, no FAA-approval or compliance
   language, no founder-credibility boast.** There are no customers yet;
   the product mock says "Illustrative data." and every name, tail number
   and figure in it is synthetic.

9. **Brand strings come from `lib/brand.ts` only**, and
   `BRAND.attribution` ("powered by AMG Aviation") appears in the marketing
   footer and the app footer — nowhere else, ever.

10. **Never assert a tax outcome.** The product records and totals; it does
    not determine what the IRS will allow. `deduct` is an expense
    *treatment* enum (`app/(app)/expenses/actions.ts`), the in-app control
    reads "Keep as a deduction", and the mileage screen says in as many
    words that it is "a record of drives, not a determination of what's
    deductible". So: **"lands in the year's deductible total"** describes
    the software and is allowed. **"lowers your taxable income"**, **"is
    deductible"**, **"saves you $X at tax time"** and anything of that shape
    are prohibited on every public surface, and the landing page is the one
    signed-out surface carrying no disclaimer at all, so a tax claim made
    there is made naked. This rule exists because the 2026-08 rewrite
    introduced exactly that sentence while replacing a correct one.

11. **Figures are interpolated, never typed.** The trial comes from
    `TRIAL_PERIOD_DAYS` (the same constant the checkout hands Stripe); the
    public amounts come from `TIER_PRICE_COPY`. Pre-purchase surfaces
    (`/welcome`, settings/billing) read the *live* Stripe Price so the
    number shown equals the charge, and render "Unavailable" rather than a
    made-up figure when a price env is unset.

---

## 6. Word budgets

Five sections, down from seven, down from ~1,600 words across ~13 beats.
The standard is **ten seconds on FBO wifi**: hero alone answers what it is,
who it's for and what it costs; hero plus section 2 earns a qualified yes or
no inside thirty.

Both columns below are real, and they are not the same number. **Budget** is
what the strategy asked for; **Shipped** is what `app/(marketing)/page.tsx`
actually renders today. Keeping both is what makes this a check rather than
an aspiration — the table used to show only the budget, and the page had
been over it since the day it was written, so an editor comparing the two
found them out of step with no way to tell which was authoritative.

**Shipped is now measured, not tallied by hand.** Render the page, open
every `<details>`, drop the `[data-mock]` subtree (the product mock is
illustrative data, not copy), then take each `main > section`'s rendered
text and count whitespace-separated tokens containing a letter or digit.
The `data-mock` attribute on `product-mock.tsx` exists for this and nothing
else. Measuring the DOM rather than the source is what lets the derived
tier badges and the interpolated figures be counted as a reader meets them.

| # | Section | Budget | Shipped |
|---|---|---|---|
| 1 | Hero, navy, product mock beside the argument | 58 | 42 |
| 2 | Finish the paperwork while the trip is fresh — three record rows, each showing today and in-product | 155 | 107 |
| 3 | The rest of the job, in the same place — spec block, sticky heading column | 125 | 86 |
| 4 | Questions pilots ask us — three FAQ items | 112 | 117 |
| 5 | Close, navy — plans line and one action | 42 | 26 |
| | **Total** | **492** | **378** |

Recounted at the 2026-08 redesign. Section 2's budget is the old sections
2 and 4 added together (100 + 55), because it is now the old sections 2 and
4: they made the same argument about the same three records twice, one
screen apart, and merging them is where most of the 100-word drop came
from. Section 5's is likewise the old plans band plus the old closing CTA
(30 + 12). Section 4 is the only overrun and it is the FAQ, which carries
the counsel-reviewed currency wording; trimming it would cost substance, so
it stands and is stated.

**Rules of thumb behind the budgets**

- **No section intro paragraphs.** The heading is the intro. Three of them
  (103 words) explained the thing sitting directly beneath them.
- **A body paragraph that restates its own heading is deleted, not
  trimmed.** The old 65-word hero paragraph restated the H1 three times.
- **One idea, one statement.** "Log the trip once" appeared twelve times on
  the old landing page and seventeen across the signed-out surface. It now
  stays in the footer, the auth panel and metadata instead of being repeated
  through the page body.
- **Two aphorisms on the whole page, a full screen apart** — section 3's
  heading and the lapsed-card line. Seven clever titles in a row reads to a
  working professional as being sold to.
- **Structural problems get structural fixes.** Trimming the seven-block
  feature band by 20% would have left 535 words and the identical
  seven-scroll experience. It became one ~125-word spec block. The same
  reasoning retired sections 4 and 5 in the 2026-08 redesign: two sections
  that restate each other are not fixed by shortening both.
- **A record is named once per page.** "Invoice", "logbook entry" and
  "receipts" each appeared in the outputs cards AND again as comparison
  rows. Naming a thing twice in different words reads as padding to the
  reader and as two separate claims to a reviewer checking them against
  the code.

---

## 7. What was cut, and why it stays cut

- **The seven-block feature band** (669 words, ~40% of the page). Every
  block carried a 30–40 word body *and* a bullet list restating that body;
  the day types were named twice, twenty words apart. Five of the seven
  silently mixed Solo, Pro and Business features, so a reader took
  estimates, recurring invoices, statements, bank import, sales tax and
  double-entry accounting as included.
- **The 65-word hero paragraph** and the H1's nested sub-line (structurally
  a `<Text>` inside a `<Heading>`).
- **Two of five comparison rows**, and the two-card side-by-side layout
  that duplicated the row labels.
- **The three plan cards in the landing plans teaser** — a lower-fidelity
  duplicate of `/pricing`, one click away.
- **Ten of eleven data-ownership statements.** One spec line and the cancel
  FAQ, where a sceptic actually goes looking.
- **Three FAQ items**: trial length (stated twice already), "Who is this
  for?" (the eyebrow does it), and "Do I own my data?" — which was also
  factually wrong; see claim rule 6.
- **The 17-word mock caption** → "Illustrative data." Same disclosure, two
  words.
- **The standalone comparison section** (2026-08). Not the comparison
  itself, which is claim rule 7's territory and still runs as the middle
  column of section 2's rows — the second *section*, which re-listed the
  invoice, the logbook entry and the receipts a screen after section 2 had
  already listed them. Its heading ("Stop rebuilding the same trip") was
  also the H1's sentence a second time.
- **The plans band** (2026-08). One line and one link do not need a band of
  their own two screens above the closing call to action; the line moved
  into the close. The price is now stated once on the page, in the hero.
- **The second closing CTA button.** The close had "Try free" and "Compare
  plans" side by side while the hero already carried both; the close keeps
  the one action that is not already one click away.

---

## 8. Where the copy sources live

| Fact | Source of truth |
|---|---|
| Brand name, descriptor, tagline, attribution | `lib/brand.ts` |
| Trial length | `TRIAL_PERIOD_DAYS`, `lib/stripe/server.ts` |
| Public amounts | `TIER_PRICE_COPY`, `app/(marketing)/pricing/pricing-model.ts` |
| Pre-purchase amounts | `lib/stripe/prices.ts` (live Stripe Price) |
| Tier names, blurbs, feature labels, gating | `lib/entitlements.ts` |
| What may be claimed publicly | `PUBLIC_CLAIM_FILTER` + `isPubliclyClaimable()` |
| Navy panel / band styles | `lib/surface-style.ts` + `.v1-m-*` in `app/globals.css` |
| Downgrade promise | `DOWNGRADE_NOTE`, `lib/entitlements.ts` |
| Currency wording | `CURRENCY_DISCLAIMER`, `lib/brand.ts` |

Related: `docs/PRICING.md` (§3.2 amounts, §4 the currency gate, §5 the
downgrade/cancel promise, §6 and §8 the unshipped-feature rules) and
`docs/LAUNCH-GATES.md` (G2, G3, G5, G7 — what "published" means).
