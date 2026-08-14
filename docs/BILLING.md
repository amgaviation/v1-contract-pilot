# Billing

*Refreshed 2026-08-14 — the previous version of this document described
the pre-three-tier, single-Solo-plan product and had drifted from what's
actually wired. This version reads from `lib/entitlements.ts`,
`lib/stripe/prices.ts`, `.env.example`, and the `/settings/billing`
screen. See `docs/PRICING.md` for the pricing *proposal* (its numbers are
not all signed yet — this document only states what is wired, never a
dollar figure).*

How a person becomes a tenant, what's configured where, what each tier
includes, and the one deliberate exception to the self-serve rule.

## The shape of it

**Three tiers — Solo, Pro, Business — each sold monthly or annually, card
required, with a 7-day trial** (`docs/PLAN.md` decisions #6, #7, #10;
tier ladder added by the owner's 2026-08-11 order, see `docs/PRICING.md`
§1). Business is licensed per seat with a two-seat minimum; Solo and Pro
are flat-rate, single-unit subscriptions. `lib/entitlements.ts` is the one
place a tier is named or its feature set defined — the welcome plan
picker, `/settings/billing`, the upgrade screen, the webhook's
price→tier mapping, and the public pricing page all read from it, so
"what does Pro include" can only ever have one answer in this codebase.

**No dollar amount lives in code.** Every price a pilot sees is read live
from the Stripe Price object the tier's env var points at
(`lib/stripe/prices.ts`), never typed into a file — a changed Price is a
new Stripe object pointed at by the same env var, so a by-ID cache can
never serve a stale figure. What each tier costs today is whatever that
live Price says; this document doesn't restate it because restating it is
exactly how the old version of this document went stale.

**The gating principle** (`lib/entitlements.ts`'s own header, stated here
because it's a safety posture, not packaging): tiers gate BUSINESS DEPTH,
never safety records. The logbook, the currency board, and the documents
wallet stay on every tier forever — a professional shouldn't have their
14 CFR 61.51 record-keeping duty held hostage to a subscription.
Account-wide CSV export is likewise on every tier, deliberately (the
downgrade promise is "read-only plus export, never locked out of your own
data," and a paywalled export would contradict it).

The signup path:

```
/signup            create a Supabase identity (email confirmation is ON)
   ↓
/login             sign in
   ↓
/welcome           no tenant yet → pick a tier (Solo/Pro/Business) and
                    billing interval (monthly/annual), "Start your 7-day trial"
   ↓
Stripe Checkout    subscription mode, card required, trial_period_days=7,
                    quantity = seatsForTier(tier) (2 for Business, 1 otherwise)
   ↓
webhook            checkout.session.completed → provisions the tenant,
                    mapping the subscription's Price back to a tier via
                    tierForPriceId (lib/entitlements.ts)
   ↓
/                  the app
```

**Only the webhook creates a tenant.** Returning to the success URL does
not, and cannot: `/welcome?checkout=complete` renders a "setting up your
workspace" state and nothing else. A forged return URL mints nothing.
That is decision #7, and `npm run billing:verify` asserts it.

**Plan changes after signup** (upgrade, downgrade, switch monthly↔annual)
go through `/settings/billing`, which writes nothing itself — every
button there calls Stripe first (`subscriptions.update`) and the tier on
record (`pilot.accounts.plan_tier`) only changes when the webhook's
confirmation event lands. A Business upgrade always sets quantity to the
two-seat minimum or the account's current seat count, whichever is
higher — `seatsForTier` is the one place that floor is computed, so a
plan-change path can't silently underbill an existing multi-seat account.
Downgrading never deletes anything: screens outside the new tier stop
accepting new work and come straight back on upgrade (`DOWNGRADE_NOTE`,
rendered verbatim on the billing screen).

## Configuration

Eight variables, all in the Vercel project and `.env.local` for
development. See `.env.example` for the full annotated list — it is the
source of truth for names; this table is not.

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | Test key until launch |
| `STRIPE_WEBHOOK_SECRET` | From the platform webhook endpoint's signing secret |
| `STRIPE_PRICE_ID_SOLO` / `STRIPE_PRICE_ID_SOLO_ANNUAL` | Solo, monthly and annual |
| `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_PRO_ANNUAL` | Pro, monthly and annual |
| `STRIPE_PRICE_ID_BUSINESS` / `STRIPE_PRICE_ID_BUSINESS_ANNUAL` | Business (per-seat, 2-seat minimum), monthly and annual |
| `NEXT_SUPABASE_SECRET_KEY` | Service role. The webhook writes for a user with no session in flight, so it cannot use a session-scoped client |

The six `STRIPE_PRICE_ID_*` names are pinned by `TIER_PRICE_ENV` in
`lib/entitlements.ts` and pinned again by `tests/entitlements.test.mjs` —
a renamed or unset var silently un-maps that tier/interval rather than
erroring, so **an empty value must be treated as unset, never as a
configured tier that happens to cost nothing.** Leave a var empty only
when that tier/interval is genuinely not for sale yet; the pickers then
show it as unavailable instead of guessing a price.

Still deliberately absent: `STRIPE_PRICE_ID_BUSINESS_SEAT`. Business
today is a flat per-seat *subscription* (quantity = seats, no seat-add
UI); true incremental seat-sync (`multi_seat` in `lib/entitlements.ts`,
still `comingSoon: true`) is a separate, not-yet-built feature, and adding
the env var now would let "unset" pass for "configured" the day it lands.

**Keep all Stripe values in the same mode.** The webhook rejects any
event whose `livemode` disagrees with the key's mode, so a test event can
never mutate live data — but that guard only holds if they aren't mixed.

## What the webhook guarantees

Each of these is asserted by `npm run billing:verify`, which signs its own
payloads so the cases Stripe won't produce on demand are still testable:

- **Signature verification** on the raw body. Missing, wrong-secret, and
  malformed signatures are all rejected `400`.
- **Idempotency.** `pilot.stripe_events` is keyed on Stripe's own event
  id, so a replayed delivery collides on insert rather than double-
  applying. Stripe retries for up to 3 days.
- **Retry safety.** A handler that crashed leaves `processed_at` NULL, and
  that retry *is* allowed to run. Only a non-null `processed_at` means
  "skip" — otherwise one transient failure would strand a paying customer
  unprovisioned forever.
- **Out-of-order safety.** Stripe does not guarantee delivery order, so a
  stale event is skipped when a newer one for the same object was already
  applied. Without this a late `trialing` could overwrite a current
  `active`.
- **Tier mapping from Stripe's own record.** `plan_tier` is written from
  the subscription's actual Price via `tierForPriceId`, never from a UI
  claim — a checkout and its provisioning can't disagree about what was
  sold, and an upgrade/downgrade takes effect on Stripe's confirmation,
  not on the button click.
- **Test/live separation**, above.

Handler failures return **500 on purpose** so Stripe retries. Returning
200 would silently drop a paid customer's provisioning.

## Comp / internal accounts — the deliberate exception

An account with **`stripe_customer_id IS NULL`** is an internal or comped
tenant. It was created directly rather than through checkout, is not a
Stripe customer, and contributes nothing to MRR. `/settings/billing`
recognizes this (`isComped`) and shows "this account isn't billed through
Stripe" instead of plan-change controls.

This does not contradict decision #7. That rule exists so a *self-serve
customer* cannot reach an unbilled tenant; it is not a rule against the
operator comping access. The distinguishing mark is the null column, which
is why comping is done this way rather than by issuing a $0 Stripe
subscription — a $0 subscription would pollute revenue metrics and make
"how many paying customers do we have" a harder question than it should
be.

**Any future dunning, cancellation, or seat-sync job MUST skip rows where
`stripe_customer_id is null`** rather than treating them as delinquent or
unlinked. That is the one obligation this convention creates.

To comp an account:

```sql
-- 1. The person signs up normally at /signup and confirms their email.
-- 2. Then, once:
insert into pilot.accounts (kind, plan, plan_tier, seat_count, legal_name,
                            status, stripe_customer_id, stripe_subscription_id,
                            trial_ends_at)
values ('solo', 'solo', 'solo', 1, '<their business name>', 'active',
        null, null, null);
-- plan_tier is the entitlement ladder ('solo' | 'pro' | 'business') —
-- set it to whichever tier the comp is meant to grant. plan stays 'solo'
-- (the flat-rate billing shape) unless a per-seat comp is ever needed;
-- see 20260812300000_account_plan_tier.sql's header for how the two
-- columns relate and why they're allowed to differ.

insert into pilot.account_members (account_id, user_id, role)
select a.id, u.id, 'owner'
  from pilot.accounts a
  cross join auth.users u
 where u.email = '<their email>'
   and a.legal_name = '<their business name>';
```

Converting one to paid later is just a normal checkout: the webhook's
provisioning step short-circuits on an existing `stripe_customer_id`, so
the account would need its Stripe columns backfilled from the resulting
subscription rather than being provisioned fresh.

### Current comp accounts

| Account | Owner | Why |
|---|---|---|
| AMG Aviation Group LLC | `tony@amgaviationgroup.com` | Operator's own access to the product |

## Known gaps

- **`docs/PRICING.md`'s tier numbers are a proposal, not all signed.**
  Solo's existing Price is unchanged and live; the Pro and Business
  amounts are the owner's to confirm. Nothing in the product invents a
  number in the meantime — an unconfigured Price renders that tier
  "Unavailable" rather than guessing.
- **Business seat management has no UI.** The subscription bills at the
  two-seat minimum (or more, set directly in Stripe); there is no
  in-product way to add a third seat or invite a second pilot/bookkeeper
  yet (`multi_seat` in `lib/entitlements.ts`, `comingSoon: true`).
  `pilot.account_members` already carries owner/member/bookkeeper roles.
- **The 7-day trial may end before a contract pilot has flown a billable
  trip.** Config, not code; worth revisiting after the first cohort.
- **Email confirmation is ON** in the Supabase project, so signup shows a
  "check your email" state rather than signing the pilot straight in.
  That is friction on a card-required trial — a deliberate decision to
  revisit, not an oversight.
- **Priority support (Business) has no channel to be priority about** —
  there is no support address or contact route anywhere in the product,
  so that row stays `comingSoon` on the pricing matrix rather than a bare
  checkmark. Clear it only once a channel exists and is routed.

Resolved since the last version of this document: legal name is now
editable at `/settings` (it used to print on invoices exactly as typed at
Stripe checkout, uncorrectable); Stripe Connect (integration #2, the
pilot billing *their own* client) is built — `lib/stripe/connect.ts`,
`lib/stripe/connect-payments.ts`, asserted by
`npm run connect:verify` — and stays deliberately separate from the
platform billing this document describes, per `docs/PLAN.md`.
