-- ===========================================================================
-- pilot.clients.you_invoice - a counterparty you fly for but never bill.
--
-- THE SEQUENCE THIS FIXES. A contract pilot completes basic indoc for an
-- operator weeks before flying a trip for them, and often for an operator
-- that never sends a single trip. pilot.operator_qualifications.client_id
-- is `not null` (20260807060000), so recording that indoc, a 135.293
-- competency check or a 135.297 IPC already required the operator to exist
-- as a row in pilot.clients. That part is right: a qualification is held
-- under a specific operator's certificate and has to name one. What was
-- wrong is that every row in pilot.clients was assumed to be somebody you
-- send bills to, so recording a training event dragged a brand new billing
-- relationship into the invoice and estimate pickers, the A/R aging
-- buckets, the statements and the unbilled queue.
--
-- WHY NOT A SEPARATE `operators` TABLE. One counterparty table stays
-- correct. An operator you fly for often becomes one you invoice, and a
-- second table would duplicate the whole Part 135 qualification model and
-- force a merge flow the first time a training relationship turned into a
-- paying one. 20260807060000's own header already settled this ("no
-- separate `operators` table. A client IS the operator for v1"); this
-- migration keeps that decision and fixes the thing that actually hurt,
-- which is that the table had no way to say "I do not bill this one".
--
-- WHY operator_qualifications.client_id STAYS `not null`, so nobody lifts
-- it later thinking it was an oversight:
--
--   1. A qualification is always FOR an operator. A row with no operator
--      is a statement about nobody's certificate.
--   2. The table carries this constraint:
--        unique (account_id, client_id, requirement, type_designator)
--      Postgres treats two NULLs as distinct in a
--      unique constraint, so a nullable client_id would silently permit
--      unlimited duplicate rows for the same requirement, which is the
--      exact failure the same migration's type_designator column is
--      declared `not null default ''` to avoid. Making client_id nullable
--      does not loosen a restriction; it disables a constraint.
--
-- THE COLUMN IS NAMED FOR WHAT IT MEANS TO A PILOT. `you_invoice` reads
-- as the sentence the form asks ("You invoice this client"), and it is
-- TRUE by default so every pre-existing row keeps behaving exactly as it
-- does today: nothing leaves anyone's A/R, no picker loses an option, no
-- statement changes. Turning it off is reversible at any time.
--
-- WHAT TURNING IT OFF DOES, in one sentence: the client stops appearing
-- where you pick somebody to bill, and keeps everything else. Trips,
-- documents, operator qualifications, rate overrides and the credential
-- packet are all untouched by this column, in the database and on screen.
--
-- ---------------------------------------------------------------------------
-- MARKING A CLIENT THAT ALREADY HAS INVOICES: REFUSED, and why refusal is
-- the coherent option rather than the lazy one.
--
-- The alternative is "handle it": keep the invoices, hide the client from
-- the pickers, and decide what A/R does. Both endings of that are wrong.
-- Hiding their open invoices from A/R aging makes money the pilot is owed
-- disappear from the one screen whose job is to total it, on a checkbox
-- with no mention of money in its label. Keeping them in A/R leaves a
-- client the product has been told is not billed sitting in the aging
-- buckets, in the statements and on the overdue ladder, so the flag would
-- mean "not billed, except everywhere it counts".
--
-- Refusal has neither ending and one extra property that is worth more
-- than the convenience: it makes an INVARIANT true, rather than a habit.
-- Every invoice, estimate and recurring schedule in the database belongs
-- to a client with you_invoice = true. That is what lets the invoice and
-- estimate client pickers filter on this column with a bare equality and
-- no risk of a draft losing its own currently selected client, and it is
-- why A/R aging and the statements need no filter at all: the rows they
-- aggregate cannot belong to a non-invoiced client.
--
-- Estimates and recurring schedules count for the same reason invoices do.
-- An estimate is a quote you sent somebody, and a recurring schedule is a
-- standing instruction to generate invoices, which would otherwise keep
-- billing a client the pilot had just said they do not bill.
--
-- The pilot who wants a billed client out of their pickers already has the
-- feature for it, and it is the right one: archive them.
--
-- The invariant is enforced from BOTH directions, because one direction is
-- only a habit:
--   pilot.clients_refuse_stop_invoicing()  refuses you_invoice -> false
--                                          while paperwork exists.
--   pilot.refuse_billing_a_non_invoiced_client()
--                                          refuses new invoices, estimates
--                                          and schedules pointed at a
--                                          client with you_invoice = false.
-- Without the second one the guarantee would rest on every current and
-- future call site remembering to filter its picker.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- RLS IS UNCHANGED, AND HERE IS THE PROOF.
--
-- This file creates no policy, drops no policy and alters no policy. It
-- does not touch `alter table ... enable row level security` anywhere.
-- Every table it references (pilot.clients, pilot.invoices,
-- pilot.estimates, pilot.recurring_invoice_schedules, pilot.trips) keeps
-- the policies it already had, unchanged in text and in count. Grep this
-- file for `policy` and the only hits are in comments.
--
-- Postgres RLS is row level and has no column granularity, so ADDING a
-- column cannot widen a policy: `account_id in (select
-- pilot.current_account_ids())` selects exactly the rows it selected
-- before. What a column addition CAN widen is the column-scoped GRANT,
-- which is the real write boundary on this schema, so the two grants at
-- the bottom name `you_invoice` and nothing else. No revoke is issued
-- first: a revoke on a table drops every column privilege at once, which
-- is the mistake this directory's README records.
--
-- Both trigger functions below are `security invoker` and
-- `set search_path = ''`. Invoker matters: the guard's `exists` runs under
-- the CALLER's own RLS, so it can only see the caller's own invoices,
-- estimates and schedules. That is not a hole, it is exactly enough, and
-- the reason is the composite foreign keys this schema has used since
-- Phase 1. pilot.invoices, pilot.estimates and
-- pilot.recurring_invoice_schedules each reference a client by
-- (account_id, client_id), so every row that can possibly reference this
-- client is in this client's own account, and the caller can read every
-- row in their own account. There is no row the guard could miss.
-- SECURITY DEFINER would have read the same rows with more privilege, and
-- would additionally have turned the guard into a cross-tenant existence
-- oracle. It is not used.
-- ---------------------------------------------------------------------------
--
-- SAFE ON A LIVE DATABASE. Additive only. `add column ... not null default
-- true` does not rewrite the table on Postgres 11 and later: a non-volatile
-- default is stored in the catalog and materialised as rows are written, so
-- this is a brief ACCESS EXCLUSIVE lock on the catalog entry and nothing
-- more, however many clients exist. No index is created, so there is no
-- long-running build to hold that lock open. No existing column, constraint,
-- policy or grant is dropped or narrowed.
--
-- NO INDEX ON THE NEW COLUMN, deliberately. A pilot's client list is small
-- (app/(app)/clients/page.tsx caps its read at 1000 and calls that a
-- boundary worth showing, not a paging problem), every query that filters
-- on you_invoice is already scoped to one account by RLS, and a boolean
-- with almost every row on one side of it is close to the worst possible
-- index key. Add one when a plan shows it is needed, not before.
-- ===========================================================================

alter table pilot.clients
  add column if not exists you_invoice boolean not null default true;

comment on column pilot.clients.you_invoice is
  'False means a counterparty the pilot flies for and never bills: an operator whose indoc, 135.293 competency check and 135.297 IPC they hold, with no billing relationship. Such a client is excluded from the invoice and estimate pickers, and by construction from A/R aging, statements and the unbilled queue, and keeps its trips, documents, rate overrides and operator qualifications. TRUE for every pre-existing row and for every new client by default, so nothing already in A/R is affected. Setting it to false is refused while the client has any invoice, estimate or recurring schedule (pilot.clients_refuse_stop_invoicing) and pointing any of those three at a false client is refused too (pilot.refuse_billing_a_non_invoiced_client); together those keep the invariant that every billing document belongs to a client with you_invoice = true. Reversible at any time.';

-- ---------------------------------------------------------------------------
-- Direction 1: you cannot stop invoicing a client you have already billed.
-- ---------------------------------------------------------------------------
create or replace function pilot.clients_refuse_stop_invoicing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only the true -> false transition is guarded. Turning the flag back
  -- on is always allowed (the mark is reversible), and an update that
  -- does not move the flag must not pay for these three lookups.
  if new.you_invoice or not old.you_invoice then
    return new;
  end if;

  if exists (
    select 1 from pilot.invoices i
    where i.account_id = old.account_id and i.client_id = old.id
  ) then
    raise exception
      'client % has invoices, so it cannot be marked as one you do not invoice', old.id
      using hint = 'Archive the client instead. Archiving keeps the invoices and takes the client out of new work.';
  end if;

  if exists (
    select 1 from pilot.estimates e
    where e.account_id = old.account_id and e.client_id = old.id
  ) then
    raise exception
      'client % has estimates, so it cannot be marked as one you do not invoice', old.id
      using hint = 'Archive the client instead, or delete the estimates first.';
  end if;

  if exists (
    select 1 from pilot.recurring_invoice_schedules s
    where s.account_id = old.account_id and s.client_id = old.id
  ) then
    raise exception
      'client % has a recurring invoice schedule, so it cannot be marked as one you do not invoice', old.id
      using hint = 'Delete the schedule first. A schedule left in place would keep generating invoices for a client you had just said you do not bill.';
  end if;

  return new;
end;
$$;

comment on function pilot.clients_refuse_stop_invoicing() is
  'Refuses pilot.clients.you_invoice true -> false while the client has any invoice, estimate or recurring schedule. See 20260815120000''s header for why refusal rather than hiding: it makes "every billing document belongs to a client with you_invoice = true" an invariant, which is what lets the pickers filter on a bare equality and lets A/R aging and the statements need no filter at all. The APP produces the sentence a pilot reads (app/(app)/clients/actions.ts checks the same three tables first); this trigger is the backstop that also catches the concurrent case, where an invoice is created between that check and this write.';

create trigger clients_refuse_stop_invoicing
  before update on pilot.clients
  for each row execute function pilot.clients_refuse_stop_invoicing();

-- ---------------------------------------------------------------------------
-- Direction 2: you cannot bill a client you have said you do not bill.
--
-- One function, three triggers. Without this half, the invariant would
-- rest on every current and future picker remembering to filter, and a
-- crafted post to a create action would walk straight past all of them.
-- ---------------------------------------------------------------------------
create or replace function pilot.refuse_billing_a_non_invoiced_client()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invoiced boolean;
begin
  -- FOR SHARE, AND THE INVARIANT DEPENDS ON IT.
  --
  -- A plain SELECT here left a race that neither trigger could see. Under
  -- READ COMMITTED, with A doing "stop invoicing client X" and B inserting
  -- an invoice for X:
  --
  --   A updates pilot.clients, taking FOR NO KEY UPDATE on X, and its
  --   trigger counts billing rows and finds none, because B has not
  --   committed.
  --   B inserts. Its foreign key takes FOR KEY SHARE on X, which does NOT
  --   conflict with FOR NO KEY UPDATE, because you_invoice is not a key
  --   column. Its trigger reads the still-committed you_invoice = true and
  --   allows the write.
  --
  -- Both commit and a billing document is attached to a client marked as
  -- one you do not invoice, which is exactly the invariant the pickers and
  -- the unfiltered A/R aging rely on.
  --
  -- FOR SHARE conflicts with FOR NO KEY UPDATE, so the two serialise in
  -- whichever order they arrive, and the loser sees the winner's committed
  -- state and refuses:
  --   A first: B blocks on the lock, then reads you_invoice = false and
  --     raises below.
  --   B first: A blocks on its own UPDATE, then its count sees B's row and
  --     clients_refuse_stop_invoicing() raises.
  -- FOR SHARE rather than FOR UPDATE because this transaction only reads
  -- the client; it must block the flag flipping under it, not claim the
  -- right to write the row.
  select c.you_invoice into invoiced
  from pilot.clients c
  where c.account_id = new.account_id and c.id = new.client_id
  for share;

  -- No row found means the composite foreign key is about to reject this
  -- write anyway, or RLS hid the client from this caller. Either way the
  -- honest answer is to say nothing and let the constraint layer speak.
  if invoiced is null or invoiced then
    return new;
  end if;

  raise exception
    'client % is marked as one you do not invoice, so it cannot be billed', new.client_id
    using hint = 'Turn "You invoice this client" back on for that client first.';
end;
$$;

comment on function pilot.refuse_billing_a_non_invoiced_client() is
  'Refuses an insert or a client re-point on pilot.invoices, pilot.estimates and pilot.recurring_invoice_schedules when the target client has you_invoice = false. The other half of the invariant pilot.clients_refuse_stop_invoicing() enforces; see 20260815120000''s header.';

create trigger invoices_refuse_non_invoiced_client
  before insert or update of client_id on pilot.invoices
  for each row execute function pilot.refuse_billing_a_non_invoiced_client();

create trigger estimates_refuse_non_invoiced_client
  before insert or update of client_id on pilot.estimates
  for each row execute function pilot.refuse_billing_a_non_invoiced_client();

create trigger recurring_invoice_schedules_refuse_non_invoiced_client
  before insert or update of client_id on pilot.recurring_invoice_schedules
  for each row execute function pilot.refuse_billing_a_non_invoiced_client();

-- ---------------------------------------------------------------------------
-- THE UNBILLED QUEUE.
--
-- pilot.unbilled_trip_money (20260813010000) is the BASE of a three-step
-- derivation chain: unbilled_by_client is defined over it and
-- unbilled_summary over that, so the headline total on Overview is by
-- construction the sum of the client rows beneath it. That is why this
-- exclusion is applied HERE and not in the app. Filtering the client rows
-- on the screen while the headline still summed every trip would produce a
-- total that disagrees with the rows printed under it, which is the exact
-- defect that file's whole design exists to prevent.
--
-- WHAT CHANGED: one predicate in the `unbilled` CTE. Everything else in
-- this function is byte-for-byte the 20260813010000 definition, comments
-- included, because a `create or replace` restates the whole body and a
-- silent edit to the day-money arithmetic here would be invisible in a
-- diff of a new file. Read that migration's header before touching the
-- pricing rule; it is mirrored in lib/trip-value.ts and the two must move
-- together.
--
-- WHY THE PREDICATE IS `not exists (... and not c.you_invoice)` rather
-- than a join to c.you_invoice: pilot.trips.client_id is NULLABLE, and a
-- trip with no client is still unbilled money that must keep counting. The
-- negative form leaves those rows in (no client row matches, so nothing is
-- excluded) without a second null branch to get wrong.
--
-- WHAT THIS MEANS ON SCREEN: work flown for an operator you do not bill
-- stops appearing as money waiting to be invoiced, because it is not.
-- It stays a trip, in the trip list, with its days and its logbook entries.
-- ---------------------------------------------------------------------------
create or replace function pilot.unbilled_trip_money(target_account_id uuid)
returns table (
  trip_id uuid,
  client_id uuid,
  client_name text,
  starts_on date,
  ends_on date,
  aircraft_ident text,
  billable_days numeric,
  day_value_cents bigint,
  rebill_expense_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with unbilled as (
    select
      t.account_id,
      t.id,
      t.client_id,
      t.starts_on,
      t.ends_on,
      t.aircraft_ident,
      t.day_rate_cents,
      t.day_count,
      t.travel_day_rate_cents,
      t.travel_day_count,
      -- The day-rows-vs-scalars switch, evaluated on the RAW presence of
      -- any trip_days row, NOT on whether any BILLABLE row survived the
      -- join below. lib/trip-value.ts branches on `dayRows.length > 0`
      -- before it filters by billable, so a trip whose grid is entirely
      -- 'off' days prices at $0 there and must price at $0 here. Branching
      -- on the filtered set instead would silently fall back to the scalar
      -- columns and bill a trip the pilot marked as not billable.
      exists (
        select 1
        from pilot.trip_days td
        where td.account_id = t.account_id
          and td.trip_id = t.id
      ) as has_day_rows
    from pilot.trips t
    where t.account_id = target_account_id
      and t.status = 'completed'
      and t.billing_state = 'unbilled'
      -- 20260815120000. Work for a counterparty the pilot does not bill is
      -- not money waiting to be invoiced. See this migration's header for
      -- why the predicate is negative rather than a join.
      and not exists (
        select 1
        from pilot.clients c
        where c.account_id = t.account_id
          and c.id = t.client_id
          and not c.you_invoice
      )
  ),
  day_groups as (
    -- One row per (trip, day type, snapshotted rate), the same grouping
    -- key createInvoiceDraft emits one invoice line for.
    --
    -- `qty` is rounded to 2dp HERE, once per group, before it ever
    -- multiplies a rate: pilot.trip_days.quantity is numeric(3,1) and
    -- units numeric(3,2), so the product carries three decimals that the
    -- invoice line's own quantity never will. Mirrors roundQuantity().
    --
    -- `days` is the summed bare QUANTITY, deliberately WITHOUT units.
    -- quantity is time worked; units is the fraction of the rate that time
    -- bills at. "Six unbilled trip days" is a statement about days flown,
    -- and a travel day paid at half rate is still one day away from home.
    select
      td.trip_id,
      td.day_type_id,
      td.rate_cents,
      round(sum(td.quantity * td.units), 2) as qty,
      sum(td.quantity) as days
    from pilot.trip_days td
    join unbilled u
      on u.account_id = td.account_id
     and u.id = td.trip_id
    join pilot.day_types dt
      on dt.account_id = td.account_id
     and dt.id = td.day_type_id
    where dt.billable
    group by td.trip_id, td.day_type_id, td.rate_cents
  ),
  grid as (
    -- Round once per group, THEN sum the groups. Summing first and
    -- rounding once at the end would be a different (and wrong) number.
    select
      g.trip_id,
      sum(round(g.qty * g.rate_cents))::bigint as value_cents,
      sum(g.days) as days
    from day_groups g
    group by g.trip_id
  ),
  rebill as (
    -- Rebillable receipts filed against an unbilled trip. No
    -- already-on-an-invoice guard, per 20260813010000's header: the day
    -- side has no equivalent guard and a half-guarded figure cannot be
    -- explained to a pilot in one sentence.
    --
    -- pilot.expenses CHECKs `treatment <> 'rebill' or trip_id is not null`,
    -- so every row this can match has a trip; the join is what scopes it to
    -- the unbilled ones.
    select
      e.trip_id,
      sum(e.amount_cents)::bigint as cents
    from pilot.expenses e
    join unbilled u
      on u.account_id = e.account_id
     and u.id = e.trip_id
    where e.treatment = 'rebill'
    group by e.trip_id
  )
  select
    u.id,
    u.client_id,
    -- LEFT join: pilot.trips.client_id is nullable, and a trip with no
    -- client is still unbilled money. Nulled out rather than dropped;
    -- dropping it would make the client rows sum to less than the total,
    -- which is the one thing that whole file exists to prevent. The screen
    -- renders the null bucket as "No client".
    c.name,
    u.starts_on,
    u.ends_on,
    u.aircraft_ident,
    case
      when u.has_day_rows then coalesce(gr.days, 0)
      else u.day_count + coalesce(u.travel_day_count, 0)
    end,
    case
      when u.has_day_rows then coalesce(gr.value_cents, 0)
      -- The scalar fallback, mirroring lib/trip-value.ts: each half
      -- rounded independently, a null travel rate or count reading as 0.
      -- The explicit ::numeric casts are not decoration. `round(bigint)`
      -- is ambiguous in Postgres (bigint casts implicitly to both numeric
      -- and double precision) and would fail to resolve at create time.
      else (
        round(u.day_rate_cents::numeric * u.day_count)
        + round(coalesce(u.travel_day_rate_cents, 0)::numeric
                * coalesce(u.travel_day_count, 0))
      )::bigint
    end,
    coalesce(r.cents, 0)
  from unbilled u
  left join pilot.clients c
    on c.account_id = u.account_id
   and c.id = u.client_id
  left join grid gr on gr.trip_id = u.id
  left join rebill r on r.trip_id = u.id
  -- Oldest work first. The caller renders only the first handful, and
  -- "the first handful" has to mean "the ones that have been waiting
  -- longest" rather than whatever order the planner happened to produce.
  order by u.starts_on, u.ends_on, u.id
$$;

comment on function pilot.unbilled_trip_money(uuid) is
  'One row per completed, not-yet-invoiced trip flown for a client you invoice: billable day count, day money (mirrors lib/trip-value.ts exactly), and rebillable receipts filed against it. The base definition unbilled_by_client and unbilled_summary are both derived from. 20260815120000 excluded trips whose client has you_invoice = false; trips with no client at all still count.';

-- ---------------------------------------------------------------------------
-- GRANTS. Additive, column-scoped, and NO revoke first: a revoke on a
-- table drops every column privilege on it at once. Same shape as every
-- prior column added to this table (20260807000000, 20260807040000,
-- 20260813130000, 20260814092000).
--
-- SELECT is already granted table-wide, so it is not restated here.
-- created_at/updated_at/id stay withheld exactly as before.
-- ---------------------------------------------------------------------------
grant insert (you_invoice) on pilot.clients to authenticated;
grant update (you_invoice) on pilot.clients to authenticated;
