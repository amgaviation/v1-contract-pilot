-- ===========================================================================
-- pilot.trip_list_value — one priced row per trip, for the /trips LIST.
--
-- THE PROBLEM. app/(app)/trips/page.tsx used to price the Value column by
-- reading trip_days for every listed trip with a single `.in("trip_id",
-- tripIds)` and pricing each trip in JavaScript via lib/trip-value.ts. That
-- read is capped at DAY_ROW_LIMIT=1000 rows TOTAL, across every trip on the
-- page, and on an exact-cap hit the page (correctly) hides the whole Value
-- column rather than show an undercount. The honesty is not the defect; the
-- PERMANENCE is. A working pilot fills roughly 300-400 day rows a year, so
-- by year three the account's day-row count exceeds 1000 and the Value
-- column is gone on every single visit from then on — not a transient
-- failure, a one-way trip into "this product no longer shows what trips are
-- worth." pilot.unbilled_trip_money (20260813010000) solved exactly this
-- class of problem for Overview by moving the aggregation into SQL, where a
-- plain select is capped but an aggregate function returns one row per trip
-- no matter how many day rows sit behind it. This does the same for the
-- trips list.
--
-- WHY A SEPARATE FUNCTION FROM pilot.unbilled_trip_money, RATHER THAN
-- REUSING IT. unbilled_trip_money's trip grain is deliberately narrow —
-- `status = 'completed' and billing_state = 'unbilled'` — because it feeds
-- Overview's "money you haven't billed yet" figure and a scheduled or
-- already-invoiced trip is neither. The trips list shows EVERY trip
-- (scheduled, in progress, completed, canceled, invoiced, paid) and needs a
-- Value for all of them — a pilot scanning the list wants to see what a
-- still-scheduled trip is slated to bill just as much as a completed one.
-- Narrowing unbilled_trip_money's filter to serve this caller would widen
-- what "unbilled" means for Overview; adding a second, unfiltered function
-- is what keeps each screen's grain honest. THE ARITHMETIC ITSELF IS NOT
-- reinvented — every rule below (day-rows-vs-scalar switch, billable-only,
-- group-by (day_type_id, rate_cents), group-first-then-round, quantity *
-- units, rounding parity with lib/trip-value.ts) is copied verbatim from
-- unbilled_trip_money's base CTE. If you change the pricing rule, change it
-- in BOTH functions and in lib/trip-value.ts — see that file's header for
-- the full rounding-parity argument.
--
-- WHY SECURITY INVOKER, GRAIN, AND ORDERING all match
-- pilot.unbilled_trip_money — see that migration's header for the
-- SECURITY INVOKER reasoning (a DEFINER form would be a cross-tenant
-- existence oracle) and the Data-API-truncation reasoning (this returns one
-- row per trip regardless of how many trip_days rows back it, so the class
-- of bug this migration exists to close is structurally absent rather than
-- merely detected). `billable_days` is `sum(td.quantity * td.units) filter
-- (where dt.billable)`, rounded to 2dp ONCE — the same figure
-- lib/trip-value.ts's tripDayQuantity() computes in JS and pilot.trip_pl's
-- day_quantity column computes for the P&L report; not bit-identical to
-- either NECESSARILY (trip_pl documents up to n * 0.005 days of drift on a
-- multi-group trip, a denominator-only concern), but the SAME RULE.
-- ===========================================================================

create or replace function pilot.trip_list_value(target_account_id uuid)
returns table (
  trip_id uuid,
  -- Lets the caller apply the SAME "fall back to the scalar day count only
  -- when there are no rows" precedence app/(app)/trips/[id]/page.tsx now
  -- applies for the trip detail headline (lib/trip-value.ts's
  -- tripDayQuantity). billable_days below is GRID-ONLY — null when this is
  -- false — so the list keeps reading trips.day_count for a scalar trip
  -- exactly as it already does, rather than this function inventing a
  -- second definition of the scalar figure.
  has_day_rows boolean,
  billable_days numeric,
  day_value_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select
      t.id,
      t.day_rate_cents,
      t.day_count,
      t.travel_day_rate_cents,
      t.travel_day_count,
      -- Same "raw presence, not filtered presence" rule as
      -- unbilled_trip_money: a trip whose grid is entirely non-billable
      -- 'off' days has rows and must price at $0, not silently fall back
      -- to the scalar columns.
      exists (
        select 1
        from pilot.trip_days td
        where td.account_id = t.account_id
          and td.trip_id = t.id
      ) as has_day_rows
    from pilot.trips t
    where t.account_id = target_account_id
  ),
  day_groups as (
    select
      td.trip_id,
      td.day_type_id,
      td.rate_cents,
      round(sum(td.quantity * td.units), 2) as qty,
      sum(td.quantity) as days
    from pilot.trip_days td
    join base b on b.id = td.trip_id
    join pilot.day_types dt
      on dt.account_id = td.account_id
     and dt.id = td.day_type_id
    where dt.billable
      and td.account_id = target_account_id
    group by td.trip_id, td.day_type_id, td.rate_cents
  ),
  grid as (
    -- Round once per group, THEN sum the groups — identical order of
    -- operations to unbilled_trip_money's `grid` CTE, for the same reason:
    -- summing first and rounding once at the end is a DIFFERENT (and
    -- wrong) number.
    select
      g.trip_id,
      sum(round(g.qty * g.rate_cents))::bigint as value_cents,
      sum(g.days) as days
    from day_groups g
    group by g.trip_id
  )
  select
    b.id,
    b.has_day_rows,
    case when b.has_day_rows then coalesce(gr.days, 0) else null end,
    case
      when b.has_day_rows then coalesce(gr.value_cents, 0)
      else (
        round(b.day_rate_cents::numeric * b.day_count)
        + round(coalesce(b.travel_day_rate_cents, 0)::numeric
                * coalesce(b.travel_day_count, 0))
      )::bigint
    end
  from base b
  left join grid gr on gr.trip_id = b.id
$$;

comment on function pilot.trip_list_value(uuid) is
  'One priced row per trip in the account (every status, every billing_state) — has_day_rows, GRID-ONLY billable day count (null when has_day_rows is false — the caller falls back to trips.day_count itself, same precedence as lib/trip-value.ts), and day money mirroring lib/trip-value.ts / pilot.unbilled_trip_money''s arithmetic exactly, without their completed/unbilled filter. Exists so the /trips list Value and Days columns cannot be truncated by the Data API''s 1000-row cap the way a raw trip_days .in() read can. SECURITY INVOKER: reads only the caller''s own rows under RLS.';

revoke all on function pilot.trip_list_value(uuid) from public;
grant execute on function pilot.trip_list_value(uuid) to authenticated, service_role;

-- ===========================================================================
-- gap S: 'hold' joins the trip status vocabulary.
--
-- WHY. A contract pilot routinely carries soft holds — dates a client asks
-- them to block before the job is confirmed — that block the calendar
-- without being sales. Before this, a hold had to be entered as 'scheduled'
-- (indistinguishable from confirmed work) or kept out of the system
-- entirely (invisible to the one screen — /trips — meant to answer "am I
-- actually free that week").
--
-- WHY THIS IS CHEAP. Every revenue-facing consumer of trips.status in this
-- codebase allow-lists SPECIFIC values it cares about rather than
-- excluding 'canceled' — pilot.unbilled_trip_money and
-- pilot.trip_committed_invoice both require `status = 'completed'`; the
-- invoice trip picker (app/(app)/invoices/new/page.tsx) and Overview's
-- "flown but not yet invoiced" / "still marked scheduled" panels both
-- `.in("status", [...])` an explicit list. None of those lists include
-- 'hold', so a hold trip is automatically excluded from every unbilled/
-- invoice path and every "you still owe an action here" nag — nothing
-- downstream needs to change for a hold to be inert everywhere it should
-- be. It only becomes visible where app/(app)/trips/** (this cluster's own
-- territory) explicitly renders it: the status picker and the Days column
-- badge.
--
-- WHAT WAS CHECKED AND LEFT ALONE: app/(app)/logbook/actions.ts and
-- app/(app)/reports/year-end/travel-log.ts both test `trip.status ===
-- "completed"` / `=== "canceled"` — equality checks, not exhaustive
-- switches, so a 'hold' trip just fails both the same way a 'scheduled'
-- one always has. travel-log.ts's own TypeScript union type
-- (`"scheduled" | "in_progress" | "completed" | "canceled"`) is now
-- one value stale — outside this migration's file allowlist to fix, and
-- inert at runtime (it types a DB read, not an exhaustiveness check).
-- ===========================================================================
alter table pilot.trips
  drop constraint if exists trips_status_check,
  add constraint trips_status_check
    check (status in ('scheduled', 'in_progress', 'completed', 'canceled', 'hold'));

comment on column pilot.trips.status is
  'scheduled | in_progress | completed | canceled | hold. ''hold'' (added 20260814094000) is a tentative, unconfirmed block on the calendar — it deliberately behaves like ''canceled'' to every revenue path (pilot.unbilled_trip_money, pilot.trip_committed_invoice and the invoice trip picker all require ''completed''; Overview''s reminder panels allow-list ''scheduled''/''in_progress'' explicitly) without being conflated with an actual cancellation.';
