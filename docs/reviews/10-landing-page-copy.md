# Landing page copy — rewrite spec

**Status:** FINAL v3 (orchestrator) — CRO critic, UX critic, and aviation/voice flag passes all applied; every required change resolved or rejected with a reason (see Critic resolutions).
**Deliverable:** copy document only. No file under `app/` or `components/` is modified by this spec; it is written to be implemented against `app/(marketing)/page.tsx`.
**Inputs read:** `.agents/product-marketing.md`, `docs/reviews/09-EXECUTIVE-SUMMARY.md`, `docs/reviews/01-cro.md`, `docs/reviews/03-content.md`, `docs/MARKETING.md`, current `app/(marketing)/page.tsx`.

**Purpose (from the brief):** inform prospects so the right ones sign up with accurate expectations — maximize conversion and minimize future churn through clarity about what the product does and doesn't do. No hype, no dark patterns.

## Ground rules this spec obeys

1. Every §5 claim rule in `docs/MARKETING.md` binds every line here: two generated / one organised; nothing beyond shipped code; no currency-board mention; never legal-to-fly claims; seats are a billing fact; export-on-every-plan stated; workflow-only comparison; **no testimonials, statistics, customer counts, or founder boasts (there are no customers yet)**; brand strings from `lib/brand.ts`; no tax-outcome claims; figures interpolated from constants, never typed.
2. The money position holds. `docs/MARKETING.md` §3 was signed 2026-08-17 and says the next repositioning must argue against it; this rewrite executes that position better, it does not replace it. The H1 and subheadline are deliberately kept.
3. Markers: **[NEEDS PROOF: …]** = claim wanted but no grounding exists — do not ship without it. **[VERIFY: …]** = grounded in the repo; implementer confirms the exact fact before shipping. **[NEEDS DECISION: …]** = owner choice required.
4. Dollar figures in this spec are display values; the implementation must interpolate `INTRO_FIRST_MONTH_LABEL` and `TIER_PRICE_COPY` (claim rule 11).

## The ICP call this spec makes

The paying audience is the independent U.S. contract pilot — singular. The schema has no operator account type, no operator pricing, and `docs/MARKETING.md` §2 excludes "operators buying for their pilots" (see `.agents/product-marketing.md`, Discrepancy 1). Operators are real readers, but they are the pilot's *clients*: they receive tokenized links (invoice, estimate, packet, vendor) and never sign up. So this spec:

- keeps the page's single conversion action pilot signup;
- handles the operator reader inside one compact strip (§3) written to serve the pilot's own buying decision first — "what your clients get" — which orients an operator without spending front-door words on a visitor who mostly arrives via share links, not `/`;
- delivers the requested operator-led hero as **Variant B**, with a recommendation against using it as the front door and a note on where its copy should live instead.

This is the churn-minimizing move the brief asks for: an operator who signs up expecting an operator product is the wrong signup.

## Page rhythm (bands, tones, CTAs)

`brand` (hero, CTA) → `canvas` (§2 mechanic + §3 clients strip) → `sunk` (§4 promises, quiet CTA) → `canvas`, narrow (§5 FAQ + contact) → `sunk` (§6 depth + pricing pointer, `/pricing` link) → `brand` (§7 close, CTA). No two adjacent bands share a tone, matching the shipped page's alternation; no stretch of the page is more than two beats from a conversion action. *(Both were UX critic requirements — the v1 draft had four same-tone, CTA-free sections in a row.)*

---

## §0. Page metadata

- **Title:** `V1 — The books for your flying business.` (brand name + `BRAND.tagline`; the landing page currently inherits the bare default "V1").
  - *Addresses:* 01-cro HIGH "homepage has no page-specific title; bare 'V1' competes with takeoff-decision-speed content in this exact audience's search results."
- **Meta description:** unchanged — the current root description carries the money position and audits clean (04-strategy).
- **OG image:** unchanged (01-cro LOW; not worth the effort now).
- *Implementation note:* export page-level `metadata.title` built from `lib/brand.ts` constants so the rendered title is absolute, not the bare template default.

---

## §1. Hero

**Layout intent:** unchanged from the shipped 2026-08-17 design — navy band, argument in the 5-of-12 column, real Overview capture (with its "Illustrative data." caption) in the 7-of-12 column, eager-loaded. One implementation note travels with this section: render the hero without awaiting the signed-in session check for cookie-less visitors (01-cro HIGH: the page currently blocks first paint on a Supabase round trip, against the strategy's own "ten seconds on FBO wifi" bar). Copy assumes the hero is the first thing painted.

### Variant A — pilot-led (recommended default)

- **Eyebrow:** `For independent contract pilots` *(kept verbatim — the page's audience statement, load-bearing for self-selection.)*
- **H1:** `Flying is the job. This is the business.` *(kept verbatim — owner-signed identity claim; §3 of MARKETING.md holds this angle. No alternatives offered: churning a signed H1 five days after signing it is the exact instability that document warns against.)*
- **Subheadline:** `V1 keeps the books for your flying business: who owes you, what you earned, what you spent, and the year-end packet your CPA asks for. All of it comes off the trips you fly.` *(kept verbatim — the audit found no fault with it, and the opening phrase is the tagline, spoken identically everywhere.)*
- **Primary CTA:** `Start your books — $5 first month`
  - Replaces `Try V1 — $5 first month`. "Try" promises an immediate, low-stakes trial; the real path is account creation → email confirmation → plan + card. "Start your books" frames beginning a thing you'll keep — accurate to the path and to the product's promise of durable records.
  - *Addresses:* 01-cro HIGH "the CTA promises 'Try,' the next screens deliver an identity form, a mandatory email round-trip, then a plan/price screen"; 09 theme C (system-level honesty).
  - Alternatives considered and rejected in favor of `Start your books — $5 first month`: `Open your books — $5 first month` (same shape, softer verb — loses the beginning-of-work framing) and `Create your account — $5 first month` (most literal, least value).
- **Secondary CTA:** `Compare plans` → `/pricing` *(was "View plans"; unified with §6's button label so the same destination carries the same words everywhere — UX critic, label consistency.)*
- **Fine line (under CTAs):** `Plans start at $29/month; the $5 first month applies to monthly plans. Card required.`
  - *Addresses:* 03-content MEDIUM "'$5 for your first month, on every plan' can be misread to include annual" — the monthly scope is now stated the first time the offer appears.
  - *Why this edit to the signed hero block is in-bounds while the H1 is not:* the fine line is a factual price-scope statement, not positioning, and `docs/MARKETING.md`'s own history is the precedent — its "An offer change must sweep the SHELL" section exists because imprecise offer copy shipped three false price claims. Correcting offer scope is what that document demands; changing the H1 is what it forbids. The change still requires the owner's re-signature on §4's "verbatim" block (see Appendix item 8).

**Word budget:** 75 — five words over the signed §6 hero budget of 70 (not just over the shipped 55). The overage is the monthly-scope clause and is flagged for the owner's re-signature rather than silently absorbed.

### Variant B — operator-led (provided for comparison; not recommended as the front door)

Written for the operator-side reader — an AP desk, owner, or management company that received a V1 link from a pilot, or typed the name off an invoice.

- **Eyebrow:** `If a contract pilot sent you here`
- **H1:** `Clean paperwork from every contract pilot.`
- **Subheadline:** `V1 is the books software independent contract pilots run their businesses on. There's nothing for you to buy or log into. Invoices and estimates arrive as links you can open, check, accept, or pay in the browser, along with the pilot's current credentials and insurance.`
- **Primary CTA:** `See what your pilots send` → `#for-operators` (§3's strip — it lists exactly what arrives: invoices, estimates, packets as links). *(Was `#how-it-works`, which is written in first-person pilot voice and never shows an operator what they receive — CRO critic required change.)*
- **Secondary CTA:** `I'm a pilot — start your books` → `/signup`
- **Fine line:** `Payments go to your pilot directly. V1 adds no fee on top.`

**Recommendation:** do not make this the default hero. The page has exactly one conversion action (pilot signup — there is no operator account to sell; schema and `docs/MARKETING.md` §2), so leading with the operator reader points the page's strongest real estate at a visitor who cannot convert. Use Variant B's copy where the operator actually arrives: as the orientation caption on the four tokenized surfaces (02-navigation CRITICAL — those pages currently explain nothing and link nowhere; there the CTA pair is dropped and the V1 mark simply links to `/`), or as a future `/for-operators` page. Revisit only if analytics (currently absent — 04-strategy HIGH) later shows meaningful operator traffic landing on `/`.

---

## §2. How it works — "What a trip is worth"

**Layout intent:** unchanged — `canvas` band, lead-in sentence, then three hairline-separated question rows, two of them carrying their product capture. This section already is the how-it-works: enter a trip once, and the page shows what mechanically comes off it. Anchor `#how-it-works` kept. §3's clients strip renders as this band's closing row (see §3).

- **Heading:** `What a trip is worth` *(kept.)*
- **Lead-in:** `Start with the trip. Add the client, aircraft, legs, and your flight, travel, standby, or off days. The three answers below come from that record.` *(kept verbatim — day-type vocabulary is the belonging signal.)*
- **Row 01 — `What am I owed?`:** `Your client's rate and billable days are already filled in. Review the lines, then send a numbered PDF invoice with a payment link.` *(kept verbatim; invoice capture stays.)*
- **Row 02 — `What did I fly?`:** `One draft per leg, with PIC and SIC kept separate. You review every draft before anything reaches your logbook.` *(kept verbatim; logbook capture stays. Per-leg phrasing matches the product's actual one-draft-per-leg behavior and standard logging practice. Note: the code comment beside this line asserts per-flight entries are "the only form 14 CFR 61.51 recognises" — the flag pass checked 61.51(b) against the current eCFR and found it specifies required data per flight without mandating entry granularity; the copy stands on the product's behavior, not that overstated reading. Adjacent fix logged, Appendix item 9.)*
- **Row 03 — `What did it cost?`:** `Scan a receipt at the FBO from your phone's browser and attach it to the trip. Mark it for client reimbursement or keep it with your deductible expense records.`
  - Change: adds the phone-browser clause. *Addresses:* 01-cro MEDIUM "landing copy invites a mobile scenario ('Scan a receipt at the FBO') but nothing confirms it works from a phone" — answered in place instead of spending an FAQ slot. ("From your phone's browser" already implies no app; the earlier "no app to install" aside was cut in the flag pass as a bracketed-fragment tell.)
  - **[VERIFY: receipt OCR runs fully in the mobile browser, with no app install — the OCR engine ships as browser-side assets (`public/ocr/`, `scripts/sync-ocr-assets.mjs`) — confirm on a real phone before shipping the clause.]**
  - The reimbursement/deductible sentence is kept verbatim: it is the claim-rule-10-compliant phrasing (describes the software's action, never a tax outcome).

**Word budget:** 110 (shipped 102 + the mobile clause). §3's strip is budgeted separately below.

---

## §3. Audience clarity — "What your clients get" (renders as §2's closing row)

**Layout intent:** one hairline row at the end of §2's band, same ledger pattern as the three question rows but with no step number — a coda, not a fourth question. Anchor id `#for-operators` (Variant B and any future token-page link target it).

- **Row heading:** `What your clients get`
- **Body:** `Nothing for them to sign up for. The owners and operators you bill get numbered invoices, estimates they can accept online, and your current credentials and insurance, all as browser links.`
  - *(Flag-pass changes: the stacked double triad is broken up — client types compressed to "owners and operators," one list kept because the three deliverables are the row's payload; "credential packets" replaced with "your current credentials and insurance," which is what the packet holds and how the receiving desk thinks of it.)*

**Why this shape (CRO critic required change #4, accepted with a restructure rather than a pure cut):** the v1 draft's two-column audience split re-identified the pilot (already done by the eyebrow, H1, and subhead — `docs/MARKETING.md` §7 cut a "Who is this for?" FAQ item on exactly that precedent) and addressed operators in second person on a page where they can't convert. This row keeps every fact the split carried but points it at the pilot's own buying decision — what you send clients is part of what you're buying — while still letting an operator reader recognize themselves in one sentence and self-select out of signup. The brief's audience-split requirement is met in function: both readers learn which chair they sit in, with accurate expectations.

*Addresses:* the brief's operator/pilot requirement without inventing an operator product; 09 theme E (the operator seam as an honest surface); churn intent. The "explicitly not for" list (flight departments, hobby loggers) stays off this page per `docs/MARKETING.md` §2 ("the exclusion belongs on /pricing if anywhere — never on the front door") — logged as a `/pricing` adjacent fix (Appendix item 3).

**Word budget:** 40.

---

## §4. Proof — "Four promises"

**Layout intent:** `sunk` band. The trust shelf. Claim rule 8 bans testimonials, statistics, and customer counts — and this product genuinely has none — so credibility is carried by promises the product enforces rather than typed. Four hairline rows, no icons. A quiet, secondary-styled CTA closes the band (UX critic required change #1: the v1 draft left §2–§5 with zero conversion actions — the page's longest CTA-free stretch; this is the mid-page action at the trust peak).

- **Heading:** `Four promises`
- **Row 1:** `If a feature isn't in your plan, it isn't on this page. The lists here are generated from the same rules the product enforces.` *(Reordered per CRO optional #7 — leads with the reader-facing meaning, keeps the mechanism as the second sentence.)*
- **Row 2:** `Cancel or downgrade and nothing is deleted. The account goes read-only, and your records stay readable and exportable.`
- **Row 3:** `The full account export is on every plan, Solo included: every record type as CSV.`
- **Row 4:** `Client payments go straight to you. V1 adds no fee of its own and never holds the money.`
- **Band CTA (secondary/outline style):** `Start your books — $5 first month` → `/signup` *(same label as the hero primary — one offer, spoken identically.)*

Grounding, row by row: (1) `specGroups()` / `lib/entitlements.ts` derivation; (2) the downgrade/cancel promise (`DOWNGRADE_NOTE`, pricing FAQ, lifecycle verify scripts) — scoped to cancel/downgrade only; the hold-lapse purge is a different path and stays documented on `/pricing`; (3) claim rule 6, `account_export` minTier solo — "every record type as CSV" deliberately does not say "every file," because uploaded receipt/document files are downloaded per-record, not bulk-exported (08-churn MEDIUM); (4) `docs/PRICING.md` §6 — Stripe Connect Standard, zero application fee, pilot is merchant of record. Row 4 is the page's single statement of the zero-take-rate fact.

*Addresses:* 01-cro HIGH "the zero-take-rate claim — the strongest claim-rule-compliant trust signal available — appears nowhere"; 01-cro's social-proof gap (compliant trust elements in place of banned testimonials); 09 fix list, copy item 8.

**Word budget:** 80 including the CTA label.

---

## §5. Objection handling — "Questions pilots ask us"

**Layout intent:** `canvas` band, narrow measure, native `<details>` items — unchanged. Four items (three kept, one added), then a contact line styled as its own bordered row at body size, not caption fine print (UX critic optional #3: it is the site's only support channel and must read as one).

- **Heading:** `Questions pilots ask us` *(kept.)*
- **Item 1 (one word changed):** `I already keep a logbook. Do I have to start over?` → `No. Import a ForeFlight or LogTen export, or any CSV through the column mapper, and carry on from there.`
  - "LogTen Pro" → "LogTen": the flag pass verified the vendor retired the "Pro" branding after the 2022 Coradine acquisition; the stale name is a credibility tell for exactly this audience. **[VERIFY: current LogTen branding at ship time.]** The in-app import UI carries the same stale name in four places — adjacent fix, Appendix item 10.
- **Item 2 (kept verbatim — this spec changes nothing in it):** `Does it decide whether I'm current or legal to fly?` → `No, and it will never present itself that way. It tracks the expiry dates you entered off your own documents so you can see what's coming. Currency and airworthiness decisions stay yours.`
  - **[NEEDS DECISION — route to counsel, do not edit in implementation:** the flag pass surfaced a real conflict between two owner documents. This shipped line paraphrases the counsel-reviewed `CURRENCY_DISCLAIMER`, which `docs/MARKETING.md` §5 rule 4 blesses ("the substance survives in the landing FAQ") but `docs/CURRENCY-SPEC.md` §7 forbids ("`CURRENCY_DISCLAIMER` remains the single source; no screen may paraphrase it") — and the word "airworthiness" is itself open counsel question C-1 in that spec, with an explicit instruction not to change the wording without sign-off either way. This spec deliberately keeps the shipped line verbatim rather than rewording counsel-adjacent language, and flags it for the same counsel loop as the Terms/Privacy G3 gate.**]
- **Item 3 (kept verbatim, including the lapsed-card line — one of the page's two permitted aphorisms):** `What happens if I cancel or downgrade?` → `Nothing is deleted. Downgrading stops new work on the screens your plan no longer includes; cancelling puts the account in read-only. A pilot's logbook is a legal record; a lapsed card will never be the thing that destroys one.`
- **Item 4 (new):** `Where do my records and receipts live?` → `In your account, exportable in full whenever you want. Receipts are read in your browser when you scan them, and bank statements are parsed in your browser before anything is saved.`
  - **[VERIFY: exact data-handling facts against `app/(marketing)/privacy/page.tsx:76-89` and the import/OCR code paths — the browser-side parsing claims are documented there, but this FAQ must not outrun what the privacy page states.]**
  - *Addresses:* 01-cro MEDIUM "FAQ set leaves the data-security objection unanswered" for a product that asks for bank statements and income data.
- **Contact row (bordered, below the items):** `Something we didn't answer? Email [NEEDS DECISION: support address — no channel exists anywhere in the product today; see 01-cro HIGH / 04-strategy HIGH] and a person will answer.`
  - *Addresses:* the no-contact-channel finding at the exact moment a hesitating prospect has an unanswered question. The same address belongs in the site footer (Appendix item 3).

**Word budget:** 145 including the contact row.

---

## §6. Depth + pricing pointer — "The rest of the books"

**Layout intent:** `sunk` band; the spec block keeps its derived tier pills and mechanical dropping of `comingSoon`/unclaimable lines. The pricing pointer's placement is breakpoint-aware (UX critic required change #4): at `lg`+ it sits in the sticky heading column under the h2; **below `lg`, the pointer sentence and button render as a full-width row above the feature list**, so the price anchor precedes the list at every width instead of scrolling away in a collapsed side column.

- **Heading:** `The rest of the books` *(kept.)*
- **Pricing pointer:** `Three plans: Solo, Pro, and Business. A year of the books costs less than half of one flight day's pay.`
  - Button: `Compare plans` → `/pricing` *(label unified with the hero secondary — was "Compare all features".)*
  - The anchor sentence restores the vetted "half" framing (CRO critic required change #5), and the flag pass fixed two more things: "flight day" is the product's own shipped day-type vocabulary (`'flight', 'Flight day'` in the phase-9 migration) where "flying day" was not, and "pay" resolves the cost-vs-time unit mismatch. Qualitative by design: claim rule 11 forbids typed figures and no maintained constant carries a day-rate comparison. **[VERIFY: the comparison against `docs/PRICING.md` §2.8 — a full year of the most expensive published tier under half of one flight day's pay at the low end of researched figures — still holds before shipping; if the owner won't stand behind it, cut the sentence entirely rather than soften it.]**
  - *Addresses:* 01-cro MEDIUM "no price-anchor framing despite one already vetted internally"; keeps the page's one dollar-figure statement in the hero.
- **Spec line change (one):** the invoices line becomes `Numbered invoice PDFs, payment links, email delivery, and view tracking.`
  - *Addresses:* 03-content LOW "the same feature is summarized by two non-overlapping capability lists on the two public pages."
- All other spec lines: kept verbatim (their tier tags are derived; the prose was audited clean).

**Word budget:** 100 (spec lines ~85 + pointer ~15).

---

## §7. Final CTA — close

**Layout intent:** unchanged — `brand` band bookending the hero, one heading, one supporting line, one action.

- **Heading:** `Start the books with your next trip.` *(kept.)*
- **Body:** `Solo, Pro, and Business plans, each with the full account export from day one.`
  - Changes: adds the missing conjunction (01-cro LOW / 03-content MEDIUM: the `.join(", ")` currently renders "Solo, Pro, Business plans…" on every load — implementation should join with a final "and" rather than hand-typing names); drops the close's repetition of the $5 offer (the offer lives in the hero and on the buttons; the close's added value is the export promise, kept).
- **CTA:** `Start your books — $5 first month` → `/signup` *(same label as every other primary on the page.)*

**Word budget:** 25.

---

## Copy deltas vs. the shipped page

| Kept verbatim | Changed | New |
|---|---|---|
| Eyebrow, H1, subheadline | Primary CTA label (all instances) | §3 clients strip (~35 words) |
| §2 heading, lead-in, rows 01–02 | Hero fine line (monthly scope) | §4 promises band + quiet CTA (80 words) |
| Spec block headings + 11 of 12 lines | §2 row 03 (mobile clause) | FAQ item 4 (data) |
| FAQ items 2–3 | Invoices spec line; FAQ item 1 ("LogTen Pro" → "LogTen") | FAQ contact row |
| Close heading | `/pricing` link labels unified ("Compare plans") | Pricing-pointer anchor sentence |
| "Illustrative data." caption | Close body (conjunction; $5 removed); page title metadata | Hero Variant B (separate surface) |

Estimated rendered total: **~575 words across six visual beats** (shipped: 384 across five; the v1 draft was ~615 across seven). The remaining overage over `docs/MARKETING.md` §6's 430 budget is the brief's two new requirements — audience clarity (40 words) and a proof band (80 words) — plus the honesty clauses the audit demanded; the §6 budget table needs the owner's re-signature with these numbers if this spec is adopted (see Appendix item 8).

## Appendix — adjacent fixes this copy depends on or points at (not landing-page copy)

1. **Precondition:** none of this converts anyone until the Resend sending domain is verified (09 finding 1). Ship order: DNS → signup error-handling honesty (05-signup) → this page.
2. Hero paint: skip the session round trip for cookie-less visitors (01-cro HIGH) — copy assumes a fast first paint.
3. Footer: add the support address (same one as §5's contact row) to `site-footer.tsx`; add `/pricing` FAQ items for the anti-persona ("who it's not for") and the $5 refund clause **[NEEDS DECISION: is the $5 refundable on same-month cancel? 01-cro LOW says the current copy leaves it implied]**.
4. `/pricing` hero needs one sentence of value proposition/audience of its own (01-cro HIGH — it is an indexed, shareable entry point that currently opens on bare dollar figures) and the same day-rate anchor (01-cro MEDIUM). §3's clients-strip language and §6's anchor sentence are the ready source material. *(Logged per CRO critic required change #6.)*
5. Pricing cards should carry the chosen tier through signup (`?plan=`) so the pointer's promise ("compare, then start") survives the funnel (05-signup MEDIUM).
6. Analytics before this page ships, or the rewrite is unmeasurable (04-strategy HIGH; 09 brief).
7. Auth screens: the "A business" account-type hint fix (03-content HIGH) — one screen after this page's CTA; the collision undoes this page's clarity work if left.
8. `docs/MARKETING.md` re-signatures this spec requires: the hero fine line (part of §4's "verbatim" block), the hero budget overage (75 vs 70), and the §6 budget table for the new totals. Export-page/pricing-FAQ wording on "every uploaded file" vs. per-record file downloads should also be reconciled (08-churn MEDIUM) so §4 row 3 never drifts into overclaiming.
9. The code comment at `app/(marketing)/page.tsx` (RECORDS row 02) asserts per-flight entries are "the only form 14 CFR 61.51 recognises" — the flag pass checked 61.51(b) against the current eCFR: it specifies required data per flight or lesson logged without mandating entry granularity. Soften the comment so the per-leg design stands on product behavior and logging convention, not an overstated regulatory reading.
10. "LogTen Pro" → "LogTen" branding sweep in the app itself: `app/(app)/logbook/import/import-workspace.tsx` (tab label and two body strings) and `app/(app)/logbook/import/page.tsx` subtitle carry the retired vendor name this spec fixes on the landing FAQ. **[VERIFY: current LogTen branding at ship time.]**

## Critic resolutions

Every required change from the two critic passes, resolved or rejected with a reason.

**CRO critic (skill: cro):**
1. Fine-line edit inside the signed hero block unexplained — **accepted**: §1 now states why the edit is in-bounds (offer-scope accuracy, the exact failure class MARKETING.md's own history punishes) and flags the re-signature (Appendix 8).
2. "Recommend the first" ambiguity in CTA alternatives — **accepted**: rewritten as "considered and rejected in favor of `Start your books — $5 first month`."
3. Variant B CTA target mismatch (`#how-it-works` is pilot-voiced; recommended destinations lack the anchor) — **accepted**: B's primary CTA now targets `#for-operators` (§3's strip, which lists exactly what an operator receives), and the token-surface note says the CTA pair is dropped there (the mark links to `/`).
4. Cut §3 column 1, compress column 2 — **accepted with a restructure, not a pure cut**: §3 is now a single 40-word "What your clients get" row inside §2's band, pointed at the pilot's buying decision while still orienting the operator reader. A pure cut was rejected because the brief explicitly requires audience clarity for both readers and the operator-expectation problem is a churn risk this page must answer somewhere; the restructure removes the redundant pilot re-identification the critic correctly flagged.
5. Anchor sentence diluted the vetted framing — **accepted**: restored to "less than half a flying day," with the verify-or-cut instruction kept.
6. `/pricing` value-prop and anchor findings untracked — **accepted**: Appendix item 4 added.
7. [OPTIONAL] §4 row 1 too abstract — **accepted**: reordered to lead with the reader-facing meaning.
8. [OPTIONAL] Hero overage vs signed budget under-framed — **accepted**: stated as an overage against the signed 70, flagged for re-signature.

**UX critic (skill: ux-expert):**
1. Four consecutive CTA-free sections — **accepted**: §4 closes with a quiet secondary CTA; the rhythm map (top of spec) shows no stretch more than two beats from an action.
2. No band tones assigned; middle risks reading as one block — **accepted**: tones assigned for every section (rhythm map); §3 merged into §2's band so the page keeps a strict alternation with no two adjacent tones equal.
3. ~615 words / seven beats vs the 430 budget; merge or cut before sign-off — **partially accepted**: §3 merged into §2 (structural fix, the precedent the critic cited) and §4/§5 tightened, landing at ~575 across six beats. Returning fully to 430 is **rejected**: the two additions are the owner's brief (audience clarity, proof band) and the audit's own required honesty clauses; the remaining overage is presented to the owner for an explicit budget re-signature (Appendix 8) rather than met by cutting requested sections.
4. Pricing pointer loses its placement rationale below `lg` — **accepted**: below `lg` the pointer renders as a full-width row above the feature list.
5. [OPTIONAL] §3 heading repeated the eyebrow's ground — **accepted**: heading is now "What your clients get."
6. [OPTIONAL] `/pricing` link labels inconsistent — **accepted**: both are now "Compare plans."
7. [OPTIONAL] Contact line under-emphasized for the site's only support channel — **accepted**: specified as a bordered row at body size.

**Aviation/voice flag pass (skills: humanizer aviation layer + aviation-expert):** eight flags returned; all applied by the orchestrator, as follows.
1. [CONSIDER] Em-dash-as-connective density across ~a third of copy strings — **partially accepted**: prose instances rewritten (Variant B subhead, §4 row 3, §3 body, §6 pointer intro now use plain sentences or colons). The CTA labels keep `— $5 first month`: that is a button-label offer separator, the shipped page's own convention, not prose cadence.
2. [FIX] §2 row 03's double-em-dash aside + "no app to install" fragment — **accepted**: rewritten as one plain sentence ("Scan a receipt at the FBO from your phone's browser and attach it to the trip."); the no-install fact moved into the [VERIFY] note.
3. [CONSIDER] The 14 CFR 61.51 justification overstates the reg (61.51(b) sets required data, not entry granularity; verified against current eCFR) — **accepted**: the spec's annotation no longer leans on the reg, and the overstated code comment is logged as Appendix item 9. The copy itself was already correct.
4. [CONSIDER] §3's stacked double triad — **accepted**: client types compressed to "owners and operators"; the deliverables triad kept (it is the row's payload).
5. [CONSIDER] "credential packets" is product-internal vocabulary, not the receiving desk's — **accepted**: both occurrences now read "current credentials and insurance."
6. [FIX] "LogTen Pro" is retired branding (post-2022 Coradine acquisition) — **accepted**: FAQ item 1 now says "LogTen," with a [VERIFY] at ship time; the four in-app occurrences are logged as Appendix item 10.
7. [FIX] The currency FAQ line paraphrases `CURRENCY_DISCLAIMER` against `docs/CURRENCY-SPEC.md` §7's no-paraphrase rule, and "airworthiness" is open counsel question C-1 — **accepted with a different remedy than rewording**: the line is kept verbatim as shipped (the one thing both owner documents agree on is not changing counsel-adjacent wording without sign-off) and the conflict is documented in place as a [NEEDS DECISION] routed to the same counsel loop as the G3 Terms/Privacy gate. Verified directly against `docs/CURRENCY-SPEC.md` before resolving.
8. [CONSIDER] Anchor sentence's unit mismatch and "flying day" vs the product's shipped "flight day" vocabulary — **accepted**: now "less than half of one flight day's pay."
Flagger's closing verdict, for the record: with these addressed, the copy reads as written from inside the world — PIC/SIC, per-leg drafts, FBO, day types, and the client-type list all used correctly; no luxury-jet or generic-SaaS clichés.
