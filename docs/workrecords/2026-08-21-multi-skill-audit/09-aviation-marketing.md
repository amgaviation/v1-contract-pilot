# 09 — Aviation marketing audit: does this read like it was written by someone who has flown the job?

**Scope:** `app/(marketing)/**`, `app/(auth)/**`, `lib/brand.ts`, plus the constants those
surfaces interpolate (`lib/stripe/server.ts`, `lib/entitlements.ts`,
`app/(marketing)/pricing/pricing-model.ts`) and the schema I checked claims against.
**Date:** 2026-08-21. **Method:** every public string read in this run; every claim traced
to the code or migration that implements it; `docs/MARKETING.md` §5, the `aviation-expert`
and `aviation-marketing` skills, and `docs/reviews/10-landing-page-copy.md` read first.

---

## Summary

Most of this copy passes the test, and it passes it in the places that are hardest to fake:
`/how-it-works` walks one trip the way a pilot would describe their own week, per diem and a
cancellation fee land on the invoice because the trip earned them, one logbook draft per
**leg** with PIC and SIC kept apart, receipts scanned at the FBO, the year-end packet framed
as the thing a CPA asks for, and three of six walkthrough steps carry an honest limitation —
including the refund sentence, which is the most credible thing on the site. The
legality line is held cleanly everywhere it is tested: the landing FAQ, the pricing FAQ and
`/your-data` all say the decision is the pilot's, and the currency board is genuinely absent
rather than hedged. **The AMG check passes with nothing to report: `BRAND.attribution` renders
once in the marketing footer (`app/(marketing)/site-footer.tsx:109`) and nowhere else; no
public string implies AMG operational endorsement, certification, or that V1 is an AMG
product.** What fails is concentrated in three places and all three are recent-drift, not
authorship: the **brand tagline now inverts the meaning of the term the product is named
after and reads as a go/no-go claim** (F1); the **$5 first month is claimed unscoped on three
consecutive pre-card screens** while the code grants it to monthly only (F2); and the site's
**single strongest credibility asset — real Part 135 qualification tracking, 135.293/.297/.299
with the 135.301(a) grace month, per operator — is invisible on every public page** while the
documents claim reads as a Part 91 GA list (F4, F5). Fix F1 and F2 before launch; F4 is the
highest-value addition available to this page and costs about forty words.

---

## F1 — The tagline inverts V1 and reads as a legality claim

**Severity: critical.**
**Location:** `lib/brand.ts:32`, rendering at `app/(marketing)/page.tsx:123`,
`app/(marketing)/layout.tsx:61`, `app/(marketing)/site-footer.tsx:72`,
`app/(auth)/auth-brand.tsx:95`, `app/(auth)/layout.tsx:66`, `app/manifest.ts:37`.

**Evidence.**

```ts
// lib/brand.ts:32
tagline: "V1, we make the decision simple",
```

14 CFR § 1.2 defines V1 as "the maximum speed in the takeoff at which the pilot must take the
first action … to stop the airplane within the accelerate-stop distance," and the minimum
speed at which the takeoff may be continued after an engine failure at V<sub>EF</sub>
(verified 2026-08-21; eCFR was serving a redirect wall, so this text is from the § 1.2
listings, not from memory). Every pilot in the addressable market drills this: V1 is the
point at which **the decision has already been made and you are committed**. There is no
decision left to simplify at V1 — that is the entire meaning of the callout. The line reads,
to the only audience that matters, as though the writer chose the most famous
speed in aviation for its sound and not its meaning. `app/(marketing)/page.tsx:118` shows the
repo already knows this: *"'V1' is one of the most overloaded words in this exact audience's
vocabulary: the takeoff decision speed every pilot searches and drills."*

Second, and worse: **"the decision"** on a product whose documents wallet tracks medical,
flight review, PIC proficiency check and insurance expiry
(`lib/custom-options.ts:132-139`) is read as the go/no-go decision. That is the claim
`docs/MARKETING.md` §5 rule 4 forbids and that `CURRENCY_DISCLAIMER` (`lib/brand.ts:84`,
counsel-reviewed) exists to disclaim — "You remain responsible for your own currency and
airworthiness decisions." The tagline says the opposite of the counsel-reviewed sentence in
the same file. It is one of only three strings on the auth panel a pilot reads one screen
from a card (`app/(auth)/auth-brand.tsx:95`).

Third, mechanically: `app/(marketing)/page.tsx:123` builds the homepage title as
`` `${BRAND.name} — ${BRAND.tagline}` ``, which renders **"V1 — V1, we make the decision
simple"** in the browser tab and in every search result; `app/(marketing)/layout.tsx:61`
renders the OG alt as **"V1: V1, we make the decision simple"**.

Fourth, the doc of record disagrees with the code. `docs/MARKETING.md` §1 and §4 both still
state that `BRAND.tagline` is "The books for your flying business." — as does
`public/brand/og-image.svg:2,16,27`, whose own comment claims it is `BRAND.tagline` "copied
verbatim." Commit `a9493ab` regenerated the PNG and left the SVG source and the strategy doc
behind.

**Fix.** Restore the recorded tagline, or pick a line that survives the audience's reading of
its own vocabulary. Compliant candidates, all of which describe the software rather than a
decision:

```ts
tagline: "The books for your flying business.",   // the recorded line; §1, §4, og-image.svg
// or
tagline: "The business side of flying.",
```

If the owner wants to keep the V1 pun, the only version that survives a pilot's reading is one
where the *product* is the committed thing, not the pilot's decision — e.g. "Past V1 on the
paperwork." — and even that trades a rule-4 risk for a joke. My recommendation is to take the
pun out entirely: the brand *name* already does the work, and the tagline's job is to say what
the thing is. Then re-render `public/brand/og-image.svg` → `og-image.png` from the new
constant, and correct `docs/MARKETING.md` §1/§4 in the same commit.

---

## F2 — The $5 first month is claimed unscoped on three pre-card screens

**Severity: high (financial claim).**
**Location:** `app/(marketing)/pricing/page.tsx:129-131`,
`app/(marketing)/how-it-works/page.tsx:259-261`, `app/(auth)/signup/signup-form.tsx:172-178`.

**Evidence.** `lib/stripe/server.ts:66-68` is explicit: *"Annual plans get no intro month: a
'first month' has no meaning on an invoice that bills a year at a time, so annual checkouts
charge the plain annual price."* The landing hero scopes it correctly
(`app/(marketing)/page.tsx:560-563`: "the $5 first month applies to monthly plans"), and so
does the pricing FAQ (`pricing/page.tsx:371`: "on any monthly plan … Annual plans bill the
plain annual price from day one"). Three surfaces do not:

- `pricing/page.tsx:129` — "**$5 for your first month, on every plan.** The regular price
  applies from month two." This sits roughly two screens above the FAQ answer that
  contradicts it, on the page whose own heading promises to answer things "Before you enter
  a card."
- `how-it-works/page.tsx:259` — "Plans start at $29 a month and **the first month is $5 on any
  of them.**"
- `signup-form.tsx:173,177` — "**$5 for your first month.** … Your first month is $5; the
  regular price applies after that." No interval has been chosen yet at this point in the
  funnel, so this is an unconditional promise made before the pilot can know it does not
  apply to them.

The plan picker itself is correct and interval-aware (`welcome/welcome-actions.tsx:178-184`),
which means the discrepancy surfaces at the *last* screen: a pilot who came for "$5 on any
plan" and picks annual reads "billed today" at full price. This is precisely the failure
`docs/MARKETING.md` records under "An offer change must sweep the SHELL, not just the page."

**Fix.** One clause each; the qualifier already exists in two places, copy it.

```diff
-// app/(marketing)/pricing/page.tsx:129
-  {INTRO_FIRST_MONTH_LABEL} for your first month, on every plan.
-  The regular price applies from month two.
+  {INTRO_FIRST_MONTH_LABEL} for your first month on any monthly plan.
+  The regular price applies from month two, and annual plans bill their
+  plain annual price from day one.

-// app/(marketing)/how-it-works/page.tsx:259
-  Plans start at {TIER_PRICE_COPY.solo.monthly} a month and the
-  first month is {INTRO_FIRST_MONTH_LABEL} on any of them.
+  Plans start at {TIER_PRICE_COPY.solo.monthly} a month, and the
+  {INTRO_FIRST_MONTH_LABEL} first month applies to monthly plans.

-// app/(auth)/signup/signup-form.tsx:173-178
-  {introLabel} for your first month.
-  You pick a plan and enter a card on the next step. Your first
-  month is {introLabel}; the regular price applies after that.
+  {introLabel} for your first month on a monthly plan.
+  You pick a plan and enter a card on the next step. Pick monthly and
+  your first month is {introLabel} with the regular price after that;
+  pick annual and it bills the plain annual price.
```

The `/how-it-works` close also labels its CTA "Try V1 — $5 first month"
(`how-it-works/page.tsx:268`) where every other button on the site says "Start your books —
$5 first month" (`page.tsx:133`). Same offer, two labels, contrary to the file's own
"THE ONE OFFER, SPOKEN IDENTICALLY" rule.

---

## F3 — "Less than half of one flight day's pay" is false for part of the audience and for one of the three plans

**Severity: high.**
**Location:** `app/(marketing)/page.tsx:877-880`.

**Evidence.** The shipped line is:

> Three plans: Solo, Pro, and Business. A year of the books costs less than half of one
> flight day's pay.

The guard comment (`page.tsx:857-874`) reasons it against "PIC ~$1,200 at the bottom of the
range," sourced from `docs/PRICING.md:196-199`, which describes that source as *"a
crew-sourcing vendor publishing its own survey with no stated methodology — treat as
directional only"* and whose bottom rung is a **King Air 200 PIC**. Three problems:

1. **It is false for Business.** `pricing-model.ts:116-117` sets the Business floor at
   `$780` annual (two-seat minimum). Half of $1,200 is $600. The sentence sits directly
   beneath "Three plans: Solo, Pro, **and Business**," so the reader applies it to all three.
   The comment's escape hatch — "the most expensive plan a single pilot can buy" — is
   reasoning the reader never sees.
2. **It is false against the site's own illustration.** `product-shot.tsx:71-72` shows
   "three flight days at **$1,350.00**." Half is $675 — still under the $780 Business floor.
3. **It is false for a large slice of the real audience.** The benchmark is turbine PIC at
   the top of the market. An SIC seat, a light-jet or single-pilot turboprop day, or a
   first-year contract day rate commonly runs well under $1,000, at which point a $490 Pro
   year is *more* than half a day. This audience does that arithmetic against their own
   number in about two seconds, and the skill's rule is that being wrong once in this market
   is expensive.

Separately, **"one flight day's pay" is not the phrase.** A contract pilot says **day rate**.
"Flight day" is this product's internal day-type key; borrowing an internal enum where the
industry has its own word is the exact tell this audience reads as outsider writing.

**Fix.** Either cut the comparison (the skill's default: proof or cut), or bind it to the plan
it is actually true of and to the reader's own number rather than a vendor's:

```diff
-  Three plans: Solo, Pro, and Business. A year of the books costs
-  less than half of one flight day&apos;s pay.
+  Three plans: Solo, Pro, and Business. A year of Solo costs about what
+  one day rate does, and you can see the whole thing before your second
+  month bills.
```

If the owner wants the day-rate anchor kept, it needs a date-stamped, named source on the
page, and it must name the plan.

---

## F4 — The best credibility asset in the codebase appears on no public page

**Severity: high (opportunity, and the reason a skeptical pilot bounces).**
**Location:** absent from `app/(marketing)/page.tsx:280-345` (the spec block),
`app/(marketing)/how-it-works/page.tsx:105-152` (the six steps); surfaces only as an
unexplained noun in `app/(marketing)/page.tsx:452`, `pricing/page.tsx:379` and
`your-data/page.tsx:105` ("your aircraft and your operator qualifications are kept").

**Evidence.** The schema does the hardest thing in this domain, correctly:
`supabase/migrations/20260807110000_operator_qualification_reg_corrections.sql:408` computes
expiry for `written_test_135_293a` (12 calendar months, 135.293(a)),
`competency_check_135_293b` (12 cal. mo., class/type-specific),
`ipc_135_297` (6 cal. mo., type-specific per (e) rotation) and `line_check_135_299`
(12 cal. mo., explicitly **not** type-specific — one check in any one type covers every type),
each with the **135.301(a) one-month-early / one-month-late provision applied**, and it
deliberately computes **no determination at all** for `drug_alcohol_program_120` and
`prd_consent_111`. It is per-operator (`20260807060000_operator_qualifications.sql`), because
being typed and current personally is necessary and not sufficient under someone else's
certificate.

That is the single most convincing paragraph this product could put in front of a contract
pilot, and it is the one thing the public site never says. What the site says instead is
"Medical, flight review, passport, and insurance dates" (`page.tsx:294`) — a list a private
pilot would recognise — while the actual differentiator, *the thing no logbook app and no
accounting tool does*, sits behind the login unmentioned. A skeptical reader concludes the
product is a spreadsheet with invoices attached.

**Fix.** One spec row and one walkthrough note, both rule-4 safe because they describe records
and dates rather than a determination. Proposed, using the FAQ's own compliant register:

```diff
   // app/(marketing)/page.tsx — the "What you fly" / documents group
   {
     text: "Medical, flight review, passport, and insurance dates",
     features: ["documents"],
   },
+  {
+    text: "Per-operator qualification records: indoc, recurrent, competency and line checks, and the dates each one runs to",
+    features: ["documents"],
+  },
```

and, as a `note` on `how-it-works` step 06:

> Flying under more than one certificate means more than one set of qualification dates, so
> those are kept per operator rather than in one pile. You enter them off your own records
> and V1 shows you what's coming due. Whether you're qualified to fly a given leg stays your
> call and your operator's.

Two constraints on whoever writes this: (a) do not print a computed expiry as an assurance —
the migration is careful about 135.301(a) precisely because a wrong computed date is worse
than a blank one; (b) do not name a reg section in public copy unless someone re-verifies it
at eCFR that day. The copy above deliberately names the *checks* and not the section numbers.

---

## F5 — The documents claim omits the certificate, and leads with the Part 91 item

**Severity: medium.**
**Location:** `app/(marketing)/page.tsx:294`; wallet vocabulary at
`lib/custom-options.ts:132-139`.

**Evidence.** The wallet actually holds `medical` ("Medical certificate"), `flight_review`,
`pic_proficiency_check` ("PIC proficiency check (61.58)"), `passport`, **`certificate`**,
`insurance` and `w9`. The public line names four of seven and drops the two that matter most
to this reader: the **certificate** itself — the first document any operator, insurer or AP
desk asks for — and the 61.58 PIC proficiency check, which is the item a pilot flying a
turbojet or multi-crew type outside 91K/121/125/133/135/137 actually has to watch. Leading
with "flight review" is the Part 91 ordering; a contract pilot flying under a 135 certificate
often has the 61.56 review satisfied by a check under §61.56(d) and thinks about it least.

**Fix.**

```diff
-  { text: "Medical, flight review, passport, and insurance dates", features: ["documents"] },
+  { text: "Certificate, medical, passport, insurance and check dates, with W-9 in the same wallet", features: ["documents"] },
```

---

## F6 — Section 2 lost the row its own hero promises

**Severity: medium.**
**Location:** `app/(marketing)/page.tsx:216-260` (`DRIVES`), against `page.tsx:195-214`,
`page.tsx:576-578` and `docs/MARKETING.md` §6.

**Evidence.** The hero promises four things off one record — "the invoice, the logbook drafts
and **the year-end numbers**" (`page.tsx:516-520`). The band that proves it is introduced in
its own JSX comment as "The mechanic, **in four rows**, ending on the year" (`page.tsx:577`),
and the array's guard comment says "**Row 04 describes reports.** It must never acquire a tax
OUTCOME" and "Rows 03 **and 04** have none [no screenshot]" (`page.tsx:206-213`). `DRIVES`
contains three rows. The year row is gone, so the page's headline payoff — the beat
`docs/MARKETING.md` §6 budgets 155 words for and §3 calls "the reason to buy" — has no proof
row, and the surviving row 03 is titled "**What did it cost?**", a question heading among two
declaratives ("The invoice is already built." / "The logbook entries are already drafted.")
whose body is about scanning a receipt, not about cost.

This reads as a merge casualty rather than an editorial decision, and it is the shape of thing
that lets a retired claim walk back in: the guard comments now protect a row that does not
exist.

**Fix.** Restore the fourth row and give row 03 a declarative title matching its siblings and
its body:

```diff
   {
     step: "03",
-    q: "What did it cost?",
+    q: "The receipts are already on the trip.",
     body: "Scan a receipt at the FBO from your phone's browser …",
   },
+  {
+    step: "04",
+    q: "The year is already written.",
+    body:
+      "That trip is already a line in your profit and loss, in your quarterly totals and in the year-end packet your CPA asks for. Nothing gets rebuilt in January.",
+  },
```

(That body is `how-it-works` step 06's own sentence and stays inside rule 10: it describes
totals, it asserts no tax outcome.)

---

## F7 — The 1099 reality is implied everywhere and named nowhere

**Severity: medium.**
**Location:** `app/(marketing)/page.tsx:330`, `how-it-works/page.tsx:148`,
`pricing/page.tsx:123-127`; confirmed absent by a grep of the whole public surface.

**Evidence.** `docs/MARKETING.md` §2 defines the reader as "a one-person **1099** business …
and **filing the quarterlies** on all of it." The public copy says "quarterly summaries"
(`page.tsx:330`) and "your quarterly totals" (`how-it-works:148`). The words **1099**,
**estimated taxes**, **self-employed** and **Schedule C** appear on no public page; **W-9**
appears once, as three words inside a spec line (`page.tsx:285`). "Quarterly summaries" is
ambiguous — a reader takes it as a quarterly business report, which every accounting tool
has. The thing that actually keeps this pilot awake is what to send in on the four estimated
payment dates, and whether the shoebox of receipts from six different owners will survive
their CPA.

Naming it is free under rule 10, which forbids asserting a tax *outcome*, not naming the
*record*: "lands in the year's deductible total" is already blessed.

**Fix.** One word in the spec line and one clause in the walkthrough:

```diff
-  { text: "Profit and loss, quarterly summaries, and a CPA-ready year-end packet", features: ["reports_core"] },
+  { text: "Profit and loss, quarterly totals for your estimated payments, and a CPA-ready year-end packet", features: ["reports_core"] },
```

and in `how-it-works` step 06, "in your quarterly totals" → "in the quarterly totals you work
your estimated payments off". Neither sentence tells the pilot what they owe or what is
deductible; both name the record the reader is actually looking for. Do not go further — a
public string that computes or promises a tax figure is a counsel problem, not a copy one.

---

## F8 — /pricing publicly claims the bookkeeper seat

**Severity: medium (claim-rule break).**
**Location:** `app/(marketing)/pricing/page.tsx:178-181` rendering
`lib/entitlements.ts:386`, via `pricing-model.ts:78-80`.

**Evidence.** `docs/MARKETING.md` §5 rule 5: *"Seats are a billing fact, not a feature …
'Invite your bookkeeper' may not be claimed anywhere."* `publicTierAdds("business")` returns
every Business feature that is not in `PUBLIC_CLAIM_FILTER` — and the filter contains only
`"currency"` (`pricing-model.ts:50`). `multi_seat` is `comingSoon: true` but **not** filtered,
so the pricing card renders its label verbatim with a suffix:

> Additional seats for a bookkeeper or second pilot **(coming soon)**

The tier badge machinery on the landing page drops `comingSoon` rows, which is why the rule
looks obeyed there; `/pricing` renders them. The label makes exactly the bookkeeper claim the
rule bans, and marks it coming soon — which rule 3 already establishes is not a defence for a
claim that may not be made.

**Fix.** Change the label so it states the billing fact only. The per-seat price and the
two-seat minimum stay, per the rule.

```diff
-    label: "Additional seats for a bookkeeper or second pilot",
+    label: "Additional seats",
```

---

## F9 — "Based airport" is not the phrase, on the first field a pilot reads

**Severity: low-medium.**
**Location:** `app/(auth)/signup/signup-form.tsx:104` (label), `:109` (placeholder `KTEB`).

**Evidence.** The field is `home_base` in the code and "Based airport" on screen. Pilots say
**home base**, or just **base**; "based" is used of the *aircraft* ("a Citation based at
TEB"), not of the person. It is a small word in a big position: it is the second thing a pilot
types on the screen that precedes a card, on a surface `docs/MARKETING.md` says binds
"harder in practice." The `KTEB` placeholder is a good choice and should stay — it is a real
ICAO identifier at the field this audience actually flies out of — but nothing tells the pilot
whether "TEB" is acceptable.

**Fix.** `label="Home base"`, and make the hint carry the format:
`hint="ICAO or FAA identifier, e.g. KTEB"`.

---

## F10 — "Two minutes" is an unbacked claim, made twice

**Severity: low-medium.**
**Location:** `app/(auth)/signup/signup-form.tsx:83`, `app/(auth)/auth-brand.tsx:76`.

**Evidence.** "**Two minutes**, and your next trip's invoice lines and logbook drafts are
ready to review." and "**Set up takes about two minutes** and it starts working on the first
trip you log." Nothing in the repo measures this, and the actual path is signup → email
confirmation → plan pick → Stripe checkout → provisioning webhook → onboarding wizard that
collects address, certificate and rate defaults (`signup-form.tsx:27-33`). The signup line
also compresses that whole path into a claim about the *next trip*, which is the same
autonomy-flavoured shape the comment block immediately above it (`:71-80`) was written to
prevent — it is milder than "drafts its own invoice", but it is the same sentence pattern
surviving a third rewrite.

**Fix.** Cut the number, keep the promise that is checkable:

```diff
-  Two minutes, and your next trip&rsquo;s invoice lines and logbook
-  drafts are ready to review.
+  Set up your account, then log your next trip and read the invoice
+  lines and logbook drafts it puts in front of you.
```

Same treatment on `auth-brand.tsx:76`. If the owner wants a time claim back, time the real
path and date-stamp the number.

---

## F11 — The operator row talks past the person who reads it

**Severity: low.**
**Location:** `app/(marketing)/page.tsx:664-672`.

**Evidence.** The row is aimed at "the owners and operators you bill" and says they get "your
current **credentials** and insurance, all as browser links." The people on the other end are
a scheduler, a chief pilot, or an AP clerk, and they do not ask for "credentials" — they ask
for **a copy of your certificate and medical**, **a COI**, and **a W-9 before we can pay you**.
The product already models exactly that, with per-document consent so a client who asked for a
W-9 does not receive a passport (`20260810100000_credential_packet_share.sql:36,76`). The row
spends its one sentence on a vaguer word than the schema uses.

**Fix.**

```diff
-  Nothing for them to sign up for. The owners and operators you
-  bill get numbered invoices, estimates they can accept online,
-  and your current credentials and insurance, all as browser links.
+  Nothing for them to sign up for. The owners and operators you bill get
+  numbered invoices, estimates they can accept online, and a link to the
+  certificate, medical, insurance and W-9 they asked for, with nothing in
+  it you did not put there.
```

---

## What I did not cover

- **Rendered output.** I read source, not a running page. Word counts against
  `docs/MARKETING.md` §6's budget table, the reveal/reduced-motion behaviour, and how the copy
  breaks at phone widths are unverified here.
- **`app/(app)/**` in-app empty states.** My brief covers them only where public copy leaks
  into them; I read the public surface and `lib/brand.ts` and did not sweep the authenticated
  product's strings. Given F1, `BRAND.tagline` should be traced through every in-app render
  before it ships.
- **The four tokenized client-facing surfaces** (`/invoice`, `/estimate`, `/packet`,
  `/vendor`). They are read by the pilot's own client, not by a pilot, and they were outside
  the scope I was given — but they are public strings and they carry the product's voice to an
  AP desk. They deserve their own pass.
- **Regulatory verification beyond two points.** I verified the V1 definition (14 CFR § 1.2)
  live for F1 and read the 135.293/.297/.299/.301 reasoning in
  `20260807110000_operator_qualification_reg_corrections.sql` for F4. I did **not**
  re-verify those section numbers at eCFR in this run (it served a redirect wall), and any
  copy that ends up printing a reg cite publicly must be re-verified the day it is written.
- **Day-rate market data.** I did not run a fresh 2026 day-rate survey for F3. The finding
  stands on internal inconsistency (the site's own $1,350 illustration versus the $780
  Business floor), not on a competing figure. If the anchor is kept rather than cut, someone
  needs to source and date-stamp a real number.
- **SEO/GEO, `/terms`, `/privacy`, `/your-data` structure, and CRO.** `/terms` and `/privacy`
  are honest placeholders that say so; `/your-data` I read for claims and found none to fault.
  Persuasion, conversion and search were explicitly not my brief, and
  `docs/reviews/01-cro.md` / `10-landing-page-copy.md` already hold that ground.
