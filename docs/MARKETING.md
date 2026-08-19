# Marketing — positioning, message hierarchy, claim rules

The approved strategy for the signed-out surface, written down once so
future copy has a source. Signed off in the 2026-08 rewrite, repositioned
2026-08-17, and **rewritten again 2026-08-19 at the owner's direction** —
that last pass changed the VOICE, the message ORDER and the site's
INFORMATION ARCHITECTURE, and it is recorded in §3.1, §4 and §4.1. §5's
claim rules are unchanged and still absolute.

The 2026-08-17 entry below is kept because it explains why the money beats
exist and where they went, not because the arrangement it describes is
current. Where the two disagree, 2026-08-19 wins.

**The 2026-08-17 note, for context.** It read: the workflow wedge
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

> V1 is a business management platform built for pilots. You log the trip
> once and the invoice, the per-leg logbook drafts and the year-end numbers
> all come off that one record.

The 2026-08-17 one-liner ("the books for a flying business of one: who owes
you, what you earned, what you spent, and the year-end packet your CPA asks
for") is retired as the LEAD, not as content. Those four money beats are the
payoff of the landing page's section 2 and the whole of /how-it-works step
06. `BRAND.tagline` still says "The books for your flying business." and
still renders only in the footer, the auth column and metadata.

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

**The category is a business management platform, and the mechanic is the
headline** (2026-08-19). The owner's own post opens with the category
sentence and then the mechanic, and the site now does the same. The H1 is
"One trip entry drives the rest." and the subhead carries both the category
claim and what the one record produces.

This supersedes the 2026-08-17 arrangement, in which the money beats led and
the mechanic was demoted to proof. What changed is ORDER, not content. The
money is still the payoff and it is now stated in more places than before,
because the 2026-08-19 pass also put the Stripe Connect answer on the site
for the first time (§3.1).

**Why the mechanic can lead now when it could not before.** The retired
2026-08 wedge sold single-entry as a saving ("stop entering the same trip
three times"), which is a mechanism nobody wakes up wanting. "One trip entry
drives the rest" is the same architecture sold as a CAPABILITY, and every row
under it ends on something the pilot wanted anyway, meaning an invoice that
is already priced, a logbook that is already drafted, and a year that is
already written. The difference is what the sentence promises, not which
feature it describes.

**The money is still the reason to buy.** The Overview leads with Unbilled
work / Awaiting payment / Paid this year, LEDGER.md chose the fintech
register "because this product is, above all, how they get paid", and the
landing page's section 3 is now entirely about getting paid. Pilots already
pay for this category (QuickBooks, Wave, a CPA), so the argument is never
that the problem exists, only that the generic answer fits a flying business
badly.

**Belonging is still proved by vocabulary and defaults**, never by an
unsigned boast that pilots built it:

> "day records typed flight, travel, standby or off" · "PIC and SIC kept
> distinct" · "tag it rebill or deduct"

**Hold this angle.** Two positionings in one week is already one more than
a brand should spend. Distinctive assets (the navy, the mark, the mono
identifiers) and this message now stay consistent for years, not quarters;
the next person who wants to reposition should have to argue against this
paragraph.

## 3.1 The voice, and the post it comes from (2026-08-19)

The owner posted this from the V1 account and told us to write the site the
same way. It is the register of record. When a future draft and this block
disagree, this block wins.

> V1 is a business management platform we built for pilots. One trip entry
> drives the rest.
>
> You log the trip once. Your client, the a/c tail #, the legs you flew and
> which days were duty, commuting, or cancellation. After that the invoice
> is already built and priced off the custom configured client profile &
> your preferences. Logbook entries already drafted, waiting for approval.
> Receipts from the trip attach to the invoice automatically if desired.
>
> Not flying for a bit? Set your subscription hold date, it'll unpause by
> itself.
>
> Come tax season everything's already in your P&L and your quarterly
> totals. Payment processing integrated directly through our platform via
> your stripe account.
>
> No more spreadsheets gentlemen. You're Welcome.
>
> Solo starting at $29 a month, first month $5 on any plan.

**What the site takes from it.** Plain declaratives. Second person
throughout. Ordinary contractions. Clauses joined with *and* / *so* / *then*
rather than stacked on commas, roughly one comma a sentence, and a short
line only where one is earned. The category sentence first, the mechanic
second, the money as the payoff. No colon-lists. No em dashes. No
rule-of-three pileups. None of "streamline", "purpose-built", "seamless",
"all-in-one", "take control of".

**What the site deliberately did NOT take, and why.**

- **"No more spreadsheets"** is on the banned-phrase list this repo's
  aviation-marketing skill keeps, for the same reason "say goodbye to" is:
  it is the shape of the claim rather than a claim, and this audience reads
  it as agency copy. The idea survives on /how-it-works, stated as the
  actual situation ("you're the integration between those three").
- **"gentlemen"** addresses part of this audience and excludes the rest. A
  closing joke that lands in one Facebook group is not the front door of
  the business, and the cost of being wrong about it is a screenshot. Cut,
  along with "You're Welcome.", which reads as swagger in a post and as
  smugness on a homepage.
- **"duty, commuting, or cancellation"** is not what the product seeds. A
  new account gets Flight day, Travel day and Standby day
  (`20260807000000_phase9_day_types_and_trip_days.sql`) and the taxonomy is
  the tenant's own after that. The site names the seeded three and says the
  list is yours, which is both accurate and a better claim.
- **"Receipts ... attach to the invoice automatically"** is true but needs
  its trigger stated, or it breaks claim rule 1. The pilot tags an expense
  `rebill`, and `createInvoiceDraft` then carries the tagged ones onto the
  invoice as `reimbursable_expense` lines. Every place the site says this,
  the pilot's tag is in the sentence.

**Three things in that post were true, shipped, and had never appeared on
the public site at all.** All three are on it now:

| Claim | Implementation | Where it landed |
|---|---|---|
| Payment processing through the pilot's own Stripe account | `lib/stripe/connect.ts` (Standard Connect, direct charges, no application fee), `lib/stripe/connect-payments.ts` | Landing §3, /how-it-works step 05, /pricing FAQ, /your-data |
| Subscription hold that resumes on its own date | `lib/stripe/hold.ts`, `app/(app)/settings/account-actions.ts` | Landing FAQ, /your-data |
| Receipt pages going out attached to the invoice PDF | `app/(app)/invoices/actions.ts` | Landing §2 row 03, /how-it-works step 03 |

The Stripe one is the significant omission. Chasing payment is the pain
this audience actually names, the product has shipped an answer to it, and
the public site had never once said a client can pay an invoice.

---

## 4. Message hierarchy

Rewritten 2026-08-19 for the landing page's six bands.

| Rank | Beat | Where it lives |
|---|---|---|
| 1 | The mechanic as the claim: one trip entry drives the rest | Hero H1 |
| 2 | The category, and what the one record produces | Hero subhead |
| 3 | The four things it drives, ending on the year | Section 2 |
| 4 | Getting paid, through the pilot's own Stripe account | Section 3 |
| 5 | Depth as evidence of belonging | Section 4 spec block |
| 6 | The four barriers left, and a door to the long answers | Section 5 FAQ |
| 7 | Cost, and the promise that outlives the card | Section 6 close |

**Hero copy, verbatim:**

- **Eyebrow** — For independent contract pilots
- **H1** — One trip entry drives the rest.
- **Subhead** — V1 is a business management platform we built for pilots.
  You log the trip once and the invoice, the logbook drafts and the
  year-end numbers all come off that one record.
- **Fine line** — Plans start at $29/month, and the first month is $5 on any
  of them. Card required.

**"We built" is the voice, and it is deliberate.** V1 speaks as a company
throughout the site, never as a founder. "We built V1 for pilots" is in;
"I built this because I fly" is out, and so is any unsigned boast that
pilots built it (claim rule 8). Belonging is proved by vocabulary and
defaults instead:

> "flight day or travel day or standby" · "PIC and SIC kept apart" · "mark
> it rebill or keep"

`BRAND.tagline` ("The books for your flying business.") stays in the footer,
the auth column and metadata, and is never repeated in a page body.

**Section 2 contains no comparison.** The old "Today: retyped into an
invoicing tool" column existed to serve the duplicate-entry argument and
left with it (§7). Claim rule 7 still binds any comparison a future edit
reintroduces — the one position the site does take, on /how-it-works, names
no competitor and calls no other tool bad at its own job.

## 4.1 The information architecture (2026-08-19)

The public site was four pages, two of which were counsel-gated legal
placeholders. Everything the product had to say lived on `/` and everything
a sceptic wanted lived inside collapsed `<details>` rows. "How it works" in
the header and the footer was an ANCHOR, `/#how-it-works`, which is what a
site does when it has one page and four sections.

```
/                    Landing. What it is, the mechanic, getting paid, the
                     spec block, four questions, the price.
/how-it-works        One trip start to finish, in six steps, plus the one
                     position the site takes (the multi-client inversion).
/pricing             Three plans, the generated matrix, six FAQ answers.
/your-data           Export, hold, cancel, and what AMG can and cannot read.
/terms  /privacy     Counsel-gated placeholders. noindex, footer only.
```

**Header nav**, in priority order: How it works · Pricing · Your data · Log
in · Get started. Five items plus the mark, inside the 4–7 guidance. "How it
works" hides below `sm` and "Your data" below `md` so the CTA never wraps to
a second row on a phone.

**Footer**: Product (How it works, Pricing, Your data) · Account · Legal.

**Why these two pages and no others.** `/how-it-works` because the owner's
direction was to explain the system more clearly and a first-time reader
found the old page confusing, and because a walkthrough is the highest-intent
page a product like this can own. `/your-data` because export on every plan
is the strongest claim this product has (claim rule 6) and it was hidden
behind an accordion, and because a pilot who has been burned by an app that
lost their data goes looking for exactly that page.

Deliberately NOT added: a blog, `/about`, `/contact`, per-feature pages, or
comparison pages. There are no customers yet, no content to hub, and nothing
to say on an about page that claim rule 8 permits. Three marketing pages that
are all worth reading beats eight that are not.

**Indexation follows the structure.** `app/sitemap.ts` and `app/robots.ts`
both list all four indexable paths, and both still fail closed off
production (`VERCEL_ENV`). /terms and /privacy stay off both lists and keep
their own noindex.

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
every `<details>`, drop the `[data-mock]` subtree (the product screenshots
and their captions are illustrative data, not copy), then take each `main > section`'s rendered
text and count whitespace-separated tokens containing a letter or digit.
The `data-mock` attribute on `product-shot.tsx` exists for this and nothing
else. Measuring the DOM rather than the source is what lets the derived
tier badges and the interpolated figures be counted as a reader meets them.

Re-budgeted 2026-08-19 for the six-band landing page. Two things moved the
total: section 2 gained a fourth row (the year), and section 3 is new. The
FAQ grew by one item and lost nothing, because the hold is a real question a
pilot asks and the site had never answered it outside a /pricing accordion.

| # | Section | Budget | Shipped |
|---|---|---|---|
| 1 | Hero, navy — mechanic H1, category subhead, mock | 75 | — |
| 2 | You log the trip once — four rows | 175 | — |
| 3 | Getting paid — Stripe Connect, with its limit | 115 | — |
| 4 | What else is in there — spec block | 110 | — |
| 5 | Questions pilots ask us — four FAQ items | 190 | — |
| 6 | Close, navy — plans line and one action | 35 | — |
| | **Total** | **700** | — |

**Shipped is unmeasured on this revision** and the dashes say so rather than
carrying the previous version's numbers forward as if they still described
the page. Re-measure with the method above (render, open every `<details>`,
drop `[data-mock]`, count per `main > section`) and fill the column in. An
invented figure in this table is worse than an empty one: the whole point of
keeping both columns is that a future editor can tell budget from fact.

**The total roughly doubled, deliberately.** The 430-word budget was written
for a page that was the entire site. It is now the front door of four pages,
and the depth it used to have to carry alone lives on /how-it-works and
/your-data. The ten-seconds-on-FBO-wifi standard is unchanged and still met
by the hero: what it is, who it is for, what it costs.

**Page budgets for the two new pages**, on the same standard:

| Page | Budget |
|---|---|
| /how-it-works — six steps, the position, the close | 900 |
| /your-data — four sections, the limitation, the close | 700 |

Re-budgeted at the 2026-08-17 repositioning: these are fresh numbers for
the money position, not the old wedge's budgets carried over. Section 2's
budget dropped from the merged 155 because the "Today: retyped into…"
comparison column left with the angle that needed it — the rows now carry
a question and its answer, nothing else. The hero's rose slightly: the
subhead now carries the whole value proposition (owed, earned, spent,
year-end) where the old one restated the H1's mechanism.

**Rules of thumb behind the budgets**

- **No section intro paragraphs.** The heading is the intro. Three of them
  (103 words) explained the thing sitting directly beneath them.
- **A body paragraph that restates its own heading is deleted, not
  trimmed.** The old 65-word hero paragraph restated the H1 three times.
- **One idea, one statement.** The old wedge's slogan appeared twelve
  times on the pre-2026-08 landing page and seventeen across the signed-out
  surface. The tagline — whatever it currently is — renders in the footer,
  the auth panel and metadata, and is never repeated through the page body.
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
