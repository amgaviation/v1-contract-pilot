# Marketing council — V1's positioning after the 2026-08-19 rewrite

> **Simulated council.** Each take below is built from the advisor's published
> frameworks and documented positions, applied to this repo. None of it is the
> real person's review of V1, and no advisor is quoted except where the quote is
> traceable to their own published work. Living advisors (Godin, Dunford,
> Hormozi, Sharp) are simulated applying their method, never endorsing.

**Summary.** The 2026-08-19 move from the money lead to the mechanic lead was
the right call on sophistication grounds and the council mostly backs it — but
it was executed with the payoff missing. `app/(marketing)/page.tsx:217` ships
three rows in the band whose own comment (`:208`, `:580`) and whose word budget
in `docs/MARKETING.md` §6 both describe **four**, and the row that is gone is
"the year", i.e. the money. So the page now leads with a mechanism and never
lands the outcome it was supposed to lead to, which is the one arrangement
nobody on this bench would defend. Worse, the phrase the strategy calls "one
phrase, spoken identically everywhere the brand speaks" is not the phrase in the
code: `BRAND.tagline` reads **"V1, we make the decision simple"**
(`lib/brand.ts:32`), which renders in the homepage `<title>`, the OG alt text,
the footer, both auth surfaces and the PWA manifest — and in an audience where
"V1" *is* the go/no-go decision speed, a claim to make the decision simple is
the one claim §5 rule 4 forbids outright. Three public surfaces also state the
$5 offer without its monthly-only scope, which is the exact failure
`docs/MARKETING.md`'s own history section was written to prevent. Fix those
three before touching the H1; then test the lead, in the Facebook groups, not
on a page nobody is visiting yet.

---

## The question before the council

The 2026-08-19 rewrite moved the lead from the money position ("the books for a
flying business of one") back to the workflow wedge as a capability ("One trip
entry drives the rest"). Right call for a cold audience? Stakes: a solo founder,
pre-launch, no customers, three tiers, a $5 first month, and a wedge that has now
moved twice in one week.

## Seated: Schwartz, Dunford, Godin, Hormozi, Ogilvy — plus Sharp as dissenter

The five the brief named, with Byron Sharp added as the designated dissenter
because the other five all argue *about* which differentiated message wins, and
somebody on the bench has to argue that the message matters less than being
recognisable and reachable at all.

---

### Eugene Schwartz — market sophistication and awareness stage

Schwartz's first question is not "is this headline good" but "what stage is this
market at, and does the headline meet the prospect exactly there." This market is
at sophistication stage three, arguably four. The pilot has heard "run your
business," "get paid faster," "books made simple" from QuickBooks, Wave, and every
horizontal SaaS ad that ever ran. Direct claims are exhausted. `docs/PRICING.md`
§2.8 concedes the point in the founder's own numbers: this pilot is already paying
$629.99/year across ForeFlight, LogTen and QuickBooks. Nobody needs to be sold
that the problem exists. At stage three, Schwartz's prescription is unambiguous —
**you introduce a new mechanism, and the mechanism becomes the headline.** "One
trip entry drives the rest." is a mechanism headline. On the sophistication axis
the 2026-08-19 pass moved *toward* the correct stage, not away from it.

Awareness is the axis where he'd push back. The cold pilot arriving from a
Facebook link is problem-aware at best: he knows January is a mess, he does not
know a trip-native books category exists. A mechanism headline assumes
solution-awareness. The page compensates in two places — the eyebrow ("For
independent contract pilots", `page.tsx:505`) and the subhead's first clause
(`:517`) — and Schwartz would accept the eyebrow as legitimate: the headline's
only job is to stop the prospect and get the first sentence read, and to this
reader "trip entry" is his own vocabulary, not jargon. What he would not accept is
the mechanism arriving without its payoff. In *Breakthrough Advertising* the
mechanism is only ever a route to the desire; it is never the destination. The
band under the H1 was designed to walk mechanism → invoice → logbook → receipts →
**the year**, and the fourth row is not in the shipped array. The page therefore
performs the classic stage-three error in reverse: it elaborates a mechanism and
then stops before channeling it onto the desire that was already there.

**Bottom line:** the mechanic lead is correct for the stage; restore the money row
under it, because a mechanism without its payoff channels nothing.

### April Dunford — is the competitive alternative framed right?

Dunford starts at the top of the chain: if V1 did not exist, what would this pilot
honestly do instead? The repo already has the answer, and it is a good one —
`docs/MARKETING.md` §2 says the pilot runs a logbook app plus a spreadsheet plus
QuickBooks and **"they are personally the integration between the three."** That
is a real competitive alternative, it is the status quo rather than a named rival,
and it is exactly the shape *Sales Pitch* asks for.

Her objection is where it lives. That sentence appears on `/how-it-works`
(`app/(marketing)/how-it-works/page.tsx:227-240`) and nowhere on the landing page.
The landing page's section 2 used to carry a comparison column and it was deleted
with the wedge (`docs/MARKETING.md` §7). So the front door now presents a
mechanism with no alternative to be better *than*. In Dunford's chain the
unique attribute ("one record feeds all three jobs") is stated, but the value it
enables is invisible without the frame, because a buyer cannot price "one entry"
unless he has just been reminded he currently does three. The insight in that
`/how-it-works` panel — every client's system is built to look at their own crew,
none of them can look at your whole year — is the single best sentence on this
site, and it is two clicks from the fold.

Her second objection is the category. §3 declares the category "a business
management platform," which is the vaguest available frame and the one that makes
V1's strengths invisible: it is the same phrase Jobber, Housecall and forty
horizontal tools use. "Books for a flying business" is the frame that makes the
strengths obvious, and the 2026-08-19 pass demoted it into the subhead's second
clause. She would keep the mechanic H1 and fight to get the category and the
alternative into the section-2 rail, which currently spends its 40 words restating
the H1 (`page.tsx:597-604`).

**Bottom line:** the alternative is identified correctly and then filed on the
wrong page; the front door names no status quo, so the mechanism has nothing to
be better than.

### Seth Godin — is this remarkable to *this* pilot?

Godin's test is whether a specific person would remark on it, and whether they'd
be missed if gone. Two things here pass that test and one of them is buried.

The first is vocabulary. "PIC and SIC kept separate" (`page.tsx:237`), "flight day
or a travel day or standby" (`:601`), "one draft per leg" — that is not marketing
about pilots, that is a product that knows what a leg is. Godin would call this the
right kind of proof: people like us do things like this, demonstrated rather than
announced. §3's refusal to prove belonging with a founder boast is correct and
should stay correct.

The second is the promise band (`page.tsx:371-376`): cancel and nothing is deleted,
export on every plan including Solo, and client payments going straight to the
pilot with no fee taken. The fourth of those is genuinely remarkable in this
category — a vertical SaaS that touches a solo operator's invoicing and refuses to
take a point of it. `docs/PRICING.md` §6 says why in one sentence: taking a cut of
a pilot's invoice makes the vendor a participant in their client relationship.
Godin's view is that this is the purple cow and it is sitting fourth in a
four-item grid under the label "Four promises," which is a filing cabinet, not a
claim. He would also note that the FAQ's lapsed-card line — a pilot's logbook is a
legal record, and a lapsed card will never be the thing that destroys one
(`page.tsx:456`) — is the most tellable sentence on the site, and it is inside a
collapsed `<details>`.

Where he dissents from the whole bench: he does not think the H1 is the decision.
"One trip entry drives the rest" and "the books for a flying business of one" are
both fine, and neither is the reason anyone tells another pilot about this. The
smallest viable audience here might be a few hundred people who all read the same
two Facebook groups, and what spreads in that room is *we never take your money
and we never delete your logbook*, not a headline.

**Bottom line:** the remarkable thing is already built and shipped, and the page
files it fourth in a grid; the H1 debate is being had at the wrong altitude.

### Alex Hormozi — does the offer carry the risk it should?

Hormozi does not look at the headline. He looks at the value equation and asks
which variable is weakest. Dream outcome: strong and specific. Time delay: strong —
the payoff starts on the next trip. Effort and sacrifice: fine. **Perceived
likelihood of achievement: nearly zero, and nothing on the page addresses it.**
This is a brand with no customers, no testimonials permitted, no case studies, no
counts, and no way for a stranger to verify that the invoice really does build
itself. Every lever he'd normally reach for to fix that is banned by §5 rule 8, and
correctly so.

That leaves the one lever §5 does not ban: risk reversal. And the current offer
moves risk in the wrong direction. The card is required, there is no trial, and
`app/(marketing)/pricing/page.tsx:371` states in the FAQ that "the $5 you already
paid isn't refunded." $5 is a trivial amount of money, and the page spends a
sentence explaining that you cannot have it back. That sentence buys nothing and
costs the only certainty signal available. There is no guarantee anywhere on any of
the three pages. Hormozi's read: the product is priced against a $1,200 day rate
(`docs/PRICING.md` §2.8) with a first-month price of five dollars, and the founder
is still guarding the five dollars.

His second point is volume, and it is the uncomfortable one. All of this is
argument about a page that, pre-launch, has approximately no visitors. The leverage
order is market, then offer, then persuasion — the page is the third of three, and
it is where all the work has gone.

**§5 tension, stated plainly.** Hormozi's default fix is a stacked bonus, a
deadline and scarcity language. All three are prohibited: §5 rule 8 bans invented
statistics and urgency-and-scarcity framing outright, and this product has no
customers to count. **The compliant version of his fix** is: (1) state the
first-month exit as a guarantee in the hero fine line rather than as a refund
refusal buried in the pricing FAQ — the mechanic already exists, cancel in the
first month and nothing more is charged; (2) make the $5 refundable on request in
the first month, which is a real risk reversal costing at most $5 a churned
signup, and say so in one flat sentence with no exclamation and no deadline; (3)
elevate the export-and-never-deleted promise into the hero's fine line, because for
this buyer "you can always leave with everything" *is* the guarantee.

**Bottom line:** the weakest variable is perceived likelihood, the only permitted
lever is risk reversal, and the offer currently reverses none of it.

### David Ogilvy — does the page actually sell?

Ogilvy's first question is whether the homework was done, and here it plainly was:
the copy is factual, specific and benefit-led, and it does not insult the reader.
"It priced itself off the rate card you set up for that client"
(`page.tsx:222`) is the Rolls-Royce sentence of this page — a concrete, checkable
detail doing the work a hundred adjectives would not. He would keep it.

His complaints are structural and he would make three. First, the fine line under
the hero CTA is three facts about billing (`page.tsx:560-564`) at the exact point in
the page where a benefit belongs; the reader is asked to absorb a price scope
clause before he has been told what he gets. Second, the page's own conversion path
contradicts itself: the hero's secondary button says **"Compare plans"** and links
to `/how-it-works` (`page.tsx:136`, `:539-548`), a page with no prices on it until
its closing band. A reader who clicks a promise of prices and gets a six-step
walkthrough has been told the page does not keep its word, in the one place — the
fold — where "you have spent eighty cents out of your dollar." Third, the same
offer is spoken in three different ways across the site: "Start your books — $5
first month" on the landing page (`:133`), "Try V1 — $5 first month" at the close
of `/how-it-works` (`how-it-works/page.tsx:266`), "Start for $5" on the pricing
cards (`pricing/page.tsx:189`). The landing page's own header comment records why
"Try" was retired — it promises a trial the funnel does not have — and the
retired label is still shipping one click away.

On the strategic question: he would side with keeping the mechanic H1, on the
grounds that it is closer to a Big Idea than the money line ever was, and would
then ask the only question he really cares about — how will you measure whether it
sold? Nothing on this site is instrumented to answer that.

**Bottom line:** the copy is honest and factual, and the page's own navigation
breaks the promise its buttons make; fix the buttons before rewriting a word of
the H1.

### Byron Sharp — the dissenter

Sharp's position is that this entire session is a debate about a variable that
barely moves the outcome. Two headlines, both accurate, both in the buyer's own
language, will not differ measurably in their effect on a brand with essentially
zero mental availability. What decides whether V1 exists in two years is whether
the pilot thinks of it at the moment the category need arises — the January
scramble, the unbilled trip, the new client who wants an invoice — and whether
it is easy to find and buy when he does.

His practical objections are three. One: the brand has been repositioned twice in
one week, and every reposition resets whatever memory structure existed. §3's
"hold this angle" paragraph is the single most valuable sentence in
`docs/MARKETING.md` and it should be treated as binding. Two: the distinctive
assets — navy, the mark, the mono identifiers — are being maintained
(`docs/MARKETING.md` §3.2), which is right, but the verbal asset is broken:
`BRAND.tagline` in `lib/brand.ts:32` is not the phrase the strategy document says
it is, so the one line that appears in the title tag, the OG card, the footer and
both auth screens is not the line anyone chose. That is a distinctive-asset
failure, and it is a bigger deal than the H1. Three: §2's exclusions ("explicitly
not: flight departments... operators buying for their pilots") are tight targeting
of the kind he argues caps growth — though he would concede the B2B and near-zero
scale caveats that his own critics raise apply here more than usual.

**Bottom line:** neither headline will decide this; brand consistency and being
findable will, and the verbal asset is currently inconsistent with the strategy in
code.

---

## Where the council disagrees

1. **Schwartz vs. Dunford — mechanism or category first.** Schwartz says a
   stage-three market has exhausted direct claims, so the mechanism *is* the
   headline. Dunford says a mechanism with no competitive alternative in view is
   uninterpretable, and the frame ("the books for a flying business") is what
   makes the mechanism legible. The real trade-off: **stage of market vs. frame of
   reference** — is this reader saturated with claims, or missing context? They
   are reconcilable and the shipped page nearly does it: mechanic H1, category and
   alternative in the section-2 rail. What would settle it: which of two Facebook
   posts — mechanic-first vs. status-quo-first — earns more click-throughs from
   the same group.

2. **Hormozi vs. Godin — risk reversal or trust by character.** Hormozi wants a
   guarantee because perceived likelihood is the weak variable and it is the only
   permitted lever. Godin's position is that a guarantee is a transactional patch
   on a trust problem, and the four promises already *are* the guarantee if they
   are stated as identity rather than filed as a grid. The real trade-off:
   **certainty bought with money vs. certainty bought with character.** What would
   settle it: put the refund sentence in the hero fine line for a fortnight and
   watch signup-start rate; it costs at most $5 per churned signup to learn.

3. **Sharp vs. everyone — does the message matter at all here.** Sharp says two
   accurate headlines are within noise of each other and the compounding asset is
   consistency and availability. Ogilvy and Schwartz both hold that at zero
   awareness the message is the only asset there is. The real trade-off:
   **penetration mechanics derived from FMCG vs. a pre-launch B2B vertical with
   one channel.** His own documented limits (the laws come from FMCG panel data;
   he has acknowledged B2B application challenges) apply directly. But his
   narrower point survives the caveat completely: repositioning twice in a week
   is self-harm, and the tagline in the code is a live inconsistency.

4. **Ogilvy vs. Godin — where the effort belongs.** Ogilvy would spend the next
   week on headline discipline and measurement. Godin would spend it in the two
   Facebook groups where the smallest viable audience already talks. The real
   trade-off: **craft on the asset vs. presence in the room.** For a solo founder
   with no traffic, the room wins on arithmetic — but only once the page keeps the
   promises its buttons make, which is Ogilvy's precondition and is not currently
   met.

---

## Chair's synthesis

**The 2026-08-19 call was right, and it is not finished.** Moving the lead to the
mechanic-as-capability is correct for a stage-three market whose buyer already
pays for the category, and the owner's own post is field evidence that the
mechanic is what this audience responds to. But the rewrite's own design put the
money at the end of the mechanic band — four rows "ending on the year" — and the
fourth row is not in the code. The page as shipped leads with a mechanism and
then never pays it off, which is the one arrangement neither the money position
nor the workflow wedge would have produced on its own. That is a bug, not a
strategy question, and it should be fixed before anyone argues about the H1 again.

Then: hold the angle. §3's "two positionings in one week is already one more than
a brand should spend" is the most important paragraph in the document, and the
next reposition should have to argue against it. What is left to do is not a third
position; it is (a) making the code say what the strategy says, (b) making the
buttons keep their promises, and (c) putting one compliant certainty signal into
the offer.

**Do, in this order:**

1. **Fix the tagline** (`lib/brand.ts:32`). It is one string and it is currently
   the site's largest §5 exposure and its largest brand inconsistency.
2. **Restore section 2's fourth row** — the year, the P&L, the quarterly totals,
   the packet — so the mechanic lands on the money the strategy says is still the
   reason to buy.
3. **Sweep the offer scope and the CTA labels** across `/pricing` and
   `/how-it-works` so the monthly-only qualifier and the one CTA wording are the
   same everywhere the offer appears.
4. **Add the compliant certainty sentence** to the hero fine line (first-month
   exit, export on every plan) and take the decision on refunding the $5.

**Tripwire:** Sharp's. If a fifth positioning conversation opens before the site
has met a hundred real visitors, the problem being solved is not positioning.

**What I would test first — and it is not an A/B test on this page.** There is no
traffic; a landing-page split test pre-launch measures nothing. The first test is
Hopkins-shaped and runs where the audience already is: **two versions of the
owner's own post into the pilot Facebook groups, a week apart** — one opening on
the mechanic exactly as the current H1 does, one opening on the status quo
("you're the integration between a logbook app, a spreadsheet and QuickBooks"),
both closing on the same offer sentence. Measure clicks to the site and, from the
same UTM, signup starts. That answers Schwartz vs. Dunford with the market's own
behaviour, costs nothing, and produces the sentence the H1 should be. The page-level
A/B test is the *second* test, and it only becomes meaningful once the first one
has produced traffic.

**Execute with:** `product-marketing` for the section-2 rail and the restored money
row; `copywriting` for the hero fine line and the CTA sweep; `pricing` for the
refund decision; `analytics` before either test, because nothing here is currently
instrumented to tell you which post worked.

---

# Findings

Every finding below cites a file opened during this run. Nothing is reported from
memory. The fixes are written as proposed diffs only — no source file was edited.

---

### 1. `BRAND.tagline` breaks §5 rule 4 and contradicts the strategy in six rendered places

**Severity: CRITICAL** · `lib/brand.ts:32`

**Evidence.** The constant reads:

```ts
tagline: "V1, we make the decision simple",
```

`docs/MARKETING.md` §1 and §4 both state the tagline is **"The books for your
flying business."** and §4 builds an argument on it: *"The subhead's opening
phrase is the tagline verbatim — one phrase, spoken identically everywhere the
brand speaks, which is the whole of how a small brand builds a memory
structure."* The shipped subhead (`app/(marketing)/page.tsx:517-520`) does not
contain the shipped tagline, so that mechanism does not exist.

Where the actual string renders (`grep BRAND.tagline`):
`app/(marketing)/page.tsx:123` (homepage `<title>`),
`app/(marketing)/layout.tsx:61` (OG image alt),
`app/(marketing)/site-footer.tsx:72`,
`app/(auth)/auth-brand.tsx:95`,
`app/(auth)/layout.tsx:66`,
`app/manifest.ts:37` (PWA description).

Per `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md:344`
(`title.absolute` "defines the route title, it ignores `title.template` from
parent segments"), the homepage title resolves literally to
`V1 — V1, we make the decision simple` — the brand name twice, and a claim.

**Why it is a §5 defect and not a taste question.** Rule 4: *never state or imply
the product decides whether a pilot is legal to fly.* The homepage's own comment
(`page.tsx:114-121`) records that "V1" is "the takeoff decision speed every pilot
searches and drills." To this exact reader, "V1, we make the decision simple" is
a sentence about the go/no-go decision. The landing FAQ spends 39 words disclaiming
precisely that (`page.tsx:447-448`), and the title tag above it makes the claim.
It also breaches rule 9 in effect: the brand string is not the one the strategy
signed. `app/(auth)/` is in scope per §5's own scope note, and this renders there
twice.

**Fix.**

```diff
-  tagline: "V1, we make the decision simple",
+  tagline: "The books for your flying business.",
```

Then re-read `page.tsx:123` (the title becomes `V1 — The books for your flying
business.`) and confirm `public/brand/og-image.png` does not have the old line
baked in — `app/(marketing)/layout.tsx:51` says the OG image carries "the mark
plus BRAND.tagline", so the raster may need regenerating.

---

### 2. Section 2's money row — "the year" — is missing from the shipped page

**Severity: HIGH** · `app/(marketing)/page.tsx:217-260`

**Evidence.** `DRIVES` contains three entries: `01` the invoice, `02` the logbook
drafts, `03` "What did it cost?". The file's own comment above the array
(`:208-215`) describes a fourth: *"Row 04 describes reports. It must never acquire
a tax OUTCOME... TWO OF THE FOUR CARRY A SCREENSHOT... Rows 03 and 04 have none."*
The section's JSX comment (`:580-581`) says *"The mechanic, in four rows, ending on
the year."* `docs/MARKETING.md` §6 re-budgets section 2 explicitly because
*"section 2 gained a fourth row (the year)"*, and §3 defends the mechanic lead on
the grounds that *"every row under it ends on something the pilot wanted anyway...
and a year that is already written."*

The row is not in the array. The equivalent copy exists only on `/how-it-works`
step 06 (`how-it-works/page.tsx:146-151`).

**Consequence.** This is the whole council question in one defect. The rewrite
moved the lead off money on the explicit promise that money remained the payoff of
section 2; on the shipped page the money payoff appears as three words in the hero
subhead ("the year-end numbers") and then not again until the spec block's
generated list. A cold reader gets a mechanism and a receipt-tagging workflow.

**Fix.** Restore the row, worded to survive §5 rule 10 (describes the software, no
tax outcome):

```diff
   {
     step: "03",
     q: "What did it cost?",
     body: "Scan a receipt at the FBO from your phone's browser and attach it to the trip. Mark it for client reimbursement or keep it with your deductible expense records.",
   },
+  {
+    step: "04",
+    q: "The year is already written.",
+    // Rule 10: this describes the software. It records and totals; it
+    // never asserts a tax outcome. "Lands in the year's totals" is
+    // allowed; "lowers your taxable income" is not.
+    body:
+      "Every trip you logged is already a line in your profit and loss and in your quarterly totals, so the year-end packet your CPA asks for is built out of the work you already did. Nothing gets rebuilt in January.",
+  },
 ];
```

Re-measure §6's shipped column afterwards by the method §6 prescribes.

---

### 3. The $5 offer is stated without its monthly-only scope on three public surfaces

**Severity: HIGH** · `app/(marketing)/pricing/page.tsx:53`, `:130`, `:189`, `:311`;
`app/(marketing)/how-it-works/page.tsx:253-254`

**Evidence.** The landing page carefully scopes the offer — *"the $5 first month
applies to monthly plans"* (`page.tsx:560-564`), with a 9-line comment explaining
that `lib/stripe/server.ts` mints the intro coupon per **monthly** price only.
`docs/MARKETING.md` §4 re-signs that clause and calls an unqualified version *"a
price claim this product does not honour."*

The other two pages make the unqualified claim:

- `pricing/page.tsx:130` — "**{$5} for your first month, on every plan.** The
  regular price applies from month two." On a page that sells annual on every card
  (`:158`, `priceLine()` at `:92`/`:98`).
- `pricing/page.tsx:52-53` (metadata description, the crawlable sentence) — "every
  plan starts at $5 for the first month."
- `how-it-works/page.tsx:253-254` — "Plans start at $29 a month and the first month
  is **$5 on any of them**."
- The three plan-card buttons and the closing CTA read "Start for $5"
  (`pricing/page.tsx:189`, `:311`) with no scope anywhere near them.

The same page's own FAQ contradicts all of this at `:371`: *"$5, on any monthly
plan... Annual plans bill the plain annual price from day one."*

**Consequence.** A pilot who reads the hero line, picks annual, and is charged
$290 has been given a false price. `docs/MARKETING.md`'s "An offer change must
sweep the SHELL" section exists because three false price claims already shipped
this way once.

**Fix.**

```diff
-            {INTRO_FIRST_MONTH_LABEL} for your first month, on every plan.
-            The regular price applies from month two.
+            {INTRO_FIRST_MONTH_LABEL} for your first month on any monthly plan.
+            The regular price applies from month two, and annual plans bill the
+            annual price from day one.
```

```diff
-              Plans start at {TIER_PRICE_COPY.solo.monthly} a month and the
-              first month is {INTRO_FIRST_MONTH_LABEL} on any of them.
+              Plans start at {TIER_PRICE_COPY.solo.monthly} a month, and the
+              {INTRO_FIRST_MONTH_LABEL} first month applies to monthly plans.
```

and the same qualifier in the `/pricing` metadata description. The card buttons
can stay short if the scope line sits above them in the same band, which after
this change it does.

---

### 4. The hero's secondary CTA says "Compare plans" and goes to `/how-it-works`

**Severity: HIGH** · `app/(marketing)/page.tsx:136`, `:539-548`

**Evidence.**

```ts
/** Both /pricing links, hero and spec block, say the same thing too. */
const PRICING_CTA = "Compare plans";
```

and in the hero:

```tsx
<NextLink href="/how-it-works" className={...}>
  {PRICING_CTA}
</NextLink>
```

The constant's own comment asserts both uses are `/pricing` links. Only the spec
block's is (`:882`). The hero's is not, and `/how-it-works` shows no plan
comparison — its only price statement is in the closing band 250 lines down
(`how-it-works/page.tsx:253`).

**Consequence.** The page's second-most-clicked element makes a promise the
destination does not keep, at the fold. It also means the hero offers no route to
prices at all, on a page whose §6 standard is that "hero alone answers what it is,
who it's for and what it costs."

**Fix.** Keep the destination (the walkthrough is the right second action) and fix
the label, or keep the label and fix the href. Ogilvy's preference and mine is the
former, since section 2 already routes to `/how-it-works` with a better label:

```diff
 const PRICING_CTA = "Compare plans";
+
+/** The hero's second action. The walkthrough, not the price list — the
+ *  spec block carries the /pricing link further down. */
+const WALKTHROUGH_CTA = "See how it works";
```

```diff
               <NextLink
                 href="/how-it-works"
                 className={lButtonClass({ size: "lg", variant: "onBrandOutline", className: "rounded-full" })}
               >
-                {PRICING_CTA}
+                {WALKTHROUGH_CTA}
               </NextLink>
```

Then correct the comment on `PRICING_CTA`, which will then be true.

---

### 5. `/how-it-works` re-ships the retired "Try V1" trial promise

**Severity: HIGH** · `app/(marketing)/how-it-works/page.tsx:266`

**Evidence.** The close renders `Try {BRAND.name} — {INTRO_FIRST_MONTH_LABEL}
first month`. The landing page's header comment (`page.tsx:85-89`) records the
2026-08-18 decision in as many words: *"THE CTA STOPPED PROMISING A TRIAL. 'Try
V1' promised an immediate, low-stakes look at the product; the next screens are an
identity form, a mandatory email round trip and a plan-and-card screen. 'Start your
books' is what the path actually is, and it is the same label on all three
actions."* `START_CTA` (`page.tsx:133`) is that label. There is no trial:
`.agents/product-marketing.md` records "card required at signup, no free trial."

So the site now speaks its one offer in three labels — "Start your books — $5 first
month", "Try V1 — $5 first month", "Start for $5" — and the retired one is the
only one that describes a product experience the funnel does not provide.

**Fix.** Export the constant and use it, so this cannot drift again:

```diff
-// app/(marketing)/page.tsx
-const START_CTA = `Start your books — ${INTRO_FIRST_MONTH_LABEL} first month`;
+// app/(marketing)/start-cta.ts — one offer, one string, imported by all
+// three marketing pages.
+export const START_CTA = `Start your books — ${INTRO_FIRST_MONTH_LABEL} first month`;
```

```diff
-              Try {BRAND.name} — {INTRO_FIRST_MONTH_LABEL} first month
+              {START_CTA}
```

The `/pricing` card buttons can keep "Start for $5" if the owner wants the short
form on a price card, but the two full-sentence CTAs should be identical.

---

### 6. The offer reverses no risk, and spends a sentence refusing to

**Severity: MEDIUM-HIGH** · `app/(marketing)/pricing/page.tsx:371`;
`app/(marketing)/page.tsx:560-564`

**Evidence.** The pricing FAQ's first answer ends: *"Cancel during the first month
and nothing more is charged: the $5 you already paid isn't refunded, and the
account stays open until that first month ends."* The hero fine line
(`page.tsx:560-564`) states price, scope and "Card required." No guarantee appears
on any of the three pages. There are no testimonials, counts or case studies —
correctly, §5 rule 8 forbids them and there are no customers.

**Consequence (Hormozi's value equation).** With certainty unpurchasable by proof,
the only remaining lever is risk reversal, and the offer moves risk toward the
buyer: card required, no trial, non-refundable. Five dollars is not a sum worth
defending against a buyer whose alternative is $629.99/year of tools
(`docs/PRICING.md` §2.8).

**§5 tension, explicit.** The advisor's own playbook reaches for a bonus stack, a
deadline and scarcity. §5 rule 8's ban on urgency and invented statistics rules all
three out, and they should stay ruled out — this audience reads them as agency copy
and the founder has no numbers to stack. **The compliant version:**

```diff
             <p className="text-caption text-brand-ink-2">
               Plans start at {TIER_PRICE_COPY.solo.monthly}/month; the{" "}
               {INTRO_FIRST_MONTH_LABEL} first month applies to monthly plans.
-              Card required.
+              Card required. Cancel inside the first month and nothing else is
+              charged, and your records stay exportable whatever you decide.
             </p>
```

No deadline, no scarcity, no claim of a refund the product does not give. If the
owner will also refund the $5 on request in the first month — a decision, not an
agent's to make — the FAQ sentence at `:371` becomes a guarantee instead of a
refusal, for a maximum exposure of $5 per churned signup.

---

### 7. `docs/MARKETING.md` §4 still specifies the retired hero, and §4 is where an editor looks

**Severity: MEDIUM** · `docs/MARKETING.md` §4 (hero copy block) vs. §3 and
`app/(marketing)/page.tsx:513`

**Evidence.** §3 records the 2026-08-19 decision: *"The H1 is 'One trip entry
drives the rest.'"* Twenty lines later §4, under the heading **"Hero copy,
verbatim"**, says:

> **H1** — Flying is the job. This is the business.
> **Subhead** — V1 keeps the books for your flying business: who owes you, what
> you earned, what you spent, and the year-end packet your CPA asks for...

and adds *"the H1, eyebrow and subhead above are untouched and stay verbatim."*
The shipped H1 is `One trip entry drives the rest.` (`page.tsx:513`) and the
shipped subhead is the category-plus-mechanic sentence (`:517-520`). §4's ranked
message hierarchy is also stale — rank 1 is "The identity claim: flying is the job,
this is the business | Hero H1", and rank 2 assigns the money beats to the hero
subhead, which is no longer where they are.

**Consequence.** This is the governance failure underneath the council question.
The document that outranks every marketing skill now disagrees with itself in two
adjacent sections, and the stale half is the one labelled "verbatim". The next
editor who follows §4 will revert the 2026-08-19 rewrite while believing they are
enforcing it. §5's own history section names this exact failure mode: *"a comment
guarding a line is not a check, and it will outlive the line it guards."*

**Fix.** Rewrite §4's hero block and the rank 1/2 rows to the shipped strings, and
move the retired hero into §7 ("What was cut, and why it stays cut") where the
2026-08-17 money hero already has a home. Keep §3's "hold this angle" paragraph
exactly as it is.

---

### 8. `docs/PRICING.md` still specifies a 14-day card-required trial as policy

**Severity: MEDIUM** · `docs/PRICING.md` §5 and §8 items 3 and 4

**Evidence.** §5 opens: *"**Trial: 14 days, card required, every self-serve tier —
and the trial runs at Pro feature level.**"* §8 lists as an open owner decision:
*"3. **Trial length.** Proposed **14 days** (from 7), card required,
trial-at-Pro-level. Options: 7 / 14 / 30"* and *"4. Annual at signup or as in-app
upgrade after month one... to keep the first charge small on a card-required
trial."* §3.2 repeats the framing: *"annual at signup on a card-required trial
makes the first charge $290–$490+."*

There is no trial. `app/(marketing)/page.tsx:85-89` records that the trial was
replaced by the intro-price offer, `.agents/product-marketing.md` states "card
required at signup, no free trial", and every shipped CTA carries
`INTRO_FIRST_MONTH_LABEL`.

**Consequence.** `docs/PRICING.md` is named in `docs/MARKETING.md` §8 as a source
of truth for the offer. A skill or an editor reading it writes trial copy — which
is how "Try V1 free" reached the header, "Start free trial" the footer, and "Start
your trial" the signup card, per `docs/MARKETING.md`'s own account.

**Fix.** Add a dated superseding note at the top of §5 and strike §8 item 3:

```diff
 ## 5. Trial policy, downgrade, and cancellation
+
+**SUPERSEDED 2026-08-17: there is no trial.** The 7-day card-required trial was
+replaced by the intro-price offer — the first month of a new MONTHLY
+subscription at INTRO_FIRST_MONTH_LABEL (lib/stripe/server.ts), annual
+unaffected. The trial reasoning below is kept only because the downgrade,
+hold and cancellation commitments that follow it are current and still bind
+the public pages. §8 item 3 is closed by this note.
```

---

### 9. The competitive alternative is named only on `/how-it-works`, never on the front door

**Severity: MEDIUM** · `app/(marketing)/how-it-works/page.tsx:227-240` vs.
`app/(marketing)/page.tsx:593-613`

**Evidence.** The status-quo frame `docs/MARKETING.md` §2 identifies — *"they run a
logbook app plus a spreadsheet plus QuickBooks or Wave, and they are personally the
integration between the three"* — is written out on `/how-it-works` as *"You're the
integration between those three, and you do it by typing the same trip in over and
over."* Nothing equivalent appears on the landing page: §7 records that section 2's
comparison column was removed with the wedge in the 2026-08-17 pass and never
replaced.

Section 2's rail currently spends its words restating the H1
(`page.tsx:597-604`): heading "You log the trip once", body describing what you
type. The mechanic is stated twice in the same 4-of-12 column.

**Consequence (Dunford's chain).** The unique attribute is present, the value it
enables is stated, but the alternative it beats is absent, so a cold reader has
nothing to price the value against. It is also the page's only opportunity to make
the §5-rule-7-safe argument: no competitor named, no tool called bad at its own
job, the cost named is the seam between three tools that do not know about each
other.

**Fix.** Replace the rail's second sentence, which restates the heading, with the
frame — no added words, and it satisfies §6's "a body paragraph that restates its
own heading is deleted, not trimmed":

```diff
                 <p className="text-body text-ink-2">
                   Put in the client, the tail number, the legs you flew and how
                   each day counted, whether that was a flight day or a travel
-                  day or standby. That's the only time you type any of it.
+                  day or standby. That's the only time you type any of it, and
+                  it's the last week you're the integration between a logbook
+                  app, a spreadsheet and whatever you use for books.
                 </p>
```

---

### 10. The mechanic H1 assumes solution-awareness the cold reader does not have

**Severity: MEDIUM** · `app/(marketing)/page.tsx:505-520`

**Evidence.** The fold reads, in order: eyebrow "For independent contract pilots"
(`:505-507`), H1 "One trip entry drives the rest." (`:513`), subhead "V1 is a
business management platform we built for pilots. You log the trip once and the
invoice, the logbook drafts and the year-end numbers all come off that one record."
(`:517-520`). The category word is "business management platform"; the outcome
words ("year-end numbers") are the subhead's last four.

**Consequence (Schwartz).** The H1 is a mechanism sentence, which is the correct
move for a stage-three market — but a mechanism headline presumes the reader is
solution-aware, and the pilot arriving cold from a Facebook link is problem-aware.
Everything that tells him what this *is* sits below the H1 in body type, and the
category phrase chosen is the least distinguishing one available: "business
management platform" is the phrase every horizontal vertical-SaaS tool uses, and
`docs/MARKETING.md` §3 itself argues elsewhere that the money frame is what makes
the strengths obvious.

This is not a defect in the sense the findings above are — the copy is honest and
the arrangement is defensible. It is the live strategic question, and the answer
is testable rather than arguable.

**Fix.** Do not change the H1 on argument. Do finding 2 first (the payoff row),
then run the two-post test described in the synthesis. If the status-quo opener
out-clicks the mechanic opener in the group, the variant to try on the page is the
one already drafted in `docs/reviews/10-landing-page-copy.md` §1, and §3's "hold
this angle" bar applies to any change that follows.

---

### 11. `/how-it-works` carries the stale "LogTen Pro" vendor branding the landing page fixed

**Severity: LOW-MEDIUM** · `app/(marketing)/how-it-works/page.tsx:132`

**Evidence.** Step 04 reads *"Bring your history with you from a ForeFlight or
LogTen Pro export."* The landing FAQ carries a 7-line comment recording the
opposite decision (`page.tsx:436-444`): *"'LogTen', not 'LogTen Pro': Coradine was
acquired in 2022 and the product's own headings, navigation and App Store listing
are 'LogTen' / 'LogTen Pilot Logbook' today (logten.com, checked 2026-08-18)...
Stale vendor branding is a credibility tell in front of exactly this reader. The
import screens in app/(app) were corrected in the same change."* The landing FAQ
answer itself says "ForeFlight or LogTen export" (`:444`).

`/how-it-works` was written the following day and did not get the correction.

**Fix.**

```diff
-    body: "One draft per leg, with PIC and SIC time kept apart, waiting in a queue. You look them over and approve them and they go in. Bring your history with you from a ForeFlight or LogTen Pro export, or any CSV through the column mapper.",
+    body: "One draft per leg, with PIC and SIC time kept apart, waiting in a queue. You look them over and approve them and they go in. Bring your history with you from a ForeFlight or LogTen export, or any CSV through the column mapper.",
```

(`docs/PRICING.md` §2.3 and §2.8 also say "LogTen Pro", but those are internal
memos citing a price list, not public copy.)

---

### 12. Counted claims in the strategy docs no longer match the code

**Severity: LOW** · `app/(marketing)/page.tsx:409` and `:434-462`;
`docs/MARKETING.md` §6; `.agents/product-marketing.md:20-25`

**Evidence.** Three separate count/quote drifts, each individually small, together
showing the docs are no longer being re-derived from the code:

- The FAQ comment says **"FOUR QUESTIONS"** (`page.tsx:409`) and the array holds
  **five** (`:434-462`). `docs/MARKETING.md` §6 budgets "four FAQ items + contact
  row" at 171 shipped words, so the shipped column cannot have been re-measured
  since the fifth was added — and §6's entire claim to be "a check rather than an
  aspiration" rests on that column being measured.
- §6's section 2 figure (151) was budgeted for four rows plus the clients row;
  the page ships three plus the clients row (finding 2).
- `.agents/product-marketing.md:20-25` quotes the **retired 2026-08-17
  one-liner** as the verbatim current §1 ("V1 is the books for a flying business
  of one..."), and its core-mechanic paragraph cites an array called `RECORDS` in
  `app/(marketing)/page.tsx`; the shipped array is `DRIVES` (`page.tsx:217`). The
  brief is dated 2026-08-18, one day before the rewrite. It is the file this
  skill and every other marketing skill is told to read first, so it currently
  hands them the superseded position.

**Fix.** Correct the FAQ comment to "FIVE QUESTIONS", re-run §6's measurement
method after finding 2 lands and update both columns in one pass, and add a
`**Superseded 2026-08-19**` banner to `.agents/product-marketing.md` pointing at
`docs/MARKETING.md` §3/§3.1 for the current one-liner and at `DRIVES` for the
mechanic array.

---

## What I did not cover

- **Anything behind the auth wall.** `/signup`, `/login`, `/welcome`,
  `/forgot-password` and `/reset-password` are inside §5's scope by its own
  statement, and §5's history says the auth strings have broken twice on the same
  screen — but they were not in this council's assigned work product and I did not
  open them. Given the tagline defect in finding 1 renders on two of those
  screens, they should be swept by hand as part of that fix.
- **`/your-data`, `/privacy`, `/about`, the site header and footer**, beyond the
  single `grep` for `BRAND.tagline`. `docs/MARKETING.md` §3.1 says the Stripe and
  hold claims also landed on `/your-data`; I did not check their wording against
  `lib/stripe/hold.ts` or `lib/stripe/connect.ts`.
- **Verification of the feature claims themselves.** §5 rule 2 warns that ten of
  seventeen features carry empty `routePatterns`, so `tests/marketing-pricing-model.test.mjs`
  structurally cannot catch a false claim on trips, invoices, expenses, clients,
  logbook, documents or reports_core — and that those claims must be checked by
  hand. I read `lib/entitlements.ts` only through `pricing-model.ts`'s imports and
  did **not** hand-verify the SPEC lines, the `/pricing` matrix rows, or the
  `/logbook/import` claim the rule names as the example. That check is outstanding
  and it is the one §5 says nobody is doing.
- **The visual and CRO layer.** `app/design/marketing.css`, the reveal/motion
  behaviour, mobile rendering, and the `#for-operators` inbound-link behaviour from
  the four tokenized client-facing routes. The prior review series
  (`docs/reviews/00`–`10`) covers CRO and UX and I read only its headers plus the
  landing-copy spec's status line.
- **Any live research pass.** The skill offers one; I ran none. Every advisor take
  above is grounded in the dossiers in
  `.claude/skills/marketing-council/references/advisors/` and nothing else, so
  positions attributed to living advisors reflect their published frameworks as
  the dossiers record them, not any statement made after those dossiers were
  written.
- **Whether the price levels are right.** `docs/PRICING.md` §2 and §3.2 were read
  for the offer structure and the day-rate framing only. The council did not
  relitigate $29/$49/$39-per-seat, and Hormozi's premium-pricing instinct would
  argue Pro is underpriced against the replacement math in §3.2 — that is a
  separate session.
- **No file was edited.** Every fix above is a proposed diff. Nothing was applied,
  no migration was written, no command was run against the database, and no git
  operation was performed.
