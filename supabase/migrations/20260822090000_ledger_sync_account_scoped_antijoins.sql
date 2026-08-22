-- ===========================================================================
-- ledger_sync: give the eight anti-joins over journal_lines their account_id
--
-- WHAT CHANGES. Nothing about what pilot.ledger_sync derives, deletes or
-- returns. The function below is 20260812100000's body verbatim — same
-- membership check, same drift pass, same six insert passes, same
-- ON CONFLICT keys, same return shape — with exactly eight predicates
-- added, one per correlated `not exists (select 1 from pilot.journal_lines
-- jl where jl.entry_id = ...)`:
--
--     and jl.account_id = <the enclosing row's account_id>
--
-- Two are in the drift pass (the expense and mileage "lines no longer
-- match" checks, 20260812100000:441 and :468); six are the "this entry has
-- no lines yet" guards on the line inserts (:545, :590, :632, :670, :708,
-- :742).
--
-- WHY. The only index naming entry_id is journal_lines_entry_idx
-- (account_id, entry_id) — account_id LEADING. An anti-join that binds
-- entry_id alone cannot use it as an index condition and degrades to a
-- full-index scan per candidate row. These run inside the pass that fires
-- on every load of /accounting, /accounting/journal, /accounting/reconcile,
-- /reports/cash-flow and /reports/balance-sheet, so the cost is paid on
-- page renders, not on a nightly job.
--
-- WHY IT IS PROVABLY NOT A SEMANTIC CHANGE, which is the only reason this
-- is a safe edit to a money-path function at all. pilot.journal_lines
-- carries a COMPOSITE foreign key (account_id, entry_id) references
-- pilot.journal_entries (account_id, id). A line's account_id is therefore
-- already, by the constraint, equal to the account_id of the entry its
-- entry_id names. Adding `jl.account_id = <that entry's account_id>`
-- restates a fact the database already enforces: the predicate can remove
-- no row the old form matched and admit none it did not. It is a planner
-- hint written as SQL, not a filter.
--
-- Replay-safe and re-runnable: `create or replace function` with the same
-- signature, plus the same revoke/grant/comment trio the original file
-- ends with, all of which are idempotent.
--
-- NOT CHANGED HERE, deliberately: the missing watermark (this pass still
-- re-derives the tenant's whole history on every call). That wants a schema
-- column and a real decision about staleness; this file is the free half.
-- ===========================================================================

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
        where jl.account_id = je.account_id and jl.entry_id = je.id and jl.side = 'debit'
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
        where jl.account_id = je.account_id and jl.entry_id = je.id and jl.side = 'debit'
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
    and not exists (
      select 1 from pilot.journal_lines jl
      where jl.account_id = x.account_id and jl.entry_id = x.entry_id
    );

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
    and not exists (
      select 1 from pilot.journal_lines jl
      where jl.account_id = x.account_id and jl.entry_id = x.entry_id
    );

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
    and not exists (
      select 1 from pilot.journal_lines jl
      where jl.account_id = x.account_id and jl.entry_id = x.entry_id
    );

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
    and not exists (
      select 1 from pilot.journal_lines jl
      where jl.account_id = x.account_id and jl.entry_id = x.entry_id
    );

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
    and not exists (
      select 1 from pilot.journal_lines jl
      where jl.account_id = x.account_id and jl.entry_id = x.entry_id
    );

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
    and not exists (
      select 1 from pilot.journal_lines jl
      where jl.account_id = x.account_id and jl.entry_id = x.entry_id
    );

  return jsonb_build_object('created', v_created, 'removed', v_removed);
end;
$$;

revoke all on function pilot.ledger_sync(uuid) from public;
grant execute on function pilot.ledger_sync(uuid) to authenticated, service_role;

comment on function pilot.ledger_sync(uuid) is
  'Derives ledger entries from invoices/payments/expenses/mileage, idempotently: entries are keyed (source_type, source_id) against journal_entries_source_uniq and inserted ON CONFLICT DO NOTHING, so re-running (or racing) can never double-post. Drifted expense/mileage entries are deleted and re-derived in the same transaction. SECURITY DEFINER with the in-body current_account_ids() membership check — the check IS the tenancy boundary; never remove it. Every anti-join over journal_lines binds account_id as well as entry_id (20260822090000) so journal_lines_entry_idx (account_id, entry_id) is usable as an index condition; the composite FK makes that a restatement, never a filter.';
