-- Hardening pass over 20260809040000_connect_payments.sql, driven by seven
-- review findings against that migration and the application code around
-- it. Three of them are database-shaped and fixed here; the other four are
-- fixed in lib/stripe/connect.ts, the OAuth callback route, and the two
-- server-action files. Read 20260809040000's header first — this file
-- amends decisions taken there and does not restate their reasoning.
--
-- ***************************************************************************
-- FINDING 1 — THE CLAIM THAT WAS NOT TRUE
-- ***************************************************************************
-- 20260809040000's header ends with:
--
--   "Neither function is reachable except through connect-actions.ts's
--    server actions and the OAuth callback route — never directly from
--    the browser with an anon key, since RPC calls still require a valid
--    `authenticated` session and the function itself re-derives the caller
--    from auth.uid()."
--
-- The second half of that sentence is true. The first half does not follow
-- from it, and is false. `grant execute on function
-- pilot.connect_account_link(uuid, text) to authenticated` means any
-- signed-in account OWNER can POST /rest/v1/rpc/connect_account_link from
-- a terminal with the publishable key and their own session JWT. Requiring
-- an authenticated session excludes strangers; it does not exclude the
-- signed-in pilot, who is the only caller that function was ever gated
-- against in the first place. What the direct call skips is everything
-- that made the value trustworthy:
--
--   - the OAuth authorization-code exchange (so the `acct_...` written
--     need not be an account this platform holds a grant on, or one the
--     caller controls at all — any well-formed acct id is accepted), and
--   - exchangeConnectCode()'s livemode agreement check (so a test-mode
--     deployment could be made to carry a live-mode connected account id,
--     which is the one thing payment-panel.tsx's livemode gate exists to
--     make impossible).
--
-- Neither is a cross-tenant read and neither leaks anything — the write is
-- still bounded to the caller's own account. It is a data-integrity and
-- test/live-separation hole, and the fix is to make the function require
-- PROOF that the OAuth round trip actually happened, rather than to
-- document the hole more carefully.
--
-- THE PROOF: a server-minted, single-use state token (pilot.
-- connect_oauth_states below), created when the pilot starts onboarding
-- and consumed by connect_account_link. The token is generated INSIDE the
-- database by a SECURITY DEFINER function and is never selectable — the
-- table has RLS on and NO policies at all, so the only copy that ever
-- exists outside the row is the one returned to the caller that minted
-- it, which the server action puts straight into an httpOnly cookie and
-- into Stripe's `state` parameter. A caller who did not start the flow
-- cannot produce one, which is exactly the property the header claimed
-- and did not have.
--
-- ***************************************************************************
-- FINDING 2 — THE STATE WAS NOT BOUND TO THE ACCOUNT THAT STARTED THE FLOW
-- ***************************************************************************
-- The old `state` was a random hex string compared against a cookie: it
-- proved the callback belonged to the same BROWSER that started the flow,
-- and nothing about WHICH ACCOUNT started it. The callback then resolved
-- the target account by taking the caller's FIRST account_members row by
-- created_at — so a pilot who belongs to two accounts, starting the flow
-- from account B, would have the grant attached to account A. Not an
-- attack; a plain wrong-row bug that no amount of CSRF checking would
-- catch. The state row below carries `account_id`, so the account is read
-- off the proof itself and the callback no longer picks one.
--
-- ***************************************************************************
-- FINDING 3 — THE PAYMENT-LINK CHECK MADE A LINKED INVOICE UNVOIDABLE
-- ***************************************************************************
-- `invoices_payment_link_requires_sendable_status` (that migration, line
-- ~344) says a stored link requires status in ('sent','partial','paid').
-- voidInvoice() sent `{ status: 'void' }` and nothing else, so voiding any
-- invoice that had ever had a link generated failed with 23514 and the
-- pilot saw "Some of those values aren't valid together." Confirmed by
-- reading both sides rather than taking the report at face value.
--
-- THE CONSTRAINT IS NOT THE BUG AND IS DELIBERATELY KEPT. "A voided
-- invoice has no live payment link" is the invariant worth having: the
-- alternative reading — relax the check so a void can leave the link
-- columns populated — leaves a Stripe-hosted page still collecting card
-- payments for an invoice the pilot has cancelled. The fix is in
-- voidInvoice(), which now deactivates the link on Stripe and clears all
-- four columns in the same UPDATE that sets status='void'.
--
-- Note what is deliberately NOT added: a trigger that silently nulls the
-- link columns on void. That would make every future void path succeed
-- while leaving the Stripe-side link live, which is the failure this
-- constraint exists to prevent. A loud 23514 forces any new void path to
-- go through the deactivate-then-clear helper. The constraint stays a
-- tripwire, not a formality.
-- ***************************************************************************

-- ---------------------------------------------------------------------------
-- 1. pilot.connect_oauth_states — one row per in-flight Connect onboarding.
--
--    Deliberately NOT reachable from the browser in any direction: RLS is
--    on with ZERO policies, AND the table-level SELECT is explicitly
--    revoked. Both functions below are SECURITY DEFINER and therefore
--    read/write it as the table owner. That combination is the point — a
--    state token that `authenticated` could select would be a token any
--    signed-in user could steal from any other, which is the whole
--    property being bought here.
--
--    THE REVOKE IS NOT DECORATIVE, and this comment originally claimed
--    (wrongly) that "no grant of any kind is issued on the table".
--    20260802190437 line ~370 sets ALTER DEFAULT PRIVILEGES IN SCHEMA
--    pilot, so every new table in this schema is born with SELECT granted
--    to `authenticated` — including this one, without a single grant
--    statement being written here. scripts/connect-verify.mjs's
--    CONNECT-3e caught exactly that: it asserted 42501 on a bare select
--    and instead got a clean empty result, because RLS-with-no-policies
--    returns zero rows rather than refusing. Zero rows is the same
--    OUTCOME today, but it is a weaker guarantee: it holds only as long
--    as nobody ever adds a policy here, whereas a revoked SELECT fails
--    regardless of what policies exist.
--
--    Rows are short-lived by construction: minting one deletes the
--    caller's previous attempt and sweeps anything older than an hour, and
--    consuming one deletes it. There is no separate reaper to forget to
--    schedule.
-- ---------------------------------------------------------------------------
create table if not exists pilot.connect_oauth_states (
  -- 32 random bytes, base64url, no padding: 43 chars from [A-Za-z0-9_-],
  -- the same token shape and the same CSPRNG as pilot.invoice_shares.token
  -- (20260809060000). URL-safe because this value travels to Stripe and
  -- back as the `state` query parameter.
  state text primary key check (state ~ '^[A-Za-z0-9_-]{43}$'),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  -- The user who started the flow, not just the account: the callback runs
  -- in whatever session the browser currently holds, and a state minted by
  -- one signed-in user must not be completable by another even if both are
  -- owners of the same account.
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table pilot.connect_oauth_states is
  'In-flight Stripe Connect OAuth attempts. Minted by pilot.connect_oauth_state_begin, consumed (single-use) by pilot.connect_account_link. RLS is enabled with NO policies and no grants: nothing outside those two SECURITY DEFINER functions can read or write this table, which is what makes the token unforgeable proof that the OAuth round trip was actually started by this user for this account.';

alter table pilot.connect_oauth_states enable row level security;

-- No policies. This is the deny-all case, stated once here so a future
-- reader does not "fix" the missing policy.

-- Undo the schema-wide default privilege (see the table comment). anon is
-- named too even though it holds nothing here today, so that a future
-- default-privileges change cannot quietly hand it read access either.
revoke all on pilot.connect_oauth_states from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. pilot.connect_oauth_state_begin — mint a state for one onboarding
--    attempt. Owner-gated identically to connect_account_link, because a
--    non-owner should not be able to start a flow they could never finish.
-- ---------------------------------------------------------------------------
create or replace function pilot.connect_oauth_state_begin(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if not exists (
    select 1 from pilot.account_members
    where account_id = p_account_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'only an account owner may connect Stripe';
  end if;

  -- Starting a new attempt retires this user's previous one: two live
  -- states would mean an abandoned flow could still be completed later
  -- from a stale tab, against whichever account it was started for.
  delete from pilot.connect_oauth_states where user_id = auth.uid();
  -- Sweep: nothing older than an hour is completable anyway (the consume
  -- side enforces 15 minutes), so this keeps the table from accumulating
  -- abandoned attempts without needing a scheduled job.
  delete from pilot.connect_oauth_states where created_at < now() - interval '1 hour';

  v_state := replace(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '=', ''
  );

  insert into pilot.connect_oauth_states (state, account_id, user_id)
  values (v_state, p_account_id, auth.uid());

  return v_state;
end;
$$;

revoke all on function pilot.connect_oauth_state_begin(uuid) from public;
grant execute on function pilot.connect_oauth_state_begin(uuid) to authenticated;

comment on function pilot.connect_oauth_state_begin(uuid) is
  'Called by startConnectOnboarding() in app/(app)/settings/connect-actions.ts. Mints the single-use `state` that Stripe echoes back to the OAuth callback, binding the attempt to (account, user). Owner-only. The returned token is the ONLY copy that leaves the database — the table it writes is unreadable to every role but this function''s definer.';

-- ---------------------------------------------------------------------------
-- 3. pilot.connect_account_link — replaced. The old signature took the
--    account id straight from the caller; the new one takes the OAuth
--    state and reads the account off the proof. Dropping rather than
--    overloading, so the old, directly-callable-without-proof entry point
--    stops existing rather than sitting alongside the new one.
-- ---------------------------------------------------------------------------
drop function if exists pilot.connect_account_link(uuid, text);

create or replace function pilot.connect_account_link(p_connect_account_id text, p_state text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_user_id uuid;
  v_created_at timestamptz;
begin
  if p_connect_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'invalid Stripe connected account id';
  end if;

  -- Consume the state. DELETE ... RETURNING is the single-use guarantee:
  -- a replayed callback URL finds no row. (A failed check below raises,
  -- which rolls the DELETE back with everything else — so a wrong-user or
  -- expired attempt does not burn a state the rightful owner could still
  -- complete.)
  delete from pilot.connect_oauth_states
    where state = p_state
    returning account_id, user_id, created_at
    into v_account_id, v_user_id, v_created_at;

  if v_account_id is null then
    raise exception 'that Stripe connection attempt has expired or was already used';
  end if;

  if v_user_id is distinct from auth.uid() then
    raise exception 'that Stripe connection attempt belongs to a different sign-in';
  end if;

  if v_created_at < now() - interval '15 minutes' then
    raise exception 'that Stripe connection attempt has expired';
  end if;

  -- Re-checked at consume time, not merely at mint time: ownership can be
  -- revoked between the two, and this is the write that matters.
  if not exists (
    select 1 from pilot.account_members
    where account_id = v_account_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'only an account owner may connect Stripe';
  end if;

  perform set_config('pilot.allow_connect_write', 'on', true);
  update pilot.accounts set connect_account_id = p_connect_account_id
    where id = v_account_id;

  return v_account_id;
end;
$$;

revoke all on function pilot.connect_account_link(text, text) from public;
grant execute on function pilot.connect_account_link(text, text) to authenticated;

comment on function pilot.connect_account_link(text, text) is
  'Called by app/api/stripe/connect/callback/route.ts after the OAuth token exchange. Consumes a single-use pilot.connect_oauth_states row (minted by connect_oauth_state_begin), which is what proves the caller actually started this OAuth flow for this account — the previous signature took the account id as an argument and could be called directly over PostgREST with no OAuth round trip at all. The account written is read off the consumed state, never off an argument.';

-- ---------------------------------------------------------------------------
-- 4. The amount a stored payment link was created for.
--
--    A Payment Link snapshots a Price, and the Price snapshots the balance
--    at the moment the link was generated. Record a $2,000 cheque against
--    a $5,000 invoice and the stored link still charges $5,000 — the
--    invoice screen would happily keep offering it. The application now
--    retires a link whenever a payment lands (see recordPayment), but the
--    screen also needs to be able to SAY what a live link is for, and a
--    stored amount is the only way to tell a current link from a stale one
--    without a Stripe round trip on every page render.
-- ---------------------------------------------------------------------------
alter table pilot.invoices
  add column if not exists stripe_payment_link_amount_cents bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'pilot.invoices'::regclass
      and conname = 'invoices_payment_link_amount_positive'
  ) then
    alter table pilot.invoices
      add constraint invoices_payment_link_amount_positive
      check (stripe_payment_link_amount_cents is null or stripe_payment_link_amount_cents > 0);
  end if;
end $$;

comment on column pilot.invoices.stripe_payment_link_amount_cents is
  'The balance the stored Payment Link was created to collect. A link is a snapshot of a Price; this is what lets the invoice screen tell the pilot whether the live link still matches the balance due. Cleared with the rest of the link columns.';

-- id and url are two halves of one fact — a row carrying one without the
-- other is a link the app cannot render or a link it cannot deactivate.
-- num_nonnulls keeps the rule readable and covers both directions.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'pilot.invoices'::regclass
      and conname = 'invoices_payment_link_columns_consistent'
  ) then
    alter table pilot.invoices
      add constraint invoices_payment_link_columns_consistent
      check (num_nonnulls(stripe_payment_link_id, stripe_payment_link_url) in (0, 2));
  end if;
end $$;

grant update (stripe_payment_link_amount_cents) on pilot.invoices to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Re-declare the two functions that enumerate the payment-link columns,
--    so the new fourth column travels with the other three. Both bodies
--    are otherwise copied verbatim from 20260809040000.
-- ---------------------------------------------------------------------------
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
       'stripe_payment_link_id', 'stripe_payment_link_url',
       'stripe_payment_link_livemode', 'stripe_payment_link_amount_cents'
     ]
     is distinct from
     to_jsonb(old) - array[
       'status', 'sent_at', 'delivery_method', 'notes', 'updated_at',
       'stripe_payment_link_id', 'stripe_payment_link_url',
       'stripe_payment_link_livemode', 'stripe_payment_link_amount_cents'
     ]
  then
    raise exception 'invoice % is issued (status=%) and cannot be modified except status/sent_at/delivery_method/notes/payment-link fields', old.id, old.status;
  end if;

  return new;
end;
$$;

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
end;
$$;
