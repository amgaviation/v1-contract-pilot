# Executive summary — V1 site review, 2026-08-18

Synthesized from reports 00–08 in this directory. Scope: the full surface — marketing,
auth, onboarding, the app, and the four tokenized client pages — reviewed against the
single ICP the codebase evidences (the independent U.S. contract pilot;
`.agents/product-marketing.md` Discrepancy 1). Roughly 85 findings across the eight
reports; the ten below are the ones that move prospect conversion and churn the most,
deduplicated where several reports hit the same defect from different angles.

---

## Status since the audit (updated 2026-08-18)

The findings below are left as written — this is a dated snapshot, and editing the diagnosis
after the fact would destroy the record. What has changed since:

- **Finding 1 (the Resend domain) is RESOLVED.** Mail sends from
  `mail.amgaviationgroup.com`; see `README.md` and G5 in `docs/LAUNCH-GATES.md`.
- **Finding 2 (signup told the truth about mail failures) is SHIPPED**, including the
  status-zero hole a review caught afterwards: `@supabase/auth-js` reports a fetch that never
  reached the server as `AuthRetryableFetchError` with status `0`, which the first version of
  the resend guard let through as a false success.
- **Finding 6 (the false read-only banner) is SHIPPED.**
- **Finding 3 (no contact channel) is SHIPPED**, and the claim is worth stating precisely:
  `BRAND.supportEmail` reaches the marketing footer, both public FAQs, the auth screens, the
  checkout and billing-portal failures, the billing and account-lifecycle errors, the
  unknown-status fallback, and the report exports that refuse to run. It is deliberately NOT
  on every terminal string in the product: ordinary validation errors and transient
  save/upload failures a pilot can simply retry do not carry it, and the four tokenized
  client surfaces never will.
- **Finding 8 (orphaned token surfaces) is SHIPPED**: the mark links to `/`.
- **Finding 10 is PARTLY shipped.** The Help topic and the Overview subtitle are corrected.
  The other half is still open: a completed clientless trip still renders "Invoice it" and
  routes to a form that cannot bill it (`app/(app)/trips/[id]/page.tsx:351-356`), which is
  the dead end the finding is actually about.
- **Still open:** findings 4, 5, 7, 9 and the second half of 10 — the cancel-flow save path,
  the hold-expiry warning the pricing page promises, pilot-facing lifecycle email, analytics,
  and the clientless-trip invoice guard. Plus the landing-page rewrite itself
  (`10-landing-page-copy.md`), which is specced and waiting on implementation.

---

## 1. The ten highest-impact findings

**1. One unresolved DNS task disables both acquisition and retention.** The Resend
sending domain is unverified (`README.md:74-79`), so the signup confirmation email fails —
and every one of the site's 8 CTAs terminates at `/signup`, so 100% of top-of-funnel
intent currently dead-ends (01-cro, 04-strategy, 06-onboarding, all Critical). The same
chokepoint — `lib/email/send.ts` is "THE ONLY PLACE THIS PRODUCT SENDS MAIL" — also
silently blocks the platform's payment-failed and receipt emails, so the entire
involuntary-churn recovery path is off with no admin alert (08-churn Critical). Fix:
verify `amgaviationgroup.com` at resend.com/domains (DKIM + SPF) or temporarily point
`INVOICE_FROM_EMAIL` at `onboarding@resend.dev`. Manual step; nothing else on this list
converts a visitor until it's done.

**2. The signup flow launders that failure into three false statements and a permanent
trap.** When the confirmation send fails, Supabase has already created the user row, but
`classifySignUpError` (`lib/auth/signup-outcome.ts:138-147`) reports "nothing was saved"
(false); the retry lands on `/check-email`, which claims a link was sent (false); and
`resendConfirmation` (`app/(auth)/resend-actions.ts:137`) unconditionally returns
`sent: true` even when the resend errored (false, forever). Login then tells the same
pilot their correct password "didn't match" (`app/(auth)/login/actions.ts:25-28`, no
`email_not_confirmed` case). This is a standing code defect, not an outage symptom — any
future transient mail failure re-arms the same trap (05-signup Critical + High).

**3. There is no way to contact a human anywhere in the product.** Confirmed by the
code's own comments: `lib/entitlements.ts:395-399` ("There is no support address, no
contact route and no help link anywhere") and `app/(auth)/welcome/actions.ts:189-193`
(the checkout-failure copy deliberately dropped "get in touch" because no channel
exists). A card-required, no-trial funnel with zero pre-purchase question path, and a
checkout failure state with no fallback (01, 02, 04 all flag independently). A `mailto:`
in `site-footer.tsx` and the two failure-copy sites is the smallest fix.

**4. Cancellation is one click, and the retention feature built for it is invisible.**
`setCancelAtPeriodEnd` goes straight to Stripe with no confirm, no reason capture, no
save offer (`app/(app)/settings/billing/actions.ts:282-329`). The Hold feature — the
exact "not flying this season" alternative — lives on a different, unlabeled Settings tab
and is never mentioned beside the Cancel button (`settings/account-panel.tsx` vs
`billing-panel.tsx:687-707`). Worse, "Deactivate" cancels immediately and forfeits the
paid remainder, while Billing's cancel preserves it — different money outcomes, no
cross-link (08-churn: 2 Critical + 2 High).

**5. The pricing page promises a pre-purge warning that does not exist.**
`pricing/page.tsx:360`: "The export works throughout, and we tell you before anything
goes." No code implements any warning — `app/api/holds/run/route.ts` purges commercial
records after a lapsed hold and only `console.log`s it; there is no notification system
and no hold-expiry email (08-churn Critical). A public data-deletion promise with no
implementation is a legal/trust exposure, not just a churn bug: either build the T-14/7/1
warning emails or pull the sentence.

**6. The read-only banner — the most-seen retention touchpoint — is wrong for 4 of its 6
trigger states.** Every page renders "Your subscription has ended… Resubscribe" for
`past_due`, `unpaid`, `incomplete`, and a pilot's own deliberate hold
(`app/(app)/app-shell.tsx:340-355`), telling a mid-dunning pilot to do the wrong thing
(`resubscribe()` refuses to run on those statuses). Accurate per-status copy already
exists unused in `lib/billing-state.ts` `STATUS_DISPLAY` (08-churn Critical).

**7. The pilot themselves never gets a lifecycle email.** Beyond one receipt and one
static payment-failed template: no dunning escalation, no email when Stripe exhausts
retries and cancels (the `customer.subscription.updated/deleted` branch only syncs
state), no card-expiring-soon notice, no document-expiry digest (despite the in-app
expiry ladder), no activation nudge for a paid pilot who stalls, no win-back
(`app/api/stripe/webhook/route.ts:265-329`, `lib/email/` inventory; 08-churn, 06-onboarding).

**8. The four client-facing token pages — the product's only organic loop — are
orphaned.** `/invoice/[token]`, `/estimate/[token]`, `/packet/[token]`, `/vendor/[token]`
and their 404s contain zero links to anything: `Logo` is a plain `<span><svg>`
(`components/logo.tsx:26-49`). An operator's AP desk asked to click "Pay $X online" or
"Set up autopay" cannot verify what V1 is — friction on the pilot's own revenue, and a
wasted brand impression on every invoice sent (02-navigation Critical).

**9. A non-converting visitor leaves no trace, and nothing is measured.** No analytics
package, script, or UTM capture anywhere (`package.json`, both layouts — 04-strategy
verified absence), and no lower-commitment capture (no email field, waitlist, or
newsletter). The funnel's only outcomes are "paid" or "gone, unrecorded." The landing
rewrite this audit precedes cannot be evaluated without at least pageview + CTA + funnel
stage events and UTM passthrough into Stripe checkout `metadata` (04-strategy High ×2).

**10. First-run steers a paid pilot into a dead end, and Help lies about what they
bought.** Overview's subtitle says "Start with a trip" beside a checklist whose step 1 is
"Add your first client"; a clientless trip saves fine but can never be invoiced
(`invoice_lines_validate_trip`), and the trip page still shows "Invoice it"
(`overview/page.tsx:1319`, `trips/[id]/page.tsx:351-356`). `/help`'s "Creating your
account" topic describes a trial that was replaced by the $5 intro month
(`lib/help/guide.ts:65`) — read by a pilot double-checking a charge they just paid
(06-onboarding High ×2).

---

## 2. Cross-cutting themes no single report caught

**A. One pipe, many failures — and the pipe reports success when it breaks.** Signup
confirmation, invoice delivery, dunning, receipts, and every future lifecycle email all
route through one `sendEmail()` and one unverified domain. The DNS fix (Finding 1) is
necessary but not sufficient: the resend action fabricates success, platform-mail
failures are swallowed as `console.error`, and no alerting exists — so the next mail
outage will be invisible again. Fix the domain, then make the channel honest about
failure (05's classification fixes, 08's alerting note).

**B. The right answer usually already exists in the codebase — unshipped.** Accurate
banner copy sits unused in `lib/billing-state.ts`; `BUSINESS_MINIMUM_ANNUAL` is defined
and unit-tested but never rendered; the back-link pattern exists on the statement page
but not the seven main detail pages; the mobile card pattern exists on Overview (with a
comment naming the exact failure) but not on Trips/Invoices/Expenses; the grouped
Settings sidebar was built to fix an overload it still exhibits below 1024px; the
day-rate price anchor was vetted in `docs/PRICING.md` §2.8 and never used; Hold was built
and then hidden from the cancel moment. The pattern is propagation failure, not design
failure — most fixes here are "apply the thing you already built."

**C. Sentence-level honesty, system-level overclaiming.** The claim rules are enforced
impressively — 03-content found zero violations on any live line. But the *system* makes
claims copy never could: "a link is on its way" (unsent), "nothing was saved" (saved),
"we tell you before anything goes" (we don't), Help's trial (removed), "Try V1" (a
5-field form + mailbox round-trip), legal pages that say nothing is binding beneath a
card form. The brand's trust discipline needs to extend from copywriting into error
paths, Help, and operational promises.

**D. Card-first + no memory = every stall is permanent.** Payment precedes value
(deliberate), but every drop-off point after it — mail trap, checkout failure,
provisioning wait with a manual Refresh (`welcome/page.tsx:44-63`), wizard that loses all
state on reload, empty app with no nudge job — is silent, unrecorded (no analytics), and
unreachable (no email lifecycle, no support channel). The funnel has no second chances
anywhere.

**E. The single-ICP call is right; the operator *seam* is still a growth surface.** The
codebase is unambiguous that pilots are the only customer (the task's two-sided framing
doesn't hold — see `.agents/product-marketing.md` Discrepancy 1). But operators do meet
the product weekly, at its money moments, via token links — currently anonymous (Finding
8). Linking the mark and captioning it ("the books software your pilot uses to bill
you") turns every invoice into the product's only zero-cost acquisition channel —
pilot-to-pilot referral via the paperwork other pilots' operators receive — without
building any operator-facing product.

---

## 3. Prioritized fix list

### Copy/content changes (no structural code)

1. Pull or soften the purge-warning promise until implemented — `pricing/page.tsx:360` (legal exposure).
2. Rewrite `/help` "Creating your account" to the shipped $5-intro model — `lib/help/guide.ts:62-68`.
3. Overview getting-started subtitle: "Start with a trip" → start with a client — `overview/page.tsx:1319`.
4. Signup account-type hint: defuse the "A business"/Business-plan name collision — `signup-form.tsx:180-183` (03's proposed text).
5. Pricing hero: "$5 for your first month, on every plan" → "on any monthly plan; annual bills the plain annual price from day one" — `pricing/page.tsx:126-129`.
6. Add one positioning sentence to the `/pricing` hero (audience + category) — `pricing/page.tsx:117-131`.
7. Landing page `metadata.title` from `BRAND.tagline` instead of bare "V1" — `app/(marketing)/page.tsx` (new export).
8. State the zero-take-rate fact once on the landing page and once in the pricing FAQ — near `page.tsx:152-181`.
9. Business card: render `BUSINESS_MINIMUM_ANNUAL`, lead with shipped accounting ("Everything in Pro, plus double-entry accounting:"), say what a seat is for — `pricing/page.tsx:109,156-161`.
10. Small sweeps: close-band "and" join (`page.tsx:549`), "enforces with" (`pricing/page.tsx:201`), align the two invoices feature lines, move the legacy-subscriber FAQ item off the pre-purchase list, README's retired workflow-wedge lead.

### Product/code changes

1. **Resend domain verification** (DNS: DKIM + SPF) or temp sender swap — gates everything; manual/ops.
2. Signup honesty: classify the mail-send failure, stop `sent: true` on resend errors, special-case `email_not_confirmed` at login — `lib/auth/signup-outcome.ts`, `resend-actions.ts`, `login/actions.ts`.
3. Contact channel: `mailto:` in `site-footer.tsx`, the checkout-failure copy, and `/check-email`.
4. Per-status read-only banner: thread `statusDisplay()` into `app-shell.tsx:340-355`.
5. Cancel flow: reason capture + Hold offer beside Cancel; cross-link Cancel↔Deactivate money difference — `billing-panel.tsx`, `account-panel.tsx`.
6. Hold-expiry warning emails (T-14/7/1) extending `api/holds/run` — makes fix #1 of the copy list unnecessary by making the promise true.
7. Dunning: escalating payment-failed copy, `hosted_invoice_url` in the failure email, a dunning-exhaustion/cancellation notice — `webhook/route.ts`, `platform-mail.ts`.
8. Analytics + UTM passthrough into checkout `metadata`; one email-capture field on `/pricing` — smallest viable measurement before the rewrite ships.
9. Token pages: make `Logo` a link to `/` with a one-line caption on the four token surfaces + 404s — `components/logo.tsx` call sites.
10. Landing paint: skip the `getSessionContext()` round trip when no auth cookie is present — `page.tsx:321-324`.
11. Carry `?plan=` from pricing cards through `/signup` to `/welcome`'s picker — `pricing/page.tsx:185`, `welcome-actions.tsx:58-61`.
12. Guard "Invoice it" on clientless trips — `trips/[id]/page.tsx:351-356`.
13. App consistency batch: standardize confirm dialogs on the stays-open-on-failure pattern; extend the mobile card pattern to Trips/Invoices/Expenses; pagination past the 1000-row caps; Clients search; logbook import into ⌘K and the logbook empty state; back-links on the seven detail pages; aircraft `loading.tsx` + retire confirm.
14. Onboarding: sign-out link in the wizard chrome, `?step=` persistence, cut the six never-read fields, first-invoice acknowledgment; post-checkout provisioning auto-poll with escalating copy.
15. Once email works: activation-nudge job (no trips N days after provisioning) and document-expiry digest, reusing the `reminders/run` pattern.

---

## 4. Landing page rewrite brief

Write for one reader: the independent U.S. contract pilot running a 1099 business —
the operator two-sided framing is not supported by the product and should not shape the
page (operators get orientation via the token surfaces, not the hero). The positioning
holds and is fresh (owner-signed 2026-08-17): keep "Flying is the job. This is the
business.", the money subhead, and every §5 claim rule — the audit found the copy
strategy sound and its execution mostly clean, so the rewrite's job is mechanics, not
message. Concretely: let the hero paint instantly (drop the session round-trip for
cookie-less visitors) and keep it inside the ten-second bar; make the CTA promise match
the path (account setup at $5 for the first month on monthly plans — not "Try");
add the two missing trust elements the claim rules permit — the zero-take-rate line and
a human contact path — plus a real page title built from the tagline; give `/pricing`
one sentence of its own positioning and a marked default tier so it can convert
cold arrivals; and instrument the page (events + UTM passthrough) before it ships so
the rewrite is measurable. Sequence matters: verify the sending domain first, fix the
signup error-handling so the funnel tells the truth, then ship the rewrite — a better
page pointed at today's funnel converts nobody.
