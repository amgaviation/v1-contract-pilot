-- Confirming a bank transaction becomes ONE statement, and the same spend
-- entered twice becomes visible before it reaches a client.
--
-- ***************************************************************************
-- THREE DEFECTS, ONE CAUSE: confirmTransaction was three round trips
-- ***************************************************************************
-- app/(app)/expenses/transactions/actions.ts confirmed a reviewed
-- transaction in three separate PostgREST calls — claim, insert the
-- expense, attach the link. Each is its own transaction, so the gaps
-- between them are real states the database can be left in:
--
--   CONFIRM-1  Process death between the claim and the insert commits
--              review_state='reviewed' with expense_id null and NO
--              expense. The row then vanishes from every surface: the
--              queue filters on 'unreviewed', the badge counts the same,
--              and nothing anywhere selects reviewed-with-null-expense.
--              The money is silently absent from the books, and a retry
--              is told "That transaction has already been reviewed" —
--              the product affirmatively reporting the row as handled
--              while nothing is on the books.
--
--   CONFIRM-2  A LOST REPLY on the expense insert is indistinguishable
--              from a REJECTED insert: postgrest-js synthesises
--              {error:{message:"TypeError: fetch failed"}, status:0},
--              which the code treats exactly like a 400. It reverts the
--              claim and invites a retry — so the committed-but-unreported
--              expense gets a sibling. One bank line, two expenses, both
--              rebillable.
--
-- Both are gone if the claim and the insert are the same transaction.
-- This repo already has the pattern for that and does not need the
-- service-role client for it: pilot.invoice_share_create,
-- pilot.connect_account_link and pilot.generate_recurring_invoice are all
-- SECURITY DEFINER functions scoped by pilot.current_account_ids(). An
-- RPC is not a second privileged entry point in the sense
-- lib/supabase/service-role.ts's header guards against — it is a narrow,
-- named door that re-derives the caller from auth.uid() and can be read
-- in one sitting.
--
--   BX-2/BX-3  Nothing compared an incoming bank row against expenses
--              ALREADY in the books. A pilot photographs a $312.00 hotel
--              folio and files it rebill; a month later the card
--              statement imports the same charge; both count. Driven
--              end-to-end in review, the client's own invoice read back
--              total_cents: 62400 for one $312.00 stay — as two lines
--              that don't even look alike, because the imported one
--              carries the raw bank descriptor and the manual one the
--              pilot's own vendor text. It reads as a two-night stay.
--
-- ***************************************************************************
-- WHY A WARNING AND NOT A BLOCK
-- ***************************************************************************
-- Two identical same-day charges are real — two crew meals at the same
-- airport restaurant, a toll plaza charged both directions, two $4.75
-- coffees. Refusing them would be wrong, and createInvoiceDraft has no way
-- to tell a genuine pair from a duplicate either. So the probe SURFACES
-- and the pilot decides. The one thing that is enforced in the database is
-- the idempotency key below, which stops the same TRANSACTION becoming two
-- expenses — a case with no legitimate reading at all.
-- ***************************************************************************

-- ---------------------------------------------------------------------------
-- 1. The idempotency key. A retry after a lost reply now costs a 23505
--    instead of a second expense.
--
--    Deliberately NOT a foreign key: pilot.bank_transactions already
--    references pilot.expenses, and adding the mirror would make a cycle
--    with two ON DELETE SET NULLs in it. The authoritative lineage link
--    stays bank_transactions.expense_id; this column exists to be UNIQUE,
--    not to be joined.
-- ---------------------------------------------------------------------------
alter table pilot.expenses
  add column if not exists bank_transaction_id uuid;

comment on column pilot.expenses.bank_transaction_id is
  'The bank transaction this expense was confirmed from, if any. Exists to make confirming idempotent — expenses_bank_transaction_uniq means a retry after a lost reply raises 23505 instead of creating a second expense. Not a FK (that would close a cycle with bank_transactions.expense_id); the lineage link of record is bank_transactions.expense_id.';

create unique index if not exists expenses_bank_transaction_uniq
  on pilot.expenses (account_id, bank_transaction_id)
  where bank_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 2. pilot.bank_transaction_duplicate_candidates — what the pilot is shown
--    BEFORE they confirm.
--
--    SECURITY INVOKER, deliberately: it reads the caller's own expenses
--    and must obey RLS like any other read. There is nothing here that
--    needs to see past a policy, so it does not.
-- ---------------------------------------------------------------------------
create or replace function pilot.bank_transaction_duplicate_candidates(
  p_transaction_id uuid,
  p_day_window int default 4
)
returns table (
  expense_id uuid,
  incurred_on date,
  vendor text,
  amount_cents bigint,
  treatment text,
  already_from_bank boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.incurred_on, e.vendor, e.amount_cents, e.treatment,
         e.bank_transaction_id is not null
  from pilot.bank_transactions t
  join pilot.expenses e
    on e.account_id = t.account_id
   and e.amount_cents = abs(t.amount_cents)
   and e.incurred_on between t.posted_on - p_day_window and t.posted_on + p_day_window
  where t.id = p_transaction_id
    and t.account_id in (select pilot.current_account_ids())
    -- The expense this very transaction already became is not a duplicate
    -- of itself.
    and (e.bank_transaction_id is distinct from t.id)
  order by e.incurred_on desc
  limit 10;
$$;

revoke all on function pilot.bank_transaction_duplicate_candidates(uuid, int) from public;
grant execute on function pilot.bank_transaction_duplicate_candidates(uuid, int) to authenticated;

comment on function pilot.bank_transaction_duplicate_candidates(uuid, int) is
  'Expenses already in the books that look like the same spend as this bank transaction — same account, same absolute amount, within a few days. Matching on amount+date rather than description on purpose: the imported row carries the raw bank descriptor ("SYNTH INN 88 SYNTHETIC RD") while the manual one carries whatever the pilot typed ("SYNTH INN 88"), so the descriptions are exactly what does NOT match on a real duplicate. Advisory only — two identical same-day charges are legitimate.';

-- Keeps the probe cheap as a ledger grows.
create index if not exists expenses_account_amount_incurred_idx
  on pilot.expenses (account_id, amount_cents, incurred_on);

-- ---------------------------------------------------------------------------
-- 3. pilot.bank_transaction_confirm — claim + insert + attach, atomically.
--
--    Everything the old three-call sequence did, in one transaction, with
--    the same validation. Returns the new expense id.
-- ---------------------------------------------------------------------------
create or replace function pilot.bank_transaction_confirm(
  p_transaction_id uuid,
  p_category text,
  p_treatment text,
  p_trip_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn pilot.bank_transactions%rowtype;
  v_expense_id uuid;
begin
  -- FOR UPDATE, not a bare select: two confirms racing the same row must
  -- serialize here rather than both passing the unreviewed check.
  select * into v_txn
  from pilot.bank_transactions
  where id = p_transaction_id
    and account_id in (select pilot.current_account_ids())
  for update;

  if v_txn.id is null then
    raise exception 'that transaction is not recognized';
  end if;
  if v_txn.review_state <> 'unreviewed' then
    raise exception 'that transaction has already been reviewed';
  end if;
  if v_txn.amount_cents >= 0 then
    raise exception 'that transaction is a deposit or refund, not an expense';
  end if;
  if p_treatment = 'rebill' and p_trip_id is null then
    raise exception 'an expense cannot be rebilled to nobody';
  end if;

  insert into pilot.expenses
    (account_id, trip_id, incurred_on, category, vendor, amount_cents, treatment, notes, bank_transaction_id)
  values (
    v_txn.account_id,
    p_trip_id,
    v_txn.posted_on,
    p_category,
    left(v_txn.description, 500),
    abs(v_txn.amount_cents),
    p_treatment,
    case when p_notes is null or p_notes = ''
      then 'Imported from bank statement.'
      else 'Imported from bank statement — ' || p_notes end,
    v_txn.id
  )
  returning id into v_expense_id;

  update pilot.bank_transactions
    set review_state = 'reviewed',
        category = p_category,
        treatment = p_treatment,
        trip_id = p_trip_id,
        notes = p_notes,
        expense_id = v_expense_id
    where id = v_txn.id;

  return v_expense_id;
end;
$$;

revoke all on function pilot.bank_transaction_confirm(uuid, text, text, uuid, text) from public;
grant execute on function pilot.bank_transaction_confirm(uuid, text, text, uuid, text) to authenticated;

comment on function pilot.bank_transaction_confirm(uuid, text, text, uuid, text) is
  'Confirms a bank transaction into an expense as ONE transaction. Replaces a three-round-trip sequence whose gaps were real, reachable states: dying between the claim and the insert stranded the row reviewed with no expense and invisible on every surface, and a lost reply on the insert was indistinguishable from a rejection, so the revert-and-retry produced two expenses for one bank line. SECURITY DEFINER but scoped by pilot.current_account_ids() and locking the row FOR UPDATE — it is a narrow named door, not a widening of lib/supabase/service-role.ts.';

-- DELIBERATELY NOT DONE HERE: narrowing the UPDATE grant.
--
-- The obvious companion change is to revoke UPDATE on
-- pilot.bank_transactions and re-grant only (review_state, notes), so a
-- hand-rolled request could not recreate the un-atomic three-step
-- sequence this migration exists to remove. It is the right change and it
-- is not in this migration, for a reason worth writing down rather than
-- discovering later.
--
-- Attempting it here broke four existing assertions in
-- scripts/bank-import-verify.mjs — BANK-REVIEW-1/2/3 and BANK-FK-1 — all
-- of which reach the reviewed state by direct UPDATE because that was the
-- only path when they were written. They would each need rewriting: the
-- two that assert a CHECK (a rebill with no trip; reviewed without
-- category+treatment) should exercise it as a privileged role, since the
-- CHECK is what they test and the grant is incidental; the ones that
-- perform a legitimate confirm should call this function instead.
--
-- That is a careful pass over four probes whose whole value is that they
-- fail for the RIGHT reason, and bundling it into a migration that
-- already changes the confirm path would mean changing the code under
-- test and the test in the same breath. Split out on purpose.
--
-- What is already closed regardless: 20260810030000 withholds
-- review_state/category/treatment from the INSERT grant, so a transaction
-- still cannot be BORN reviewed (BANK-GRANT-2), and the application no
-- longer has any direct-update path — confirmTransaction calls this
-- function and nothing else.
