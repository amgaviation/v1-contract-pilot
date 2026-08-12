-- ===========================================================================
-- Accounting core, part 1 of 2 — chart of accounts + double-entry ledger
--
-- WHAT THIS IS. The Wave-style accounting spine for a solo contract pilot:
-- a per-tenant CHART OF ACCOUNTS (pilot.accounts_chart — NOT pilot.accounts,
-- which is the tenant table), a double-entry JOURNAL
-- (pilot.journal_entries + pilot.journal_lines, debits = credits enforced
-- in the database), and the DERIVED-POSTING mechanism that turns the facts
-- this product already records (invoices issued, payments received,
-- expenses, mileage) into ledger entries without ever double-posting.
-- Part 2 (20260812100001) adds bank-statement reconciliation on top.
--
-- WHY THE CHART IS AVIATION-SHAPED, NOT A GENERIC BOOKKEEPING CLONE. The
-- seeded accounts mirror how a contract pilot actually earns and spends:
-- income split the way invoice_lines already splits it (day rate, travel
-- day, per diem, cancellation/standby, reimbursed expenses), expense
-- accounts mapped one-to-one from pilot.expenses' existing category
-- vocabulary (the travel eight plus the self-funded seven from
-- 20260810070000), and equity as OWNER DRAWS / OWNER CONTRIBUTIONS —
-- which is the honest solo-pilot equivalent of payroll: a sole proprietor
-- does not run a payroll tax engine on themselves, they take draws, and
-- pretending otherwise would be a domain error the same way FET on a
-- pilot's service invoice would be (see 20260805090000's header).
--
-- ***************************************************************************
-- THE POSTING MECHANISM, AND WHY IT CANNOT DOUBLE-POST. Read this before
-- touching pilot.ledger_sync.
--
-- Chosen: ON-DEMAND, IDEMPOTENT DERIVATION (pilot.ledger_sync), not
-- per-table triggers on invoices/payments/expenses/mileage. Reasons:
--   1. One code path serves both the historical backfill and every future
--      row — a trigger set would still need a separate backfill that could
--      drift from the triggers.
--   2. The source tables belong to other features and already carry
--      load-bearing trigger stacks (invoices_protect_issued,
--      invoice_payments_validate, ...); hanging ledger writes off them
--      couples every future edit of those features to this one.
--   3. Idempotency is enforced where it cannot be forgotten: every derived
--      entry carries (source_type, source_id), and
--      journal_entries_source_uniq is a UNIQUE index over exactly that.
--      Re-running the sync INSERTs with ON CONFLICT DO NOTHING; a re-post
--      of the same invoice/payment/expense/mileage row is a no-op BY INDEX,
--      not by convention. Two concurrent syncs cannot double-post either:
--      the second's speculative insert waits on the first's, then skips —
--      and the line inserts only fire for entries that have no lines yet,
--      evaluated in the same statement snapshot.
--   4. Sources that can CHANGE (expenses and mileage are editable; issued
--      invoices and recorded payments are immutable by this schema's own
--      triggers/grants) are handled by a drift pass that DELETEs the
--      derived entry whose source no longer matches and lets the insert
--      pass recreate it — still keyed by the same unique index, so there
--      is never a moment two entries for one source can coexist.
--
-- The sync runs when an accounting or ledger-report surface loads (and via
-- an explicit "refresh" action) — the ledger is a derived read model of
-- the facts, never a second place to edit them.
-- ***************************************************************************
--
-- BASIS, stated once so the reports can label it honestly: the JOURNAL is
-- accrual-shaped (an issued invoice debits Accounts receivable and credits
-- income; the payment moves cash against AR). The house income reports
-- (year-end, quarterly, P&L) are CASH-basis. The two tie together exactly:
-- cash income for a period == the bank movement of payment entries minus
-- the void-invoice reclass entries for that period, which
-- scripts/accounting-verify.mjs asserts to the cent against the P&L's own
-- arithmetic. One source of truth per figure: cash income is ALWAYS
-- pilot.invoice_payments; the ledger derives from it, never competes.
--
-- VOIDED INVOICES: a sent invoice that later becomes void is reversed by a
-- derived 'invoice_voided' entry DATED AT ISSUE, so no period's accrual
-- income retains a document that ended void (mirroring how the P&L
-- retroactively excludes payments on void invoices). A payment that was
-- received against a now-void invoice is reclassified from AR to the
-- 'client_credit' liability ("held for clients") — the money is really in
-- the bank, it just is not income, and negative AR is not how to say that.
--
-- MILEAGE is posted per entry at the entry's own snapshot amount, debiting
-- 'expense_mileage' and crediting OWNER CONTRIBUTIONS (a non-cash,
-- owner-funded expense — the standard mileage rate is a deemed cost, not a
-- bank withdrawal). Two consequences, both deliberate and mirrored from
-- the P&L's own mileage note: it never appears in cash flow (the P&L also
-- excludes it from cash expenses), and its account total is the sum of
-- per-entry snapshots, which can differ from the Schedule C figure
-- (year-total miles x rate, rounded once) by sub-dollar rounding — the
-- P&L reconciliation therefore excludes the mileage account and asserts it
-- separately against the per-entry sum.
--
-- UNASSIGNED expenses (treatment = 'unassigned') are NOT posted, exactly
-- as the P&L excludes them from Expenses — posting them would make the
-- ledger disagree with every existing report about the same figure.
--
-- Inherits, without deviation: composite (account_id, id) FKs, RLS enabled
-- in this same migration, column-scoped grants added (never revoke —
-- README's revoke trap), SECURITY DEFINER functions with in-body
-- current_account_ids() checks (the next_invoice_number /
-- bank_transaction_confirm precedent), search_path pinned everywhere.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. pilot.accounts_chart — the chart of accounts.
--    Named accounts_chart, NOT accounts: pilot.accounts is the tenant.
-- ---------------------------------------------------------------------------
create table if not exists pilot.accounts_chart (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  kind text not null check (kind in ('asset', 'liability', 'equity', 'income', 'expense')),
  -- Non-null on SEEDED accounts only. This is how pilot.ledger_sync finds
  -- posting targets mechanically ('expense_' || expenses.category,
  -- 'income_' || invoice_lines.line_type, 'bank', 'accounts_receivable',
  -- ...) no matter what the pilot has RENAMED the account to — renaming is
  -- free, the key is the identity. Never client-writable: only
  -- pilot.seed_accounts_chart writes it (see grants below).
  system_key text,
  -- Archived accounts keep every posted line and keep rendering in
  -- history/reports; they only stop being offered for NEW lines. System
  -- accounts cannot be archived at all — they are live posting targets
  -- (see accounts_chart_protect below).
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.accounts_chart is
  'Chart of accounts, per tenant. Seeded aviation-shaped at account creation (seed_accounts_chart); pilot may add/rename/archive. system_key is the stable posting identity for seeded rows — ledger_sync targets it, names are free to change. NOT pilot.accounts, which is the tenant table.';

-- The seeded rows must be unique per tenant for ledger_sync's joins to be
-- single-valued, and the partial index is also what makes seeding
-- idempotent (ON CONFLICT target).
create unique index if not exists accounts_chart_system_key_uniq
  on pilot.accounts_chart (account_id, system_key)
  where system_key is not null;

create index if not exists accounts_chart_account_idx
  on pilot.accounts_chart (account_id, kind) where archived_at is null;

create trigger accounts_chart_set_updated_at before update on pilot.accounts_chart
  for each row execute function pilot.set_updated_at();

-- Rename is allowed on every row (a pilot who bills "duty days" may call
-- the account that); archive is allowed on pilot-created rows only. The
-- UPDATE grant below scopes columns; this trigger scopes rows+transitions,
-- because a grant cannot say "these columns, but not on system rows".
create or replace function pilot.accounts_chart_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;
  if new.system_key is distinct from old.system_key then
    raise exception 'a ledger account''s posting identity (system_key) cannot be changed';
  end if;
  if new.kind is distinct from old.kind then
    raise exception 'a ledger account''s type cannot change once it exists — archive it and add a new one';
  end if;
  if old.system_key is not null
     and new.archived_at is distinct from old.archived_at
     and new.archived_at is not null then
    raise exception 'built-in ledger accounts cannot be archived — they are where your invoices, payments and expenses post. Rename it instead.';
  end if;
  return new;
end;
$$;

create trigger accounts_chart_protect
  before update on pilot.accounts_chart
  for each row execute function pilot.accounts_chart_protect();

-- ---------------------------------------------------------------------------
-- 2. The default aviation chart, seeded per tenant.
--    Mirrors the accounts_seed_invoice_sequence precedent (20260805090000):
--    a trigger on pilot.accounts INSERT plus a backfill for tenants that
--    predate this migration, so no account can exist without a chart.
-- ---------------------------------------------------------------------------
create or replace function pilot.seed_accounts_chart(target_account_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into pilot.accounts_chart (account_id, name, kind, system_key)
  values
    -- Assets. ONE cash account by design: pilot.invoice_payments does not
    -- record which real-world account money landed in, so per-bank asset
    -- accounts could never be funded truthfully. Statement sources
    -- (pilot.bank_accounts) reconcile against this one account in part 2.
    (target_account_id, 'Cash & bank',                        'asset',     'bank'),
    (target_account_id, 'Accounts receivable',                'asset',     'accounts_receivable'),
    -- Liabilities.
    (target_account_id, 'Sales tax collected',                'liability', 'sales_tax_payable'),
    (target_account_id, 'Client funds held (voided invoices)','liability', 'client_credit'),
    -- Equity — the honest solo-pilot "payroll": owner pay is draws.
    (target_account_id, 'Owner draws',                        'equity',    'owner_draws'),
    (target_account_id, 'Owner contributions',                'equity',    'owner_contributions'),
    -- Income, keyed 'income_' || invoice_lines.line_type so posting is
    -- mechanical against the invoicing vocabulary that already exists.
    (target_account_id, 'Day rate (flight & duty days)',      'income',    'income_flight_day'),
    (target_account_id, 'Travel & positioning days',          'income',    'income_travel_day'),
    (target_account_id, 'Per diem',                           'income',    'income_per_diem'),
    (target_account_id, 'Reimbursed expenses',                'income',    'income_reimbursable_expense'),
    (target_account_id, 'Standby & cancellation fees',        'income',    'income_cancellation_fee'),
    (target_account_id, 'Other income',                       'income',    'income_other'),
    -- Expenses, keyed 'expense_' || expenses.category — the travel eight
    -- plus the self-funded seven (20260810070000), plus the mileage
    -- account (see the file header for its non-cash treatment).
    (target_account_id, 'Airline tickets',                    'expense',   'expense_airline'),
    (target_account_id, 'Hotels & lodging',                   'expense',   'expense_hotel'),
    (target_account_id, 'Rental cars',                        'expense',   'expense_rental_car'),
    (target_account_id, 'Rideshare & taxi',                   'expense',   'expense_rideshare'),
    (target_account_id, 'Fuel',                               'expense',   'expense_fuel'),
    (target_account_id, 'Meals',                              'expense',   'expense_meals'),
    (target_account_id, 'Parking & tolls',                    'expense',   'expense_parking'),
    (target_account_id, 'Other expenses',                     'expense',   'expense_other'),
    (target_account_id, 'Training & checkrides',              'expense',   'expense_training'),
    (target_account_id, 'Medical exams',                      'expense',   'expense_medical'),
    (target_account_id, 'Insurance',                          'expense',   'expense_insurance'),
    (target_account_id, 'Charts & subscriptions',             'expense',   'expense_charts'),
    (target_account_id, 'Equipment',                          'expense',   'expense_equipment'),
    (target_account_id, 'Uniforms',                           'expense',   'expense_uniform'),
    (target_account_id, 'Dues & memberships',                 'expense',   'expense_dues'),
    (target_account_id, 'Vehicle — standard mileage',         'expense',   'expense_mileage')
  on conflict (account_id, system_key) where system_key is not null do nothing;
$$;

revoke all on function pilot.seed_accounts_chart(uuid) from public;
-- Not granted to authenticated: seeding happens via the trigger below and
-- the backfill here. service_role DOES need EXECUTE, because the trigger
-- body's PERFORM is an ordinary function call checked against the
-- INSERTING role — and every account is created by the service_role
-- webhook (Phase 1's "no client INSERT policy" rule).
grant execute on function pilot.seed_accounts_chart(uuid) to service_role;

create or replace function pilot.accounts_seed_chart()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pilot.seed_accounts_chart(new.id);
  return new;
end;
$$;

create trigger accounts_seed_chart
  after insert on pilot.accounts
  for each row execute function pilot.accounts_seed_chart();

-- Backfill: tenants that predate this migration.
select pilot.seed_accounts_chart(id) from pilot.accounts;

-- ---------------------------------------------------------------------------
-- 3. The journal. Entries are headers; lines are the debits/credits.
-- ---------------------------------------------------------------------------
create table if not exists pilot.journal_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  entry_date date not null check (entry_date >= date '2000-01-01'),
  memo text not null check (btrim(memo) <> '' and length(memo) <= 500),
  -- 'manual' = the pilot's own journal entry (journal_entry_create).
  -- Everything else is DERIVED by pilot.ledger_sync from a source row
  -- named by source_id — see the file header for the full posting map.
  source_type text not null default 'manual'
    check (source_type in ('manual', 'invoice_issued', 'invoice_voided',
                           'payment', 'payment_void_reclass', 'expense', 'mileage')),
  source_id uuid,
  check ((source_type = 'manual') = (source_id is null)),
  created_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.journal_entries is
  'Double-entry journal headers. Derived entries are keyed by (source_type, source_id) and UNIQUE-constrained — the idempotency that makes re-posting a no-op by index. Entries are immutable; a manual mistake is deleted (journal_entry_delete) and re-entered, a derived one is refreshed by ledger_sync when its source changes.';

-- THE idempotency enforcement. In the database, not application code —
-- same reasoning as bank_transactions_fingerprint_uniq: a check-then-write
-- races two overlapping syncs; a unique index cannot.
create unique index if not exists journal_entries_source_uniq
  on pilot.journal_entries (account_id, source_type, source_id)
  where source_id is not null;

create index if not exists journal_entries_account_date_idx
  on pilot.journal_entries (account_id, entry_date desc, created_at desc);

create table if not exists pilot.journal_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  entry_id uuid not null,
  foreign key (account_id, entry_id)
    references pilot.journal_entries (account_id, id) on delete cascade,
  chart_account_id uuid not null,
  -- RESTRICT: a chart account with history cannot vanish (it can only be
  -- archived, which keeps rendering).
  foreign key (account_id, chart_account_id)
    references pilot.accounts_chart (account_id, id) on delete restrict,
  side text not null check (side in ('debit', 'credit')),
  amount_cents bigint not null check (amount_cents > 0),
  line_no integer not null default 0 check (line_no >= 0),
  created_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.journal_lines is
  'The debits and credits. amount_cents is always positive; side carries direction. Per entry, sum(debits) = sum(credits) and at least two lines — enforced by a deferred constraint trigger, so no committed state can be unbalanced.';

create index if not exists journal_lines_entry_idx
  on pilot.journal_lines (account_id, entry_id);
create index if not exists journal_lines_chart_idx
  on pilot.journal_lines (account_id, chart_account_id);

-- ---------------------------------------------------------------------------
-- 4. Debits = credits, enforced at commit. A plain CHECK cannot span rows,
--    so this is a DEFERRABLE INITIALLY DEFERRED constraint trigger: every
--    write to an entry or its lines re-verifies the whole entry balances
--    and carries >= 2 lines, at COMMIT time, after all of a transaction's
--    inserts have landed. No committed journal state can be unbalanced —
--    not via the functions below, not via service_role, not via a future
--    code path that forgets the rule.
-- ---------------------------------------------------------------------------
create or replace function pilot.journal_entry_check_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entry_id uuid;
  v_balance bigint;
  v_count integer;
begin
  if tg_table_name = 'journal_entries' then
    v_entry_id := new.id;
  elsif tg_op = 'DELETE' then
    v_entry_id := old.entry_id;
  else
    v_entry_id := new.entry_id;
  end if;

  -- The entry itself may have been deleted in this same transaction (a
  -- manual delete, or ledger_sync's drift pass) — its lines cascaded away
  -- with it and there is nothing left to balance.
  if not exists (select 1 from pilot.journal_entries where id = v_entry_id) then
    return null;
  end if;

  select
    coalesce(sum(case side when 'debit' then amount_cents else -amount_cents end), 0),
    count(*)
  into v_balance, v_count
  from pilot.journal_lines
  where entry_id = v_entry_id;

  if v_count < 2 then
    raise exception 'journal entry % must carry at least two lines', v_entry_id;
  end if;
  if v_balance <> 0 then
    raise exception 'journal entry % is unbalanced: debits minus credits = % cents', v_entry_id, v_balance;
  end if;
  return null;
end;
$$;

create constraint trigger journal_lines_balanced
  after insert or update or delete on pilot.journal_lines
  deferrable initially deferred
  for each row execute function pilot.journal_entry_check_balanced();

create constraint trigger journal_entries_balanced
  after insert on pilot.journal_entries
  deferrable initially deferred
  for each row execute function pilot.journal_entry_check_balanced();

-- ---------------------------------------------------------------------------
-- 5. pilot.ledger_sync — the derived-posting pass. SECURITY DEFINER with
--    the in-body membership check (next_invoice_number precedent), because
--    authenticated deliberately holds NO write grants on the journal
--    tables at all: every journal write goes through this function or
--    journal_entry_create/_delete below, each a narrow named door.
--
--    Order matters: drift deletions first (so the insert pass can recreate
--    a corrected entry under the same unique key in the same transaction),
--    then entry inserts (ON CONFLICT DO NOTHING against
--    journal_entries_source_uniq), then line inserts guarded by "this
--    entry has no lines yet" — a single statement per source type, so the
--    guard is evaluated against one consistent snapshot for every UNION
--    branch and a partially-lined entry can never result.
-- ---------------------------------------------------------------------------
create or replace function pilot.ledger_sync(target_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
  v_removed bigint := 0;
  v_created bigint := 0;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and current_user <> 'service_role'
     and not exists (
       select 1 from pilot.current_account_ids() a where a = target_account_id
     )
  then
    raise exception 'not a member of account %', target_account_id;
  end if;

  -- ---- DRIFT / OBSOLESCENCE PASS ------------------------------------------
  -- Only expenses and mileage can drift: issued invoices are immutable
  -- (invoices_protect_issued) and payments have no UPDATE grant. Deleting
  -- the entry cascades its lines (and, in part 2, any reconciliation match
  -- on those lines — honest: the thing the match pointed at changed).

  -- An expense entry whose source was deleted or re-tagged 'unassigned'.
  delete from pilot.journal_entries je
  where je.account_id = target_account_id
    and je.source_type = 'expense'
    and not exists (
      select 1 from pilot.expenses e
      where e.account_id = je.account_id and e.id = je.source_id
        and e.treatment in ('deduct', 'rebill')
        and e.amount_cents > 0
    );
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;

  -- An expense entry whose date, amount or category no longer matches.
  delete from pilot.journal_entries je
  using pilot.expenses e
  where je.account_id = target_account_id
    and je.source_type = 'expense'
    and e.account_id = je.account_id and e.id = je.source_id
    and (
      je.entry_date <> e.incurred_on
      or not exists (
        select 1
        from pilot.journal_lines jl
        join pilot.accounts_chart c
          on c.account_id = jl.account_id and c.id = jl.chart_account_id
        where jl.entry_id = je.id and jl.side = 'debit'
          and jl.amount_cents = e.amount_cents
          and c.system_key = 'expense_' || e.category
      )
    );
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;

  -- Mileage: same two cases.
  delete from pilot.journal_entries je
  where je.account_id = target_account_id
    and je.source_type = 'mileage'
    and not exists (
      select 1 from pilot.mileage_entries m
      where m.account_id = je.account_id and m.id = je.source_id
        and m.amount_cents > 0
    );
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;

  delete from pilot.journal_entries je
  using pilot.mileage_entries m
  where je.account_id = target_account_id
    and je.source_type = 'mileage'
    and m.account_id = je.account_id and m.id = je.source_id
    and (
      je.entry_date <> m.drove_on
      or not exists (
        select 1 from pilot.journal_lines jl
        where jl.entry_id = je.id and jl.side = 'debit'
          and jl.amount_cents = m.amount_cents
      )
    );
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;

  -- Belt only (these sources are immutable/undeletable by the app, but a
  -- service_role correction must not strand a derived entry): drop derived
  -- entries whose source row is gone or no longer qualifies.
  delete from pilot.journal_entries je
  where je.account_id = target_account_id
    and je.source_type in ('invoice_issued', 'invoice_voided')
    and not exists (
      select 1 from pilot.invoices i
      where i.account_id = je.account_id and i.id = je.source_id
        and i.issued_on is not null and i.status <> 'draft'
        and (je.source_type <> 'invoice_voided' or i.status = 'void')
    );
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;

  delete from pilot.journal_entries je
  where je.account_id = target_account_id
    and je.source_type in ('payment', 'payment_void_reclass')
    and not exists (
      select 1
      from pilot.invoice_payments p
      join pilot.invoices i on i.account_id = p.account_id and i.id = p.invoice_id
      where p.account_id = je.account_id and p.id = je.source_id
        and (je.source_type <> 'payment_void_reclass' or i.status = 'void')
    );
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;

  -- ---- INSERT PASS: invoice_issued ----------------------------------------
  -- DR Accounts receivable (total incl. tax) / CR income per line type /
  -- CR sales tax collected. Amounts come from pilot.invoice_totals — the
  -- one place totals are computed — so the ledger can never disagree with
  -- the invoice surfaces about the same document.
  insert into pilot.journal_entries (account_id, entry_date, memo, source_type, source_id)
  select i.account_id, i.issued_on,
         'Invoice ' || coalesce(i.invoice_number, left(i.id::text, 8)) || ' issued',
         'invoice_issued', i.id
  from pilot.invoices i
  join pilot.invoice_totals t on t.invoice_id = i.id
  where i.account_id = target_account_id
    and i.issued_on is not null and i.status <> 'draft'
    and t.total_cents > 0
  on conflict (account_id, source_type, source_id) where source_id is not null do nothing;
  get diagnostics v_n = row_count; v_created := v_created + v_n;

  insert into pilot.journal_lines (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
  select x.account_id, x.entry_id, x.chart_id, x.side, x.amount_cents, x.line_no
  from (
    select je.account_id, je.id as entry_id, ar.id as chart_id,
           'debit'::text as side, t.total_cents as amount_cents, 0 as line_no
    from pilot.journal_entries je
    join pilot.invoice_totals t on t.invoice_id = je.source_id
    join pilot.accounts_chart ar
      on ar.account_id = je.account_id and ar.system_key = 'accounts_receivable'
    where je.account_id = target_account_id and je.source_type = 'invoice_issued'
    union all
    select je.account_id, je.id, c.id, 'credit', sum(l.amount_cents)::bigint, 1
    from pilot.journal_entries je
    join pilot.invoice_lines l
      on l.account_id = je.account_id and l.invoice_id = je.source_id
    join pilot.accounts_chart c
      on c.account_id = je.account_id and c.system_key = 'income_' || l.line_type
    where je.account_id = target_account_id and je.source_type = 'invoice_issued'
    group by je.account_id, je.id, c.id
    union all
    select je.account_id, je.id, tax.id, 'credit', t.tax_cents, 2
    from pilot.journal_entries je
    join pilot.invoice_totals t on t.invoice_id = je.source_id
    join pilot.accounts_chart tax
      on tax.account_id = je.account_id and tax.system_key = 'sales_tax_payable'
    where je.account_id = target_account_id and je.source_type = 'invoice_issued'
  ) x
  where x.amount_cents > 0
    and not exists (select 1 from pilot.journal_lines jl where jl.entry_id = x.entry_id);

  -- ---- INSERT PASS: invoice_voided ----------------------------------------
  -- The exact mirror image of the issue entry, dated at issue — see the
  -- file header for why the reversal is retroactive.
  insert into pilot.journal_entries (account_id, entry_date, memo, source_type, source_id)
  select i.account_id, i.issued_on,
         'Invoice ' || coalesce(i.invoice_number, left(i.id::text, 8)) || ' voided',
         'invoice_voided', i.id
  from pilot.invoices i
  join pilot.invoice_totals t on t.invoice_id = i.id
  where i.account_id = target_account_id
    and i.issued_on is not null and i.status = 'void'
    and t.total_cents > 0
  on conflict (account_id, source_type, source_id) where source_id is not null do nothing;
  get diagnostics v_n = row_count; v_created := v_created + v_n;

  insert into pilot.journal_lines (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
  select x.account_id, x.entry_id, x.chart_id, x.side, x.amount_cents, x.line_no
  from (
    select je.account_id, je.id as entry_id, ar.id as chart_id,
           'credit'::text as side, t.total_cents as amount_cents, 0 as line_no
    from pilot.journal_entries je
    join pilot.invoice_totals t on t.invoice_id = je.source_id
    join pilot.accounts_chart ar
      on ar.account_id = je.account_id and ar.system_key = 'accounts_receivable'
    where je.account_id = target_account_id and je.source_type = 'invoice_voided'
    union all
    select je.account_id, je.id, c.id, 'debit', sum(l.amount_cents)::bigint, 1
    from pilot.journal_entries je
    join pilot.invoice_lines l
      on l.account_id = je.account_id and l.invoice_id = je.source_id
    join pilot.accounts_chart c
      on c.account_id = je.account_id and c.system_key = 'income_' || l.line_type
    where je.account_id = target_account_id and je.source_type = 'invoice_voided'
    group by je.account_id, je.id, c.id
    union all
    select je.account_id, je.id, tax.id, 'debit', t.tax_cents, 2
    from pilot.journal_entries je
    join pilot.invoice_totals t on t.invoice_id = je.source_id
    join pilot.accounts_chart tax
      on tax.account_id = je.account_id and tax.system_key = 'sales_tax_payable'
    where je.account_id = target_account_id and je.source_type = 'invoice_voided'
  ) x
  where x.amount_cents > 0
    and not exists (select 1 from pilot.journal_lines jl where jl.entry_id = x.entry_id);

  -- ---- INSERT PASS: payments (incl. reversal rows) ------------------------
  -- A payment row: DR Cash & bank / CR Accounts receivable. A reversal row
  -- (amount < 0, 20260810120000) is the same entry mirrored. One derived
  -- entry per pilot.invoice_payments row, so the ledger's cash movement
  -- for a period is exactly the sum the P&L reads from the same table.
  insert into pilot.journal_entries (account_id, entry_date, memo, source_type, source_id)
  select p.account_id, p.paid_on,
         case when p.amount_cents > 0
           then 'Payment received — invoice ' || coalesce(i.invoice_number, left(i.id::text, 8))
           else 'Payment reversed — invoice ' || coalesce(i.invoice_number, left(i.id::text, 8))
         end,
         'payment', p.id
  from pilot.invoice_payments p
  join pilot.invoices i on i.account_id = p.account_id and i.id = p.invoice_id
  where p.account_id = target_account_id
  on conflict (account_id, source_type, source_id) where source_id is not null do nothing;
  get diagnostics v_n = row_count; v_created := v_created + v_n;

  insert into pilot.journal_lines (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
  select x.account_id, x.entry_id, x.chart_id, x.side, x.amount_cents, x.line_no
  from (
    select je.account_id, je.id as entry_id, bank.id as chart_id,
           case when p.amount_cents > 0 then 'debit' else 'credit' end as side,
           abs(p.amount_cents) as amount_cents, 0 as line_no
    from pilot.journal_entries je
    join pilot.invoice_payments p on p.account_id = je.account_id and p.id = je.source_id
    join pilot.accounts_chart bank
      on bank.account_id = je.account_id and bank.system_key = 'bank'
    where je.account_id = target_account_id and je.source_type = 'payment'
    union all
    select je.account_id, je.id, ar.id,
           case when p.amount_cents > 0 then 'credit' else 'debit' end,
           abs(p.amount_cents), 1
    from pilot.journal_entries je
    join pilot.invoice_payments p on p.account_id = je.account_id and p.id = je.source_id
    join pilot.accounts_chart ar
      on ar.account_id = je.account_id and ar.system_key = 'accounts_receivable'
    where je.account_id = target_account_id and je.source_type = 'payment'
  ) x
  where x.amount_cents > 0
    and not exists (select 1 from pilot.journal_lines jl where jl.entry_id = x.entry_id);

  -- ---- INSERT PASS: payments held against voided invoices -----------------
  -- DR Accounts receivable / CR Client funds held, dated at the payment —
  -- the money stays real in Cash & bank while income and AR both correctly
  -- exclude it. See the file header ("VOIDED INVOICES").
  insert into pilot.journal_entries (account_id, entry_date, memo, source_type, source_id)
  select p.account_id, p.paid_on,
         'Payment held — invoice ' || coalesce(i.invoice_number, left(i.id::text, 8)) || ' voided',
         'payment_void_reclass', p.id
  from pilot.invoice_payments p
  join pilot.invoices i on i.account_id = p.account_id and i.id = p.invoice_id
  where p.account_id = target_account_id and i.status = 'void'
  on conflict (account_id, source_type, source_id) where source_id is not null do nothing;
  get diagnostics v_n = row_count; v_created := v_created + v_n;

  insert into pilot.journal_lines (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
  select x.account_id, x.entry_id, x.chart_id, x.side, x.amount_cents, x.line_no
  from (
    select je.account_id, je.id as entry_id, ar.id as chart_id,
           case when p.amount_cents > 0 then 'debit' else 'credit' end as side,
           abs(p.amount_cents) as amount_cents, 0 as line_no
    from pilot.journal_entries je
    join pilot.invoice_payments p on p.account_id = je.account_id and p.id = je.source_id
    join pilot.accounts_chart ar
      on ar.account_id = je.account_id and ar.system_key = 'accounts_receivable'
    where je.account_id = target_account_id and je.source_type = 'payment_void_reclass'
    union all
    select je.account_id, je.id, held.id,
           case when p.amount_cents > 0 then 'credit' else 'debit' end,
           abs(p.amount_cents), 1
    from pilot.journal_entries je
    join pilot.invoice_payments p on p.account_id = je.account_id and p.id = je.source_id
    join pilot.accounts_chart held
      on held.account_id = je.account_id and held.system_key = 'client_credit'
    where je.account_id = target_account_id and je.source_type = 'payment_void_reclass'
  ) x
  where x.amount_cents > 0
    and not exists (select 1 from pilot.journal_lines jl where jl.entry_id = x.entry_id);

  -- ---- INSERT PASS: expenses (deduct + rebill only) -----------------------
  -- DR the category's expense account / CR Cash & bank. 'unassigned' rows
  -- are excluded exactly as the P&L excludes them. Both 'deduct' and
  -- 'rebill' post: a rebilled cost is a real cash outflow (the P&L's own
  -- corrected REBILL DECISION), and its reimbursement arrives inside a
  -- payment entry above.
  insert into pilot.journal_entries (account_id, entry_date, memo, source_type, source_id)
  select e.account_id, e.incurred_on,
         left('Expense — ' || coalesce(nullif(btrim(e.vendor), ''), e.category), 500),
         'expense', e.id
  from pilot.expenses e
  where e.account_id = target_account_id
    and e.treatment in ('deduct', 'rebill')
    and e.amount_cents > 0
  on conflict (account_id, source_type, source_id) where source_id is not null do nothing;
  get diagnostics v_n = row_count; v_created := v_created + v_n;

  insert into pilot.journal_lines (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
  select x.account_id, x.entry_id, x.chart_id, x.side, x.amount_cents, x.line_no
  from (
    select je.account_id, je.id as entry_id, c.id as chart_id,
           'debit'::text as side, e.amount_cents, 0 as line_no
    from pilot.journal_entries je
    join pilot.expenses e on e.account_id = je.account_id and e.id = je.source_id
    join pilot.accounts_chart c
      on c.account_id = je.account_id and c.system_key = 'expense_' || e.category
    where je.account_id = target_account_id and je.source_type = 'expense'
    union all
    select je.account_id, je.id, bank.id, 'credit', e.amount_cents, 1
    from pilot.journal_entries je
    join pilot.expenses e on e.account_id = je.account_id and e.id = je.source_id
    join pilot.accounts_chart bank
      on bank.account_id = je.account_id and bank.system_key = 'bank'
    where je.account_id = target_account_id and je.source_type = 'expense'
  ) x
  where x.amount_cents > 0
    and not exists (select 1 from pilot.journal_lines jl where jl.entry_id = x.entry_id);

  -- ---- INSERT PASS: mileage -----------------------------------------------
  -- DR Vehicle — standard mileage / CR Owner contributions. Non-cash and
  -- owner-funded by design — see the file header ("MILEAGE").
  insert into pilot.journal_entries (account_id, entry_date, memo, source_type, source_id)
  select m.account_id, m.drove_on,
         left('Mileage — ' || m.from_place || ' to ' || m.to_place, 500),
         'mileage', m.id
  from pilot.mileage_entries m
  where m.account_id = target_account_id
    and m.amount_cents > 0
  on conflict (account_id, source_type, source_id) where source_id is not null do nothing;
  get diagnostics v_n = row_count; v_created := v_created + v_n;

  insert into pilot.journal_lines (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
  select x.account_id, x.entry_id, x.chart_id, x.side, x.amount_cents, x.line_no
  from (
    select je.account_id, je.id as entry_id, c.id as chart_id,
           'debit'::text as side, m.amount_cents, 0 as line_no
    from pilot.journal_entries je
    join pilot.mileage_entries m on m.account_id = je.account_id and m.id = je.source_id
    join pilot.accounts_chart c
      on c.account_id = je.account_id and c.system_key = 'expense_mileage'
    where je.account_id = target_account_id and je.source_type = 'mileage'
    union all
    select je.account_id, je.id, oc.id, 'credit', m.amount_cents, 1
    from pilot.journal_entries je
    join pilot.mileage_entries m on m.account_id = je.account_id and m.id = je.source_id
    join pilot.accounts_chart oc
      on oc.account_id = je.account_id and oc.system_key = 'owner_contributions'
    where je.account_id = target_account_id and je.source_type = 'mileage'
  ) x
  where x.amount_cents > 0
    and not exists (select 1 from pilot.journal_lines jl where jl.entry_id = x.entry_id);

  return jsonb_build_object('created', v_created, 'removed', v_removed);
end;
$$;

revoke all on function pilot.ledger_sync(uuid) from public;
grant execute on function pilot.ledger_sync(uuid) to authenticated, service_role;

comment on function pilot.ledger_sync(uuid) is
  'Derives ledger entries from invoices/payments/expenses/mileage, idempotently: entries are keyed (source_type, source_id) against journal_entries_source_uniq and inserted ON CONFLICT DO NOTHING, so re-running (or racing) can never double-post. Drifted expense/mileage entries are deleted and re-derived in the same transaction. SECURITY DEFINER with the in-body current_account_ids() membership check — the check IS the tenancy boundary; never remove it.';

-- ---------------------------------------------------------------------------
-- 6. Manual journal entries — the pilot's own two-plus-line entries.
--    One SECURITY DEFINER function per verb (the bank_transaction_confirm
--    precedent): entry + lines land in ONE transaction, which the deferred
--    balance trigger then verifies at commit. There is deliberately no
--    direct INSERT path for authenticated — a header-only insert could
--    never satisfy the min-two-lines rule across PostgREST's
--    one-statement-per-request boundary.
-- ---------------------------------------------------------------------------
create or replace function pilot.journal_entry_create(
  target_account_id uuid,
  p_entry_date date,
  p_memo text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_chart uuid;
  v_side text;
  v_amount numeric;
  v_idx integer := 0;
  v_debits bigint := 0;
  v_credits bigint := 0;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and current_user <> 'service_role'
     and not exists (
       select 1 from pilot.current_account_ids() a where a = target_account_id
     )
  then
    raise exception 'not a member of account %', target_account_id;
  end if;

  if p_entry_date is null or p_entry_date < date '2000-01-01'
     or p_entry_date > current_date + 1 then
    -- current_date + 1: same worldwide-timezone allowance as
    -- invoice_payments.paid_on (20260805090000).
    raise exception 'a journal entry needs a date between 2000 and today';
  end if;
  if p_memo is null or btrim(p_memo) = '' or length(p_memo) > 500 then
    raise exception 'a journal entry needs a memo (up to 500 characters)';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal entry needs at least two lines';
  end if;
  if jsonb_array_length(p_lines) > 30 then
    raise exception 'a journal entry can carry at most 30 lines';
  end if;

  insert into pilot.journal_entries (account_id, entry_date, memo, source_type, source_id)
  values (target_account_id, p_entry_date, btrim(p_memo), 'manual', null)
  returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_side := v_line->>'side';
    if v_side is null or v_side not in ('debit', 'credit') then
      raise exception 'each line must be a debit or a credit';
    end if;

    begin
      v_chart := (v_line->>'chart_account_id')::uuid;
    exception when invalid_text_representation then
      v_chart := null;
    end;
    if v_chart is null or not exists (
      select 1 from pilot.accounts_chart c
      where c.account_id = target_account_id and c.id = v_chart
        and c.archived_at is null
    ) then
      raise exception 'each line must name one of your active ledger accounts';
    end if;

    v_amount := null;
    begin
      v_amount := (v_line->>'amount_cents')::numeric;
    exception when invalid_text_representation then
      v_amount := null;
    end;
    if v_amount is null or v_amount <> trunc(v_amount)
       or v_amount <= 0 or v_amount > 1e15 then
      raise exception 'each line needs a positive whole number of cents';
    end if;

    insert into pilot.journal_lines
      (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
    values (target_account_id, v_entry_id, v_chart, v_side, v_amount::bigint, v_idx);

    if v_side = 'debit' then v_debits := v_debits + v_amount::bigint;
    else v_credits := v_credits + v_amount::bigint;
    end if;
    v_idx := v_idx + 1;
  end loop;

  -- The deferred trigger would also catch this at commit; raising here
  -- names the amounts, which is the message a pilot can act on.
  if v_debits <> v_credits then
    raise exception 'debits (%) must equal credits (%) — the entry is unbalanced',
      v_debits, v_credits;
  end if;

  return v_entry_id;
end;
$$;

revoke all on function pilot.journal_entry_create(uuid, date, text, jsonb) from public;
grant execute on function pilot.journal_entry_create(uuid, date, text, jsonb) to authenticated, service_role;

comment on function pilot.journal_entry_create(uuid, date, text, jsonb) is
  'The one write path for a MANUAL journal entry: header + lines in one transaction, two-line minimum, debits = credits or a P0001 naming both sums. SECURITY DEFINER, membership-checked in the body — same narrow-named-door shape as bank_transaction_confirm.';

create or replace function pilot.journal_entry_delete(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_source_type text;
begin
  select account_id, source_type into v_account, v_source_type
  from pilot.journal_entries where id = p_entry_id;

  if v_account is null or (
       coalesce(current_setting('role', true), '') <> 'service_role'
       and current_user <> 'service_role'
       and not exists (select 1 from pilot.current_account_ids() a where a = v_account)
     )
  then
    raise exception 'that journal entry is not recognized';
  end if;
  if v_source_type <> 'manual' then
    raise exception 'this entry is derived from your records — it updates or clears automatically when its source changes';
  end if;

  delete from pilot.journal_entries where id = p_entry_id;
end;
$$;

revoke all on function pilot.journal_entry_delete(uuid) from public;
grant execute on function pilot.journal_entry_delete(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Read shapes for the reports. SECURITY INVOKER on purpose (the
--    bank_transaction_duplicate_candidates precedent): they read the
--    caller's own rows under the caller's own RLS. Aggregation happens in
--    the database so the balance sheet reads ~30 rows regardless of how
--    many thousands of journal lines exist — the Data API's silent
--    1000-row truncation can never shortchange a per-account balance.
--    balance_cents is the raw signed sum (debits positive); the report
--    layer presents each kind in its natural sign.
-- ---------------------------------------------------------------------------
create or replace function pilot.ledger_balances(
  target_account_id uuid,
  through_date date
)
returns table (
  chart_account_id uuid,
  name text,
  kind text,
  system_key text,
  archived boolean,
  balance_cents bigint,
  line_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.kind,
    c.system_key,
    c.archived_at is not null,
    coalesce(sum(
      case jl.side when 'debit' then jl.amount_cents else -jl.amount_cents end
    ) filter (where je.entry_date <= through_date), 0)::bigint,
    count(jl.id) filter (where je.entry_date <= through_date)
  from pilot.accounts_chart c
  left join pilot.journal_lines jl
    on jl.account_id = c.account_id and jl.chart_account_id = c.id
  left join pilot.journal_entries je
    on je.account_id = jl.account_id and je.id = jl.entry_id
  where c.account_id = target_account_id
  group by c.id, c.name, c.kind, c.system_key, c.archived_at
$$;

revoke all on function pilot.ledger_balances(uuid, date) from public;
grant execute on function pilot.ledger_balances(uuid, date) to authenticated, service_role;

-- Cash flow: every entry that moves 'bank' in the period, attributed to
-- its counterpart (non-bank) lines. Because every entry balances, each
-- counterpart line's negated signed amount is exactly its share of the
-- cash movement, so these rows sum to the period's net cash change.
create or replace function pilot.ledger_cash_flow(
  target_account_id uuid,
  period_start date,
  period_end date
)
returns table (
  chart_account_id uuid,
  name text,
  kind text,
  system_key text,
  cash_cents bigint,
  entry_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.kind,
    c.system_key,
    sum(-(case jl.side when 'debit' then jl.amount_cents else -jl.amount_cents end))::bigint,
    count(distinct je.id)
  from pilot.journal_entries je
  join pilot.journal_lines jl
    on jl.account_id = je.account_id and jl.entry_id = je.id
  join pilot.accounts_chart c
    on c.account_id = jl.account_id and c.id = jl.chart_account_id
  where je.account_id = target_account_id
    and je.entry_date between period_start and period_end
    and c.system_key is distinct from 'bank'
    and exists (
      select 1
      from pilot.journal_lines b
      join pilot.accounts_chart bc
        on bc.account_id = b.account_id and bc.id = b.chart_account_id
      where b.account_id = je.account_id and b.entry_id = je.id
        and bc.system_key = 'bank'
    )
  group by c.id, c.name, c.kind, c.system_key
$$;

revoke all on function pilot.ledger_cash_flow(uuid, date, date) from public;
grant execute on function pilot.ledger_cash_flow(uuid, date, date) to authenticated, service_role;

-- The Cash & bank lines themselves, for the reconciliation surface (part
-- 2) and the ledger screen: one row per bank-account journal line with its
-- entry's facts alongside, so the caller needs no client-side join. The
-- CALLER applies .limit() and the length===limit truncation check, per the
-- house 1000-row discipline.
create or replace function pilot.ledger_bank_lines(
  target_account_id uuid,
  period_start date,
  period_end date
)
returns table (
  journal_line_id uuid,
  entry_id uuid,
  entry_date date,
  memo text,
  source_type text,
  signed_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    jl.id,
    je.id,
    je.entry_date,
    je.memo,
    je.source_type,
    (case jl.side when 'debit' then jl.amount_cents else -jl.amount_cents end)::bigint
  from pilot.journal_entries je
  join pilot.journal_lines jl
    on jl.account_id = je.account_id and jl.entry_id = je.id
  join pilot.accounts_chart c
    on c.account_id = jl.account_id and c.id = jl.chart_account_id
  where je.account_id = target_account_id
    and je.entry_date between period_start and period_end
    and c.system_key = 'bank'
  order by je.entry_date asc, je.created_at asc, jl.line_no asc
$$;

revoke all on function pilot.ledger_bank_lines(uuid, date, date) from public;
grant execute on function pilot.ledger_bank_lines(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. RLS — enabled here, in these tables' own first migration.
-- ---------------------------------------------------------------------------
alter table pilot.accounts_chart  enable row level security;
alter table pilot.journal_entries enable row level security;
alter table pilot.journal_lines   enable row level security;

create policy accounts_chart_select on pilot.accounts_chart for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy accounts_chart_insert on pilot.accounts_chart for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy accounts_chart_update on pilot.accounts_chart for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
-- Deliberately no DELETE policy on accounts_chart: archive is the removal
-- story; a chart account with posted lines is history.

create policy journal_entries_select on pilot.journal_entries for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy journal_lines_select on pilot.journal_lines for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
-- Deliberately NO insert/update/delete policies on the journal tables for
-- authenticated: every write goes through ledger_sync /
-- journal_entry_create / journal_entry_delete (SECURITY DEFINER, each with
-- its own membership check). A direct write would bypass the balanced-
-- entry discipline those doors exist to enforce, so the door does not
-- exist — same shape as invoice_number_sequences.

-- ---------------------------------------------------------------------------
-- 9. Grants. ADDED, never re-granted after a revoke (README's revoke
--    trap). authenticated: read everywhere; write only on accounts_chart,
--    column-scoped — system_key and account-identity columns are withheld
--    (the protect trigger additionally guards kind/system_key/archive
--    transitions per-row).
-- ---------------------------------------------------------------------------
grant select on pilot.accounts_chart, pilot.journal_entries, pilot.journal_lines
  to authenticated;

grant insert (account_id, name, kind) on pilot.accounts_chart to authenticated;
grant update (name, archived_at) on pilot.accounts_chart to authenticated;

grant select, insert, update, delete
  on pilot.accounts_chart, pilot.journal_entries, pilot.journal_lines
  to service_role;
