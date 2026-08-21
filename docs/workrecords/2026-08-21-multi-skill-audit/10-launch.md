# V1 launch readiness — gate walk, ORB plan, sequencing

V1 is a real product (382 app files, 50-table schema, 526+ unit assertions, ~20 verify
harnesses) sitting behind a short list of gates that are entirely human, not technical:
Stripe is in test mode, there is no Terms of Service or Privacy Policy, signup captures no
acceptance of anything, and the currency engine is fully built but must stay dark until
aviation counsel signs off. Nothing below argues the code isn't ready — it mostly is. What
blocks broad launch is four unsigned human decisions (G2 pricing, G3 legal docs, G4 live
Stripe, G6/G7 counsel copy) and one real gap the code openly documents: there is no way for
a stranger to contact a human anywhere in the product, and no analytics on the funnel that
would tell anyone the launch worked.

---

## 1. Gate readiness — `docs/LAUNCH-GATES.md` walked gate by gate

| Gate | Status | Evidence |
|---|---|---|
| **G1 — currency engine flag** | **NOT MET** | `lib/currency/gate.ts` requires the literal string `"true"`; nothing under `app/` calls the engine, so it renders nowhere (`docs/LAUNCH-GATES.md` lines 37–58). Six adversarial regulatory passes have run, the fifth found a bug the fourth's fix introduced; the gate's own text says a green `currency:verify` "is a floor and not a ceiling" (lines 106–141). Counsel has not answered C-1–C-5; the owner has not answered O-1/O-6; there is no airman-record schema for 61.57 to resolve against. Correctly out of scope for launch — and it must stay out of *all* public copy per MARKETING.md rule 3, which is independently enforced by `PUBLIC_CLAIM_FILTER = ["currency"]` in `app/(marketing)/pricing/pricing-model.ts:50`. |
| **G2 — pricing sign-off** | **NOT MET** | `docs/PRICING.md` is explicitly headed "PROPOSAL... the numbers in it are not signed" (line 3). Every price string in the repo still prints **$29** (the configured, already-live Solo price) while the proposal argues for **$49 Pro / $39-seat Business** — none of the proposed numbers appear anywhere the product can charge, which is the deliberate discipline `docs/LAUNCH-GATES.md` G2 describes (lines 180–184). §8 lists eight open owner decisions (numbers, seat minimum, trial length, annual-at-signup vs. upgrade, display names, grandfathering, live-mode confirmation, invoice-extras matrix line) — none closed in this repo. |
| **G3 — Terms of Service / Privacy Policy** | **NOT MET** | `app/(marketing)/terms/page.tsx:8-16` and the mirrored privacy page are counsel-gated placeholders, `noindex` by explicit `robots: { index: false }`, that state in their own body nothing on them is binding. `app/(auth)/signup/signup-form.tsx` (per `docs/LAUNCH-GATES.md` line 212) captures email/password only — no acceptance checkbox, no column recording consent, and no migration exists to add one. This is the gate everything else queues behind: G4 (money) cannot proceed while it's open. |
| **G4 — live Stripe (two switches)** | **NOT MET** | `lib/stripe/server.ts:23-26,54-55` requires `STRIPE_SECRET_KEY` and derives live-mode purely from the `sk_live_`/`rk_live_` prefix — confirming the key is currently test-mode-shaped per `README.md` ("Live Supabase project, live Stripe (**test mode**)") and `docs/PRICING.md` §7 ("Create Products and Prices in TEST mode only. No live-mode object until the standing counsel gate clears"). Both platform billing and Connect switches are mechanically ready (idempotent webhook, livemode guard, `connect:verify`/`billing:verify` harnesses) but neither has been flipped, and can't be until G2/G3 close. |
| **G5 — custom domain cutover** | **PARTIALLY MET** | The domain itself is not cut over (product still runs on the Vercel preview host per the marketing indexing guard in G2's text), but the sub-blocker that used to sit under this gate — the Resend sending-domain failure that broke signup confirmation — is **CLOSED, 2026-08-18** per `docs/LAUNCH-GATES.md` lines 386–403 and corroborated independently in `.agents/product-marketing.md` Discrepancy 3. Mail sends from `mail.amgaviationgroup.com`, verified DKIM/SPF, confirmed working by the owner. The remaining domain-move checklist (`NEXT_PUBLIC_APP_URL`, Stripe redirect URIs, Supabase Auth Site URL, both webhook endpoint URLs) is unstarted and depends on G4 being flipped live first. |
| **G6 — worker classification / 1099 posture** | **PARTIALLY MET** | The copy counsel needs to review is drafted and live in the repo today: the year-end-report disclaimer sits above every figure (`docs/LAUNCH-GATES.md` line 428), W-9 tracking asserts nothing (`pilot.clients.w9_status`), and `docs/CURRENCY-SPEC.md` C-2 (whether 61.57(e)(3)'s "employed by" language reaches a 1099 contract pilot) is queued for the same review. None of it has counsel's signature yet — prepared-and-waiting is the honest state, not met. |
| **G7 — tax/year-end copy (standing counsel gate)** | **PARTIALLY MET** | Same shape as G6: disclaimers exist and are described as "a first pass, not a substitute for review" by the gate's own text (line 459). One standing exception is flagged and NOT closed by this gate: `/reports/quarterly`'s "Set aside" column computes `netProfitCents × setAsidePercent` — a computed figure, not a summed one — predating the gate and explicitly called out as something counsel must decide on (lines 466–473), not something already resolved. |
| **G8 — duty/rest/flight-time (135.267)** | **MET (as "correctly not built")** | Nothing is built, deliberately — `docs/LAUNCH-GATES.md` states this is intentional because the product only sees one operator's slice of a pilot's flight time and a partial "you are within limits" claim is worse than none (lines 497-519). This is the one gate whose closed state *is* "stay unbuilt," and the repo honors that. |
| **G9 — medical-certificate modelling** | **MET (as "correctly not built")** | Same shape as G8: today's single-scalar `expires_on` on a document row is deliberately not extended into a real 61.23 model until a privacy review runs alongside counsel (lines 523-543). Correctly out of scope. |
| **G10 — public copy vs. what's built** | **MOSTLY MET, with two rows now honest and one still deferred** | Logbook import (rows #12/#13) is fully shipped and the gate text itself documents correcting a stale "not built" claim (`docs/LAUNCH-GATES.md` lines 556). Invoice delivery (#16) is built end-to-end via `lib/email/send.ts`, with one narrow honesty qualifier remaining: a live invoice send specifically has not been exercised, only the parallel Supabase-Auth-mail path over the same domain (line 557). The business per-seat plan (#10) is deliberately deferred — `multi_seat` reads `comingSoon: true` in `lib/entitlements.ts` per `docs/MARKETING.md` claim rule 5 — and the public copy correctly never claims seat invites. |

**Net read:** the code side of launch readiness is unusually strong for a pre-revenue,
solo-founder product — the verify-script discipline, the entitlements-driven claim filter,
and the "nothing deleted on downgrade" enforcement at the database layer (not just in copy)
are all real and evidenced. What's missing is entirely the four human signatures (G2/G3/G4,
plus counsel on G6/G7) and G5's remaining domain-move checklist, which cannot start before G4.

---

## 2. The ORB plan — one person, no audience, no budget

Grounded in the actual ICP (`docs/MARKETING.md` §2, `.agents/product-marketing.md`): the
U.S. independent contract pilot running day rates for owners/management companies/135
operators. This is a narrow, professionally-licensed, safety-culture audience — most of the
channel judgment below turns on that, not on generic SaaS-launch playbook defaults.

### Owned (build first, own it forever)

- **The four tokenized share-link pages are already an owned distribution surface and are
  currently wasted.** `docs/reviews/09-EXECUTIVE-SUMMARY.md` finding 8 (confirmed independently
  in this pass — `components/logo.tsx:26-49` is a bare `<span><svg>` with no link) means every
  invoice, estimate, and packet a pilot sends an operator's AP desk carries zero brand
  reinforcement or path back to signup. Before spending a single hour on rented/borrowed
  channels: make the mark a link to `/`, and add one small "invoiced with V1" or equivalent
  line. This is the single cheapest owned-channel win available and it converts on every
  invoice a pilot already sends, at zero incremental cost per send.
- **Email**, once G3 (ToS/consent) closes — the product already has the sending infrastructure
  (verified domain, `lib/email/send.ts`) and the natural list is the pilots who signed up.
  Start it as a monthly "what shipped" note once there's a paying cohort; do not build a
  separate newsletter infrastructure pre-launch.
- **A blog is not recommended as a starting owned channel.** No blog infrastructure exists in
  the repo today (`app/(marketing)` has no post-listing route), and a solo founder writing SEO
  content into a market this narrow (contract pilots, a few thousand people nationally) is a
  poor first-100-hours bet versus channel work below. Revisit post-first-ten-users.

### Rented (pick one or two, funnel to owned)

- **Reddit — the highest-signal free channel for this exact persona.** r/flying and r/aviation
  have large, professionally-adjacent audiences; more specifically, **r/aviationjobs** and
  smaller contract/135-crew-focused communities (e.g. crew-scheduling and PIC/SIC forums that
  already exist informally on Reddit and Facebook) are where this persona actually asks "how do
  you invoice your operators." Reddit tolerates founder participation *only* as a genuine
  community member answering questions, disclosing affiliation, and never as a drive-by pitch —
  self-promotion below the site-wide ~10% rule gets removed and can get an account banned. This
  is slower than it sounds and is the correct trade for a channel with zero cost.
- **LinkedIn** — the ICP's day job puts them there for network/certificate reasons already.
  One founder account posting build-in-public updates (a shipped feature, a real screenshot,
  no invented metrics per the standing claim rules) is the standard "medium update" cadence
  from the launch skill's own priority matrix — appropriate here because it costs only posting
  time.
- **Facebook groups for contract/freelance pilots exist and are the closest analog to a
  "trade forum" for this persona** — treat exactly like Reddit: answer questions, disclose
  you built the tool, never cold-pitch. These groups vary sharply on tolerance for promotion;
  check each group's rules before posting rather than assuming.
- **Do not lead with X/Twitter or Instagram.** No evidence this persona congregates there for
  work-tooling discovery, and it duplicates LinkedIn's effort for a worse audience match.

### Borrowed (the credibility shortcut, and it has to be earned first)

- **Aviation podcasts and YouTube channels aimed at working pilots** (charter/135 crew content,
  not airline-hobbyist content) are the correct borrowed-channel target — pitch as "here's a
  free look at the tool," not as a paid sponsorship, matching the TRMNL pattern the launch
  skill documents. Identify 3–5 by searching for 135/charter-pilot-focused YouTube and podcast
  hosts; this needs the founder to do outreach, not something this audit can pre-select without
  live search.
- **CrewRoo's own audience is not a legitimate borrowed-channel target** — it is the identified
  direct competitor (`docs/PRICING.md` §2.6) and its users are the wrong people to poach via
  comparison-shaming per MARKETING.md claim rule 7 ("no claim a named tool is bad at its own
  job"). If a comparison page is ever built, it must stay workflow-only.
- **Aviation counsel and any CPA the founder already has a relationship with** are a real,
  zero-cost borrowed channel most launch plans miss: a CPA who serves several contract pilots
  is exactly the kind of introducer this persona already trusts for financial-tool
  recommendations, and it costs one conversation.

### What this ORB plan deliberately does not include

**No Product Hunt launch is recommended before G3/G4 close.** A Product Hunt spike that lands
on card-required signup with no Terms of Service and a test-mode Stripe key is worse than no
launch — it burns the one good first impression on infrastructure that isn't ready to take
money. Product Hunt is a Phase 5 (full launch) tactic per the launch skill's own five-phase
model, not a Phase 2/3 tactic, and this product is currently pre-Phase-2 on the legal/payments
axis even though the code is Phase-4-ready.

---

## 3. Sequencing — what must be true before broad launch vs. what can follow

**Must be true before *any* external, non-friend signup (Phase 2/Alpha in the launch skill's
model):**
1. G3 closes — real Terms/Privacy exist, signup records acceptance (needs the migration
   `docs/LAUNCH-GATES.md` names as not yet written).
2. G2 closes — the owner signs a number, even if it's "ship $29 unchanged, revisit later."
3. Contact channel exists somewhere in the product — `lib/entitlements.ts:395-399`'s own
   comment ("There is no support address, no contact route and no help link anywhere,"
   confirmed still true by this pass finding no analytics/social/contact evidence in
   `app/(marketing)/site-footer.tsx`) is the cheapest pre-launch fix on this whole list: one
   `mailto:` link.
4. Minimum analytics — `docs/reviews/09-EXECUTIVE-SUMMARY.md` finding 9, independently
   confirmed here (no analytics package or script anywhere in `app/layout.tsx` or the
   marketing layout): without pageview + signup-funnel-stage events, the first ten users
   convert or don't with no visibility into where they dropped. This does not need a full
   analytics stack — server-side event logging into the existing Postgres, keyed by UTM
   passthrough into Stripe checkout metadata, is enough for ten users.

**Must be true before Stripe live-mode cutover (G4):**
5. G2 and G3 both closed (G4's own text makes this an explicit precondition).
6. Both Stripe switches flipped together, not staggered — the gate's own text is emphatic
   that platform billing and Connect are separate failure modes; run `billing:verify` and
   `connect:verify` against the live configuration with the non-local opt-in before taking
   the first real card.
7. The Connect webhook's three async-ACH event types registered on "connected accounts"
   scope specifically — the gate documents this exact mistake (registering fewer than three
   event types) as the one failure mode that "looks like nothing is wrong" while a client's
   failed ACH payment silently leaves an invoice reading Paid.
8. G5's remaining checklist (domain, redirect URIs, Auth Site URL, both webhook endpoints)
   completed in the same change as the G4 cutover — not before (nothing to point at yet) and
   not meaningfully after (share links sent under the interim domain must keep resolving).

**Can follow broad launch, not before it:**
- Annual pricing as an in-app upgrade (per `docs/PRICING.md` §3.2's own recommendation to defer
  it past first charge).
- Business per-seat invite UI (`multi_seat` is `comingSoon` by design — G10's #10 row).
- The blog/content-marketing owned channel.
- Podcast/YouTube borrowed-channel outreach — needs a working, paid product to point people at
  first; pitching before G4 closes wastes the credibility.

**The first ten users.** Given the ICP's size and this product's current contact-channel and
analytics gaps, recommend a manual Phase-1/Phase-2 approach exactly as the launch skill
describes it: recruit individually (a CPA/counsel introduction, a Reddit/Facebook-group
relationship built over weeks, not a cold post) rather than opening self-serve signup to a
larger unmeasured audience first. This also naturally validates G2's pricing before it's
irreversible — Solo stays $29 either way per `docs/PRICING.md` §3.2's stated reasoning (zero
migration cost), but Pro/Business numbers are far cheaper to adjust before ten people are
already paying $49 than after.

---

## 4. What NOT to launch with

1. **The currency board — absolute, not a judgment call.** MARKETING.md claim rule 3 states
   it appears "on no public page... not even 'coming soon'" and this is independently enforced
   in code by `PUBLIC_CLAIM_FILTER = ["currency"]` (`app/(marketing)/pricing/pricing-model.ts:50`).
   G1 documents six rounds of adversarial regulatory review, each finding what the round before
   introduced — this is not a "the code isn't done" gap, it's a "the arithmetic has had five
   confirmed near-misses on FAA-record correctness" gap, and it must stay dark regardless of how
   ready the rest of the product looks.
2. **Any "cancel anytime" framing until G3 closes and the mechanism is actually verified for
   every path.** `.agents/product-marketing.md` Discrepancy 2 (independently checked against
   `app/(app)/settings/billing/actions.ts` and `app/(app)/settings/account-actions.ts` in this
   pass — both paths are real code) shows the mechanism exists, but the Terms placeholder's own
   comment still asserts it doesn't. Reconcile the claim with the code before launch, don't
   ship the stale caveat *or* an unreviewed "cancel anytime" promise past counsel.
3. **The 135.267 flight-time / duty-rest output (G8) and any 61.23 medical modelling (G9)** —
   both correctly unbuilt; do not let "the currency engine is basically done" pressure pull
   either of these into scope for a first launch. They are structurally partial by design
   (single-operator slice, single-scalar medical) and the gate text is explicit that a partial
   safety claim is worse than none.
4. **Any tax-outcome phrasing** — MARKETING.md rule 10 names the exact banned shapes
   ("lowers your taxable income," "is deductible," "saves you $X at tax time") and notes this
   rule exists *because* that exact mistake shipped once already during a rewrite. Worth a
   pre-launch copy sweep specifically for this pattern given it has already recurred once.
5. **Annual pricing at signup** — `docs/PRICING.md` §3.2's own caution (a card-required trial's
   first charge jumping to $290–$490+ with no brand behind it is "a real abandonment risk") is
   sound and should hold for the first launch cohort regardless of what the owner decides for
   later cohorts.
6. **Any operator-facing pitch or account type.** `.agents/product-marketing.md` Discrepancy 1
   confirms there is no operator account (`pilot.accounts.kind` is only `'solo'`/`'business'`,
   both describing the pilot's own account) — do not let ORB channel selection (e.g. an operator
   trade publication) drift the launch toward a second ICP the schema does not support.

---

## What I did not cover

- Did not independently verify the live Stripe dashboard, Resend domain status, or Supabase
  Auth SMTP configuration — all claims about their state are sourced from this repo's docs
  and code comments, dated 2026-08-18, and taken at face value per this task's evidence rules.
- Did not re-audit the eight `docs/reviews/00-08` reports in full; relied on the 2026-08-18
  executive summary's "status since" section and spot-checked two of its findings (support
  contact, token-page branding) directly against current code rather than re-reading every
  underlying report line by line.
- Did not evaluate SEO/content-strategy depth, paid-acquisition channels (deliberately —
  "no budget" is stated in the task), or a Product Hunt asset kit, since the sequencing
  argument in §3 places Product Hunt after gates this repo has not yet closed.
- Did not price or validate the ORB plan's borrowed-channel podcast/YouTube list by name —
  identifying specific 135/charter-pilot content creators requires live web search this task
  didn't run; flagged as founder outreach work in §2 rather than invented.
- Did not assess `docs/BILLING.md`, `docs/CURRENCY-SPEC.md`, or `docs/WAVE-PARITY.md` beyond
  the citations pulled from `docs/LAUNCH-GATES.md` and `.agents/product-marketing.md` — those
  are large documents in their own right and a full read was out of scope for a launch-plan pass.
