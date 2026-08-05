# Billing (Phase 2)

How a person becomes a tenant, what's configured where, and the one
deliberate exception to the self-serve rule.

## The shape of it

**$29/month, solo plan, card-required 7-day trial** (docs/PLAN.md
decisions #6, #7, #10). The per-seat business plan is deferred — there is
no `STRIPE_PRICE_ID_BUSINESS_SEAT` yet, on purpose, so an unset variable
can't be mistaken for a configured one when seat-sync lands.

The signup path:

```
/signup            create a Supabase identity (email confirmation is ON)
   ↓
/login             sign in
   ↓
/welcome           no tenant yet → "Start your 7-day trial"
   ↓
Stripe Checkout    subscription mode, card required, trial_period_days=7
   ↓
webhook            checkout.session.completed → provisions the tenant
   ↓
/                  the app
```

**Only the webhook creates a tenant.** Returning to the success URL does
not, and cannot: `/welcome?checkout=complete` renders a "setting up your
workspace" state and nothing else. A forged return URL mints nothing.
That is decision #7, and `billing:verify` asserts it.

## Configuration

Four variables, all in the Vercel project and `.env.local` for
development. See `.env.example` for the full annotated list.

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | Test key until launch |
| `STRIPE_WEBHOOK_SECRET` | From the webhook endpoint's signing secret |
| `STRIPE_PRICE_ID_SOLO` | The $29/month recurring price |
| `NEXT_SUPABASE_SECRET_KEY` | Service role. The webhook writes for a user with no session in flight, so it cannot use a session-scoped client |

**Keep all three Stripe values in the same mode.** The webhook rejects any
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
- **Test/live separation**, above.

Handler failures return **500 on purpose** so Stripe retries. Returning
200 would silently drop a paid customer's provisioning.

## Comp / internal accounts — the deliberate exception

An account with **`stripe_customer_id IS NULL`** is an internal or comped
tenant. It was created directly rather than through checkout, is not a
Stripe customer, and contributes nothing to MRR.

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
insert into pilot.accounts (kind, plan, seat_count, legal_name, status,
                            stripe_customer_id, stripe_subscription_id, trial_ends_at)
values ('solo', 'solo', 1, '<their business name>', 'active', null, null, null);

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

- **No settings screen.** `legal_name` is taken from what the pilot gave
  Stripe (falling back to their email's local-part) and it prints on their
  invoices, so they cannot currently correct it. Worth closing before real
  customers.
- **Email confirmation is ON** in the Supabase project, so signup shows a
  "check your email" state rather than signing the pilot straight in.
  That is friction on a card-required trial — a deliberate decision to
  revisit, not an oversight.
- **The 7-day trial may end before a contract pilot has flown a billable
  trip.** Config, not code; worth revisiting after the first cohort.
- **Stripe Connect** (integration #2, the pilot billing *their* client) is
  not built. It is deliberately kept separate from platform billing — see
  docs/PLAN.md.
