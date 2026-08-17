-- ===========================================================================
-- AUTOPAY — a client's saved payment method, charged when a recurring
-- invoice is generated, instead of waiting on a payment-link click.
--
-- THE SHAPE, in one paragraph. The client consents ONCE, on the vendor page
-- (app/vendor/[token]) — the one per-client anonymous surface with a
-- durable, revocable token — through a Stripe Checkout session in `setup`
-- mode ON THE PILOT'S OWN CONNECTED ACCOUNT. The resulting Customer +
-- PaymentMethod ids land on pilot.clients via the Connect webhook (the only
-- writer). A recurring schedule then carries an `autopay` flag; when the
-- pilot generates a due invoice from a flagged schedule, the app issues the
-- invoice and charges the saved method off-session as a DIRECT charge on
-- the connected account — no application fee, no platform custody, same
-- posture as every payment link (lib/stripe/connect.ts's header).
--
-- WHY COLUMNS ON pilot.clients AND NOT A NEW TABLE: the reminder/late-fee
-- migration (20260813130000) states the house test — a value a database
-- function or scheduled job computes on is a COLUMN. Autopay state is also
-- strictly one-per-client (one saved method; replacing it rotates in
-- place, like every share token here), so a table would model a
-- cardinality that does not exist.
--
-- WHY EVERY AUTOPAY COLUMN IS WITHHELD FROM THE AUTHENTICATED GRANTS,
-- unlike the reminder columns beside them: these are not preferences, they
-- are CONSENT RECORDS plus charge credentials. A pilot who could write
-- autopay_stripe_payment_method_id could assert a mandate their client
-- never gave (the id itself would fail at Stripe, but the CONSENT ROW is
-- the fact a dispute turns on and it must not be forgeable by the person
-- who benefits from it). Only the webhook — which just verified a signed
-- Checkout completion from the client's own browser session — writes them,
-- and only service-role paths (the pilot's disable action, the client's
-- own stop control, the disconnect handler) clear them. SELECT rides the
-- table-wide grant, so both the pilot's screens and the vendor page's
-- SECURITY DEFINER reader can show the state.
-- ===========================================================================

alter table pilot.clients
  -- cus_… on the PILOT'S connected account. Meaningless the moment
  -- connect_account_id changes: the disconnect paths clear all five.
  add column if not exists autopay_stripe_customer_id text,
  -- pm_… attached to that customer, usage off_session.
  add column if not exists autopay_stripe_payment_method_id text,
  -- "Visa •••• 4242" — what screens print. Derived from the PaymentMethod
  -- at save time so no render path ever needs a Stripe round trip.
  add column if not exists autopay_method_label text,
  -- When the client completed the setup session. The consent timestamp a
  -- dispute asks for.
  add column if not exists autopay_consented_at timestamptz,
  -- Which Stripe mode minted the ids. A test-mode pm is meaningless to a
  -- live key; the charge path refuses on mismatch rather than erroring at
  -- Stripe (same discipline as invoices.stripe_payment_link_livemode).
  add column if not exists autopay_livemode boolean;

comment on column pilot.clients.autopay_stripe_customer_id is
  'Stripe Customer (cus_…) on the pilot''s CONNECTED account, created when this client set up autopay from the vendor page. All five autopay_* columns move together (clients_autopay_consistent) and are written only by app/api/stripe/connect-webhook (save) and service-role clears (pilot disable, client stop, disconnect). Withheld from every authenticated write grant: this is a consent record, not a preference.';
comment on column pilot.clients.autopay_stripe_payment_method_id is
  'The saved PaymentMethod (pm_…) autopay charges, usage off_session, attached to autopay_stripe_customer_id on the connected account.';
comment on column pilot.clients.autopay_method_label is
  'Human-readable name of the saved method ("Visa •••• 4242"), captured at save time so screens never need Stripe to print it.';
comment on column pilot.clients.autopay_consented_at is
  'When the client completed the Checkout setup session — the consent timestamp. Null means autopay is off for this client.';
comment on column pilot.clients.autopay_livemode is
  'Which Stripe mode the saved ids belong to. The charge path refuses a mode mismatch outright.';

-- All five move together or not at all — a half-saved mandate is a bug in
-- whichever writer produced it, and this makes it unstorable rather than a
-- convention.
alter table pilot.clients
  drop constraint if exists clients_autopay_consistent;
alter table pilot.clients
  add constraint clients_autopay_consistent check (
    (autopay_stripe_customer_id is null)
      = (autopay_stripe_payment_method_id is null)
    and (autopay_stripe_customer_id is null) = (autopay_method_label is null)
    and (autopay_stripe_customer_id is null) = (autopay_consented_at is null)
    and (autopay_stripe_customer_id is null) = (autopay_livemode is null)
  );

-- NO GRANTS for the five columns. Deliberate — see the header. service_role
-- already holds table-wide privileges on pilot.clients.

-- ---------------------------------------------------------------------------
-- The per-schedule switch. A flag, not a per-client one: the same client
-- can hold a monthly retainer the pilot wants charged automatically AND
-- one-off invoices that should keep arriving as links. The flag is inert
-- unless the client has actually enrolled (the app checks the client
-- columns at charge time), so a pilot switching it on early does nothing
-- until the client consents.
-- ---------------------------------------------------------------------------
alter table pilot.recurring_invoice_schedules
  add column if not exists autopay boolean not null default false;

comment on column pilot.recurring_invoice_schedules.autopay is
  'When true AND the schedule''s client has autopay enrolled (pilot.clients.autopay_* set, livemode matching), generating this schedule''s due invoice also issues it and charges the saved method off-session. False (the default, and every pre-existing row): generated invoices stay drafts exactly as before 20260817160000.';

-- ADD COLUMN does not extend a column-scoped grant — the README's standing
-- lesson. Additive, no revoke.
grant insert (autopay) on pilot.recurring_invoice_schedules to authenticated;
grant update (autopay) on pilot.recurring_invoice_schedules to authenticated;

-- ---------------------------------------------------------------------------
-- 'stripe_autopay' joins the invoice_payments provenance vocabulary.
--
-- A CHECK cannot be widened in place, and 20260813100000 declared the
-- source check INLINE on the column, so its name is Postgres's to choose —
-- found by what it SAYS, the same discovery move 20260813120000 documents
-- for the outcome check, guarded so a re-apply is a no-op.
-- ---------------------------------------------------------------------------
do $$
declare
  target text;
begin
  for target in
    select conname
    from pg_constraint
    where conrelid = 'pilot.invoice_payments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%stripe_link%'
      and pg_get_constraintdef(oid) not ilike '%stripe_autopay%'
      -- The source vocabulary check mentions 'manual'; the
      -- source/intent-pairing check does not. Only the first is replaced
      -- here — the pairing check is rebuilt by name below.
      and pg_get_constraintdef(oid) ilike '%manual%'
  loop
    execute format('alter table pilot.invoice_payments drop constraint %I', target);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_payments_source_vocab'
      and conrelid = 'pilot.invoice_payments'::regclass
  ) then
    alter table pilot.invoice_payments
      add constraint invoice_payments_source_vocab
      check (source in ('manual', 'stripe_link', 'stripe_autopay'));
  end if;
end $$;

comment on column pilot.invoice_payments.source is
  'Who put this row here. ''manual'' — a pilot typed it. ''stripe_link'' — the Connect webhook recorded a client''s payment against this invoice''s Payment Link. ''stripe_autopay'' (20260817160000) — the Connect webhook recorded an off-session autopay charge of the client''s saved method. Withheld from the authenticated INSERT grant either way: the default is the only value a tenant can produce.';

-- The pairing rule extends to the new source: every Stripe-recorded row —
-- link or autopay — carries the PaymentIntent dedupe key; manual rows
-- never do. Same name, rebuilt.
alter table pilot.invoice_payments
  drop constraint if exists invoice_payments_source_intent_consistent;
alter table pilot.invoice_payments
  add constraint invoice_payments_source_intent_consistent check (
    (source in ('stripe_link', 'stripe_autopay'))
      = (stripe_payment_intent_id is not null)
  );

-- ---------------------------------------------------------------------------
-- pilot.autopay_public_state — what the vendor page may say about autopay,
-- through the vendor-link token. Mirrors pilot.client_vendor_page_public's
-- posture exactly (20260814112000): SECURITY DEFINER, token is the whole
-- access boundary, null for an unknown/revoked/expired token,
-- indistinguishably. A separate small function rather than widening the
-- big rollup one: the rollup's field list is a documented security
-- surface, and this state is asked for by a different section of the page
-- with a different reason to exist.
--
-- FIELD LIST, deliberately tiny: whether the pilot can take autopay at all
-- (a connected Stripe account exists — a boolean, never the acct_… id),
-- whether THIS client is enrolled, and the saved method's display label.
-- Nothing else: no Stripe ids, no consent timestamp, nothing the client
-- does not already know about their own card.
-- ---------------------------------------------------------------------------
create or replace function pilot.autopay_public_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_account_id uuid;
  v_client_id uuid;
  result jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;

  select s.account_id, s.client_id into v_account_id, v_client_id
  from pilot.client_vendor_links s
  where s.token = p_token
    and s.revoked_at is null
    and s.expires_at > now();

  if v_account_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'available', a.connect_account_id is not null,
    'enrolled', c.autopay_consented_at is not null,
    'method_label', c.autopay_method_label
  )
  into result
  from pilot.accounts a
  join pilot.clients c on c.account_id = a.id and c.id = v_client_id
  where a.id = v_account_id;

  return result;
end;
$$;

revoke all on function pilot.autopay_public_state(text) from public;
grant execute on function pilot.autopay_public_state(text) to anon, authenticated;

comment on function pilot.autopay_public_state(text) is
  'What the vendor page shows about autopay for the client a live vendor-link token names: whether the pilot''s account can take autopay at all (has a connected Stripe account — a boolean, never the id), whether this client is enrolled, and the saved method''s display label. Null for an unknown, revoked or expired token, indistinguishably. SECURITY DEFINER, granted to anon; the token is the entire access boundary, same as pilot.client_vendor_page_public.';

-- ---------------------------------------------------------------------------
-- pilot.connect_account_unlink learns about autopay. Restated in full
-- (create or replace replaces the whole body) from 20260810061401's
-- definition, with ONE addition at the bottom: disconnecting Stripe also
-- clears every client's autopay enrollment, because the saved Customer and
-- PaymentMethod ids live ON the disconnected account and are unreachable
-- the moment the grant is gone — the same clearing the webhook's
-- deauthorized handler performs for the pilot-initiated-from-Stripe path.
-- Grants are preserved by create or replace; none are restated.
-- ---------------------------------------------------------------------------
create or replace function pilot.connect_account_unlink(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pilot.account_members
    where account_id = p_account_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'only an account owner may disconnect Stripe';
  end if;

  perform set_config('pilot.allow_connect_write', 'on', true);
  update pilot.accounts set connect_account_id = null where id = p_account_id;

  update pilot.invoices
    set stripe_payment_link_id = null,
        stripe_payment_link_url = null,
        stripe_payment_link_livemode = null,
        stripe_payment_link_amount_cents = null
    where account_id = p_account_id
      and stripe_payment_link_id is not null;

  -- Any half-finished onboarding for this account is meaningless once the
  -- account is deliberately disconnected — and leaving one live would let
  -- a stale tab re-link it minutes later without the pilot doing anything.
  delete from pilot.connect_oauth_states where account_id = p_account_id;

  -- 20260817160000: autopay enrollments die with the grant — see this
  -- migration's header. The columns are withheld from authenticated
  -- grants, so this DEFINER body is the pilot-initiated path's only way
  -- to clear them.
  update pilot.clients
    set autopay_stripe_customer_id = null,
        autopay_stripe_payment_method_id = null,
        autopay_method_label = null,
        autopay_consented_at = null,
        autopay_livemode = null
    where account_id = p_account_id
      and autopay_stripe_customer_id is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- pilot.client_autopay_disable — the PILOT turning a client's autopay off.
-- The autopay columns are withheld from every authenticated grant (see the
-- header), so the pilot-side disable needs a DEFINER body the same way
-- connect_account_unlink does; owner-gated for the same reason every other
-- Stripe-touching control is. The client's own stop control lives on the
-- vendor page (app/api/autopay/stop) and does not come through here.
-- ---------------------------------------------------------------------------
create or replace function pilot.client_autopay_disable(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id
  from pilot.clients
  where id = p_client_id
    and account_id in (select pilot.current_account_ids());

  if v_account_id is null then
    raise exception 'client % not found', p_client_id;
  end if;

  if not exists (
    select 1 from pilot.account_members
    where account_id = v_account_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'only an account owner may turn autopay off';
  end if;

  update pilot.clients
    set autopay_stripe_customer_id = null,
        autopay_stripe_payment_method_id = null,
        autopay_method_label = null,
        autopay_consented_at = null,
        autopay_livemode = null
    where id = p_client_id
      and account_id = v_account_id;
end;
$$;

revoke all on function pilot.client_autopay_disable(uuid) from public;
grant execute on function pilot.client_autopay_disable(uuid) to authenticated;

comment on function pilot.client_autopay_disable(uuid) is
  'Owner-gated clear of one client''s autopay enrollment (all five autopay_* columns). The DEFINER body is the pilot-side path''s only way to write columns deliberately withheld from every authenticated grant. The client''s own stop control is app/api/autopay/stop, service-role, vendor-token gated.';
