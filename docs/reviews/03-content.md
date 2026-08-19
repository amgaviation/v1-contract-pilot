# Content review — signed-out surface + auth copy

Scope reviewed: `app/(marketing)/page.tsx`, `app/(marketing)/pricing/page.tsx`
(incl. `buildFaq()`), `app/(marketing)/pricing/pricing-model.ts`, `terms/page.tsx`,
`privacy/page.tsx`, `layout.tsx` metadata, `product-shot.tsx`, `site-header.tsx`,
`site-footer.tsx`, `lib/brand.ts`, `lib/entitlements.ts`, and the `app/(auth)`
signup/login/welcome copy (`signup-form.tsx`, `login-form.tsx`, `welcome/page.tsx`,
`welcome-actions.tsx`, plus the shared `auth-brand.tsx`/`auth-column.tsx`/`auth-parts.tsx`).
Checked every claim-rule-sensitive line by hand against `docs/MARKETING.md` §5 and
against the shipped route tree in `docs/reviews/00-site-map.md`; no live line was
found asserting an unshipped feature, three-generated, a tax outcome, a currency-board
mention, competitor pricing, an "invite your bookkeeper" claim, or revived
duplicate-entry wedge language — those checks are not repeated below as findings
since nothing failed them.

---

### [HIGH] "Business" names two unrelated things two screens apart in the signup funnel
- Where: `app/(auth)/signup/signup-form.tsx:177` (option label) and `:180-183` (hint);
  collides with `app/(auth)/welcome/page.tsx:68` and `lib/entitlements.ts:70`
  (`TIER_DISPLAY.business.name = "Business"`, the paid plan tier shown on the very
  next screen).
- Issue: The signup form's first field is:
  ```
  { value: "solo", label: "Just me" },
  { value: "business", label: "A business" },
  ```
  with the hint "You can change how you bill later. This just sets up your account."
  This is `pilot.accounts.kind`, unrelated to billing tier — nothing in
  `welcome/page.tsx` reads `accountKind` to pre-select or filter a plan. One screen
  later, `/welcome` presents three *plan* options, one of which is also named
  "Business" (`TIER_DISPLAY.business.name`). A pilot who just chose "A business" at
  signup, told "this affects how you bill," then sees a plan called "Business," has
  a real reason to think the two are connected — they are not, and no copy on either
  screen says so. This lands at the single highest-stakes moment in the funnel
  (`docs/MARKETING.md`: "a pilot on /signup is one screen from a card").
- Fix: Drop the billing framing from the hint and pre-empt the name collision by
  naming the upcoming choice explicitly. Replace the hint text at
  `signup-form.tsx:180-183` with:
  > "This just sets up your account. It's separate from your plan — you'll choose
  > Solo, Pro or Business next."

---

### [MEDIUM] Business tier's annual two-seat total is never stated
- Where: `app/(marketing)/pricing/page.tsx:156-161`; unused constant at
  `app/(marketing)/pricing/pricing-model.ts:117`.
- Issue: The Business card renders:
  ```
  Two-seat minimum: {BUSINESS_MINIMUM_MONTHLY}/month
  covers both seats.
  ```
  — only the monthly minimum. `BUSINESS_MINIMUM_ANNUAL = "$780"` is defined in
  `pricing-model.ts:117` and asserted in `tests/marketing-pricing-model.test.mjs:190`,
  but `pricing/page.tsx` never imports or renders it. A reader pricing out Business
  on annual sees "$390/seat/year" and "$78/month covers both seats" side by side,
  with no annual total stated — they have to multiply $390 × 2 themselves to reach
  $780/year. The monthly reader gets this arithmetic done for them; the annual reader
  does not.
- Fix: State both, using the constant that already exists:
  > "Two-seat minimum: $78/month covers both seats — $780/year on annual."

---

### [MEDIUM] "on every plan" in the pricing hero can be misread to include annual
- Where: `app/(marketing)/pricing/page.tsx:126-129`.
- Issue: The hero's fine print reads: "$5 for your first month, on every plan. The
  regular price applies from month two." Annual plans do not get the intro price —
  they bill the plain annual amount from day one (`buildFaq()`'s own "What does the
  first month cost?" answer says so correctly, and `docs/PRICING.md`/`lib/stripe/server.ts`
  confirm it). "Every plan" naturally reads as "every tier," but a skimming reader
  deciding between monthly and annual sees this sentence before any interval-specific
  language, and the monthly-only scope isn't stated until the FAQ several sections
  down.
- Fix: Make the interval scope explicit where the claim first appears:
  > "$5 for your first month on any monthly plan. Annual bills the plain annual price
  > from day one."

---

### [MEDIUM] Business tier's own feature list is two-thirds "coming soon"
- Where: `app/(marketing)/pricing/page.tsx:109` (`cardFeatures()`, business branch),
  rendering `lib/entitlements.ts:386` and `:392` (`multi_seat`, `priority_support`,
  both `comingSoon: true`) alongside `:372-374` (`accounting`).
- Issue: Under "Everything in Pro, plus:", the priciest card lists exactly three
  lines: "Accounting: chart of accounts, ledger, reconciliation, balance sheet & cash
  flow" (shipped), "Additional seats for a bookkeeper or second pilot (coming soon)",
  and "Priority support (coming soon)". This is fully compliant with claim rule 5 —
  both unshipped lines are honestly flagged — but two of the three reasons the card
  itself offers to justify the per-seat upgrade aren't real yet, which weakens the
  card's own sell for the tier a reader is most hesitant about.
- Fix: Lead the card's own intro line with the one feature that is actually shipped,
  reusing language already approved in `TIER_DISPLAY.business.blurb`. Replace
  `"Everything in Pro, plus:"` for the business branch with:
  > "Everything in Pro, plus double-entry accounting:"

---

### [MEDIUM] Missing conjunction in the landing close band's tier list
- Where: `app/(marketing)/page.tsx:549`.
- Issue:
  ```
  {TIER_ORDER.map((tier) => TIER_DISPLAY[tier].name).join(", ")}{" "}
  plans, every one of them {INTRO_FIRST_MONTH_LABEL} for the first
  month, with a full account export.
  ```
  `.join(", ")` on `["Solo","Pro","Business"]` renders "Solo, Pro, Business" with no
  conjunction before the last item, so the full, rendered sentence at the page's
  final CTA reads: "Solo, Pro, Business plans, every one of them $5 for the first
  month, with a full account export." — a run-on list rather than a sentence, on
  every single page load, in the last section before the close-the-deal button.
- Fix: Join with a trailing "and" so it renders:
  > "Solo, Pro, and Business plans, every one of them $5 for the first month, with a
  > full account export."

---

### [LOW] "enforces with" is a dangling preposition
- Where: `app/(marketing)/pricing/page.tsx:201`.
- Issue: "Generated from the plan definitions the product enforces with." — "enforces
  with" needs an object that never arrives; reads as a dropped word.
- Fix: "Generated from the plan definitions the product enforces."

---

### [LOW] "Invoices" is described with different capabilities on the two public pages
- Where: `app/(marketing)/page.tsx:208` vs. `lib/entitlements.ts:303` (rendered on
  `pricing/page.tsx`'s matrix and tier cards via `FEATURES.invoices.label`).
- Issue: The landing spec block's line for the `invoices` feature is "Numbered
  invoice PDFs, email delivery, and view tracking" — no mention of payment links.
  The pricing page's matrix/tier-card label for the same `FeatureId` is "Invoices
  with PDF & payment links" — no mention of email delivery or view tracking. Both
  are true and both are shipped, but a reader who visits both pages sees the same
  feature summarized by two non-overlapping capability lists.
- Fix: Bring the landing line into line with the payment-link capability the pricing
  page leads with:
  > "Numbered invoice PDFs, payment links, email delivery, and view tracking."
