# Launch gates

The single list of things a **human** decides before V1 can launch. Everything in this
product that carries legal, financial or regulatory weight and is *not* a coding decision
is on this page, and nothing here may be closed by an agent, a review pass, or a green
build.

`docs/PLAN.md` locks the decisions and names the standing gates. This file is the operational
form of them: who signs, what stays blocked, what is already sitting in front of the reviewer,
and what "closed" actually means. It exists because a gate that lives only in a paragraph of a
planning document gets crossed by whoever reads the next paragraph.

**Two people sign things here.** The **product owner** (Tony) — every commercial, pricing,
scope and public-claim decision. **Aviation counsel** (the Florida aviation counsel named in
`docs/PLAN.md` Context) — every piece of copy where being wrong is a liability rather than an
embarrassment. Some gates need both, and where they do, the order matters and is stated.

**How a gate closes.** Someone with the authority above says so, in writing, and this file
records it. Add a `**CLOSED** — <who>, <date>, <where the decision is recorded>` line under the
gate. Do not delete the gate; a closed gate is the record that it was considered. If closing a
gate requires a schema change, that change is written and applied *before* the gate is marked
closed, never as a follow-up.

**What an agent may do**: prepare, draft, and say "this is ready for review". Never enable,
never switch a mode, never soften a disclaimer, never publish a claim.

---

## G1 — Enabling the currency engine flag

**What it is.** Phase 7's currency engine: 14 CFR 61.57 recency, 61.56 flight review, and the
61.23 medical posture, computed from the pilot's own logbook entries and document expiries.
`docs/PLAN.md` decision #15 and the standing gates put it behind a flag, dark, until reviewed.

**The flag now exists, and the engine is IMPLEMENTED, dark, behind it.** `docs/CURRENCY-SPEC.md`
§12 is the 2026-08-10 implementation-review addendum; read it before this paragraph settles
anything. The flag is `CURRENCY_ENGINE_ENABLED`, defined in `lib/currency/gate.ts`: it requires
an exact, case-sensitive match against the string `"true"`, so an unset variable, an empty
variable, and the string `"false"` all read as off — never "on unless disabled". Nothing under
`app/` calls the engine, so nothing renders it to a pilot today. Two consequences worth being
blunt about:

- The default-off behaviour is enforced in code (`isCurrencyEngineEnabled()` and
  `assertCurrencyEngineEnabled()` in `lib/currency/gate.ts`), not by the absence of a feature —
  building the engine did not weaken the default.
- It is per-deployment, not per-tenant, until an owner decision says otherwise. §12 also found
  that 61.56 flight-review currency is **not computable yet** — `pilot.documents` records
  `expires_on` but no completion date, and 61.56 arithmetic runs from the completion — so O-1(b)'s
  "ship 61.56 only" recommendation is not ready to act on.

What exists as *inputs*: `pilot.logbook_entries` carries the day/night takeoff and
full-stop landing split, `approach_condition` (`20260807140000`), the
61.57(c)(1)(iii) intercept/track boolean, and simulator device class; `pilot.aircraft` carries
the tailwheel flag; `pilot.documents` carries hand-entered expiries. The Overview screen
deliberately shows **document expiries only** and says so in its own copy — see
`app/(app)/overview/page.tsx` (the `expirations` query comment and the panel footnote), which
explains why `CURRENCY_DISCLAIMER` is *not* rendered there: that string asserts a calculation
this product does not yet perform, and spending it early is worse than not showing it.

**Who signs.** **Both.** Aviation counsel on the disclaimer wording; the product owner on the
written spec. They are independent — counsel's answer on C-1 does not settle O-1, and the
owner's answer on O-1 does not license the wording.

**Blocked until then.** Setting `CURRENCY_ENGINE_ENABLED=true` anywhere; rendering
`CURRENCY_DISCLAIMER` on any screen; any output that states or implies a recency conclusion; any
duty/rest output (G8, which ships inside this same flag and needs its *own* disclaimer, never
this one).

**Prepared and waiting for review.**
- `docs/CURRENCY-SPEC.md` — the written spec the owner reviews. Every regulation in it was
  fetched from the eCFR versioner API at issue date 2026-08-05 and the fetch URL is printed with
  each requirement. §10 splits the open questions into six for the owner (O-1…O-6) and six for
  counsel (C-1…C-6).
- `CURRENCY_DISCLAIMER` in `lib/brand.ts`, marked COUNSEL-REVIEWED COPY, held in one place so
  no screen can paraphrase it.
- §7's specific question for counsel (C-1): the word "airworthiness" is arguably a category
  error — airworthiness is a property of the aircraft (91.7, 91.403) and this product computes
  nothing about any aircraft — with a suggested alternative that counsel may accept or reject.
  The string does not change without that sign-off either way.

**Closes when all of these are true.**
1. Counsel has answered C-1 through C-5 and the final disclaimer string is confirmed verbatim.
2. The owner has answered O-1 (does the flag ship before an airman record exists — the spec
   recommends shipping 61.56 only, with named-missing-field states for the rest) and O-6 (whether
   `role = 'SOLO'` counts toward 61.57(a)/(b)).
3. The blocking schema gap is closed or explicitly accepted: **there is no airman record** —
   no certificates, ratings, or category/class on either the airman or the aircraft — which is
   why most 61.57 states resolve to `insufficient_data` today. `docs/CURRENCY-SPEC.md` §9 lists
   the required changes. This is a migration, and it is not written.
4. `npm run currency:verify` exists and passes — table-driven fixtures per currency type,
   including the full-stop night rule, the six-calendar-month instrument look-back, and
   `insufficient_data`. **This one is now done**: the script exists, is wired into
   `package.json`, runs in CI against a real Postgres, and passes 514 checks (492 pure plus 22
   database-contract). It says out loud in its final line when its database half was skipped,
   rather than reporting a clean pass.
5. **The regulatory findings below are closed.** Added 2026-08-10. See the next section — a green
   `currency:verify` is NOT on its own evidence that the engine is right.

### Where the engine actually stands, 2026-08-10

The engine is **implemented and dark**. `CURRENCY_ENGINE_ENABLED` requires the literal string
`true`, so an unset variable, an empty one, and the string `false` all read as off, and nothing
renders currency to a pilot in any deployed state. `docs/CURRENCY-SPEC.md` §12 records what the
implementation review found against the spec.

**Four adversarial regulatory passes have run. Each closed the previous round's criticals and found
a new one.** That pattern is the single most important fact on this page, because it means a green
suite is a floor and not a ceiling. Closed so far, each verified against live eCFR text:

- 61.57(a)(1)(ii) and 135.247(b) tailwheel: the code enforced full-stop but not the requirement
  that the takeoffs and landings were made **in a tailwheel airplane**, so a tricycle-gear trainer's
  landings credited a taildragger. Both closed, with unrecorded gear producing `insufficient_data`.
- The Part 135 day/night substitution overwrote a status without rebuilding the evidence behind it,
  so a card could read "current" while still listing what was missing.
- Flight review and medical were read account-scoped, not airman-scoped — in a multi-seat account
  that reads another member's medical.
- 61.57(c)(2)'s device path was unreachable, since a simulator row has no tail number by design.

**That class is now closed, and closed structurally.** Every gate runs through one rule — *a missing
fact produces `insufficient_data` only if supplying it could change the answer* — and the invariant
is asserted directly as a property test: **adding one more logbook entry can never turn a card from
`estimated_current` into `insufficient_data`**, because flying more cannot make a pilot less current.
A reviewer proved that test bites by reintroducing the old bug shape five separate times, reverting
between each and verifying the files byte-identical afterwards. The decisive result: a single-axis
gear-gate regression on one card is caught by the property test and **by nothing else in 230 tests**.

Later rounds also closed: a mixed real-and-simulator row was discarded whole, throwing away real
takeoffs and landings; and the fix for that read `total_time === simulator_time`, which credited a
row whose simulator time EXCEEDED its total time — the engine manufacturing currency from a pure
simulator session.

**Still open, and why this gate is still shut.** Two medium findings, both about honesty rather than
arithmetic. The instrument card and the three 90-day cards now answer "was this a real flight or a
device session?" by two different tests, and they can disagree on the same row. And a credited mixed
row attributes all of its movements to the aircraft portion without disclosing that the schema
records no split between the aircraft and the device — a defensible assumption, but an undisclosed
one, and this engine's whole posture is that its arithmetic is visible.

**Do not flip this flag on the strength of the suite being green.** Six adversarial rounds have run
and five of them found something the round before had introduced. The suite is a floor.

---

## G2 — Final pricing sign-off

**What it is.** The number the product charges, the trial length, and whether the deferred
per-seat business plan exists at launch. Decision #10 locks the *shape* (solo flat rate,
business per-seat); it does not lock the amount.

**Who signs.** Product owner. Counsel only if the pricing page makes a claim about what is
included (see G3 — the refund and cancellation terms are ToS surface, not pricing surface).

**Blocked until then.** Creating the live-mode Stripe Price and setting `STRIPE_PRICE_ID_SOLO`
against it (G4 depends on this one); changing any price string in the codebase to a number the
owner has not confirmed. **Existing in the repo and rendering on the Vercel preview host is not
publishing** — G5 is the gate for the custom domain going live to strangers, and that is where
"publishing a pricing page" actually happens. What this gate blocks, precisely, is a price the
owner has not signed ever being charged: no live-mode Stripe Price, and no price string anywhere
in the product moving off $29 without the owner's word.

That carve-out is **enforced in code, not asserted here.** A review pointed out — correctly — that
"a preview is not publishing" is worthless if a preview is crawlable, and the marketing layout was
at that moment declaring `index: true` on every deployment. Both `app/(marketing)/layout.tsx` and
`app/robots.ts` now gate indexing on `VERCEL_ENV === "production"`, and both fail closed when the
variable is absent, so a preview host is noindex by construction. If either of those checks is ever
removed, this carve-out stops being true and this gate has to be rewritten before that lands.

**Prepared and waiting for review.** `docs/PRICING.md` is the document this gate reviews — it is
drafted (see that file for the proposal and the competitor research behind it) but not yet
signed. The price statements in the repo, hand-maintained rather than derived, are:

| Where | What it says | Note |
|---|---|---|
| `app/(auth)/welcome/page.tsx` | `PRICE_LABEL = "$29/month"` | Presentational only; the Stripe Price object is authoritative, and its own comment says so |
| `app/(marketing)/page.tsx` | `PRICE_LABEL = "$29/month"` | Public landing page hero and CTA band. Deployed to the Vercel preview host only — see G5 |
| `app/(marketing)/pricing/page.tsx` | `PRICE_LABEL = "$29"` | Public pricing page. Deployed to the Vercel preview host only — see G5 |
| `app/(auth)/welcome/welcome-actions.tsx` | "Card required now, cancel anytime" | The claim in G3's cancellation problem |
| `docs/BILLING.md`, `.env.example` | $29/month solo, 7-day card-required trial | `STRIPE_PRICE_ID_BUSINESS_SEAT` is deliberately absent so "unset" can never pass for "configured" |

**Every price string above prints $29, the number the product is already configured and wired to
charge — none of them prints $39, the number `docs/PRICING.md` proposes.** The owner asked for
the landing page and pricing page to be built, and they are, but the copy that charges money does
not get ahead of this gate: it was a deliberate choice to print the confirmed number, not the
proposal.

**Closes when.** `docs/PRICING.md` states the launch price, the trial length, and whether the
business per-seat plan is in or out of launch; the owner signs it; and every string in the table
above is reconciled against the live Stripe Price in the same change. A price that disagrees
with Stripe by one dollar is a chargeback conversation, and the code comments already concede
these strings are kept in sync by hand.

---

## G3 — Terms of Service and Privacy Policy

**What it is.** The two documents that have to exist before a stranger can hand this product a
card and their business records.

**Who signs.** Aviation counsel drafts or approves; the product owner accepts the commercial
terms inside them (refunds, cancellation, data retention on cancellation).

**Blocked until then.** Any real signup. This gate blocks G4 outright — taking money without
published terms is the thing counsel review exists to prevent.

**Prepared and waiting for review.** Very little, and that is the honest state:

- **`/terms` and `/privacy` routes exist, but neither is a real document.**
  `app/(marketing)/terms/page.tsx` and `app/(marketing)/privacy/page.tsx` are counsel-gated
  placeholders — each says in its own body that nothing on it is binding, and both stay
  `noindex` until this gate closes.
- **Signup captures no acceptance.** `app/(auth)/signup/signup-form.tsx` has email and password
  and nothing else, and there is no column anywhere recording that a user accepted anything.
  Recording acceptance needs a migration — it does not exist, and this file is not the place to
  write one.
- **"Cancel anytime" is currently a claim without a mechanism.** `welcome-actions.tsx` says it;
  the product has no cancellation path, no Stripe billing portal link, and no account-deletion
  route. Cancelling today means emailing a human. Counsel needs to know that before approving
  copy that says otherwise, and the owner needs to decide whether launch ships the portal or
  ships honest copy.

**Facts the Privacy Policy has to be built on, all verified in this repo:**

- Subprocessors: Supabase (Postgres + Storage + Auth), Vercel, Stripe (platform billing and
  Connect), Resend (transactional email).
- Receipts are stored in a **private** Supabase Storage bucket, tenant-scoped by the first path
  segment (`supabase/migrations/20260805210000_phase4_receipts_storage.sql`).
- Receipt OCR runs **in the pilot's browser**, not on a server — `lib/receipt-ocr/engine.ts`
  states the reason plainly, and it is a genuine privacy claim the policy can make.
- The custody claim needs care, and `docs/PLAN.md` §0's correction is the exact wording
  constraint: no RLS policy and no application code path grants one tenant anything about
  another, **but** the service-role key, the owning Postgres role, and Supabase dashboard access
  all read every tenant's data, as they do in any Supabase project. That half of the promise is
  operational, not a database guarantee. The policy — and every piece of marketing copy — says
  "no application code path", never "we cannot technically see your data". Who holds the
  service-role key and dashboard access is an owner decision that belongs in the same review.
- There is no data-export-on-request path beyond `/logbook/export` and the year-end packet, and
  no deletion path at all.

**Closes when.** Both documents are published at stable URLs, signup records acceptance (with
the migration that makes that possible applied), and the cancellation claim either becomes true
or the copy changes.

---

## G4 — Taking live revenue: **two** Stripe switches, not one

**What it is.** Moving Stripe out of test mode. `docs/PLAN.md` Architecture is explicit that
these are two separate integrations that must not be entangled, and they are **two separate
switches with two separate failure modes**. Flipping one and assuming the other followed is the
specific mistake this gate exists to prevent.

**Switch 1 — platform billing (we bill the pilot).** `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_ID_SOLO` all move to live values, together. The live
webhook endpoint is a *different* endpoint object with a *different* signing secret; the live
Price is a *different* Price object with a different id. The webhook refuses any event whose
`livemode` disagrees with the key's mode (`app/api/stripe/webhook/route.ts`), which means a
half-flipped configuration fails loudly rather than writing test data into live records — but
that guard is a safety net, not a substitute for flipping all three at once.

**Switch 2 — Stripe Connect (the pilot bills their own client).** `STRIPE_CONNECT_CLIENT_ID` is
mode-specific: the platform's Connect settings issue a separate test and live client id, and
the live one only exists once the platform profile is completed on Stripe's side. The
`redirect_uri` must match the live registration **exactly** — `lib/stripe/connect.ts` says so,
and `app/(app)/settings/connect-actions.ts` builds it as
`${NEXT_PUBLIC_APP_URL ?? https://<host>}/api/stripe/connect/callback`, which ties this switch to
G5. `exchangeConnectCode` refuses a grant whose livemode disagrees with the deployment's key
mode, so a live pilot cannot link against a test grant.

`STRIPE_CONNECT_WEBHOOK_SECRET` is the second half of this switch, and it is the one that is
easiest to leave undone because nothing visibly breaks without it. It is the signing secret of a
**second** webhook endpoint — not `STRIPE_WEBHOOK_SECRET`, which cannot verify a Connect
delivery. Register it in the Stripe dashboard, in the same mode as the platform key, pointed at
`/api/stripe/connect-webhook`, with **"Listen to events on connected accounts"** selected (the
non-default choice; a direct charge on a pilot's own account is only delivered on that scope)
and subscribed to **four** event types — `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and
`payment_intent.succeeded` (the autopay settlement path, 20260817160000)
(`CONNECT_ENDPOINT_EVENT_TYPES` in `lib/stripe/connect-payments.ts` is the authority; this
list is a copy of it). Until the secret is set, the route answers 503 to every
delivery before touching Stripe or the database, and a client's payment is not recorded on the
invoice — the pilot has to enter it by hand from their Stripe dashboard, which is exactly the
behaviour that existed before 2026-08-13 and is not a fault, just an unfinished switch.

**Why all three, and what breaks with two.** A payment link can offer a bank payment (ACH)
as well as a card, and a bank debit settles ASYNCHRONOUSLY: `checkout.session.completed`
fires when the client accepts the mandate, with `payment_status` still `unpaid` and the money
not yet moved, and one of the other two follows a few business days later. Register only the
first and no ACH payment is ever recorded at all. Register only the first two and a **failed**
debit is invisible: the invoice keeps showing "bank payment initiated — settles in a few
business days" for money that is never coming, and the payment link (which Stripe deactivates
at mandate acceptance, because it is restricted to one completed session) is never replaced,
so the client has no way to try again. This is the one registration mistake whose symptom
looks like nothing being wrong.

Subscribe to **those three event types only**. Refunds and disputes (`charge.refunded`,
`charge.dispute.*`) are deliberately out of scope for automatic recording, and this is the
place that has to say so before launch rather than after a pilot discovers it: when a pilot
refunds a client in their own Stripe dashboard — including the refund this product itself asks
them to make when a client pays a link that outlived a voided invoice — **nothing removes the
payment from the invoice**. They correct it themselves with the invoice screen's "Correct"
control, and the invoice reads Paid until they do. The reasoning (reversing money
automatically is a strictly larger claim than recording it, and there is no equivalent of the
payment-intent unique index to make an auto-reversal safe to retry) is in the header of
`lib/stripe/connect-payments.ts`. This is a documented decision, not an oversight — but it is
a gap in the same books-drift direction the auto-recording feature was built to close, so it
is written down where the launch checklist will meet it.

ACH widens that gap slightly and the honest thing is to say by how much. A bank debit that
**settles** can still be reversed afterwards: Stripe allows a personal-account holder to
dispute an ACH debit for up to 60 days (about two business days for a business account), and
in rare cases Stripe receives a bank failure after the PaymentIntent has already reached
`succeeded`. Both arrive as `charge.dispute.*` — the same unsubscribed path as a card
chargeback — so the invoice goes on reading Paid until the pilot corrects it by hand. A
`checkout.session.async_payment_failed` is a different and smaller thing: money that never
arrived, handled automatically, with nothing to reverse.

**Apply `supabase/migrations/20260813120000_connect_async_payments.sql` BEFORE deploying the
build that writes the two new outcomes**, not after it. That migration widens one CHECK
constraint on `pilot.stripe_connect_events` so `outcome` may also be `'payment_pending'` or
`'payment_failed'`; it is purely additive, so applying it early against the previous build
changes nothing observable. Applying it late does not fail the same way: until it lands, every
unsettled or failed ACH delivery hits the old constraint, Postgres raises `23514`, the Connect
route answers 500, and Stripe retries that delivery for up to three days. Nothing is
mis-recorded in that window — card payments and settled ACH payments write outcomes the old
constraint already allowed, so money keeps landing on the right invoices — but every bank debit
in flight sits in a retry loop and no pilot sees a pending or failed notice. `npm run
connect:verify` checks the constraint's shape and is the fastest way to confirm the migration is
in before the deploy goes out.

**Before enabling ACH for a pilot**, check that `us_bank_account_ach_payments` is `active` on
their connected account. The product reads this itself and degrades honestly — a link is
created card-only with a sentence saying why, rather than failing — but a pilot who signed up
for lower fees and silently gets card-only links has not got what they came for. The Settings
→ Business panel shows the current state.

A pilot can be paying us on live platform billing while still connecting a test-mode Connect
account, or the reverse. Neither is visible from the other's dashboard. Check both.

**Who signs.** Product owner for the switch itself; **counsel review before the product takes
revenue is a standing gate** in `docs/PLAN.md` and is not satisfied by G3 alone — contractor
classification is directly on point (G6).

**Blocked until then.** Onboarding any paying customer. Also: the operator's own comped account
(`docs/BILLING.md`, "Current comp accounts") is `stripe_customer_id IS NULL` by convention, and
any future dunning or seat-sync job must skip those rows rather than treat them as delinquent.

**Prepared and waiting.** The full mechanical surface is built and verified: signature
verification on the raw body, idempotency keyed on Stripe's own event id, retry safety
(`processed_at` NULL means "run it"), out-of-order safety, and the livemode guard — all asserted
by `npm run billing:verify`, which signs its own payloads and names its own skips. Connect is
asserted by `npm run connect:verify`, including that no key belonging to a pilot is ever stored;
only the `acct_…` id is. `createPaymentLinkForInvoice` passes no `application_fee_amount`, no
`on_behalf_of`, no `transfer_data` — decision #8's "no application fee" made mechanical.

**Closes when.** G2 and G3 are closed; both switches are flipped and each verified against its
own live dashboard; `billing:verify` and `connect:verify` have been run against the live
configuration with the non-local opt-in; and the owner has decided the statement descriptor and
the legal entity that appears on the pilot's card statement.

---

## G5 — Custom domain cutover

**What it is.** Moving off the Vercel preview host onto the real domain. `docs/PLAN.md` Open
items calls the domain a naming decision rather than a build blocker — that is still true of
*choosing* it, and stops being true the moment anything external points at a URL.

**Who signs.** Product owner (it is a purchase and a brand decision).

**Blocked until then.** Sending any email a pilot will click (see the sending-domain problem
below), publishing any public page, and completing G4's Connect switch, whose live redirect URI
has to be registered against the final origin.

**Everything that moves with the domain, all of it verified in this repo:**

| Surface | Where | What breaks if missed |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Vercel env; read by `app/layout.tsx` (`metadataBase`) and `connect-actions.ts` | Connect OAuth redirect goes to the old host and Stripe rejects the mismatch |
| Stripe Connect redirect URI | Stripe Connect settings, live mode | OAuth fails at the callback, after the pilot has already authorised |
| Supabase Auth Site URL + redirect allowlist | Supabase dashboard; consumed by `app/auth/confirm/route.ts` | Confirmation and password-reset links land on the old origin |
| Stripe webhook endpoint URL | Stripe dashboard, live mode | Silent: Stripe keeps delivering to the old URL and provisioning stops |
| Stripe **Connect** webhook endpoint URL | Stripe dashboard, live mode, connected-accounts scope | Silent, and worse than silent: payments keep arriving in the pilot's Stripe balance and stop being recorded on their invoices, which go on reading as overdue |
| Shared invoice links | `app/(app)/invoices/[id]/share-panel.tsx` builds them from `window.location.origin` | Links a pilot already sent to *their* client keep pointing at the old host — so the old host must keep resolving, it cannot simply be turned off |
| Credential packet links | `app/packet/[token]` | Same as above |

**The related blocker, which is not optional and is currently open.** `README.md` records it:
signup returns `Error sending confirmation email` because Resend rejects the send with
`550 — the sending domain is not verified`. **The owner decision this gate left open is now
made: the sending domain is `mail.amgaviationgroup.com`, sending as
`v1-support@mail.amgaviationgroup.com`** (2026-08-18). Until that subdomain is verified at
resend.com/domains with DKIM and SPF, **no new pilot can complete signup**. This needs someone
with DNS access, which is the definition of a human gate.

Verification alone does not close it. Two systems send mail and only one reads this repo's
config: product mail uses `INVOICE_FROM_EMAIL`, and the signup confirmation comes from Supabase
Auth's SMTP relay, set in the Supabase dashboard. Both must name the verified domain.

**Closes when.** The domain is bought and attached, every row of the table above is updated,
the sending domain is verified and a real confirmation email has been received and clicked, and
the previous host still resolves for already-issued share links.

---

## G6 — Worker classification and the 1099 posture

**What it is.** This product's users are independent contractors, and it records W-9 status and
reconciles the 1099s their clients issue. It must never tell a pilot — or a pilot's client —
what their classification *is*, or what it should be. `docs/PLAN.md`'s standing gate says it
plainly: a tool helping pilots run independent businesses arguably supports the contractor
characterization, but that is counsel's call, not ours.

**Who signs.** Aviation counsel confirms the copy. The owner signs off on any marketing claim
built on top of it.

**Blocked until then.** Any public or in-product copy that characterizes the pilot's
relationship with their client; any marketing line of the "stay compliant as a 1099 contractor"
shape; any output that reads as advice about which form to file.

**Prepared and waiting for review — the copy counsel actually reviews:**

- `/reports/year-end` — the disclaimer callout sits **above every figure**, not in a footnote:
  "This is a summary of what you recorded — not tax advice, and not a tax return… Your CPA or
  tax preparer is the authority on what to file — use this to hand them clean numbers, not to
  decide what you owe."
- `pilot.client_tax_forms` (`20260807080000`) — the 1099-NEC the *client* issued, reconciled
  against the pilot's own cash-basis ledger. Its column comment already states that a delta is
  normal (December/January payment timing), not necessarily an error, and that the pilot's CPA
  is the authority on the delta.
- W-9 tracking: `pilot.clients.w9_status` / `w9_sent_at` / `w9_received_at`, surfaced as an
  attention-queue item on the Overview and as a document in the client packet
  (`app/(app)/clients/[id]/packet-panel.tsx`). It records a status the pilot knows; it asks for
  nothing and asserts nothing.
- `/reports/quarterly` and `/reports/profit-loss` carry their own disclaimers, cross-referenced
  to the year-end one.
- **One question already queued for the same review**: `docs/CURRENCY-SPEC.md` C-2 — does 14 CFR
  61.57(e)(3)'s "employed by a part 119 certificate holder" reach a 1099 contract pilot flying
  on that operator's certificate under its training program? Our entire user base sits on the
  wrong side of the ordinary meaning of "employed". The engine never infers the exemption, but
  the field's label and help text need counsel's language.

**Closes when.** Counsel has read the four copy surfaces above plus C-2 and confirmed each, and
the confirmed strings are the ones in the code. Note that this gate overlaps G7 without
replacing it: "what tax copy may say" and "what may be said about employment status" are
different questions and got listed separately in `docs/PLAN.md` for that reason.

---

## G7 — Tax and year-end copy (standing counsel gate)

**What it is.** `docs/PLAN.md`'s "Standing counsel gates, restated": `/reports/year-end` and
`pilot.client_tax_forms` — this product is not a tax preparer and must not read as one. The
disclaimer above every figure is a first pass, not a substitute for review.

**Who signs.** Aviation counsel.

**Blocked until then.** Marketing the year-end packet as a feature to a stranger at the product's
real domain; adding any figure that is computed rather than summed.

> **A standing exception this gate must not be read as approving.** `/reports/quarterly` already
> carries a "Set aside" column that computes `netProfitCents × setAsidePercent`, which is a figure
> computed rather than summed. It PREDATES this gate; it was not introduced under it. It is recorded
> here rather than quietly tolerated, because a gate whose text forbids something the product
> already does is a gate nobody can act on. Counsel should decide explicitly whether that column
> stays, changes, or goes — and until they do, nothing may add a second computed figure anywhere.
> Note that the column's percentage is pilot-supplied and its base excludes mileage; the screen's
> own copy states both, and makes no claim about what the pilot actually owes.

**Existing in the repo and
rendering on the Vercel preview host is not marketing it** — and, as in G2, that is now enforced by
`VERCEL_ENV`-gated indexing in `app/(marketing)/layout.tsx` and `app/robots.ts` rather than merely
asserted. G5 is the gate for the custom domain
going live to the public, and that is the point at which the landing page's and pricing page's
mention of a year-end report (`app/(marketing)/page.tsx`'s Reports feature; `app/(marketing)/pricing/page.tsx`'s
Included list) would actually reach a stranger. The landing page already frames it as a record
"for you or for whoever prepares your taxes," never a filing; the pricing page's Included list
names it with no framing at all. Neither is counsel's sign-off, so neither licenses the domain
going live on its own. Nothing on those screens computes tax owed today, and nothing may start.

**Prepared and waiting.** The copy listed in G6, plus the design constraint that produced it:
`/reports/quarterly` prints a net-profit line and a set-aside column and says outright that both
are arithmetic on a percentage the pilot chose, not a number this product asserts as correct;
`/reports/profit-loss` deliberately touches no tax rate and no set-aside at all, which is why it
caveats less.

**Closes when.** Counsel confirms the disclaimers as written, or supplies replacements, and
confirms that a cash-basis summary handed to a CPA does not cross into preparation.

---

## G8 — Duty, rest and flight-time output (standing counsel gate, currently blocking a build)

**What it is.** 14 CFR 135.267. `docs/PLAN.md` calls this the highest-liability output the
product could ship, and the reason is in the regulation's own text, quoted in
`docs/CURRENCY-SPEC.md` §8: the limits count **total flight time in all commercial flying**,
across every operator. This product sees one pilot's records for the clients they entered — a
per-client slice, never the cross-employer total. A tool that says "you are within limits" when
flying for a different operator has already pushed the pilot over is worse than saying nothing.

**Who signs.** Aviation counsel, with its **own** reviewed disclaimer — never a reuse of
`CURRENCY_DISCLAIMER`. "You are current" and "you are legal to fly today" are different claims
with different consequences of being wrong.

**Blocked until then.** Building it at all. If it is ever built it ships **inside** G1's flag,
behind G1, not alongside it.

**Prepared and waiting.** Nothing is built, deliberately. `pilot.operator_qualifications`
records per-operator qualification *status* (135.293 / 135.297 / 135.299, with calendar-month
windows per 135.301) and never time worked — that distinction is load-bearing and should not be
eroded by a later feature.

**Closes when.** Counsel supplies the disclaimer and confirms the framing, and the owner accepts
that the output is structurally partial.

---

## G9 — Any medical-certificate modelling (standing counsel + privacy gate)

**What it is.** Today a medical is one hand-typed `expires_on` on a `pilot.documents` row. That
cannot represent a medical under 14 CFR 61.23, where one certificate carries several
simultaneous expiry dates depending on class, the airman's age at examination, and the
privileges being exercised — a single scalar is correct for one reading and silently wrong for
the others.

**Who signs.** Aviation counsel **and** a privacy review. Medical data is qualitatively
different from a day rate or a receipt, and it is the case the custody promise in G3 has to hold
for without exception.

**Blocked until then.** Building the data model. `docs/CURRENCY-SPEC.md` §2.8 recommends the
engine continue not to compute 61.23 at all (counsel question C-3), and nothing about the
current single-date display changes without this gate.

**Prepared and waiting.** §2.8 of the spec; the existing document-expiry panel, whose copy is
already scoped to "the expiry dates you recorded on your own documents".

**Closes when.** Counsel confirms C-3 and the copy that accompanies a pilot-entered medical
date, and the privacy review has covered storage, access and deletion for it specifically.

---

## G10 — What the public copy is allowed to claim about what is built

**What it is.** Three decisions locked in `docs/PLAN.md` are not built, and a landing page
written from the plan rather than from the product would claim all three. This is a launch gate
because the fix is an owner decision — build it, or scope the copy — and not something an agent
should quietly resolve in either direction.

| Locked decision | Reality today |
|---|---|
| #12/#13 — logbook import: ForeFlight, LogTen Pro, generic column mapper | **Built, and the public copy may say so.** `/logbook/import` ships all three paths; `app/(app)/logbook/import/actions.ts` writes both `pilot.logbook_import_batches` and `pilot.logbook_source_files`. `npm run logbook:verify` round-trips a fixture of each shape and asserts that a re-imported file is deduped by fingerprint while trip-derived and manual entries bypass fingerprinting entirely. **This row previously read "Not built … no code path writes to them", which was true when the gate was written and false by the time anyone read it** — the risk a stale gate row carries is the opposite of the one it was written for: it makes the owner refuse a claim that is actually honest. |
| #16 — invoice delivery from the platform | **Built, and the public copy may say so — with one honest qualifier.** `sendInvoice(id, "platform_email")` sends a real email with the PDF attached and the payment link in the body (`lib/email/send.ts`; `sendInvoiceReminder` chases without touching status; replies route to the pilot's own address, never a platform mailbox). The option is hidden in the UI unless `RESEND_API_KEY` and `INVOICE_FROM_EMAIL` are configured AND the client has an address on file — so it cannot silently no-op. **This row previously read "Not built… there is no send path", which was true when written and false by the time anyone read it** — the same stale-in-the-refusing-direction failure the logbook-import row above already documents. The qualifier: no live send has yet been executed, because the sending domain is unverified (G5). The mechanism is built and tested to the boundary; the boundary itself is unexercised until DNS lands. |
| #10 — business per-seat plan | **Deferred on purpose.** No `STRIPE_PRICE_ID_BUSINESS_SEAT`, no seat-sync job. |

**Who signs.** Product owner.

**Blocked until then.** Publishing a landing page, a pricing page, or any feature list.

**Closes when.** The owner has decided, per row, whether launch waits for the feature or the
copy stops claiming it — and `npm run logbook:verify`, named in `docs/PLAN.md`'s Verification
list and missing from `package.json`, exists if import ships.

---

# Open product decisions

Not gates in the sign-off sense — no lawyer is needed — but each is a fork the product cannot
take on its own, and taking the wrong one is expensive to reverse. These belong to the owner.

**MONTHLY GUARANTEE DOUBLE-BILL — app/(app)/invoices/actions.ts around line 1009.**
Four separate 3-day trips invoiced against a 10-day monthly minimum bill 19 days for a 12-day
month. An honest warning can ship immediately. The automatic credit cannot, because
pilot.guarantee_periods stores guaranteed_days and settled_invoice_id but NOT days already billed.
The two possible shapes differ in what the pilot's client sees on paper:
  (a) a negative-quantity credit line on the later invoice, or
  (b) re-opening the settlement and netting it.
This is the owner's call and must not be decided by an agent.

**Per-diem proration on the first and last day.** The draft bills full per diem × N days. The
convention a pilot's client will name — GSA/IRS M&IE — pays 75% on the first and last travel
day. Convention, not law, so billing 100% on both ends over-bills two days on every trip.
Belongs as a client-level option; recorded in `docs/PLAN.md`'s Layer 1 limitations.

**`billing_state = 'written_off'` has no writer.** The trips list still renders a badge for a
state nothing can reach. Closing it needs a write-off *feature*, not a grant — so it waits for
one rather than getting a `SECURITY DEFINER` RPC nothing calls.

**A day type's `billable`, `invoice_line_type` and label are re-resolved at draft time.** Only
`rate_cents` is snapshotted onto `trip_days`, so toggling "Billable" in settings changes what
already-captured, not-yet-invoiced days will bill. Mitigated by a warning at the toggle; the
real fix is snapshotting all four, which is a migration and a decision about existing rows.

**`trip_days.rate_cents` is `NOT NULL DEFAULT 0`.** "No rate agreed" and "$0 agreed" are the
same stored value — the exact distinction `day_types.default_rate_cents` stays nullable to
preserve. A genuinely comped billable day cannot be recorded without a warning on every draft.

**Trial length.** Seven days may end before a contract pilot has flown a billable trip, which is
the moment the product proves itself. Config, not code (`docs/BILLING.md`).

**Email confirmation is ON at signup**, so a card-required trial starts with a "check your
email" wall. A deliberate decision to revisit, not an oversight — and G5's sending-domain
problem makes it currently fatal rather than merely frictional.

**`docs/CURRENCY-SPEC.md` §10's owner questions (O-1 … O-6)** are open product decisions in
their own right and are listed there rather than repeated here, because the reasoning that makes
each one a real fork is in the sections they sit under. O-1 — whether the flag ships showing
only the fully computable 61.56 — is the one that decides whether Phase 7 can ship at all before
an airman record exists.
