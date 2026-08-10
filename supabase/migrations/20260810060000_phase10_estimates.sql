-- ===========================================================================
-- Phase 10 — Estimates (quotes)
--
-- WHAT THIS IS FOR
-- ---------------------------------------------------------------------------
-- A client asks a contract pilot what a three-day Teterboro trip will cost
-- BEFORE it is booked. Today this product has no answer: the pilot writes
-- the numbers in an email, flies the trip, and then re-types the same
-- figures into an invoice. That is the product's own central complaint —
-- the same trip entered twice — applied to the one document that comes
-- FIRST.
--
-- It is also the clearest remaining gap against the products this one is
-- measured against. QuickBooks and Wave both treat an estimate as a
-- first-class document that converts to an invoice without re-entry, and
-- the aviation-expert reference names deposits and prepay for "new or
-- shaky clients" as normal practice in day-rate agreements — which is a
-- conversation that starts with a quote.
--
-- ---------------------------------------------------------------------------
-- WHAT AN ESTIMATE IS NOT
-- ---------------------------------------------------------------------------
-- It is not a financial record. Nothing in the tax reports reads this
-- table, nothing sums it into revenue, and no payment can be recorded
-- against it. An estimate that is never accepted is a conversation that
-- did not happen. THAT is why the rules here are deliberately softer than
-- pilot.invoices: a sent estimate may be revised and re-sent, where an
-- issued invoice may not be touched at all. Do not "harmonise" the two —
-- the asymmetry is the point, and it follows from what the documents are.
--
-- ---------------------------------------------------------------------------
-- EVERY PATTERN HERE IS BORROWED, NOT INVENTED
-- ---------------------------------------------------------------------------
-- Phase 5's invoice schema was reworked repeatedly under review, and each
-- fix is reproduced here rather than re-learned:
--
--   * per-account numbering, never global — invoice cadence is a business
--     signal that must not be inferable across tenants, and a bare
--     column-level UNIQUE on the number made tenant #2's first document a
--     hard 23505 AND a cross-tenant existence oracle;
--   * the numbering function is SECURITY DEFINER **with an explicit
--     in-body tenancy check** — INVOKER cannot work (RLS filters the
--     UPDATE to zero rows and returns NULL, not an error), and DEFINER
--     without the check is a strictly worse cross-tenant primitive that a
--     review demonstrated as a live exploit;
--   * that check reads `current_setting('role', true)`, NOT `current_user`,
--     because inside a DEFINER function current_user reports the function
--     OWNER and a `current_user <> 'service_role'` test can therefore never
--     match a real service_role caller;
--   * `not exists` rather than `not in`, so a NULL in the set cannot make
--     the guard fail open;
--   * line amounts are GENERATED from quantity x unit_amount, never
--     entered, so a line total cannot drift from its own inputs;
--   * totals live in ONE view and are stored nowhere;
--   * taxability is per-line, because an estimate mixing a day rate with a
--     per-diem reimbursement has two different answers;
--   * expiry is DERIVED, never stored — the same rule invoices follow for
--     overdue. A stored flag you must remember to flip nightly is two code
--     paths tracking one fact.
--
-- All money is integer cents. All fixtures synthetic; no live pilot data.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Accounts gain their own estimate prefix, separate from the invoice one.
-- A pilot who numbers invoices INV-2026-0001 wants EST-2026-0001, not a
-- second series sharing the same letters — a client receiving both should
-- never have to work out which document they are looking at.
-- ---------------------------------------------------------------------------
alter table pilot.accounts
  add column if not exists estimate_prefix text not null default 'EST';

grant update (estimate_prefix) on pilot.accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Per-account sequential estimate numbering.
-- ---------------------------------------------------------------------------
create table if not exists pilot.estimate_number_sequences (
  account_id uuid primary key references pilot.accounts(id) on delete cascade,
  next_number integer not null default 1 check (next_number > 0)
);

comment on table pilot.estimate_number_sequences is
  'One row per account, created by accounts_seed_estimate_sequence so numbering can never be skipped for a new tenant. Advanced only by pilot.next_estimate_number(), which increments and returns in one atomic UPDATE.';

-- Same "cannot forget to wire a new tenant" discipline as the invoice
-- sequence: guarantee the row at account creation, where it is cheap, not
-- at first use, where it is a support ticket.
create or replace function pilot.accounts_seed_estimate_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into pilot.estimate_number_sequences (account_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists accounts_seed_estimate_sequence on pilot.accounts;
create trigger accounts_seed_estimate_sequence
  after insert on pilot.accounts
  for each row execute function pilot.accounts_seed_estimate_sequence();

-- Backfill every account that predates this migration.
insert into pilot.estimate_number_sequences (account_id)
select id from pilot.accounts
on conflict (account_id) do nothing;

-- SECURITY DEFINER plus an in-body membership check. Read the header of
-- this file, and pilot.next_invoice_number's comment in the Phase 5
-- migration, before touching either half — removing the check does not
-- make this "simpler", it makes it a cross-tenant read/write primitive.
create or replace function pilot.next_estimate_number(target_account_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  seq integer;
  prefix text;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and not exists (
       select 1 from pilot.current_account_ids() a where a = target_account_id
     )
  then
    raise exception 'not a member of account %', target_account_id;
  end if;

  update pilot.estimate_number_sequences
    set next_number = next_number + 1
    where account_id = target_account_id
    returning next_number - 1 into seq;

  if seq is null then
    raise exception 'no estimate sequence for account % (accounts_seed_estimate_sequence should have created one)', target_account_id;
  end if;

  -- INTO STRICT: a missing account would otherwise leave prefix NULL and
  -- concatenate the whole number away to NULL, silently producing an
  -- unnumbered document instead of an error.
  select a.estimate_prefix into strict prefix
    from pilot.accounts a where a.id = target_account_id;

  return prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(seq::text, 4, '0');
end;
$$;

comment on function pilot.next_estimate_number(uuid) is
  'Atomic increment-and-return of an account''s estimate sequence. SECURITY DEFINER with an explicit membership check — see the Phase 5 migration''s next_invoice_number comment for why both halves are required.';

-- ---------------------------------------------------------------------------
-- estimates
-- ---------------------------------------------------------------------------
create table if not exists pilot.estimates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid not null,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete restrict,

  -- Optional: a quote is often written before a trip record exists at all
  -- ("what would three days in the Citation cost me?"), which is the whole
  -- reason this document comes first. When it IS tied to a planned trip,
  -- the link is what lets the accepted quote and the eventual invoice line
  -- up against the same job.
  trip_id uuid,
  foreign key (account_id, trip_id) references pilot.trips (account_id, id)
    on delete set null (trip_id),

  -- Assigned on the transition out of draft, exactly like an invoice
  -- number: numbering a document that may still be discarded burns
  -- sequence integers and turns "why was EST-2026-0004 never sent" into a
  -- support question instead of a non-event.
  estimate_number text,

  -- No 'expired' here, deliberately. Expiry is a function of
  -- (status, valid_until, today) and is derived by pilot.estimates_expired
  -- below — same rule pilot.invoices follows for overdue, and for the same
  -- reason: a stored flag needing a nightly sweep is two code paths
  -- tracking one fact, and they drift.
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined')),

  issued_on date,
  -- How long the quote stands. Snapshotted at send time from the account's
  -- default; a contract pilot quoting a pop-up trip needs this short, and
  -- a quote with no expiry is a price the pilot is bound to forever.
  valid_until date,
  check (issued_on is null or valid_until is null or valid_until >= issued_on),
  sent_at timestamptz,

  -- Same basis-points-and-a-sane-ceiling treatment as invoices: 8.25%
  -- stores exactly as 825, nothing near money is a float, and the 25% cap
  -- catches an order-of-magnitude fat-finger.
  tax_rate_bps integer not null default 0
    check (tax_rate_bps >= 0 and tax_rate_bps <= 2500),

  -- What the client is being told beyond the line items: cancellation
  -- terms, per-diem basis, what is not included. Free text on purpose —
  -- the reference is explicit that cancellation percentages are convention
  -- rather than law, and computing an unenforceable fee is worse than
  -- recording the agreement.
  terms text,
  notes text,

  -- Set when the estimate becomes an invoice. Also the idempotency key for
  -- conversion: a non-null value means this quote has already produced a
  -- document, and pilot.estimate_convert_to_invoice refuses to make a
  -- second one.
  converted_invoice_id uuid,
  foreign key (account_id, converted_invoice_id) references pilot.invoices (account_id, id)
    on delete set null (converted_invoice_id),
  converted_at timestamptz,
  check ((converted_invoice_id is null) = (converted_at is null)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  -- Per-tenant, never global. Multiple NULLs (drafts) coexist because
  -- Postgres treats NULL as distinct from NULL in a unique constraint.
  unique (account_id, estimate_number)
);

comment on table pilot.estimates is
  'A quote given to a client before the work. NOT a financial record: nothing in the tax reports reads this table and no payment can be recorded against it. Converts to a DRAFT invoice the pilot still reviews and sends.';

create index if not exists estimates_account_status_idx
  on pilot.estimates (account_id, status, issued_on desc);
create index if not exists estimates_account_client_idx
  on pilot.estimates (account_id, client_id);

-- ---------------------------------------------------------------------------
-- estimate_lines — same shape and same vocabulary as invoice_lines, so a
-- conversion is a copy rather than a translation. amount_cents is
-- GENERATED: quantity x unit_amount_cents is the only source.
-- ---------------------------------------------------------------------------
create table if not exists pilot.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  estimate_id uuid not null,
  foreign key (account_id, estimate_id) references pilot.estimates (account_id, id) on delete cascade,
  -- Identical vocabulary to pilot.invoice_lines.line_type. If these two
  -- lists ever diverge, conversion starts silently dropping or remapping
  -- line types — keep them in step.
  line_type text not null
    check (line_type in ('flight_day', 'travel_day', 'per_diem',
                         'reimbursable_expense', 'cancellation_fee', 'other')),
  description text not null,
  quantity numeric(6,2) not null default 1 check (quantity > 0),
  unit_amount_cents bigint not null check (unit_amount_cents >= 0),
  amount_cents bigint generated always as (round(quantity * unit_amount_cents)::bigint) stored,
  -- Per-line, not per-document: a quote mixing a day rate (a taxable
  -- service in some states) with a per-diem reimbursement (commonly not)
  -- has two answers, and one invoice-wide flag makes the tax figure wrong
  -- the moment both appear.
  taxable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (account_id, id)
);

create index if not exists estimate_lines_estimate_idx
  on pilot.estimate_lines (estimate_id, sort_order);

-- ---------------------------------------------------------------------------
-- The ONE place an estimate's totals are computed. Nothing stores them.
-- ---------------------------------------------------------------------------
create or replace view pilot.estimate_totals
with (security_invoker = true) as
  select
    e.id as estimate_id,
    e.account_id,
    coalesce(lines.subtotal_cents, 0)::bigint as subtotal_cents,
    round(coalesce(lines.taxable_subtotal_cents, 0) * e.tax_rate_bps / 10000.0)::bigint as tax_cents,
    (coalesce(lines.subtotal_cents, 0)
      + round(coalesce(lines.taxable_subtotal_cents, 0) * e.tax_rate_bps / 10000.0))::bigint as total_cents
  from pilot.estimates e
  -- Aggregated in its own subquery before the join. Only one child table
  -- exists here so there is no fan-out to avoid today, but the invoice
  -- view was written this way after a real double-counting bug and the
  -- shape should not have to be rediscovered if a second child (deposits,
  -- say) is ever added.
  left join (
    select estimate_id,
      sum(amount_cents) as subtotal_cents,
      sum(amount_cents) filter (where taxable) as taxable_subtotal_cents
    from pilot.estimate_lines
    group by estimate_id
  ) lines on lines.estimate_id = e.id;

comment on view pilot.estimate_totals is
  'The single source for an estimate''s subtotal/tax/total. Nothing else in this schema stores an estimate total — compute it here or not at all.';

-- Expiry, derived. See the status column comment.
create or replace view pilot.estimates_expired
with (security_invoker = true) as
  select e.id as estimate_id, e.account_id, e.valid_until,
         (current_date - e.valid_until) as days_expired
  from pilot.estimates e
  where e.status = 'sent'
    and e.valid_until is not null
    and e.valid_until < current_date;

comment on view pilot.estimates_expired is
  'Derived, never stored: a sent estimate past its valid_until. Only "sent" appears — an accepted or declined quote has an answer, and expiry is no longer a fact about it.';

-- ---------------------------------------------------------------------------
-- An estimate is born a draft, unnumbered and unsent.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimates_force_draft_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;
  -- The column-scoped INSERT grant below already makes this unreachable
  -- for 'authenticated'. It is a loud rejection rather than a silent
  -- coercion for the same reason as invoices_force_draft_on_insert: a
  -- write that quietly does something other than what was asked is the
  -- failure mode this schema family exists to avoid.
  if new.status is distinct from 'draft'
     or new.estimate_number is not null
     or new.sent_at is not null
     or new.converted_invoice_id is not null
  then
    raise exception 'estimate insert for account % cannot set status/estimate_number/sent_at/converted_invoice_id directly', new.account_id;
  end if;
  return new;
end;
$$;

drop trigger if exists estimates_force_draft_on_insert on pilot.estimates;
create trigger estimates_force_draft_on_insert
  before insert on pilot.estimates
  for each row execute function pilot.estimates_force_draft_on_insert();

-- ---------------------------------------------------------------------------
-- Status transitions, and what may change in each state.
--
-- SOFTER THAN INVOICES ON PURPOSE. An issued invoice is frozen because it
-- is a financial record a client and a tax authority may both rely on. A
-- sent quote is a negotiating position: the client says "can you do it for
-- less", and the pilot revises and re-sends. Freezing it would push that
-- conversation back into email, which is the behaviour this product
-- exists to remove.
--
-- What IS protected: the number never changes or disappears once assigned,
-- an accepted quote's figures cannot be edited out from under the invoice
-- they produced, and the conversion link is append-only.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimates_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if old.estimate_number is not null
     and new.estimate_number is distinct from old.estimate_number then
    raise exception 'estimate % has been sent; its number cannot change', old.estimate_number;
  end if;

  -- Once a quote has produced an invoice, its numbers are the basis of a
  -- document that has left the building. Re-pricing it afterwards would
  -- make the estimate and the invoice disagree about what was agreed.
  if old.converted_invoice_id is not null then
    if new.converted_invoice_id is distinct from old.converted_invoice_id
       or new.tax_rate_bps is distinct from old.tax_rate_bps
       or new.client_id is distinct from old.client_id
       or new.status is distinct from old.status then
      raise exception 'estimate % has already been converted to an invoice', coalesce(old.estimate_number, old.id::text);
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'    and new.status = 'sent') or
      (old.status = 'sent'     and new.status in ('accepted', 'declined', 'draft')) or
      -- A client who said no and then changed their mind is ordinary. The
      -- reverse (accepted -> declined) is not offered: an accepted quote
      -- may already have produced an invoice, and the guard above would
      -- reject it anyway.
      (old.status = 'declined' and new.status in ('sent', 'accepted'))
    ) then
      raise exception 'estimate cannot move from % to %', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists estimates_protect on pilot.estimates;
create trigger estimates_protect
  before update on pilot.estimates
  for each row execute function pilot.estimates_protect();

-- Lines may not be touched once the quote has become an invoice.
create or replace function pilot.estimate_lines_protect_converted()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  converted uuid;
  owning_estimate uuid;
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return coalesce(new, old);
  end if;

  owning_estimate := coalesce(new.estimate_id, old.estimate_id);
  select e.converted_invoice_id into converted
    from pilot.estimates e where e.id = owning_estimate;

  if converted is not null then
    raise exception 'estimate has already been converted to an invoice; its lines cannot change';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists estimate_lines_protect_converted on pilot.estimate_lines;
create trigger estimate_lines_protect_converted
  before insert or update or delete on pilot.estimate_lines
  for each row execute function pilot.estimate_lines_protect_converted();

-- ---------------------------------------------------------------------------
-- Numbering on send.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimates_assign_number_on_issue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'sent' then
    if new.estimate_number is null then
      new.estimate_number := pilot.next_estimate_number(new.account_id);
    end if;
    if new.issued_on is null then
      new.issued_on := current_date;
    end if;
    if new.sent_at is null then
      new.sent_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists estimates_assign_number_on_issue on pilot.estimates;
create trigger estimates_assign_number_on_issue
  before update on pilot.estimates
  for each row execute function pilot.estimates_assign_number_on_issue();

drop trigger if exists estimates_set_updated_at on pilot.estimates;
create trigger estimates_set_updated_at before update on pilot.estimates
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- Conversion: an accepted quote becomes a DRAFT invoice.
--
-- WHY THIS IS ONE DATABASE FUNCTION AND NOT THREE CLIENT CALLS. Creating
-- the invoice, copying the lines and marking the estimate converted must
-- either all happen or none of it. PostgREST gives the client no
-- transaction, so three round trips can leave a quote marked converted
-- with an invoice that has no lines, or an invoice with no quote pointing
-- at it — and the pilot then bills a client from a document that is
-- missing half the job. Same reasoning, and the same shape, as
-- pilot.bank_transaction_confirm.
--
-- WHY IT PRODUCES A DRAFT. The product's draft-confirm boundary: the
-- logbook, the trip-derived entries and the bank import all propose and
-- let the pilot commit. An invoice that sent itself because a client
-- clicked accept would be the one place this product wrote to a client on
-- the pilot's behalf without being asked.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimate_convert_to_invoice(target_estimate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  est pilot.estimates%rowtype;
  new_invoice_id uuid;
  terms_days integer;
begin
  -- Locked for the duration: two taps on a slow connection must not
  -- produce two invoices from one quote.
  select * into est from pilot.estimates
    where id = target_estimate_id
    for update;

  if est.id is null then
    raise exception 'estimate % not found', target_estimate_id;
  end if;

  -- DEFINER bypasses RLS, so this function is the only thing standing
  -- between a caller and every tenant's estimates. Same guard, same
  -- reasoning, as next_estimate_number above.
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and not exists (
       select 1 from pilot.current_account_ids() a where a = est.account_id
     )
  then
    raise exception 'not a member of account %', est.account_id;
  end if;

  if est.converted_invoice_id is not null then
    raise exception 'estimate % has already been converted', coalesce(est.estimate_number, est.id::text);
  end if;
  if est.status <> 'accepted' then
    raise exception 'only an accepted estimate can become an invoice (this one is %)', est.status;
  end if;
  if not exists (select 1 from pilot.estimate_lines l where l.estimate_id = est.id) then
    raise exception 'estimate % has no lines to invoice', coalesce(est.estimate_number, est.id::text);
  end if;

  -- Terms come from the client as they stand TODAY, not from the quote:
  -- the invoice's due date is a fact about the invoice, and Phase 5 is
  -- explicit that it is snapshotted at issue. The quote's valid_until is a
  -- different thing entirely and is deliberately not carried over.
  select c.payment_terms_days into terms_days
    from pilot.clients c where c.id = est.client_id;

  insert into pilot.invoices (account_id, client_id, tax_rate_bps, notes)
  values (
    est.account_id,
    est.client_id,
    est.tax_rate_bps,
    -- The provenance travels with the document. A pilot looking at an
    -- invoice six months later should not have to guess which quote it
    -- came from, and a client querying it will cite the quote number.
    trim(both E'\n' from coalesce(est.notes, '') || E'\n' ||
      'From estimate ' || coalesce(est.estimate_number, '(draft)'))
  )
  returning id into new_invoice_id;

  insert into pilot.invoice_lines
    (account_id, invoice_id, line_type, description, quantity,
     unit_amount_cents, taxable, sort_order)
  select l.account_id, new_invoice_id, l.line_type, l.description, l.quantity,
         l.unit_amount_cents, l.taxable, l.sort_order
  from pilot.estimate_lines l
  where l.estimate_id = est.id
  order by l.sort_order, l.created_at;

  update pilot.estimates
     set converted_invoice_id = new_invoice_id,
         converted_at = now()
   where id = est.id;

  return new_invoice_id;
end;
$$;

comment on function pilot.estimate_convert_to_invoice(uuid) is
  'Accepted estimate -> DRAFT invoice, atomically. SECURITY DEFINER with an explicit membership check and a FOR UPDATE lock; refuses a second conversion. The invoice is a draft the pilot still reviews and sends.';

-- ---------------------------------------------------------------------------
-- RLS. Same shape as every table since Phase 1.
-- ---------------------------------------------------------------------------
alter table pilot.estimate_number_sequences enable row level security;
alter table pilot.estimates                 enable row level security;
alter table pilot.estimate_lines            enable row level security;

create policy estimate_number_sequences_select on pilot.estimate_number_sequences for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
-- No insert/update/delete policy: the sequence is advanced only by
-- pilot.next_estimate_number(), which is SECURITY DEFINER and therefore
-- bypasses both RLS and grants here. A column grant would be dead weight
-- inviting a reader to think a direct client UPDATE is supported.

create policy estimates_select on pilot.estimates for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy estimates_insert on pilot.estimates for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy estimates_update on pilot.estimates for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
-- DELETE is allowed here, unlike invoices, and only for a quote that never
-- became one: an abandoned draft quote is not a financial record and
-- leaving it undeletable would fill the list with noise. The policy's
-- USING clause is what enforces "never sent" — a numbered estimate is a
-- document a client has seen and keeps its row.
create policy estimates_delete on pilot.estimates for delete to authenticated
  using (
    account_id in (select pilot.current_account_ids())
    and status = 'draft'
    and estimate_number is null
    and converted_invoice_id is null
  );

create policy estimate_lines_select on pilot.estimate_lines for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy estimate_lines_insert on pilot.estimate_lines for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy estimate_lines_update on pilot.estimate_lines for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy estimate_lines_delete on pilot.estimate_lines for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- Grants.
--
-- THE REVOKE TRAP, for the fourth time in this repo: `revoke <priv> on
-- <table> from <role>` drops EVERY column-level privilege on that table,
-- and the following grant restores only what is listed. These are new
-- tables with no prior grants, so nothing is being dropped here — but any
-- later migration that revokes on them must re-grant the complete list
-- below, not just the column it meant to change.
-- ---------------------------------------------------------------------------
grant select on pilot.estimate_number_sequences to authenticated;

grant select, delete on pilot.estimates to authenticated;
-- INSERT is column-scoped: status, estimate_number, sent_at,
-- converted_invoice_id and converted_at are set by triggers and by
-- estimate_convert_to_invoice, never by a client. issued_on is absent for
-- the same reason — it is stamped on send.
grant insert (account_id, client_id, trip_id, valid_until, tax_rate_bps, terms, notes)
  on pilot.estimates to authenticated;
-- UPDATE is column-scoped too. `status` IS grantable here (unlike the
-- invoice equivalent's tighter list) because the pilot drives the whole
-- lifecycle from the UI — send, accept, decline — and estimates_protect
-- above is what constrains which transitions are legal. estimate_number,
-- sent_at, converted_invoice_id and converted_at stay ungrantable.
grant update (client_id, trip_id, status, valid_until, tax_rate_bps, terms, notes)
  on pilot.estimates to authenticated;

grant select, delete on pilot.estimate_lines to authenticated;
grant insert (account_id, estimate_id, line_type, description, quantity,
              unit_amount_cents, taxable, sort_order)
  on pilot.estimate_lines to authenticated;
grant update (line_type, description, quantity, unit_amount_cents, taxable, sort_order)
  on pilot.estimate_lines to authenticated;

grant select on pilot.estimate_totals, pilot.estimates_expired to authenticated;

revoke all on function pilot.next_estimate_number(uuid) from public;
grant execute on function pilot.next_estimate_number(uuid) to authenticated, service_role;
revoke all on function pilot.estimate_convert_to_invoice(uuid) from public;
grant execute on function pilot.estimate_convert_to_invoice(uuid) to authenticated, service_role;

grant select, insert, update, delete
  on pilot.estimate_number_sequences, pilot.estimates, pilot.estimate_lines
  to service_role;
grant select on pilot.estimate_totals, pilot.estimates_expired to service_role;
