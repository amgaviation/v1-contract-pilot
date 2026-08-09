-- Fixes for three confirmed defects in 20260809020000_mileage.sql and
-- 20260809030000_recurring_invoices.sql. Each is proven by an adversarial
-- reviewer executing against real Postgres; see the PR description for the
-- exact figures/SQLSTATEs. This migration corrects the grants/schema and
-- restates every comment in those two files that the defects falsified —
-- those files are not edited (house rule: never retrofit an existing
-- migration), so the corrected story lives here instead.
--
-- ===========================================================================
-- DEFECT 3 (HIGH) — rate_cents_per_mile was not actually immutable.
--
-- 20260809020000_mileage.sql:223 put rate_cents_per_mile in the column-scoped
-- UPDATE grant for pilot.mileage_entries, and updateMileageEntry (actions.ts)
-- rewrote it from the form on every save. amount_cents is GENERATED ...
-- STORED, so it recomputed instantly. Proven live, through the real update
-- path as `authenticated` (not just the rates table, which is a hollow
-- proof — mileage_rates was never wired to re-resolve anything):
--
--   insert  ... miles=100.0, rate=70.000        -> amount_cents =   7000
--   update  ... set rate_cents_per_mile=999.999 -> amount_cents = 100000
--
-- That single UPDATE re-priced an already-recorded drive 14x — exactly the
-- "wrong figure on an already-filed return" scenario the migration header
-- says must never happen. The fix: withhold rate_cents_per_mile from the
-- UPDATE grant, the same discipline recurring_invoice_schedules already
-- uses for client_id/cadence/anchor_date (20260809030000:272-282).
-- Correcting a wrong rate is delete-and-recreate. The app-layer change
-- (mileage-form.tsx, actions.ts) removes the rate field from the edit path
-- entirely and explains why.
--
-- Postgres column-level REVOKE/GRANT are tracked independently of the
-- table-level ones (pg_attribute.attacl, not pg_class.relacl), so revoking
-- one column's UPDATE privilege here does not touch any other column's
-- privilege and does not trip the house CRITICAL about `revoke <priv> on
-- <table>` dropping every column grant — that trap is specifically about a
-- *table-level* revoke/grant pair, not a column-scoped one. Verified below
-- by inspecting information_schema.column_privileges, not assumed.
-- ---------------------------------------------------------------------------
revoke update (rate_cents_per_mile) on pilot.mileage_entries from authenticated;

comment on column pilot.mileage_entries.rate_cents_per_mile is
  'Snapshotted at capture from pilot.mileage_rates and truly immutable after insert: authenticated has no UPDATE grant on this column (see this migration), so an already-recorded drive cannot be re-priced by editing it. Correcting a wrong rate is delete-and-recreate, the same discipline pilot.recurring_invoice_schedules uses for client_id/cadence/anchor_date.';

comment on table pilot.mileage_entries is
  'One row per drive, for the standard-mileage-rate deduction method. rate_cents_per_mile is snapshotted at capture from pilot.mileage_rates and is genuinely immutable after insert (no UPDATE grant on that column as of 20260809050000 — see that migration for the live-reproduced defect this closes). amount_cents is a GENERATED column (round(miles * rate_cents_per_mile)) so it can never drift from its inputs. This table records what the pilot drove and how they describe it (purpose) — it does NOT determine or label anything "deductible"; that judgment (commuting vs. business, and whether the standard-mileage-rate method or actual vehicle expenses is being used for the underlying vehicle this year — the two are alternatives, never additive, and pilot.expenses category=''fuel''/''rental_car'' rows are NOT reconciled against this table) is the pilot''s or their tax professional''s.';

-- ===========================================================================
-- DEFECT 8 (MEDIUM) — a table-level INSERT grant defeated the column
-- scoping.
--
-- 20260809020000_mileage.sql:213 granted `select, insert, delete` at the
-- TABLE level on pilot.mileage_rates and pilot.mileage_entries — table-level
-- INSERT covers every column, making the carefully enumerated column-scoped
-- `grant insert (...)` at :215/:220 pure decoration. Proven live: a crafted
-- insert setting `id` and `created_at` directly (an attacker-chosen primary
-- key and a back-dated audit timestamp) was accepted as `authenticated`.
-- RLS still confined it to the caller's own tenant, so this was bounded, but
-- it defeats the house column-scoping idiom the migration's own comment
-- (:203-211) describes one line above the grant that undoes it.
--
-- Fix: revoke the table-level INSERT, then re-grant exactly the same
-- column-scoped INSERT privileges the original migration already listed at
-- :215/:220. This is a real instance of the house CRITICAL, not an
-- exception to it: PROVEN LIVE (not assumed) that `revoke insert on
-- <table> from authenticated` removes BOTH the table-level privilege AND
-- every column-level INSERT grant that role held on that table — a
-- table-level REVOKE of a given privilege type cascades to column-level
-- ACL entries of that same privilege type; they are not independent the
-- way the equivalent-looking UPDATE case above is (verified: revoking
-- UPDATE on one column left every other column's UPDATE grant, and every
-- column's INSERT grant, untouched). So the revoke below is followed by
-- the identical re-grant statements from :215/:220, listing every column,
-- exactly as the constraint requires. sibling table
-- pilot.recurring_invoice_schedules already got this right from the start
-- (20260809030000:268, `grant select, delete` with no table-level insert
-- ever granted) — this migration brings mileage_rates/mileage_entries in
-- line with it.
-- ---------------------------------------------------------------------------
revoke insert on pilot.mileage_rates, pilot.mileage_entries from authenticated;

grant insert (account_id, tax_year, rate_cents_per_mile, notes)
  on pilot.mileage_rates to authenticated;

grant insert (account_id, drove_on, miles, from_place, to_place, purpose,
  trip_id, client_id, rate_cents_per_mile, notes)
  on pilot.mileage_entries to authenticated;

comment on table pilot.mileage_rates is
  'Per-account, per-tax-year IRS standard mileage rate, entered by the pilot — NEVER hardcoded or seeded with a real figure, because the rate changes annually and a stale baked-in number would silently misstate every mileage_entries row snapshotted from it. authenticated''s INSERT privilege is column-scoped only (account_id, tax_year, rate_cents_per_mile, notes) — no table-level INSERT grant exists, so id/created_at/updated_at are never client-choosable (see 20260809050000). See https://www.irs.gov/tax-professionals/standard-mileage-rates.';

-- ===========================================================================
-- Verification queries (informational only, no effect on the schema) — the
-- catalog state this migration must produce. Left as comments so a reader
-- of this file sees the exact check that was actually run, not just the
-- claim:
--
--   select table_name, column_name, privilege_type
--     from information_schema.column_privileges
--    where grantee = 'authenticated'
--      and table_schema = 'pilot'
--      and table_name in ('mileage_entries', 'mileage_rates')
--      and privilege_type = 'INSERT'
--   -- expect: every column of mileage_rates except id/created_at/updated_at,
--   -- every column of mileage_entries except id/amount_cents/created_at/
--   -- updated_at. Table-level INSERT (a row with column_name IS NULL does
--   -- not appear in this view; table-level privileges show as one row per
--   -- column here too when granted at the table level, so the *count* of
--   -- distinct INSERT-privileged columns is what to check against the
--   -- column list above, not privilege_type alone) confirmed absent via
--   -- has_table_privilege('authenticated', 'pilot.mileage_entries', 'INSERT')
--   -- = false after this migration (it was true before).
--
--   select table_name, column_name, privilege_type
--     from information_schema.column_privileges
--    where grantee = 'authenticated'
--      and table_schema = 'pilot'
--      and table_name = 'mileage_entries'
--      and privilege_type = 'UPDATE'
--   -- expect: drove_on, miles, from_place, to_place, purpose, trip_id,
--   -- client_id, notes — rate_cents_per_mile NOT present.
-- ===========================================================================

-- ===========================================================================
-- DEFECT 6 (MEDIUM) — recurring generation orphaned invoices and could
-- regenerate them on retry.
--
-- app/(app)/invoices/recurring/actions.ts wrote invoice -> line -> ledger as
-- three separate statements. Any failure after the invoice insert (line
-- insert fails; ledger insert fails on anything but 23505; ledger insert
-- fails WITH 23505, after which the period is durably marked generated)
-- left a real, complete, or partially-complete invoice behind with nothing
-- to clean it up, and in the non-23505 cases the period stayed "due" so
-- every retry compounded the mess.
--
-- CHOSEN FIX: one SECURITY DEFINER function, pilot.generate_recurring_invoice,
-- doing all three writes (invoice, line, ledger) as the effects of a single
-- top-level SQL statement (the function call). If ANY of the three inserts
-- raises — including the ledger's unique (account_id, schedule_id,
-- period_start) violation on 23505 — Postgres rolls back every effect of
-- that statement atomically. There is no window where a caller can observe
-- an invoice or line without its ledger row, and a losing concurrent caller
-- leaves NOTHING behind, not even a spare draft.
--
-- REJECTED ALTERNATIVE: making recurring_invoice_generations.invoice_id
-- nullable and inserting the ledger row first as a single-statement
-- reservation, then filling in invoice_id after. Rejected because (a) it
-- weakens a documented invariant — recurring_invoice_generations' own
-- comment (20260809030000:222-223) states the unique constraint is proof "a
-- given schedule's given calendar-month period has already produced an
-- invoice"; a nullable invoice_id makes a reservation-with-no-invoice a
-- representable, and under any post-reservation failure a REACHABLE, state
-- — permanently consuming a period with nothing to show for it, which is a
-- narrower version of the exact bug being fixed; (b) recovering from that
-- half-state needs either a DELETE grant on this ledger (which the RLS
-- comment at 20260809030000:254-260 explicitly withholds, on purpose, for
-- an unrelated reason: "a pilot deleting a generation row to 'free up' a
-- period is exactly the double-bill this table exists to prevent" — adding
-- delete here to clean up a null-invoice_id row reopens that exact door)
-- or a second SECURITY DEFINER function to do the cleanup, at which point
-- there is no complexity savings left over the single-function approach
-- actually chosen. The single-function approach needs no schema change to
-- recurring_invoice_generations at all — invoice_id stays NOT NULL and the
-- table's own documented invariant stays true, always.
--
-- SECURITY: this function bypasses RLS the way any SECURITY DEFINER
-- function run as the migration/table-owning role does — that is
-- deliberately NOT the same thing as the house-forbidden "admin-bypass RLS
-- policy": it is a single, narrow, explicitly-authored function, not a
-- standing policy on the table, and it re-implements the tenant check by
-- hand via pilot.current_account_ids() (the same function every RLS policy
-- in this schema calls) before doing anything else, then propagates the
-- resolved account_id — never a caller-supplied one — into every insert. A
-- caller who is not a member of the schedule's account gets "recurring
-- schedule not found," identical to what RLS would have produced, not
-- silent cross-tenant access. No service-role client is used anywhere in
-- the app layer to call this — it is invoked over the same
-- authenticated-role connection as every other query, via supabase.rpc().
-- ---------------------------------------------------------------------------
create or replace function pilot.generate_recurring_invoice(
  p_schedule_id uuid,
  p_period_start date
) returns uuid
language plpgsql
security definer
set search_path = pilot, pg_catalog
as $$
declare
  v_schedule pilot.recurring_invoice_schedules%rowtype;
  v_invoice_id uuid;
begin
  -- Tenant check done BY HAND, the same predicate every RLS policy in this
  -- schema uses — required precisely because SECURITY DEFINER means this
  -- function does not get RLS's protection for free.
  select * into v_schedule
    from pilot.recurring_invoice_schedules
    where id = p_schedule_id
      and account_id in (select pilot.current_account_ids());

  if not found then
    raise exception 'recurring schedule not found or not yours'
      using errcode = 'P0002';
  end if;

  if not v_schedule.active then
    raise exception 'recurring schedule is paused'
      using errcode = 'P0001';
  end if;

  -- account_id is always v_schedule.account_id below, never a
  -- caller-supplied value — the tenant this writes to is exactly the
  -- tenant that owns the schedule just verified above.
  insert into pilot.invoices (account_id, client_id, tax_rate_bps)
    values (v_schedule.account_id, v_schedule.client_id, v_schedule.tax_rate_bps)
    returning id into v_invoice_id;

  insert into pilot.invoice_lines
    (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, taxable)
    values
    (v_schedule.account_id, v_invoice_id, 'other', v_schedule.description, 1,
     v_schedule.amount_cents, true);

  -- THE reservation. If another concurrent call already generated this
  -- (schedule_id, period_start), this raises 23505 and the whole function
  -- call — including the invoice and line just inserted above — rolls
  -- back as one atomic unit. Nothing is left behind either way.
  insert into pilot.recurring_invoice_generations
    (account_id, schedule_id, period_start, invoice_id)
    values
    (v_schedule.account_id, p_schedule_id, p_period_start, v_invoice_id);

  return v_invoice_id;
end;
$$;

comment on function pilot.generate_recurring_invoice(uuid, date) is
  'Generates one DRAFT invoice for one (schedule, period) as a single atomic statement: invoice, line, and the recurring_invoice_generations ledger row all succeed or all roll back together, including on the ledger''s unique (account_id, schedule_id, period_start) violation. Replaces the three-separate-inserts app-layer version that could orphan an invoice/line on partial failure (defect 6, 20260809050000). SECURITY DEFINER: re-checks tenant ownership via pilot.current_account_ids() before writing anything, and never trusts a caller-supplied account_id — see this migration''s header for why this is not the house-forbidden admin-bypass pattern. Does NOT check period due-ness; the caller (generateRecurringInvoice in actions.ts) recomputes and validates the due set server-side before calling this, same as before.';

revoke all on function pilot.generate_recurring_invoice(uuid, date) from public;
grant execute on function pilot.generate_recurring_invoice(uuid, date) to authenticated;

comment on table pilot.recurring_invoice_generations is
  'The idempotency ledger for recurring invoices: proof that a given schedule''s given calendar-month period has already produced an invoice. The unique (account_id, schedule_id, period_start) constraint is what makes double-generation impossible, not merely unlikely — see the migration file header (20260809030000). Written exclusively by pilot.generate_recurring_invoice (20260809050000), a SECURITY DEFINER function that writes the invoice, its line, and this ledger row as one atomic statement, closing the "orphaned invoice on partial failure" defect a three-separate-inserts app-layer version had. invoice_id remains NOT NULL — a generation row is never a bare reservation, always proof of a real invoice.';

-- ===========================================================================
-- DEFECT 7 (MEDIUM) — a back-dated anchor could materialise an unbounded
-- backlog in one click.
--
-- No schema change needed or made here: computeDuePeriods' existing 600-
-- period cap (50 years monthly) is a runaway guard against a corrupted
-- anchor_date, not a usability guard against a legitimate-but-old one — a
-- pilot backdating a schedule to a real multi-year-old retainer can still
-- hit 79+ due periods well under that cap, and "Create all due" offered no
-- confirmation before creating all of them in one click. The fix for this
-- one is entirely in the app layer (generateAllDueRecurringInvoices in
-- actions.ts gains a confirmation threshold; due-queue.tsx surfaces a count
-- + total-amount confirmation dialog past it; schedule-form.tsx's
-- anchor_date input gains a `min` for the honest-mistake case) — see those
-- files' own comments. Documented here only so a reader of this migration
-- sees all four defects accounted for in one place.
-- ===========================================================================
