-- ===========================================================================
-- Per-trip / per-client profitability — the read shapes behind
-- /reports/trip-pl.
--
-- WHAT THIS MIGRATION ADDS: two SECURITY INVOKER, read-only aggregation
-- functions. No table, no column, no policy, no grant change to any
-- existing object. Additive in the strict sense — dropping both functions
-- returns the database to its previous state exactly.
--
-- ===========================================================================
-- WHY AGGREGATE IN THE DATABASE AT ALL.
--
-- The pilot.ledger_balances precedent (20260812100000_accounting_ledger.sql,
-- section 7): "Aggregation happens in the database so the balance sheet
-- reads ~30 rows regardless of how many thousands of journal lines exist —
-- the Data API's silent 1000-row truncation can never shortchange a
-- per-account balance."
--
-- The same hazard is sharper here. A per-trip margin needs, for one trip,
-- every invoice line billing it, every expense attached to it, and every
-- day row under it. Fetching those three lists into TypeScript and joining
-- them there means three list reads that PostgREST silently clamps to
-- db-max-rows and TRUNCATES WITHOUT ERROR — and a truncated expense read
-- does not zero a margin, it INFLATES it, because the expenses are the
-- subtrahend. A trip whose deductible expenses were cut off at the cap
-- would print a margin that is too HIGH, with nothing on screen saying so.
-- That is the worst available failure mode for this particular number.
--
-- Aggregating here collapses all of that to ONE ROW PER TRIP. The caller
-- still has to cap and check its own read — but it caps a trip count,
-- which is a number the pilot can see and reason about ("you have more
-- trips in this range than this page totals"), instead of an invisible
-- line-item count buried under a figure.
--
-- ===========================================================================
-- SECURITY INVOKER, DELIBERATELY — the same reasoning as
-- pilot.trip_committed_invoice (20260807020000) and pilot.ledger_balances,
-- restated rather than assumed because getting it wrong here is a
-- cross-tenant leak:
--
--   A DEFINER function taking (target_account_id, ...) and returning rows
--   is an existence oracle across tenants — pass someone else's account_id
--   and the row count alone tells you whether that tenant has trips in a
--   date range. As INVOKER functions these read through the CALLER'S OWN
--   RLS: a tenant sees only their own trips/lines/expenses/day rows,
--   service_role bypasses RLS as it always does, and there is nothing to
--   leak. target_account_id is therefore a FILTER, never a grant of
--   authority — passing another tenant's id returns zero rows because RLS
--   removed them, not because this function checked anything.
--
-- `set search_path = ''` for the same reason every other function in this
-- schema carries it: every object reference below is schema-qualified, so
-- a mutable search_path cannot be used to shadow pilot.* with an
-- attacker-owned table.
--
-- ===========================================================================
-- THE LINKAGE EXPRESSION: coalesce(l.trip_id, e.trip_id).
--
-- Not invented here — it is already the product's blessed definition of
-- "which trip does this invoice line bill", lifted verbatim from
-- pilot.trip_committed_invoice (20260807020000), which three billing
-- guards read. Day-money lines carry trip_id directly (set by
-- createInvoiceDraft on every day-type, contract-minimum, scalar and
-- per_diem line). REBILL LINES DO NOT — a reimbursable_expense line
-- carries expense_id + expense_treatment='rebill' and resolves its trip
-- through pilot.expenses.trip_id. A per-trip figure that read only
-- l.trip_id would silently drop every rebilled line from the trip it
-- belongs to.
--
-- "LIVE" IS `i.status <> 'void'` — again trip_committed_invoice's own
-- definition, drafts INCLUDED. This is the whole product's notion of a
-- trip being billed: a trip freezes the moment a live line references it,
-- draft or not. The draft portion is returned SEPARATELY below so the
-- report can label it, but it is deliberately not a different definition
-- of "billed" — one definition, one place. See the column comment on
-- draft_day_money_cents for the subset relationship.
--
-- NO DOUBLE-COUNTING IS POSSIBLE: an expense appears on at most one
-- invoice (unique (account_id, expense_id) on pilot.invoice_lines,
-- 20260805090000) and a trip is billed by at most one live invoice (the
-- double-bill guard), so summing lines per trip cannot count a dollar
-- twice.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY *NOT* COMPUTED IN SQL.
--
-- Margin, margin-per-day, and the client rollup are NOT here. They are
-- derived once, in app/(app)/reports/trip-pl/report-lib.ts, from the
-- columns below. A figure computed in SQL *and* in TypeScript is two
-- sources for one number, which is the defect lib/trip-value.ts was
-- written to remove ("three screens had each hand-rolled this ... so a
-- trip with a day grid showed one number on Overview, another on Trips,
-- and billed a third"). These functions return FACTS; the report derives
-- ARITHMETIC. The boundary is not stylistic.
--
-- This is also why there is no `client_pl` function returning per-client
-- money totals, despite that being the obvious symmetric shape. The
-- client rollup is by definition the sum of its trips' rows, and those
-- rows are already on the client. Computing the rollup a second time in
-- SQL would create two sources that can DISAGREE in exactly the case that
-- matters most: when the caller's trip read was truncated, a SQL-side
-- client total would come back complete while the trip rows under it were
-- short, so the table would silently fail to add up and the truncation
-- warning would be contradicted by the very figures it warns about. The
-- rollup is therefore summed in TypeScript from the same rows the reader
-- can see. The ONE client-level figure trips genuinely cannot produce —
-- revenue attached to a client but to NO trip — gets its own function
-- below, because it is a different fact, not a re-total of the same one.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- pilot.trip_pl — one row per trip overlapping [period_start, period_end].
--
-- PERIOD SEMANTICS: a trip is IN the period when its dates overlap it
-- (starts_on <= period_end AND ends_on >= period_start), not when it is
-- wholly contained. A trip flown 30 DEC – 02 JAN is real work in both
-- years and must not vanish from both reports; overlap is the only
-- filter that never drops a trip from every period. The consequence —
-- a trip straddling a boundary appears in BOTH periods at its FULL value,
-- because this report does not pro-rate a trip's money across a date
-- boundary (there is no fact in the schema that says which dollar of a
-- day-rate invoice belongs to which calendar day) — is stated on screen
-- rather than hidden. It is the honest option: the alternative is
-- inventing an allocation.
--
-- The money columns are NOT date-filtered inside the trip. Once a trip is
-- in the period, everything attached to that trip counts, whenever it was
-- invoiced or incurred. A trip's margin is a property of the TRIP, not of
-- a date window sliced through its receipts — filtering its expenses by
-- incurred_on would produce a "margin" for a fragment of a trip, which is
-- not a number anyone can act on. (This is a real difference from
-- /reports/profit-loss, which is a period report and filters every figure
-- by its own date. The two answer different questions and are labelled
-- accordingly; see report-lib.ts's basis note.)
--
-- FAN-OUT: every aggregate is a LATERAL subquery, never a chain of joins
-- off pilot.trips. Joining trips -> lines -> expenses -> day rows directly
-- would multiply rows together and inflate every sum by the cardinality of
-- the others — the classic multi-join aggregation bug, and one that
-- produces a plausible-looking-but-wrong margin rather than an error.
-- ---------------------------------------------------------------------------
create or replace function pilot.trip_pl(
  target_account_id uuid,
  period_start date,
  period_end date
)
returns table (
  trip_id uuid,
  client_id uuid,
  trip_kind text,
  trip_status text,
  billing_state text,
  starts_on date,
  ends_on date,
  aircraft_ident text,
  invoiced_day_money_cents bigint,
  draft_day_money_cents bigint,
  rebilled_cost_cents bigint,
  rebill_invoiced_cents bigint,
  deductible_cents bigint,
  unassigned_cents bigint,
  day_quantity numeric,
  has_day_rows boolean,
  scalar_day_count numeric,
  mileage_miles numeric,
  mileage_entry_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.id,
    t.client_id,
    t.trip_kind,
    t.status,
    t.billing_state,
    t.starts_on,
    t.ends_on,
    t.aircraft_ident,
    coalesce(lines.invoiced_day_money_cents, 0)::bigint,
    coalesce(lines.draft_day_money_cents, 0)::bigint,
    coalesce(ex.rebilled_cost_cents, 0)::bigint,
    coalesce(lines.rebill_invoiced_cents, 0)::bigint,
    coalesce(ex.deductible_cents, 0)::bigint,
    coalesce(ex.unassigned_cents, 0)::bigint,
    -- Rounded to 2 decimal places, the SCALE roundQuantity() in
    -- lib/trip-value.ts and createInvoiceDraft use (pilot.invoice_lines
    -- .quantity is numeric(6,2)), so this figure is expressible as a sum
    -- of invoice line quantities and reads at the same precision.
    --
    -- NOT bit-identical to the invoice, and the difference is stated
    -- rather than glossed: the invoice rounds ONCE PER (day_type_id,
    -- rate_cents) GROUP — one line per group — and this rounds ONCE PER
    -- TRIP, over all billable groups summed. quantity is numeric(3,1)
    -- and units numeric(3,2), so quantity * units can carry a third
    -- decimal; two groups of 0.125 invoice as 0.13 + 0.13 = 0.26 days
    -- while this returns round(0.25, 2) = 0.25. Bound: 0.005 per group,
    -- so a trip with n billable groups can differ from its invoice's
    -- summed line quantities by up to n * 0.005 days.
    --
    -- Accepted because this column is a DENOMINATOR ONLY (margin-per-day)
    -- and a "Days" display — no money column is derived from it, and
    -- money is the thing that has to tie to the invoice exactly. The
    -- alternative, grouping in this lateral to replicate the invoice's
    -- rounding, would put a second copy of createInvoiceDraft's grouping
    -- rule in SQL — two sources for one rule, which is the defect
    -- lib/trip-value.ts exists to prevent — to move a day count by a
    -- hundredth.
    coalesce(round(days.day_quantity, 2), 0)::numeric,
    coalesce(days.day_row_count, 0) > 0,
    -- The pre-day-grid scalar day count, used by the report ONLY when a
    -- trip has no day rows at all — the same precedence lib/trip-value.ts
    -- applies to money ("once a trip has trip_days rows it is priced from
    -- THEM ... the scalar columns are ignored entirely"). Both scalar
    -- counts are summed because both describe days worked: day_count is
    -- flight/duty days, travel_day_count is travel days, and a
    -- margin-per-day denominator that counted only the first would
    -- overstate the per-day figure on any trip with positioning days.
    (coalesce(t.day_count, 0) + coalesce(t.travel_day_count, 0))::numeric,
    coalesce(mi.mileage_miles, 0)::numeric,
    coalesce(mi.mileage_entry_count, 0)::bigint
  from pilot.trips t
  left join lateral (
    select
      -- DAY MONEY: everything that is not a rebill. line_type
      -- 'reimbursable_expense' is excluded because it is the pass-through
      -- leg of an expense the pilot already paid — counting it as trip
      -- revenue while its cost sits in expenses would make a pure
      -- pass-through look like margin. It is returned on its own below
      -- (rebill_invoiced_cents) so the pass-through can be RECONCILED
      -- rather than merely dropped.
      --
      -- Every non-rebill line type counts: flight_day, travel_day,
      -- per_diem, cancellation_fee and 'other'. per_diem and
      -- cancellation_fee are day money in the sense that matters here —
      -- money the client owes for this trip that is not a reimbursement
      -- of a receipt. A cancellation fee against a trip that never flew
      -- is precisely a margin event this report should show.
      sum(l.amount_cents) filter (
        where l.line_type <> 'reimbursable_expense'
      ) as invoiced_day_money_cents,
      -- The DRAFT SUBSET of the figure directly above — NOT a separate
      -- bucket to be added to it. Read it as "of the invoiced day money,
      -- this much sits on an invoice that has not been sent yet." Adding
      -- these two columns together double-counts every draft line.
      sum(l.amount_cents) filter (
        where l.line_type <> 'reimbursable_expense' and i.status = 'draft'
      ) as draft_day_money_cents,
      -- The reimbursement leg: what was actually billed to the client for
      -- rebilled receipts on this trip. Compared against the cost leg
      -- (ex.rebilled_cost_cents) by the report, which surfaces any gap —
      -- a rebill never invoiced, or invoiced short, is money the pilot
      -- fronted and did not get back.
      sum(l.amount_cents) filter (
        where l.line_type = 'reimbursable_expense'
      ) as rebill_invoiced_cents
    from pilot.invoice_lines l
    join pilot.invoices i
      on i.account_id = l.account_id and i.id = l.invoice_id
    -- LEFT join: only reimbursable_expense lines carry expense_id, and a
    -- day-money line must not be dropped for lacking one.
    left join pilot.expenses le
      on le.account_id = l.account_id and le.id = l.expense_id
    where l.account_id = t.account_id
      and coalesce(l.trip_id, le.trip_id) = t.id
      and i.status <> 'void'
  ) lines on true
  left join lateral (
    select
      -- treatment is set ONCE at capture (A3, 20260805070000: "No
      -- downstream surface re-asks it") — this reads that decision, it
      -- does not re-derive it.
      sum(e.amount_cents) filter (where e.treatment = 'rebill') as rebilled_cost_cents,
      sum(e.amount_cents) filter (where e.treatment = 'deduct') as deductible_cents,
      -- Unassigned receipts that DO carry a trip_id. Worth returning
      -- rather than ignoring: treatment='unassigned' means the
      -- rebill-vs-deduct decision has not been made, not that the receipt
      -- has no trip. The report excludes these from margin and shows them
      -- as an explicit "undecided" figure per trip — the same framing
      -- /reports/profit-loss uses for its account-wide unassigned total
      -- ("money you're currently losing in both directions"), which is
      -- exactly what an undecided receipt on a completed trip is.
      sum(e.amount_cents) filter (where e.treatment = 'unassigned') as unassigned_cents
    from pilot.expenses e
    where e.account_id = t.account_id
      and e.trip_id = t.id
  ) ex on true
  left join lateral (
    select
      -- The grouping rule from 20260807070000: a day's contribution is
      -- quantity * units — quantity is a TIME fraction (how much of the
      -- day was worked), units is a MONEY fraction (what share of the day
      -- rate this kind of day pays). Billable day types only, matching
      -- createInvoiceDraft's day-row path and lib/trip-value.ts.
      sum(td.quantity * td.units) filter (where dt.billable) as day_quantity,
      -- Counts ALL day rows, billable or not, because this drives
      -- has_day_rows — "does this trip have a day grid at all", which is
      -- what decides whether the scalar day_count fallback applies. A
      -- trip whose only day rows are non-billable HAS a grid; its
      -- billable quantity is legitimately zero and must not be replaced
      -- by the scalar.
      count(*) as day_row_count
    from pilot.trip_days td
    join pilot.day_types dt
      on dt.account_id = td.account_id and dt.id = td.day_type_id
    where td.account_id = t.account_id
      and td.trip_id = t.id
  ) days on true
  left join lateral (
    select
      -- MILES, NOT MONEY — and this is the whole point of the column.
      --
      -- pilot.mileage_entries.amount_cents exists and is a generated
      -- column, so summing it here would be easy and would be WRONG for
      -- this report to present. /reports/profit-loss's mileage note
      -- records why: the Schedule C figure is total miles for a year x
      -- that year's rate, rounded ONCE (lib/mileage.ts), and "summing the
      -- stored per-row amounts is what made this report disagree with
      -- /expenses/mileage for the same drives." A per-trip dollar figure
      -- would be a third computation of one deduction.
      --
      -- On top of that, 20260809020000's own header states the standard
      -- mileage rate and actual vehicle expenses are ALTERNATIVE methods
      -- for a vehicle-year, "never additive" — so a mileage dollar figure
      -- could not be added into a trip margin regardless of who computed
      -- it. Returning miles keeps the fact (this trip involved driving)
      -- without minting a second, conflicting dollar amount.
      sum(m.miles) as mileage_miles,
      count(*) as mileage_entry_count
    from pilot.mileage_entries m
    where m.account_id = t.account_id
      and m.trip_id = t.id
  ) mi on true
  where t.account_id = target_account_id
    and t.starts_on <= period_end
    and t.ends_on >= period_start
  order by t.starts_on, t.ends_on, t.id
$$;

comment on function pilot.trip_pl(uuid, date, date) is
  'One row per trip overlapping the period, with its invoiced day money, rebill pass-through legs (cost and invoiced, separately), deductible and undecided expenses, billable day quantity and mileage in MILES. Facts only — margin, margin/day and the client rollup are derived once in app/(app)/reports/trip-pl/report-lib.ts, never here and there. draft_day_money_cents is a SUBSET of invoiced_day_money_cents, not an addend. "Live" is status <> ''void'', the same definition as pilot.trip_committed_invoice. SECURITY INVOKER on purpose: a DEFINER form would be a cross-tenant existence oracle.';

revoke all on function pilot.trip_pl(uuid, date, date) from public;
grant execute on function pilot.trip_pl(uuid, date, date) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- pilot.client_unattributed_lines — live invoice money that belongs to a
-- CLIENT but to NO TRIP.
--
-- WHY THIS EXISTS AS A SEPARATE FUNCTION rather than a column on the trip
-- rows: it is, by construction, money no trip row can carry. The paradigm
-- case is the monthly-guarantee line, which createInvoiceDraft writes with
-- NO trip_id on purpose (app/(app)/invoices/actions.ts:1119-1122 — "a
-- monthly aggregate across however many trips contributed"). Attributing
-- it to one of those trips would be inventing an allocation the schema
-- never recorded, and dropping it silently would make a client's rollup
-- disagree with the invoices that client was actually sent — the exact
-- "two reports disagree about one number" failure the house rule forbids.
-- So it is surfaced as its own labelled line on the client rollup:
-- present, named, and never folded into any trip's margin.
--
-- PERIOD SEMANTICS, and why they differ from trip_pl: these lines have no
-- trip, so there are no trip dates to overlap. They are placed by their
-- INVOICE'S issued_on instead. Draft invoices cannot be placed that way —
-- issued_on is normally null until the invoice is sent — so they are
-- returned in their own column, unfiltered by date.
--
-- THE TWO COLUMNS ARE DISJOINT, AND THAT IS ENFORCED HERE, NOT ASSUMED.
-- The report ADDS them ("$X, + $Y on drafts"), so any row counted by both
-- would be double-counted on screen and in the CSV. It is tempting to
-- believe drafts can never land in the dated bucket because a draft has no
-- issue date — but that is false: updateInvoiceHeader
-- (app/(app)/invoices/actions.ts) lets the pilot set issued_on WHILE the
-- invoice is still a draft, and the insert grant permits it at creation
-- too; invoices_protect_issued only stops edits AFTER the invoice leaves
-- draft, and the send trigger only auto-fills issued_on when it is still
-- null. So the split is by STATUS, which is total and mutually exclusive:
--
--   dated column  = live NON-DRAFT lines whose issued_on falls in period
--   draft column  = ALL live draft lines, whatever issued_on says
--
-- Draft money therefore always lands in exactly one column — the draft
-- one — whether or not the pilot gave the draft a provisional date. This
-- deliberately differs from trip_pl's draft_day_money_cents, which is a
-- labelled SUBSET of a total; here a subset is impossible, because
-- undated drafts have no period to be a subset of. One convention per
-- figure, stated where the figure is defined.
-- ---------------------------------------------------------------------------
create or replace function pilot.client_unattributed_lines(
  target_account_id uuid,
  period_start date,
  period_end date
)
returns table (
  client_id uuid,
  unattributed_line_cents bigint,
  unattributed_line_count bigint,
  draft_unattributed_line_cents bigint,
  draft_unattributed_line_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.client_id,
    -- SENT (non-draft) money, placed by issued_on. `status <> 'draft'` is
    -- what keeps this disjoint from the draft column below — see header.
    coalesce(sum(l.amount_cents) filter (
      where i.status <> 'draft'
        and i.issued_on is not null
        and i.issued_on between period_start and period_end
    ), 0)::bigint,
    count(*) filter (
      where i.status <> 'draft'
        and i.issued_on is not null
        and i.issued_on between period_start and period_end
    ),
    -- ALL draft money, dated or not. Not date-filtered — see the header.
    coalesce(sum(l.amount_cents) filter (where i.status = 'draft'), 0)::bigint,
    count(*) filter (where i.status = 'draft')
  from pilot.invoice_lines l
  join pilot.invoices i
    on i.account_id = l.account_id and i.id = l.invoice_id
  left join pilot.expenses le
    on le.account_id = l.account_id and le.id = l.expense_id
  where l.account_id = target_account_id
    and i.status <> 'void'
    -- The complement of trip_pl's linkage: no trip on the line, and none
    -- reachable through a rebilled expense either.
    and coalesce(l.trip_id, le.trip_id) is null
  group by i.client_id
  -- A client whose unattributed lines are all outside the period and not
  -- drafts contributes nothing; drop the empty group rather than emitting
  -- a zero row the report would have to filter anyway. Mirrors the two
  -- select-list filters exactly, including the status split.
  having coalesce(sum(l.amount_cents) filter (
           where i.status <> 'draft'
             and i.issued_on is not null
             and i.issued_on between period_start and period_end
         ), 0) <> 0
      or count(*) filter (where i.status = 'draft') > 0
$$;

comment on function pilot.client_unattributed_lines(uuid, date, date) is
  'Live (non-void) invoice line money for a client that resolves to NO trip — chiefly monthly-guarantee lines, which createInvoiceDraft writes without a trip_id on purpose. Surfaced on the client rollup as its own labelled figure so a client total ties to the invoices actually sent, without inventing a per-trip allocation. Two DISJOINT columns, safe to add: sent (non-draft) lines placed by the invoice''s issued_on, and all draft lines regardless of date. Split by status, not by whether issued_on is null, because a draft may carry a provisional issue date. SECURITY INVOKER, same reasoning as pilot.trip_pl.';

revoke all on function pilot.client_unattributed_lines(uuid, date, date) from public;
grant execute on function pilot.client_unattributed_lines(uuid, date, date) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- NO INDEX IS ADDED HERE, deliberately — recorded because the obvious
-- reflex ("this is a new per-trip lateral over invoice_lines, add an
-- index on trip_id") is wrong twice over:
--
--   1. It already exists. 20260805090000_phase5_invoices.sql:1373 creates
--      invoice_lines_trip_idx on pilot.invoice_lines (account_id, trip_id)
--      where trip_id is not null — same name, same definition. A
--      `create index if not exists` here would be a silent no-op that
--      also makes this migration look like the index's owner, so a later
--      reader could drop the "duplicate" in phase 5 and lose it.
--
--   2. It would not serve this query anyway. pilot.trip_pl's lateral
--      filters on `coalesce(l.trip_id, le.trip_id) = t.id`, and the
--      planner cannot push a coalesce over two different tables' columns
--      down into an index on either of them. The per-trip inner scan is
--      bounded by the ACCOUNT'S line count (via l.account_id = t.account_id,
--      which the index's leading column and invoice_lines_invoice_idx both
--      serve), not by a trip_id lookup. That is cheap at the row counts a
--      single pilot's account reaches and has not been optimised further;
--      if it ever needs to be, the fix is to rewrite the predicate as an
--      OR of two sargable arms, not to add another index.
--
-- So this migration adds functions only — dropping the two functions
-- returns the database to its previous state exactly, as the header says.
-- ---------------------------------------------------------------------------
