# Landing page copy — rewrite spec

**Status:** draft v1 (orchestrator) — pending CRO critic, UX critic, and aviation/voice flag pass.
**Deliverable:** copy document only. No file under `app/` or `components/` is modified by this spec; it is written to be implemented against `app/(marketing)/page.tsx`.
**Inputs read:** `.agents/product-marketing.md`, `docs/reviews/09-EXECUTIVE-SUMMARY.md`, `docs/reviews/01-cro.md`, `docs/reviews/03-content.md`, `docs/MARKETING.md`, current `app/(marketing)/page.tsx`.

**Purpose (from the brief):** inform prospects so the right ones sign up with accurate expectations — maximize conversion and minimize future churn through clarity about what the product does and doesn't do. No hype, no dark patterns.

## Ground rules this spec obeys

1. Every §5 claim rule in `docs/MARKETING.md` binds every line here: two generated / one organised; nothing beyond shipped code; no currency-board mention; never legal-to-fly claims; seats are a billing fact; export-on-every-plan stated; workflow-only comparison; **no testimonials, statistics, customer counts, or founder boasts (there are no customers yet)**; brand strings from `lib/brand.ts`; no tax-outcome claims; figures interpolated from constants, never typed.
2. The money position holds. `docs/MARKETING.md` §3 was signed 2026-08-17 and says the next repositioning must argue against it; this rewrite executes that position better, it does not replace it. The H1 is deliberately kept.
3. Markers: **[NEEDS PROOF: …]** = claim wanted but no grounding exists — do not ship without it. **[VERIFY: …]** = grounded in the repo; implementer confirms the exact fact before shipping. **[NEEDS DECISION: …]** = owner choice required.
4. Dollar figures in this spec are display values; the implementation must interpolate `INTRO_FIRST_MONTH_LABEL` and `TIER_PRICE_COPY` (claim rule 11).

## The ICP call this spec makes

The paying audience is the independent U.S. contract pilot — singular. The schema has no operator account type, no operator pricing, and `docs/MARKETING.md` §2 excludes "operators buying for their pilots" (see `.agents/product-marketing.md`, Discrepancy 1). Operators are real readers of this page, but they are the pilot's *clients*: they receive tokenized links (invoice, estimate, packet, vendor) and never sign up. So this spec:

- keeps the page's single conversion action pilot signup;
- speaks to the operator reader honestly in one dedicated section (§3) — orientation, not a pitch;
- delivers the requested operator-led hero as **Variant B**, with a recommendation against using it as the front door and a note on where its copy should live instead.

This is the churn-minimizing move the brief asks for: an operator who signs up expecting an operator product is the wrong signup.

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
  - Alternatives considered: `Open your books — $5 first month` (same shape, softer verb); `Create your account — $5 first month` (most literal, least value). Recommend the first.
- **Secondary CTA:** `View plans` → `/pricing` *(kept.)*
- **Fine line (under CTAs):** `Plans start at $29/month; the $5 first month applies to monthly plans. Card required.`
  - *Addresses:* 03-content MEDIUM "'$5 for your first month, on every plan' can be misread to include annual" — the monthly scope is now stated the first time the offer appears. Annual's plain-price billing is detailed on `/pricing`; the landing line only scopes the claim honestly.

**Word budget:** 75 (shipped hero was 55; the fine line grew by one clause).

### Variant B — operator-led (provided for comparison; not recommended as the front door)

Written for the operator-side reader — an AP desk, owner, or management company that received a V1 link from a pilot, or typed the name off an invoice.

- **Eyebrow:** `If a contract pilot sent you here`
- **H1:** `Clean paperwork from every contract pilot.`
- **Subheadline:** `V1 is the books software independent contract pilots run their businesses on. There's nothing for you to buy or log into: invoices, estimates, and credential packets arrive as links — open, check, accept, or pay in the browser.`
- **Primary CTA:** `See what your pilots send` → `#how-it-works`
- **Secondary CTA:** `I'm a pilot — start your books` → `/signup`
- **Fine line:** `Payments go to your pilot directly. V1 adds no fee on top.`

**Recommendation:** do not make this the default hero. The page has exactly one conversion action (pilot signup — there is no operator account to sell; schema and `docs/MARKETING.md` §2), so leading with the operator reader points the page's strongest real estate at a visitor who cannot convert. Use Variant B's copy where the operator actually arrives: as the orientation caption on the four tokenized surfaces (02-navigation CRITICAL — those pages currently explain nothing and link nowhere), or as a future `/for-operators` page the token pages link to. Revisit only if analytics (currently absent — 04-strategy HIGH) later shows meaningful operator traffic landing on `/`.

---

## §2. How it works — "What a trip is worth"

**Layout intent:** unchanged — lead-in sentence, then three hairline-separated question rows, two of them carrying their product capture. This section already is the how-it-works: enter a trip once, and the page shows what mechanically comes off it. Anchor `#how-it-works` kept (the header and Variant B link into it).

- **Heading:** `What a trip is worth` *(kept.)*
- **Lead-in:** `Start with the trip. Add the client, aircraft, legs, and your flight, travel, standby, or off days. The three answers below come from that record.` *(kept verbatim — day-type vocabulary is the belonging signal.)*
- **Row 01 — `What am I owed?`:** `Your client's rate and billable days are already filled in. Review the lines, then send a numbered PDF invoice with a payment link.` *(kept verbatim; invoice capture stays.)*
- **Row 02 — `What did I fly?`:** `One draft per leg, with PIC and SIC kept separate. You review every draft before anything reaches your logbook.` *(kept verbatim; logbook capture stays. Per-leg phrasing is load-bearing — see the code comment citing 14 CFR 61.51.)*
- **Row 03 — `What did it cost?`:** `Scan a receipt at the FBO — it reads in your phone's browser, no app to install — and attach it to the trip. Mark it for client reimbursement or keep it with your deductible expense records.`
  - Change: adds the phone-browser clause. *Addresses:* 01-cro MEDIUM "landing copy invites a mobile scenario ('Scan a receipt at the FBO') but nothing confirms it works from a phone" — answered in place instead of spending an FAQ slot.
  - **[VERIFY: receipt OCR runs fully in the mobile browser — the OCR engine ships as browser-side assets (`public/ocr/`, `scripts/sync-ocr-assets.mjs`) — confirm on a real phone before shipping "no app to install."]**
  - The reimbursement/deductible sentence is kept verbatim: it is the claim-rule-10-compliant phrasing (describes the software's action, never a tax outcome).

**Word budget:** 110 (shipped 102 + the mobile clause).

---

## §3. Audience split — "Who this is for"

**New section.** Two short columns in the ledger style (hairline rule, no cards), placed directly after §2 so a reader who now understands the mechanic immediately learns which chair they sit in.

- **Heading:** `Who this is for`
- **Column 1 — subhead:** `You fly for a living`
  - **Body:** `A one-person 1099 business: day rates flown for owners, management companies, and Part 135 operators. The account is yours, and so are the books.`
- **Column 2 — subhead:** `You hire pilots who use V1`
  - **Body:** `Nothing to sign up for. Numbered invoices, estimates you can accept online, and credential packets reach you as browser links — pay online or the way you always have.`

*Addresses:* the brief's operator/pilot requirement without inventing an operator product; 09 theme E (the operator seam as an honest surface); churn intent — an operator self-selects out of signup here, a pilot sees their exact situation named. The "explicitly not for" list (flight departments, hobby loggers) deliberately stays off this page per `docs/MARKETING.md` §2 ("the exclusion belongs on /pricing if anywhere — never on the front door"); recommend adding it to the `/pricing` FAQ instead (see Appendix, adjacent fixes).

**Word budget:** 70.

---

## §4. Proof — "Four promises"

**New section.** The trust shelf. Claim rule 8 bans testimonials, statistics, and customer counts — and this product genuinely has none — so credibility is carried by promises that are enforced by the product rather than typed into the page. Four hairline rows, no icons.

- **Heading:** `Four promises`
- **Row 1:** `The feature lists on this site are generated from the same plan rules the product enforces. A claim can't outlive the code behind it.`
- **Row 2:** `Cancel or downgrade and nothing is deleted. The account goes read-only, and your records stay readable and exportable.`
- **Row 3:** `The full account export is on every plan, Solo included — every record type as CSV.`
- **Row 4:** `Client payments go straight to you. V1 adds no fee of its own and never holds the money.`

Grounding, row by row: (1) `specGroups()` / `lib/entitlements.ts` derivation; (2) the downgrade/cancel promise (`DOWNGRADE_NOTE`, pricing FAQ, lifecycle verify scripts) — scoped to cancel/downgrade only; the hold-lapse purge is a different path and stays documented on `/pricing`; (3) claim rule 6, `account_export` minTier solo — "every record type as CSV" deliberately does not say "every file," because uploaded receipt/document files are downloaded per-record, not bulk-exported (08-churn MEDIUM); (4) `docs/PRICING.md` §6 — Stripe Connect Standard, zero application fee, pilot is merchant of record. Row 4 is the page's single statement of the zero-take-rate fact.

*Addresses:* 01-cro HIGH "the zero-take-rate claim — the strongest claim-rule-compliant trust signal available — appears nowhere"; 01-cro's social-proof gap (compliant trust elements in place of banned testimonials); 09 fix list, copy item 8.

**Word budget:** 85.

---

## §5. Objection handling — "Questions pilots ask us"

**Layout intent:** unchanged — narrow measure, native `<details>` items. Four items (three kept, one added), then a contact line. Keeps to the §6 discipline: only questions that remove a real barrier and are answered nowhere else on the page.

- **Heading:** `Questions pilots ask us` *(kept.)*
- **Item 1 (kept verbatim):** `I already keep a logbook. Do I have to start over?` → `No. Import a ForeFlight or LogTen Pro export, or any CSV through the column mapper, and carry on from there.`
- **Item 2 (kept verbatim — non-negotiable; carries the counsel-reviewed CURRENCY_DISCLAIMER substance):** `Does it decide whether I'm current or legal to fly?` → `No, and it will never present itself that way. It tracks the expiry dates you entered off your own documents so you can see what's coming. Currency and airworthiness decisions stay yours.`
- **Item 3 (kept verbatim, including the lapsed-card line — one of the page's two permitted aphorisms):** `What happens if I cancel or downgrade?` → `Nothing is deleted. Downgrading stops new work on the screens your plan no longer includes; cancelling puts the account in read-only. A pilot's logbook is a legal record; a lapsed card will never be the thing that destroys one.`
- **Item 4 (new):** `Where do my records and receipts live?` → `In your account, exportable in full whenever you want. Receipts are read in your browser when you scan them, and bank statements are parsed in your browser before anything is saved.`
  - **[VERIFY: exact data-handling facts against `app/(marketing)/privacy/page.tsx:76-89` and the import/OCR code paths — the browser-side parsing claims are documented there, but this FAQ must not outrun what the privacy page states.]**
  - *Addresses:* 01-cro MEDIUM "FAQ set leaves the data-security objection unanswered" for a product that asks for bank statements and income data.
- **Contact line (below the items, small):** `Something we didn't answer? Email [NEEDS DECISION: support address — no channel exists anywhere in the product today; see 01-cro HIGH / 04-strategy HIGH] and a person will answer.`
  - *Addresses:* the no-contact-channel finding at the exact moment a hesitating prospect has an unanswered question. The same address belongs in the site footer (adjacent fix, Appendix).

**Word budget:** 150 including the contact line.

---

## §6. Depth + pricing pointer — "The rest of the books"

**Layout intent:** unchanged spec block (sticky heading column, derived tier pills, `comingSoon` and unclaimable lines mechanically dropped). The pricing pointer lives in the sticky column, under the heading, so depth and price share one band instead of adding a seventh scroll.

- **Heading:** `The rest of the books` *(kept.)*
- **Pricing pointer (sticky column, under the heading):** `Three plans — Solo, Pro, and Business. A full year of the books costs less than one flying day.`
  - Button (kept): `Compare all features` → `/pricing`.
  - The anchor sentence is qualitative by design: claim rule 11 forbids typed figures, and no maintained constant carries a day-rate comparison. **[VERIFY: the comparison against `docs/PRICING.md` §2.8 — a full year of the most expensive published tier under half of one flying day's rate at the low end of researched figures — still holds before shipping; if the owner won't stand behind it, cut the sentence rather than soften it.]**
  - *Addresses:* 01-cro MEDIUM "no price-anchor framing despite one already vetted internally"; keeps the page's one dollar-figure statement in the hero (§6/§7 of MARKETING.md — the price is stated once).
- **Spec line change (one):** the invoices line becomes `Numbered invoice PDFs, payment links, email delivery, and view tracking.`
  - *Addresses:* 03-content LOW "the same feature is summarized by two non-overlapping capability lists on the two public pages."
- All other spec lines: kept verbatim (their tier tags are derived; the prose was audited clean).

**Word budget:** 100 (spec lines ~85 + pointer ~15).

---

## §7. Final CTA — close

**Layout intent:** unchanged — navy band bookending the hero, one heading, one supporting line, one action. The close keeps the single CTA that §7 of MARKETING.md reduced it to.

- **Heading:** `Start the books with your next trip.` *(kept.)*
- **Body:** `Solo, Pro, and Business plans, each with the full account export from day one.`
  - Changes: adds the missing conjunction (01-cro LOW / 03-content MEDIUM: the `.join(", ")` currently renders "Solo, Pro, Business plans…" on every load — implementation should join with a final "and" rather than hand-typing names); drops the third on-page repetition of the $5 offer (the offer lives in the hero and on the button; the close's added value is the export promise, kept).
- **CTA:** `Start your books — $5 first month` → `/signup` *(same label as the hero primary — one offer, spoken identically.)*

**Word budget:** 25.

---

## Copy deltas vs. the shipped page

| Kept verbatim | Changed | New |
|---|---|---|
| Eyebrow, H1, subheadline | Primary CTA label (both instances) | §3 audience split (70 words) |
| §2 heading, lead-in, rows 01–02 | Hero fine line (monthly scope) | §4 promises band (85 words) |
| Spec block headings + 11 of 12 lines | §2 row 03 (mobile clause) | FAQ item 4 (data) |
| FAQ items 1–3 | Invoices spec line | FAQ contact line |
| Close heading | Close body (conjunction; $5 removed) | Pricing-pointer anchor sentence |
| "Illustrative data." caption | Page title metadata | Hero Variant B (separate surface) |

Estimated rendered total: ~615 words across seven beats (shipped: 384 across five). The two new sections are the brief's requirements (audience clarity, proof); everything else stays inside its existing budget. `docs/MARKETING.md` §6's budget table should be re-signed with these numbers if this spec is adopted.

## Appendix — adjacent fixes this copy depends on or points at (not landing-page copy)

1. **Precondition:** none of this converts anyone until the Resend sending domain is verified (09 finding 1). Ship order: DNS → signup error-handling honesty (05-signup) → this page.
2. Hero paint: skip the session round trip for cookie-less visitors (01-cro HIGH) — copy assumes a fast first paint.
3. Footer: add the support address (same one as §5's contact line) to `site-footer.tsx`; add `/pricing` FAQ items for the anti-persona ("who it's not for") and the $5 refund clause **[NEEDS DECISION: is the $5 refundable on same-month cancel? 01-cro LOW says the current copy leaves it implied]**.
4. Pricing cards should carry the chosen tier through signup (`?plan=`) so the pointer's promise ("compare, then start") survives the funnel (05-signup MEDIUM).
5. Analytics before this page ships, or the rewrite is unmeasurable (04-strategy HIGH; 09 brief).
6. Auth screens: the "A business" account-type hint fix (03-content HIGH) — one screen after this page's CTA; the collision undoes this page's clarity work if left.
7. Export-page/pricing-FAQ wording on "every uploaded file" vs. per-record file downloads should be reconciled (08-churn MEDIUM) so §4 row 3 never drifts into overclaiming.

## Critic resolutions

*(To be filled after the CRO and UX critic passes and the aviation/voice flag pass: every required change resolved or rejected with a reason.)*
