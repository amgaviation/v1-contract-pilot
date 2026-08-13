-- ===========================================================================
-- Unbilled money, read-only — the per-client shape of "what have I not
-- billed yet".
--
-- WHAT THIS ADDS. Three SECURITY INVOKER read functions and nothing else.
-- No table, no column, no policy, no trigger, no write grant. Every
-- function here is `stable` and reads only rows the caller could already
-- read through the Data API; the entire purpose is to move an AGGREGATION
-- that the app was doing in JavaScript into the database, where it cannot
-- be silently truncated and where it has exactly one definition.
--
--   pilot.unbilled_trip_money(uuid)  one row per unbilled trip: its day
--                                    money, its billable day count, and
--                                    the rebillable receipts filed against
--                                    it. THE BASE DEFINITION.
--   pilot.unbilled_by_client(uuid)   the same rows rolled up per client.
--                                    Defined OVER the function above.
--   pilot.unbilled_summary(uuid)     one row, the account total. Defined
--                                    OVER unbilled_by_client.
--
-- THE CHAIN IS THE POINT, and it is why these are three functions rather
-- than three independently-written queries. Overview renders all three at
-- once — a headline total, a row per client, and a list of trips — and the
-- product's standing rule is that one figure has one source. Written as
-- three separate aggregates over pilot.trips they would agree today and
-- drift the first time one of them was edited. Written as a chain, the
-- client rows are BY CONSTRUCTION the trips regrouped, and the total is BY
-- CONSTRUCTION the sum of the client rows. A reviewer does not have to
-- check that they agree; there is no arrangement of the SQL in which they
-- can disagree.
--
-- ***************************************************************************
-- WHAT "UNBILLED" MEANS HERE, exactly, because the word has two plausible
-- readings and this file must commit to one.
--
-- IT MEANS: the work is not on an ISSUED invoice.
--
-- That is `pilot.trips.billing_state = 'unbilled'` and nothing else.
-- billing_state is trigger-owned (INSERT/UPDATE on it is revoked from
-- `authenticated`, 20260807010000; the sole writer is
-- pilot.invoices_sync_trip_billing_state, 20260807020000), and that trigger
-- fires on an invoice's STATUS CHANGE. So a trip sitting on somebody's
-- DRAFT invoice still reads 'unbilled' — correctly, because a draft bills
-- nothing and can be thrown away.
--
-- THE CONSEQUENCE, stated plainly rather than discovered later: a rebill
-- receipt that has already been pulled onto a draft invoice line is counted
-- here. It cannot be billed twice — pilot.invoice_lines carries
-- `unique (account_id, expense_id)` (20260805090000) — so this is not a
-- double-count risk, it is a "this money is not yet promised to anyone"
-- statement about a draft that may never be sent.
--
-- THE ALTERNATIVE WAS CONSIDERED AND REJECTED. A `not exists (select 1 from
-- invoice_lines l join invoices i ... where l.expense_id = e.id and
-- i.status <> 'void')` guard on the expense side would exclude receipts
-- already on a draft. It was not added, for one reason: THERE IS NO
-- EQUIVALENT GUARD AVAILABLE ON THE DAY SIDE. A trip's days on that same
-- draft would still count in full. Guarding one half of the figure and not
-- the other produces a number that is neither "not yet on any invoice" nor
-- "not yet issued" — it is a mixture, and a mixture cannot be explained to
-- a pilot in one sentence. One rule, applied to both halves: if the TRIP is
-- unbilled, everything attached to the trip is unbilled.
--
-- This also happens to be exactly what app/(app)/overview/page.tsx's
-- "Unbilled work" KPI already computed in JavaScript, which is what makes
-- repointing that KPI at pilot.unbilled_summary a change of SOURCE and not
-- a change of VALUE.
-- ***************************************************************************
--
-- ***************************************************************************
-- THE PRICING RULE IS MIRRORED, NOT REINVENTED. Read lib/trip-value.ts's
-- header before touching the day-money arithmetic below; this is the same
-- rule in SQL, and the two must be edited together or a screen will print a
-- number the invoice does not bill.
--
--   1. A trip WITH trip_days rows is priced from THEM. day_rate_cents,
--      day_count, travel_day_rate_cents and travel_day_count are ignored
--      entirely. A trip with no day rows falls back to those four scalars.
--   2. BILLABLE day types only (pilot.day_types.billable). An 'off' day is
--      part of the trip's shape, never a line.
--   3. GROUP FIRST, THEN ROUND. Rows are grouped by (day_type_id,
--      rate_cents) — the snapshotted rate, never re-resolved — and rounded
--      ONCE per group against the group's summed quantity. This is not
--      stylistic: createInvoiceDraft emits one invoice line per group and
--      pilot.invoice_lines.amount_cents is a generated column computing
--      `round(quantity * unit_amount_cents)`. Rounding per row instead
--      disagrees with the invoice by cents.
--   4. A row's contribution to its group's summed quantity is
--      `quantity * units`, because units is a RATE fraction and quantity a
--      TIME fraction (20260807070000). units does NOT join the grouping
--      key.
--   5. The summed quantity is rounded to 2 decimal places before it
--      multiplies the rate, mirroring roundQuantity() in lib/trip-value.ts
--      and app/(app)/invoices/actions.ts.
--
-- ROUNDING PARITY WITH JAVASCRIPT, since these numbers are compared against
-- figures other screens still compute in JS. There are TWO ways the two
-- sides can disagree, and both have to be closed — an earlier version of
-- this header addressed only the first and was wrong because of it.
--
--   1. TIE DIRECTION. Postgres `round(numeric)` is half-away-from-zero; JS
--      `Math.round` is half-up. Those differ only for NEGATIVE ties, and
--      every input here is non-negative by CHECK constraint — rate_cents >=
--      0, day_rate_cents >= 0, travel_day_rate_cents >= 0, quantity > 0,
--      units > 0, day_count >= 0, travel_day_count >= 0. So on this schema
--      the two tie rules coincide. If a future migration ever allows a
--      negative rate (a credit day), that stops being true and both
--      implementations need revisiting together.
--
--   2. WHAT IS BEING ROUNDED. This is the one that actually bit. Postgres
--      rounds the EXACT DECIMAL; JavaScript rounds the nearest DOUBLE, and
--      most values with three decimals have no exact double. `sum(td.quantity
--      * td.units)` below is exact — quantity is numeric(3,1) and units
--      numeric(3,2), so every product is an exact multiple of 0.001 — while
--      `0.5 * 0.29` in JS is 0.14499999999999999, a hair BELOW the 0.145 the
--      column pair actually holds. Rounding to 2dp then gives 0.14 in JS and
--      0.15 here: a hundredth of a day, which at a $1,200 day rate is $12.00
--      of disagreement between this figure and the invoice the pilot drafts.
--      Ten single-row (quantity, units) pairs inside the CHECK bounds
--      diverge that way, and roughly 1% of multi-row group sums do.
--
--      CLOSED BY MAKING THE JS SIDE EXACT, not by making this side float:
--      lib/trip-value.ts and createInvoiceDraft accumulate each group's
--      quantity in INTEGER THOUSANDTHS (dayQuantityThousandths) and round
--      with integer arithmetic, so they compute what `numeric` computes on
--      every value the schema can hold rather than on the values someone
--      happened to try. tests/unbilled-money.test.mjs §7 pins that against
--      exact BigInt arithmetic over the whole CHECKed domain. Moving this
--      SQL to float8 to mirror JS was the alternative and was rejected:
--      the exact decimal is the value the pilot's own day grid states, and
--      the invoice must bill it.
--
--      SO: if you change the arithmetic on either side, change it on both,
--      and keep it exact on both.
--
-- WHAT THE DAY MONEY DELIBERATELY EXCLUDES, identical to lib/trip-value.ts:
-- per-diem lines, the contract-minimum adjustment, and monthly guarantees.
-- createInvoiceDraft adds all three on top. So `day_value_cents +
-- rebill_expense_cents` is what these screens have always meant by a trip's
-- unbilled value — it is NOT a promise about the invoice's final total, and
-- no UI copy built on it may claim to be.
-- ***************************************************************************
--
-- WHY SECURITY INVOKER, following pilot.ledger_balances (20260812100000 §7)
-- and pilot.trip_committed_invoice (20260807020000). These read the
-- caller's own rows under the caller's own RLS. The explicit
-- `target_account_id` predicate is belt-and-braces on top of RLS, exactly
-- as ledger_balances does it: passing another tenant's account id returns
-- zero rows because the policies filter them, not because this function
-- checked — which is what keeps it from being a cross-tenant existence
-- oracle.
--
-- WHY AGGREGATE IN THE DATABASE AT ALL. The Data API caps a plain select
-- (commonly 1000 rows) and TRUNCATES SILENTLY — no error, just a shorter
-- array. Overview's unbilled total was summed in JS over a raw
-- `expenses` read bounded at 1000, so a pilot with 1,400 receipts had a
-- headline figure quietly built from an arbitrary 1,000 of them. A pilot
-- with 1,001 unbilled trips had the same problem on the trips read.
-- pilot.unbilled_summary returns exactly ONE row no matter how many trips,
-- days or receipts stand behind it, so that class of error is not
-- mitigated here — it is structurally absent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE BASE DEFINITION — one row per unbilled trip.
--
-- Trip grain: status = 'completed' AND billing_state = 'unbilled'. Both
-- halves matter. 'completed' is the same filter Overview's "Ready to
-- invoice" list has always used, and widening it would put unflown work in
-- front of a pilot as billable money; a scheduled trip is not revenue.
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
      -- any trip_days row — NOT on whether any BILLABLE row survived the
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
  ),
  day_groups as (
    -- One row per (trip, day type, snapshotted rate) — the same grouping
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
    -- already-on-an-invoice guard — see this file's header for the full
    -- reasoning, which is that the day side has no equivalent guard and a
    -- half-guarded figure is unexplainable.
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
    -- client is still unbilled money. Nulled out rather than dropped —
    -- dropping it would make the client rows sum to less than the total,
    -- which is the one thing this whole file exists to prevent. The screen
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
      -- The explicit ::numeric casts are not decoration — `round(bigint)`
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
  'One row per completed, not-yet-invoiced trip: billable day count, day money (mirrors lib/trip-value.ts exactly), and rebillable receipts filed against it. The base definition unbilled_by_client and unbilled_summary are both derived from.';

revoke all on function pilot.unbilled_trip_money(uuid) from public;
grant execute on function pilot.unbilled_trip_money(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. PER CLIENT — the shape the Overview module renders.
--
-- Defined over the function above, not over pilot.trips, so a client row is
-- arithmetically the trips regrouped and cannot drift from them.
-- ---------------------------------------------------------------------------
create or replace function pilot.unbilled_by_client(target_account_id uuid)
returns table (
  client_id uuid,
  client_name text,
  trip_count bigint,
  billable_days numeric,
  day_value_cents bigint,
  rebill_expense_cents bigint,
  total_cents bigint,
  oldest_ends_on date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.client_id,
    -- max() rather than a second GROUP BY column: client_name is
    -- functionally dependent on client_id, and grouping by both would split
    -- one client into two rows if the name were ever ambiguous. Reads null
    -- for the no-client bucket, which is what the screen labels.
    max(t.client_name),
    count(*)::bigint,
    coalesce(sum(t.billable_days), 0),
    coalesce(sum(t.day_value_cents), 0)::bigint,
    coalesce(sum(t.rebill_expense_cents), 0)::bigint,
    coalesce(sum(t.day_value_cents + t.rebill_expense_cents), 0)::bigint,
    -- The oldest trip END date in this bucket. "Oldest" is measured from
    -- ends_on, not starts_on: a trip that started earlier but finished
    -- later has been billable for LESS time, and Overview's KPI has always
    -- measured staleness from the end of the work.
    min(t.ends_on)
  from pilot.unbilled_trip_money(target_account_id) t
  -- GROUP BY treats every null client_id as one group, so the no-client
  -- bucket is exactly one row rather than one row per orphaned trip.
  group by t.client_id
$$;

comment on function pilot.unbilled_by_client(uuid) is
  'Unbilled trip money rolled up per client, including a single null-client bucket. Derived from pilot.unbilled_trip_money so the rows can never disagree with the trips behind them.';

revoke all on function pilot.unbilled_by_client(uuid) from public;
grant execute on function pilot.unbilled_by_client(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. THE ACCOUNT TOTAL — one row, always.
--
-- An ungrouped aggregate returns exactly one row even over an empty input,
-- so a caller never has to distinguish "no row came back" from "nothing is
-- unbilled". Zeros here are real zeros; a FAILED read is an error the
-- caller must render as an error, never as this shape.
-- ---------------------------------------------------------------------------
create or replace function pilot.unbilled_summary(target_account_id uuid)
returns table (
  client_count bigint,
  trip_count bigint,
  billable_days numeric,
  day_value_cents bigint,
  rebill_expense_cents bigint,
  total_cents bigint,
  oldest_ends_on date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    -- One per bucket returned by unbilled_by_client, so the no-client
    -- bucket counts as a bucket. The sentence this feeds says "across N
    -- clients"; the screen adjusts that wording when a null bucket is
    -- present rather than quietly calling "no client" a client.
    count(*)::bigint,
    coalesce(sum(c.trip_count), 0)::bigint,
    coalesce(sum(c.billable_days), 0),
    coalesce(sum(c.day_value_cents), 0)::bigint,
    coalesce(sum(c.rebill_expense_cents), 0)::bigint,
    coalesce(sum(c.total_cents), 0)::bigint,
    min(c.oldest_ends_on)
  from pilot.unbilled_by_client(target_account_id) c
$$;

comment on function pilot.unbilled_summary(uuid) is
  'The account-wide unbilled total, in one row. Derived from pilot.unbilled_by_client, which is derived from pilot.unbilled_trip_money — so the headline figure is by construction the sum of the client rows shown beneath it.';

revoke all on function pilot.unbilled_summary(uuid) from public;
grant execute on function pilot.unbilled_summary(uuid) to authenticated, service_role;
