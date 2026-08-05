-- Phase 2 — platform billing: webhook event ledger.
--
-- docs/PLAN.md's non-negotiables for both Stripe integrations include
-- "signature verification, event-ID recording for idempotency, retry and
-- out-of-order safety". This table is the event-ID record.
--
-- WHY A TABLE AND NOT AN IN-MEMORY GUARD: the webhook runs on serverless
-- functions with no shared memory between invocations, and Stripe retries
-- a failed delivery for up to 3 days. The only durable place to answer
-- "have I already applied this event?" is the database the event mutates,
-- inside the same transaction boundary as that mutation.
--
-- TENANCY: this table is deliberately OUTSIDE the tenant model. It has no
-- account_id, because an event arrives BEFORE the account it provisions
-- exists (checkout.session.completed is the tenant-creation path — see
-- decision #7), so there is nothing to scope it to at write time. It is
-- written only by the webhook's service-role client and is never readable
-- by `authenticated` at all: RLS is enabled with NO policy for that role,
-- and no grant is issued to it, so a tenant cannot enumerate billing
-- events (theirs or anyone's). That is the correct posture — the pilot's
-- own billing state lives on pilot.accounts, which they can read.
create table if not exists pilot.stripe_events (
  -- Stripe's own event id (evt_...) is the primary key: inserting a row
  -- that already exists is the idempotency check itself, enforced by the
  -- database rather than by a read-then-write race.
  id text primary key,
  type text not null,
  -- Stripe's event creation time, NOT ours. This is what makes
  -- out-of-order delivery safe: a subscription handler compares this to
  -- the last applied event for the same subscription and refuses to apply
  -- an older state on top of a newer one. Retries and parallel deliveries
  -- do not arrive in causal order and must not be assumed to.
  stripe_created_at timestamptz not null,
  -- Which Stripe object this event concerned, so a handler can find the
  -- most recent event already applied to the same object without parsing
  -- payloads back out.
  object_id text,
  -- Set when the handler finished successfully. A row that exists with a
  -- NULL processed_at means "seen, but the handler did not complete" —
  -- Stripe will retry, and that retry SHOULD be allowed to run. Only a
  -- non-null processed_at means "done, skip this one".
  processed_at timestamptz,
  -- Guards against a test-mode event ever being applied to production
  -- data or vice versa (PLAN: "test/live mode separation"). The handler
  -- records what Stripe said and refuses a mismatch against its own key
  -- mode.
  livemode boolean not null,
  received_at timestamptz not null default now()
);

comment on table pilot.stripe_events is
  'Webhook idempotency + ordering ledger. PK is Stripe''s event id, so a replayed delivery collides on insert instead of double-applying. service_role only — never readable by authenticated.';

create index if not exists stripe_events_object_idx
  on pilot.stripe_events (object_id, stripe_created_at desc)
  where object_id is not null;

alter table pilot.stripe_events enable row level security;
-- No policy for `authenticated` by design (see the table comment): with
-- RLS on and no permissive policy, every tenant read returns zero rows
-- even if a grant were added by mistake later. service_role holds
-- BYPASSRLS, which is how the webhook reaches it.

grant select, insert, update on pilot.stripe_events to service_role;

-- ---------------------------------------------------------------------------
-- Billing state on pilot.accounts.
--
-- Every column the billing flow needs already exists from Phase 1
-- (stripe_customer_id, stripe_subscription_id, trial_ends_at, status,
-- plan, seat_count) — this migration only adds the constraints that keep
-- the Stripe linkage honest, which Phase 1 could not add because no
-- billing code existed yet to define them.
-- ---------------------------------------------------------------------------

-- One Stripe customer and one subscription map to at most one account.
-- Without these, a webhook bug (or a replayed event that slipped past the
-- ledger above) could provision a SECOND account for a customer who
-- already has one, and the pilot would silently end up with two tenants
-- and their data split across both. Partial indexes so the many NULLs on
-- unprovisioned rows don't collide.
create unique index if not exists accounts_stripe_customer_key
  on pilot.accounts (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists accounts_stripe_subscription_key
  on pilot.accounts (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- `plan` was free text. Decision #10 is "solo flat rate; business
-- per-seat" and only the solo plan is being sold at launch, so constrain
-- it to the vocabulary the billing code actually branches on rather than
-- letting a typo become a plan nobody handles.
alter table pilot.accounts
  drop constraint if exists accounts_plan_check;
alter table pilot.accounts
  add constraint accounts_plan_check
  check (plan is null or plan in ('solo', 'business'));

-- A business account bills per seat, so seat_count drives the Stripe
-- subscription quantity; a solo account is exactly one pilot by
-- definition (docs/PLAN.md: "Solo accounts have exactly one
-- account_members row"). Enforcing that here means the seat-sync code
-- can never push a quantity that contradicts the plan.
alter table pilot.accounts
  drop constraint if exists accounts_solo_single_seat_check;
alter table pilot.accounts
  add constraint accounts_solo_single_seat_check
  check (plan is distinct from 'solo' or seat_count = 1);
