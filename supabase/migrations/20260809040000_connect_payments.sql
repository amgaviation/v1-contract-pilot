-- Stripe Connect (Standard) onboarding + pay-online for invoices.
--
-- docs/PLAN.md decision #8, verbatim: "Stripe Connect (Standard). Pilot is
-- merchant of record. We never see their keys, never touch their funds,
-- take no application fee." Every choice below is in service of that
-- sentence, not around it.
--
-- ***************************************************************************
-- THE DECISION THIS MIGRATION MAKES, AND WHY (read before editing)
-- ***************************************************************************
-- The obvious design — a Connect webhook auto-records
-- pilot.invoice_payments when a client pays — needs a write path into
-- tenant financial data from a request with no user session, which is
-- exactly what lib/supabase/service-role.ts exists for and exactly what
-- its own header says has exactly ONE entry point: the platform billing
-- webhook. Routing Connect events through that same route file would keep
-- the literal URL/file singular but would still add a second, unrelated
-- category of privileged write (tenant business data, not tenant
-- provisioning) behind it — the thing "exactly one entry point" is
-- actually guarding against, not just its file path.
--
-- So this build is PAYMENT-LINK ONLY (option b): the app helps the pilot
-- generate a Stripe-hosted Payment Link on their OWN connected account
-- (a direct charge, no application fee, funds settle straight to them,
-- platform never in the funds path) and hands it to their client. When
-- the client pays, the pilot sees it in their own Stripe Dashboard and
-- records it the same way they already record a cheque or a wire today
-- (PaymentPanel / recordPayment in app/(app)/invoices/actions.ts,
-- unchanged). No new service_role caller is added anywhere by this
-- migration or the application code that follows it. This is a
-- documented manual step, not a silently narrower feature — see
-- app/(app)/invoices/[id]/payment-panel.tsx's header comment for the
-- pilot-facing framing of the same gap.
--
-- The one piece of state this flow DOES need written from a
-- request that lacks... no, actually has a full user session: the
-- Stripe-Connect OAuth callback runs as the SIGNED-IN pilot completing
-- their own onboarding, so there is no "no session" problem here at all.
-- The obstacle is narrower and different: pilot.accounts.connect_account_id
-- is deliberately withheld from the authenticated UPDATE grant AND
-- enforced by pilot.protect_account_billing_columns (Phase 1) as
-- service_role-only, specifically so a pilot can never self-mint billing
-- state from the browser. That protection is correct for plan/status/
-- seat_count/the Stripe *billing* ids; connect_account_id is a different
-- kind of column (an OAuth grant the pilot just completed, about their
-- OWN account, not an entitlement) and deserves a narrower, purpose-built
-- door rather than either (a) reusing service-role.ts — which the task's
-- own constraint says not to widen — or (b) quietly loosening the whole
-- billing-column protection. The door built below is that narrow purpose:
-- two SECURITY DEFINER functions, each doing exactly one column write,
-- gated on (i) a strict `acct_...` format check and (ii) the caller being
-- the account's own OWNER (pilot.account_members role='owner'), matching
-- the trigger's existing owner-only spirit but expressed at the function
-- boundary instead of the client-writable-column boundary. Neither
-- function is reachable except through connect-actions.ts's server
-- actions and the OAuth callback route — never directly from the browser
-- with an anon key, since RPC calls still require a valid `authenticated`
-- session and the function itself re-derives the caller from auth.uid(),
-- not from anything the client supplies.
-- ***************************************************************************

-- ---------------------------------------------------------------------------
-- 1. Widen the billing-column protection trigger with a narrow, explicit
--    exception: a session-local flag, settable only from inside the two
--    SECURITY DEFINER functions below (never exposed to PostgREST/RPC —
--    set_config lives in pg_catalog, which is not in the exposed schema
--    list), permits ONLY connect_account_id to change. Every other
--    protected column keeps the original all-service_role-only rule
--    completely unchanged.
-- ---------------------------------------------------------------------------
create or replace function pilot.protect_account_billing_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  connect_write_allowed boolean :=
    coalesce(current_setting('pilot.allow_connect_write', true), '') = 'on';
begin
  if current_user <> 'service_role' and (
    new.plan is distinct from old.plan or
    new.status is distinct from old.status or
    new.seat_count is distinct from old.seat_count or
    new.trial_ends_at is distinct from old.trial_ends_at or
    new.stripe_customer_id is distinct from old.stripe_customer_id or
    new.stripe_subscription_id is distinct from old.stripe_subscription_id or
    new.kind is distinct from old.kind
  ) then
    raise exception
      'pilot.accounts billing/entitlement columns can only be changed by service_role';
  end if;

  if new.connect_account_id is distinct from old.connect_account_id
     and current_user <> 'service_role'
     and not connect_write_allowed then
    raise exception
      'pilot.accounts.connect_account_id can only be changed by service_role or through pilot.connect_account_link/pilot.connect_account_unlink';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1b. Format-checked at the TABLE level, not only inside
--     pilot.connect_account_link's plpgsql `if` — a CHECK constraint is
--     not a grant and is never bypassed by BYPASSRLS or role, so this
--     holds even for a service_role write. Doubles as a mechanical
--     assertion that this column can never hold a Stripe SECRET key:
--     every Stripe secret/restricted key is `sk_...`/`rk_...`, never
--     `acct_...`, so a value matching this pattern is definitionally not
--     a key. scripts/connect-verify.mjs proves this by attempting
--     exactly that write and asserting the specific SQLSTATE (23514).
alter table pilot.accounts
  add constraint accounts_connect_account_id_format
  check (connect_account_id is null or connect_account_id ~ '^acct_[A-Za-z0-9]+$');

-- 2. pilot.connect_account_link — called once, from the OAuth callback,
--    right after Stripe's /oauth/token exchange returns the connected
--    account id. Idempotent (re-running with the same id is a no-op
--    write); rejects a caller who isn't the account's owner and rejects
--    anything that doesn't look like a real Stripe account id, closing
--    off both a privilege-escalation path and a garbage-data path.
-- ---------------------------------------------------------------------------
create or replace function pilot.connect_account_link(p_account_id uuid, p_connect_account_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_connect_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'invalid Stripe connected account id';
  end if;

  if not exists (
    select 1 from pilot.account_members
    where account_id = p_account_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'only an account owner may connect Stripe';
  end if;

  perform set_config('pilot.allow_connect_write', 'on', true);
  update pilot.accounts set connect_account_id = p_connect_account_id
    where id = p_account_id;
end;
$$;

revoke all on function pilot.connect_account_link(uuid, text) from public;
grant execute on function pilot.connect_account_link(uuid, text) to authenticated;

comment on function pilot.connect_account_link(uuid, text) is
  'Called by app/api/stripe/connect/callback/route.ts right after the OAuth token exchange. SECURITY DEFINER, but the write it performs is narrower than that phrase usually implies: format-checked, owner-only, and bounded to exactly the caller''s own account_id (never a value the client supplies unchecked). This is the one deliberate door through pilot.protect_account_billing_columns for connect_account_id — see the migration file header for why it exists instead of widening lib/supabase/service-role.ts.';

-- ---------------------------------------------------------------------------
-- 3. pilot.connect_account_unlink — disconnect. Clears connect_account_id
--    AND every stored payment-link reference on that tenant's invoices
--    (added below), because once the OAuth grant is revoked the platform
--    has no way to verify a stored link still resolves to the pilot's
--    Stripe account, and offering a "Pay online" button the app can no
--    longer vouch for is worse than not offering one. This does NOT
--    deactivate the Payment Link on Stripe's side — that link lives on
--    the pilot's OWN connected account, not on the platform, and the
--    platform was never in a position to revoke it unilaterally (it
--    never held the pilot's keys). The pilot is told this in
--    connect-panel.tsx's disconnect confirmation copy: if a client still
--    has the link, it may keep working until the pilot deactivates it
--    themselves in their Stripe Dashboard.
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
        stripe_payment_link_livemode = null
    where account_id = p_account_id
      and stripe_payment_link_id is not null;
end;
$$;

revoke all on function pilot.connect_account_unlink(uuid) from public;
grant execute on function pilot.connect_account_unlink(uuid) to authenticated;

comment on function pilot.connect_account_unlink(uuid) is
  'Disconnects Stripe Connect and clears every stored payment-link reference on the tenant''s invoices (display-layer clear, not a Stripe-side revoke — see this migration''s header comment). Owner-only, same membership check as connect_account_link.';

-- ---------------------------------------------------------------------------
-- 4. Payment-link columns on pilot.invoices. Ordinary tenant business
--    data — NOT a billing/entitlement column, so it is not touched by
--    protect_account_billing_columns and does not need a security
--    definer door: the existing invoices_update RLS policy plus a plain
--    column grant (added below, alongside the existing pattern) is
--    exactly the right amount of protection, the same as `notes`.
--
--    NOTE what is NOT stored here: no Stripe secret key, no PAN, no
--    payment method detail, no webhook payload. Only a Payment Link id
--    and its public URL — both things Stripe already serves back to
--    ANYONE who opens the link, not secrets by any definition.
-- ---------------------------------------------------------------------------
alter table pilot.invoices
  add column if not exists stripe_payment_link_id text,
  add column if not exists stripe_payment_link_url text,
  -- Recorded at creation time so a payment link generated on a test-mode
  -- Connect account is never presented to a client as a real bill (and
  -- vice versa) — mirrors isLiveMode()'s role for the platform webhook,
  -- but there is no webhook here to enforce it centrally, so the create-
  -- link action (lib/stripe/connect.ts) is what checks this before ever
  -- persisting a link, and payment-panel.tsx checks it again before
  -- rendering the "Pay online" button.
  add column if not exists stripe_payment_link_livemode boolean;

comment on column pilot.invoices.stripe_payment_link_id is
  'Stripe Payment Link id, created as a DIRECT CHARGE on the pilot''s OWN connected account (Stripe-Account header). No application_fee_amount is ever set — see lib/stripe/connect.ts. Cleared on disconnect by pilot.connect_account_unlink.';
comment on column pilot.invoices.stripe_payment_link_url is
  'Public URL for the id above. Not a secret — this is the exact link Stripe already hands anyone who has it.';
comment on column pilot.invoices.stripe_payment_link_livemode is
  'Whether the link above was created against a live-mode or test-mode Connect account, so a test link is never rendered as payable on a live-keyed deployment or vice versa.';

grant update (stripe_payment_link_id, stripe_payment_link_url, stripe_payment_link_livemode)
  on pilot.invoices to authenticated;

-- pilot.invoices_protect_issued (Phase 5) locks every column on an issued
-- invoice except an explicit allow-list (status/sent_at/delivery_method/
-- notes/updated_at) — and a payment link can, BY DESIGN, only ever be
-- generated once an invoice is 'sent' or 'partial' (see the CHECK above),
-- which is exactly the state that trigger otherwise locks down. Without
-- widening its allow-list, neither the legitimate authenticated write
-- (lib/stripe/connect.ts's create-link action) nor
-- pilot.connect_account_unlink's disconnect-time clear could ever
-- succeed — found live, the hard way, by scripts/connect-verify.mjs's
-- ASSERTION 4 failing with exactly this trigger's exception before this
-- fix. Re-declared here with the three payment-link columns added to the
-- allow-list; every other rule in the function (forward-only status,
-- draft-required-lines, MEDIUM-11's payment-before-paid check, and the
-- structural diff itself) is copied verbatim, unchanged.
create or replace function pilot.invoices_protect_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new; -- webhook/service paths (e.g. payment reconciliation) are exempt
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'   and new.status in ('sent', 'void')) or
      (old.status = 'sent'    and new.status in ('partial', 'paid', 'void')) or
      (old.status = 'partial' and new.status in ('paid', 'void'))
    ) then
      raise exception 'invoice % cannot move from status % to %', old.id, old.status, new.status;
    end if;

    if old.status = 'draft' and new.status = 'sent' then
      if not exists (
        select 1 from pilot.invoice_lines where account_id = new.account_id and invoice_id = new.id
      ) then
        raise exception 'invoice % cannot be sent with no line items', new.id;
      end if;

      if exists (
        select 1
        from pilot.invoice_lines l
        left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
        left join pilot.trips t on t.account_id = l.account_id and t.id = coalesce(l.trip_id, e.trip_id)
        where l.account_id = new.account_id and l.invoice_id = new.id
          and coalesce(l.trip_id, e.trip_id) is not null
          and t.client_id is distinct from new.client_id
      ) then
        raise exception 'invoice % cannot be sent: one or more line items'' trips belong to a different client', new.id;
      end if;
    end if;

    if new.status in ('partial', 'paid') then
      declare
        paid_cents bigint;
        due_cents bigint;
      begin
        select amount_paid_cents, balance_due_cents into paid_cents, due_cents
          from pilot.invoice_totals where invoice_id = new.id;
        if coalesce(paid_cents, 0) <= 0 then
          raise exception 'invoice % cannot become status=% with no recorded payment', new.id, new.status;
        end if;
        if new.status = 'paid' and coalesce(due_cents, 0) > 0 then
          raise exception 'invoice % cannot become paid with a nonzero balance due (%)', new.id, due_cents;
        end if;
      end;
    end if;
  end if;

  if old.status = 'draft' then
    return new; -- draft rows are otherwise freely editable
  end if;

  if to_jsonb(new) - array[
       'status', 'sent_at', 'delivery_method', 'notes', 'updated_at',
       'stripe_payment_link_id', 'stripe_payment_link_url', 'stripe_payment_link_livemode'
     ]
     is distinct from
     to_jsonb(old) - array[
       'status', 'sent_at', 'delivery_method', 'notes', 'updated_at',
       'stripe_payment_link_id', 'stripe_payment_link_url', 'stripe_payment_link_livemode'
     ]
  then
    raise exception 'invoice % is issued (status=%) and cannot be modified except status/sent_at/delivery_method/notes/payment-link fields', old.id, old.status;
  end if;

  return new;
end;
$$;

-- Belt-and-braces, enforced in the database rather than only in
-- lib/stripe/connect.ts: a payment link may only be STORED against an
-- invoice a client could plausibly have been sent — 'sent', 'partial',
-- or (for a link generated before the last payment landed) 'paid'.
-- 'draft' and 'void' are refused outright, matching the "an unsent
-- invoice is not payable" requirement at the same layer
-- invoice_payments_validate already enforces it for actual payments. A
-- plain CHECK suffices (no trigger needed) because both columns it
-- compares — the new link id and the new status — live on the same row
-- being written.
alter table pilot.invoices
  add constraint invoices_payment_link_requires_sendable_status
  check (stripe_payment_link_id is null or status in ('sent', 'partial', 'paid'));
