-- ===========================================================================
-- Auto-recording a payment made through an invoice's Stripe payment link.
--
-- THIS MIGRATION REVERSES A DECISION 20260809040000_connect_payments.sql
-- MADE ON PURPOSE. Read that file's header block first — it is still the
-- best statement of the cost, and it has been annotated rather than
-- rewritten so both halves of the argument stay readable.
--
-- The short version of what changed. That header refused to auto-record a
-- client's payment because doing so needs a write into TENANT FINANCIAL
-- DATA from a request that carries no user session, and
-- lib/supabase/service-role.ts's own header says it exists for "exactly
-- ONE entry point". The cost of the refusal was paid by the pilot, every
-- time: the client pays, Stripe emails the pilot, and the invoice in this
-- product goes on saying "Sent" — overdue, chased, and wrong — until the
-- pilot notices and re-types a number they already have. That is the one
-- manual step in an otherwise finished loop, and it is the step most
-- likely to be forgotten precisely because the money already arrived.
--
-- So there are now TWO service-role entry points, and the honest framing
-- is that the count went from one to two, not that the rule was
-- unchanged. Both are Stripe webhooks; neither is reachable without a
-- valid Stripe signature; and the second one's authority is narrowed by
-- everything below rather than by a promise:
--
--   app/api/stripe/webhook/route.ts          platform billing — provisions
--                                            a tenant (Phase 2).
--   app/api/stripe/connect-webhook/route.ts  connected-account payments —
--                                            inserts ONE pilot.invoice_
--                                            payments row per Stripe
--                                            PaymentIntent, for an invoice
--                                            it has proven belongs to the
--                                            connected account Stripe
--                                            itself named in event.account.
--
-- WHAT MAKES THE SECOND ONE SAFE, mechanically, and where each part lives:
--
--   Tenancy is derived from event.account, NEVER from metadata. Stripe
--   signs the delivery and names the connected account; a Payment Link's
--   metadata is typed by whoever owns that Stripe account and is therefore
--   attacker-controlled input. pilot.accounts.connect_account_id is UNIQUE
--   (20260802190437), so acct_... -> account_id is a single authenticated
--   lookup. The handler then REQUIRES metadata.account_id to equal that
--   account and the named invoice's own account_id to equal it too;
--   any disagreement is refused and recorded, never guessed at.
--
--   Money-level idempotency is the unique index on
--   stripe_payment_intent_id below. Delivery-level idempotency (the
--   events ledger) is not enough on its own: a row there with a NULL
--   processed_at is deliberately RETRYABLE, so a crash between "insert
--   the payment" and "mark processed" would otherwise credit the client
--   twice on Stripe's next attempt. The index turns that second attempt
--   into a 23505 the handler reads as "already done".
--
--   Nothing here relaxes a trigger or a grant. It cannot: both
--   pilot.invoice_payments_validate (20260810120000:101-103) and
--   pilot.invoices_protect_issued (20260810170000:84-86) already
--   early-return for service_role, which is exactly why the handler has
--   to re-implement, in application code, every rule the manual path
--   gets for free — the invoice must be 'sent' or 'partial', the status
--   advance must be computed from pilot.invoice_totals rather than
--   assumed, and a settled invoice must retire its payment link. The
--   database is NOT the backstop on that path. Say so out loud rather
--   than letting a reader assume the triggers are watching.
--
-- WHAT IS ADDED, all of it additive:
--   1. two columns on pilot.invoice_payments (source, and the dedupe key)
--   2. pilot.stripe_connect_events — a SEPARATE events ledger
--   3. RLS + column-scoped grants for both, in this same file
--
-- Not touched: no existing column, policy, grant, view or trigger is
-- altered or dropped. The two `drop constraint if exists` lines below name
-- constraints THIS file creates, for re-runnability, and follow
-- 20260810120000's precedent exactly.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. pilot.invoice_payments — where the payment came from, and the key
--    that stops it being recorded twice.
--
--    WHY A COLUMN AND NOT `notes`. `notes` is pilot-authored prose. It is
--    rendered on the invoice screen and it is theirs to write; a machine
--    stamping "paid via Stripe link" into it would be putting words in
--    someone's mouth on a document their client can be shown. A pilot must
--    also be able to tell, at a glance, which rows they typed and which
--    arrived on their own — that is the whole double-record defence on the
--    human side of this feature — and "read the notes field carefully" is
--    not a glance.
-- ---------------------------------------------------------------------------
alter table pilot.invoice_payments
  -- 'manual' is the default and the backfill in one: every row that exists
  -- today was typed by a pilot, which is precisely what 'manual' claims.
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'stripe_link')),
  -- The Stripe PaymentIntent (pi_...) this row records. THE dedupe key —
  -- see the unique index below for why it is this and not the Checkout
  -- Session id, and not the event id.
  add column if not exists stripe_payment_intent_id text;

comment on column pilot.invoice_payments.source is
  'Who put this row here. ''manual'' — a pilot typed it (every row predating 20260813100000, hence the default). ''stripe_link'' — app/api/stripe/connect-webhook/route.ts recorded it from a client''s payment against this invoice''s Stripe Payment Link. Withheld from the authenticated INSERT grant, so a tenant cannot claim either provenance: the default is the only value they can produce.';

comment on column pilot.invoice_payments.stripe_payment_intent_id is
  'The Stripe PaymentIntent behind a ''stripe_link'' row, and the key that makes auto-recording safe to retry. Withheld from the authenticated INSERT grant. Null on every manual row (including a correction of an auto-recorded one — the correction is the pilot''s own act, not Stripe''s).';

-- The two columns move together or not at all. Without this, a bug could
-- mint a 'stripe_link' row with no dedupe key (silently re-creditable on
-- the next retry) or a 'manual' row carrying one (silently blocking the
-- real auto-record that follows).
alter table pilot.invoice_payments
  drop constraint if exists invoice_payments_source_intent_consistent;
alter table pilot.invoice_payments
  add constraint invoice_payments_source_intent_consistent check (
    (source = 'stripe_link') = (stripe_payment_intent_id is not null)
  );

-- THE GUARD THAT ACTUALLY PREVENTS DOUBLE MONEY.
--
-- Deliberately NOT scoped to (account_id, ...), which is this schema's
-- usual composite-tenancy idiom. A Stripe PaymentIntent id identifies one
-- payment in the world; it must map to at most one ledger row ANYWHERE,
-- and a per-tenant unique index would let the same intent be recorded once
-- per tenant if the tenancy resolution above were ever wrong — which is
-- the exact failure this index should catch rather than accommodate.
--
-- The usual objection to a globally-unique tenant-facing column is that
-- one tenant can squat a value and block another (a denial of service, and
-- an existence oracle). That objection does not apply here: the column is
-- absent from every grant `authenticated` holds, so no tenant can write
-- any value into it, guessed or otherwise. Only the webhook's service-role
-- client can, and it writes ids Stripe minted.
create unique index if not exists invoice_payments_one_row_per_payment_intent
  on pilot.invoice_payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- ---------------------------------------------------------------------------
-- 2. pilot.stripe_connect_events — the Connect delivery ledger.
--
--    WHY NOT REUSE pilot.stripe_events (20260805160000). Its shape does not
--    fit, and forcing it would mean altering a table the platform-billing
--    webhook depends on:
--
--      - Its primary key is the bare event id. Connect event ids are minted
--        inside each connected account's own namespace, so the safe
--        delivery key is (connected account, event id) — a composite. Making
--        pilot.stripe_events use one means dropping and re-creating its
--        primary key, which is not an additive change to a live table.
--      - It has no account_id ON PURPOSE (its own header says so): a
--        provisioning event arrives BEFORE the tenant it creates exists.
--        A Connect payment event is the opposite — it is meaningless until
--        it has been tied to an existing tenant and one of their invoices,
--        and it is worth showing that tenant.
--      - It is readable by no one but service_role. This table must be
--        readable by the tenant it concerns, because a delivery this
--        handler DECLINED to act on is exactly the thing a pilot needs to
--        see (see `outcome` below).
--
--    So: a sibling. pilot.stripe_events keeps its comment, its shape and
--    its meaning; nothing about platform billing is touched.
-- ---------------------------------------------------------------------------
create table if not exists pilot.stripe_connect_events (
  -- Stripe's event id (evt_...), as delivered.
  id text not null,
  -- event.account — the connected account the event originated from, and
  -- the ONLY authenticated statement of whose payment this is. Text, not a
  -- FK to pilot.accounts: an event can legitimately arrive from an account
  -- this platform no longer has a row for (a pilot who disconnected, or a
  -- forgery attempt naming an account we never linked), and losing the
  -- record of that delivery is worse than storing an unresolvable string.
  connected_account_id text not null,
  type text not null,
  stripe_created_at timestamptz not null,
  -- The Checkout Session (cs_...) this event carried, for tracing a row
  -- back to Stripe's dashboard without keeping the payload.
  object_id text,
  -- The PaymentIntent, denormalised here so support can answer "did this
  -- payment ever reach us?" from one table, and so the money-level dedupe
  -- key is visible next to the decision it drove.
  payment_intent_id text,
  livemode boolean not null,
  -- Resolved from connected_account_id, never from metadata. Null when the
  -- account could not be resolved at all — which also makes the row
  -- invisible to every tenant, since the policies below match on this
  -- column and `null in (...)` is never true. That is the right posture:
  -- an unattributable event is the platform's problem, not a pilot's.
  account_id uuid references pilot.accounts(id) on delete cascade,
  -- The invoice this event was ABOUT, once proven to belong to account_id.
  -- Deliberately NOT a foreign key: pilot.invoice_payments' FK to
  -- pilot.invoices is ON DELETE RESTRICT and this ledger must never become
  -- a reason an invoice cannot be deleted, nor lose its audit row when one
  -- is. A dangling uuid here is a historical fact, not an inconsistency.
  invoice_id uuid,
  -- What the handler DID. Null until it has decided.
  outcome text check (outcome is null or outcome in (
    -- A pilot.invoice_payments row was inserted for this event.
    'recorded',
    -- This PaymentIntent was already on the ledger (a Stripe retry, or a
    -- crash between the insert and processed_at). Nothing to do.
    'duplicate',
    -- The money looks like it was ALREADY recorded by hand — the balance
    -- had already moved by this amount and a matching manual row sits
    -- within the race window. NOT inserted, and surfaced to the pilot for
    -- review, because a missing row they can see beats a double credit
    -- they cannot.
    'needs_review',
    -- The event did not survive the tenancy checks, or named an invoice in
    -- a state that cannot take a payment (void, draft), or carried money
    -- this ledger cannot express (a session settled in another currency, a
    -- session with no PaymentIntent to dedupe on). Not inserted — and
    -- SHOWN TO THE PILOT whenever it resolved to one of their invoices,
    -- exactly like 'needs_review'. The two outcomes differ in why nothing
    -- was written; they do not differ in what the pilot must do about it,
    -- and a row saying "the client paid $4,500 through a link that should
    -- have been deactivated — refund them" is worthless in a log the pilot
    -- has never opened.
    'refused',
    -- Nothing to act on: an event type this endpoint does not handle, a
    -- session that has not actually been paid yet, or a link minted before
    -- this feature existed and therefore carrying no invoice metadata.
    'ignored'
  )),
  -- One sentence, written for a human, explaining the outcome. Shown to
  -- the pilot for 'needs_review' and 'refused' (when the row resolved to
  -- one of their invoices); read from the logs for the rest. Where the
  -- precise explanation would tell one tenant something about another's
  -- data — "that invoice exists but is not yours" — this column carries
  -- the collapsed sentence and the precise one goes to the platform's
  -- console only (resolveAutoPayment's logDetail).
  detail text,
  -- Set when the pilot has looked at a surfaced row and decided.
  -- The ONLY column `authenticated` may write on this table.
  reviewed_at timestamptz,
  -- Same contract as pilot.stripe_events.processed_at: non-null means the
  -- handler finished, so a redelivery is skipped. NULL means it did not,
  -- and Stripe's retry is allowed to run again — which is safe only
  -- because of the unique index in section 1.
  processed_at timestamptz,
  received_at timestamptz not null default now(),
  primary key (connected_account_id, id)
);

comment on table pilot.stripe_connect_events is
  'Delivery ledger for app/api/stripe/connect-webhook/route.ts. PK is (connected account, event id) — Connect event ids are minted per connected account, so the bare id is not safely unique across them. Readable (never writable, except reviewed_at) by the tenant it was resolved to; rows that could not be attributed have a null account_id and are visible to nobody. This is the DELIVERY dedupe; the MONEY dedupe is invoice_payments_one_row_per_payment_intent, and a retryable NULL processed_at here is only safe because that index exists.';

comment on column pilot.stripe_connect_events.connected_account_id is
  'Stripe''s event.account. The one authenticated fact about whose payment this is — a Payment Link''s metadata is typed by whoever owns the connected account and is treated as untrusted input everywhere in the handler.';
comment on column pilot.stripe_connect_events.outcome is
  'What the handler did: recorded | duplicate | needs_review | refused | ignored. ''needs_review'' and ''refused'' are the two a pilot sees, on the invoice screen, whenever the row resolved to one of their invoices — both mean money arrived and this product did not record it, so a human has to look. The rest are for the platform.';
comment on column pilot.stripe_connect_events.reviewed_at is
  'Set by the pilot from the invoice screen once they have checked a surfaced (''needs_review'' or ''refused'') event. The only column authenticated may update here, and it changes nothing about the money — it dismisses a prompt.';

create index if not exists stripe_connect_events_invoice_idx
  on pilot.stripe_connect_events (account_id, invoice_id)
  where invoice_id is not null;

-- The invoice screen's query: outstanding prompts for one invoice. Both
-- surfaced outcomes, matching that query exactly — see `outcome` above.
create index if not exists stripe_connect_events_needs_review_idx
  on pilot.stripe_connect_events (account_id, invoice_id)
  where outcome in ('needs_review', 'refused') and reviewed_at is null;

-- ---------------------------------------------------------------------------
-- 3. RLS — enabled here, in this table's own first migration.
--
--    SELECT and a one-column UPDATE only. There is no INSERT policy and no
--    DELETE policy, deliberately: every row is written by the webhook's
--    service-role client, and a tenant who could insert one could fabricate
--    a "Stripe says this was paid" prompt on their own invoice screen.
-- ---------------------------------------------------------------------------
alter table pilot.stripe_connect_events enable row level security;

create policy stripe_connect_events_select on pilot.stripe_connect_events
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy stripe_connect_events_update on pilot.stripe_connect_events
  for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- 4. Grants. ADDED, never re-granted after a revoke (migrations/README.md's
--    revoke trap). Note what is NOT here, because it is the whole point:
--
--    pilot.invoice_payments' existing INSERT grant to `authenticated`
--    (20260805090000:1337 plus 20260810120000:326) lists its columns
--    explicitly and is NOT touched by this file. `source` and
--    `stripe_payment_intent_id` are therefore absent from it, which is what
--    makes the CHECK in section 1 unforgeable: a tenant cannot name either
--    column in an INSERT (42501), so every row they write takes the
--    'manual' default with a null intent id. No trigger is needed to say
--    the same thing, and none is added.
--
--    service_role already holds full DML on pilot.invoice_payments from
--    20260805090000:1364 — column-level grants do not narrow a table-level
--    one, so the webhook can write the new columns without any grant here.
-- ---------------------------------------------------------------------------
grant select on pilot.stripe_connect_events to authenticated;
-- Exactly one column. Not `outcome`, not `detail`, not `account_id`: a
-- pilot dismisses a prompt, they do not restate what Stripe sent.
grant update (reviewed_at) on pilot.stripe_connect_events to authenticated;

grant select, insert, update, delete on pilot.stripe_connect_events to service_role;
