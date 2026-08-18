# Marketing — positioning, message hierarchy, claim rules

The approved strategy for the signed-out surface, written down once so
future copy has a source. Signed off in the 2026-08 rewrite, and
**repositioned 2026-08-17 at the owner's direction**: the workflow wedge
("log the trip once" / "stop entering the same trip three times") is
retired everywhere — page, tagline, metadata, OG card, tier blurb, in-app
empty states — and this document now records the money position that
replaced it. §5's claim rules carried forward unchanged through the
repositioning; they are honesty constraints, not positioning choices. This
is what `app/(marketing)/page.tsx`, `app/(marketing)/pricing/page.tsx` and
the `app/(auth)/` shell are written against. **Read this before editing a
word of public copy.** Every rule below exists because a previous version
of the page broke it.

**`app/(auth)/` is inside the scope, not adjacent to it.** §5's claim rules
bind `/signup`, `/login`, `/forgot-password`, `/reset-password` and
`/welcome` exactly as hard as they bind the landing page, and harder in
practice: a pilot on `/signup` is one screen from a card. Nothing mechanical
checks the auth copy, and the gap has now cost twice on the same screen.
First `/signup` shipped "your next trip bills itself" while the landing page
it links from carefully said nothing of the kind. The fix carried a long
comment forbidding exactly that claim, and the replacement line under that
comment then read "your next trip drafts its own invoice and logbook
entries" — the same autonomy claim in a quieter voice, plus "invoice" for
what are invoice *lines* and "entries" for what are per-leg *drafts*. It
survived a full rewrite of the landing page because nobody re-read it.

The lesson is narrower than "read the copy": **a comment guarding a line is
not a check, and it will outlive the line it guards.** Read the auth strings
against §5 by hand whenever they change, and re-read them whenever the
landing page's mechanic copy changes, because that is when they fall out of
step.

**An offer change must sweep the SHELL, not just the page.** The 2026-08-17
switch to the $5 first month updated the landing CTAs and left "Try V1
free" in the site header, "Start free trial" in the footer, and "Start your
trial" on the signup card — three false price claims shipped by omission.
The shell's own call-to-action copy therefore makes no price claim at all
("Get started"); the price is stated only where there is room to state it
from `INTRO_FIRST_MONTH_LABEL`.

**The brand is strictly "V1"** (2026-08-17, owner's direction). The
"Contract Pilot" descriptor is retired everywhere — tab title, PWA
manifest, Stripe appInfo, app shell, auth lockup, platform email footer.
"Contract pilot" survives only as lower-case audience prose ("for
independent contract pilots"), never as part of the name.

---

## 1. The one-liner

> V1 is the books for a flying business of one: who owes you, what you
> earned, what you spent, and the year-end packet your CPA asks for —
> every figure off the trips the pilot flies.

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

## 3. The position

**Money, not workflow.** The retired wedge sold single-entry — a mechanism
nobody wakes up wanting. The position sells what the pilot already wants:
to know what they're owed, get paid for every day they flew, and put a
real set of books behind a 1099 business. The product was always built
this way — the Overview leads with Unbilled work / Awaiting payment / Paid
this year, and LEDGER.md chose the fintech register "because this product
is, above all, how they get paid" — the copy has simply caught up with the
product's own picture.

**The category is books, not workflow software.** Pilots already pay for
the category (QuickBooks, Wave, a CPA); V1 is the version of it that knows
what a trip, a leg, a day rate and a travel day are. Positioning in an
existing category means never having to sell the problem — only why the
generic answer fits a flying business badly.

**The mechanic is proof, not headline.** Trip-native — invoice lines
generated, a per-leg logbook draft, receipts filed against the trip — is
the reason to believe, stated in section 2 as the three questions a trip
answers: what am I owed, what did I fly, what did it cost.

**Belonging is still proved by vocabulary and defaults**, never by an
unsigned boast that pilots built it:

> "day records typed flight, travel, standby or off" · "PIC and SIC kept
> distinct" · "tag it rebill or deduct"

**Hold this angle.** Two positionings in one week is already one more than
a brand should spend. Distinctive assets (the navy, the mark, the mono
identifiers) and this message now stay consistent for years, not quarters;
the next person who wants to reposition should have to argue against this
paragraph.

---

## 4. Message hierarchy

| Rank | Beat | Where it lives |
|---|---|---|
| 1 | The identity claim: flying is the job, this is the business | Hero H1 |
| 2 | What the books hold: owed, earned, spent, year-end | Hero subhead |
| 3 | The mechanic as proof: the three questions a trip answers | Section 2 |
| 4 | Who the reader is not: what a pilot's clients receive | Section 2 closing row (`#for-operators`) |
| 5 | Trust, from promises the code enforces | Section 3 promises |
| 6 | The four barriers left | Section 4 FAQ |
| 7 | Depth as evidence of belonging | Section 5 spec block |
| 8 | Cost, and the promise that outlives the card | Section 6 close |

Re-ordered 2026-08-18 with the landing rewrite. Two beats are new — the
operator row and the promises band — and the spec block moved BELOW the FAQ.
That last move is structural, not editorial: with a `sunk` promises band
added, leaving the spec block where it was put two `sunk` grounds back to
back and left the FAQ as the page's last word before the close. The page
now alternates brand / canvas / sunk / canvas / sunk / brand, and no stretch
of it is more than two beats from a conversion action.

**The operator beat is a self-selection beat, not an audience expansion.**
There is no operator account type in the schema and no operator tier in
`lib/entitlements.ts`; §2 below excludes operators buying for their pilots.
The row exists so an owner or AP desk who followed a pilot's link can
recognise themselves and stop, and so the pilot can see what their clients
receive. It never asks an operator to sign up.

**Hero copy, verbatim:**

- **Eyebrow** — For independent contract pilots
- **H1** — Flying is the job. This is the business.
- **Subhead** — V1 keeps the books for your flying business: who owes
  you, what you earned, what you spent, and the year-end packet your CPA
  asks for. All of it comes off the trips you fly.

The subhead's opening phrase is the tagline verbatim — one phrase, spoken
identically everywhere the brand speaks, which is the whole of how a small
brand builds a memory structure. Section 3's heading deliberately does NOT
use it a third time.
- **Fine line** — Plans start at $29/month; the $5 first month applies to
  monthly plans. Card required.

The fine line was re-signed 2026-08-18. The scope clause is not decoration:
`lib/stripe/server.ts` mints the intro coupon per MONTHLY price only ("a
first month has no meaning on an invoice that bills a year at a time"), so
an unqualified "$5 first month" beside a page that also sells annual plans
is a price claim this product does not honour. Correcting offer scope is
what §5's history demands; the H1, eyebrow and subhead above are untouched
and stay verbatim.

`BRAND.tagline` ("The books for your flying business.") stays in the
footer, the auth column and metadata. The H1 says who the reader is
becoming; the subhead says what the product holds; neither asks a slogan
to do that work.

**Section 2 no longer contains a comparison.** The old "Today: retyped
into an invoicing tool" column existed to serve the duplicate-entry
argument and left with it (§7). Claim rule 7 still binds any comparison a
future edit reintroduces.

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

11. **Figures are interpolated, never typed.** The $5 first month comes
    from `INTRO_FIRST_MONTH_LABEL` (the same constant the checkout's
    coupon is minted from); the
    public amounts come from `TIER_PRICE_COPY`. Pre-purchase surfaces
    (`/welcome`, settings/billing) read the *live* Stripe Price so the
    number shown equals the charge, and render "Unavailable" rather than a
    made-up figure when a price env is unset.

---

## 6. Word budgets

Six sections, down from ~1,600 words across ~13 beats. The standard is
**ten seconds on FBO wifi**: hero alone answers what it is, who it's for and
what it costs; hero plus section 2 earns a qualified yes or no inside
thirty. That standard is unchanged by the 2026-08-18 re-budget below and is
still met — the hero is 68 words.

Both columns below are real, and they are not the same number. **Budget** is
what the strategy asked for; **Shipped** is what `app/(marketing)/page.tsx`
actually renders today. Keeping both is what makes this a check rather than
an aspiration — the table used to show only the budget, and the page had
been over it since the day it was written, so an editor comparing the two
found them out of step with no way to tell which was authoritative.

**Shipped is now measured, not tallied by hand.** Render the page, open
every `<details>`, drop the `[data-mock]` subtree (the product screenshots
and their captions are illustrative data, not copy), then take each `main > section`'s rendered
text and count whitespace-separated tokens containing a letter or digit.
The `data-mock` attribute on `product-shot.tsx` exists for this and nothing
else. Measuring the DOM rather than the source is what lets the derived
tier badges and the interpolated figures be counted as a reader meets them.

| # | Section | Budget | Shipped |
|---|---|---|---|
| 1 | Hero, navy — identity H1, money subhead, mock | 75 | 68 |
| 2 | What a trip is worth — three question rows + the clients row | 155 | 151 |
| 3 | Four promises, sunk — trust shelf and the mid-page action | 85 | 83 |
| 4 | Questions pilots ask us — four FAQ items + contact row | 175 | 171 |
| 5 | The rest of the books — spec block and price anchor | 125 | 123 |
| 6 | Close, navy — plans line and one action | 30 | 27 |
| | **Total** | **645** | **623** |

**RE-BUDGETED AND RE-SIGNED 2026-08-18, with the landing rewrite** —
`docs/reviews/10-landing-page-copy.md` is the spec and carries the reasoning
per line. The previous total was 430 budgeted / 384 shipped, and the honest
statement of this change is that the page grew by about 240 rendered words.
Where they went, and why none of it was met by trimming:

- **The clients row (~40).** A beat the page did not have: what an owner or
  operator receives, so the pilot can see what they are buying and the
  operator can self-select out of a signup they would churn from.
- **The promises band (~83).** Claim rule 8 bans testimonials, statistics
  and customer counts, and this product has none. The trust shelf therefore
  has to be built from facts the code enforces — including the zero-take-rate
  fact, which is the strongest compliant trust signal available and had
  appeared nowhere on any public page.
- **A fourth FAQ item, the contact row, and the offer-scope clause (~55).**
  Each answers a specific audit finding: the data objection went unanswered
  on a product that asks for bank statements; there was no contact channel
  at the moment a prospect has an unanswered question; and the offer did not
  say which plans it applied to.

Two things keep this from being budget drift. First, the **section 4 figure
is a fully-expanded count** — the method above opens every `<details>`, and
a reader who opens none meets four question lines, about 30 words. Second,
the hero still carries the ten-second standard on its own at 68 words, under
its own budget, which is the number that decides whether the page works on
FBO wifi.

Section 2's budget absorbed the clients row (110 + 40 + the mobile clause)
rather than giving it a section of its own — it renders as the closing row
of the same ledger, so it is the same beat's ground.

The pre-rewrite table, for reference: hero 70/55, section 2 110/102, spec
block 100/82, FAQ 120/117, close 30/28, total 430/384.

**Rules of thumb behind the budgets**

- **No section intro paragraphs.** The heading is the intro. Three of them
  (103 words) explained the thing sitting directly beneath them.
- **A body paragraph that restates its own heading is deleted, not
  trimmed.** The old 65-word hero paragraph restated the H1 three times.
- **One idea, one statement.** The old wedge's slogan appeared twelve
  times on the pre-2026-08 landing page and seventeen across the signed-out
  surface. The tagline — whatever it currently is — renders in the footer,
  the auth panel and metadata, and is never repeated through the page body.
- **Two aphorisms on the whole page, a full screen apart** — the spec
  block's heading ("The rest of the books") and the lapsed-card line in the
  FAQ. Seven clever titles in a row reads to a working professional as being
  sold to. The 2026-08-18 rewrite added no third: "Four promises" is a label,
  not a turn of phrase, and the promises themselves are flat declaratives on
  purpose.
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
- **The standalone comparison section** (2026-08), and then **the
  comparison itself** (2026-08-17). First the second *section* went — it
  re-listed the invoice, the logbook entry and the receipts a screen after
  section 2 had already listed them, under a heading that was the H1's
  sentence a second time. Then the repositioning removed the surviving
  middle column ("Today: retyped into an invoicing tool…"), because it
  existed to argue duplicate entry and that argument is retired. Claim
  rule 7 stays binding on any comparison a future edit reintroduces.
- **The workflow wedge itself** (2026-08-17, owner's direction). "Log the
  trip once", "Stop entering the same trip three times", and every echo of
  them — the H1, the tagline, the root SEO description, the OG card's
  baked-in text, the Solo tier blurb, the Overview and Trips empty states,
  and the help guide's summary. The mechanic those slogans described is
  still the product and still appears as proof (§3); what left is the
  claim that saved data entry is the reason to buy. §3 records why the
  money position replaced it — and its "hold this angle" paragraph is the
  condition for cutting it: a positioning is not something this page
  changes seasonally.
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
| Intro first-month price | `INTRO_FIRST_MONTH_LABEL`, `lib/stripe/server.ts` |
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
