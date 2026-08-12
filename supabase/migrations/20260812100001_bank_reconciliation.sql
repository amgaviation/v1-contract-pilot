-- ===========================================================================
-- Accounting core, part 2 of 2 — bank statement reconciliation
--
-- WHAT RECONCILIATION IS HERE. The repo already imports real bank/card
-- statements into pilot.bank_transactions (20260809070000, one canonical
-- sign: negative = money left the pilot's pocket) and the ledger's Cash &
-- bank account (part 1, 20260812100000) carries what the BOOKS say moved.
-- Reconciliation is the pilot pairing those two, line by line: a statement
-- row matched to a ledger bank line is "cleared", and whatever cannot be
-- paired is the difference the pilot has to explain — an expense never
-- recorded, a deposit never invoiced, a personal charge on the business
-- card. The match state persists here.
--
-- SIGN ALIGNMENT, the fact that makes matching a single equality:
-- bank_transactions.amount_cents is canonically signed (negative = out),
-- and a ledger bank line's signed value is +amount for a debit (money in)
-- and -amount for a credit (money out). A match therefore requires
-- statement.amount_cents == ledger signed amount, EXACTLY — enforced by
-- trigger below, so a "match" can never silently bridge two different
-- amounts and fake a zero difference.
--
-- ONE-TO-ONE ONLY, by unique index in both directions: a statement line
-- clears at most one ledger line and vice versa. A batched deposit (two
-- payments arriving as one statement line) does NOT match in v1 — both
-- sides stay visibly unreconciled and count into the difference figure,
-- which is honest, and the split is a manual journal entry away. Stated
-- here so nobody reads the 1:1 rule as an oversight.
--
-- Inherits: composite (account_id, id) FKs, RLS from first migration,
-- column-scoped grants, no service-role app path.
-- ===========================================================================

create table if not exists pilot.bank_statement_matches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,

  bank_transaction_id uuid not null,
  -- CASCADE: if an imported statement row is ever removed (service_role
  -- cleanup — the app has a delete grant on bank_transactions), a match
  -- pointing at nothing is not a fact worth keeping.
  foreign key (account_id, bank_transaction_id)
    references pilot.bank_transactions (account_id, id) on delete cascade,

  journal_line_id uuid not null,
  -- CASCADE: ledger_sync refreshes a drifted derived entry by deleting and
  -- re-deriving it. The old line's match dies with the line — honest,
  -- because the thing the pilot matched no longer exists — and the
  -- statement row returns to the unreconciled column to be matched again.
  foreign key (account_id, journal_line_id)
    references pilot.journal_lines (account_id, id) on delete cascade,

  created_at timestamptz not null default now(),
  unique (account_id, id),
  -- 1:1 in both directions, enforced by index rather than convention —
  -- two tabs racing the same match cannot double-clear either side.
  unique (account_id, bank_transaction_id),
  unique (account_id, journal_line_id)
);

comment on table pilot.bank_statement_matches is
  'A statement line (pilot.bank_transactions) paired with the ledger Cash & bank line it clears. One-to-one both ways; amounts must be identical (see bank_statement_matches_validate). Row exists = cleared; delete = unmatch.';

create index if not exists bank_statement_matches_txn_idx
  on pilot.bank_statement_matches (account_id, bank_transaction_id);

-- ---------------------------------------------------------------------------
-- Validation. The composite FKs already stop a cross-tenant pair; this
-- trigger stops a WRONG pair inside one tenant: a ledger line that is not
-- on the Cash & bank account, or amounts that differ. Without the amount
-- rule, "reconciled, difference $0" could be manufactured by matching a
-- $12 coffee to a $1,200 hotel — the exact lie a reconciliation exists to
-- make impossible.
-- ---------------------------------------------------------------------------
create or replace function pilot.bank_statement_matches_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line record;
  v_txn_cents bigint;
  v_signed bigint;
begin
  select jl.side, jl.amount_cents, c.system_key
  into v_line
  from pilot.journal_lines jl
  join pilot.accounts_chart c
    on c.account_id = jl.account_id and c.id = jl.chart_account_id
  where jl.account_id = new.account_id and jl.id = new.journal_line_id;

  if v_line.side is null then
    raise exception 'that ledger line is not recognized';
  end if;
  if v_line.system_key is distinct from 'bank' then
    raise exception 'only Cash & bank ledger lines can be matched against a statement';
  end if;

  select t.amount_cents into v_txn_cents
  from pilot.bank_transactions t
  where t.account_id = new.account_id and t.id = new.bank_transaction_id;

  if v_txn_cents is null then
    raise exception 'that statement line is not recognized';
  end if;

  v_signed := case v_line.side when 'debit' then v_line.amount_cents
                               else -v_line.amount_cents end;
  if v_txn_cents <> v_signed then
    raise exception
      'a match requires identical amounts — the statement line is % cents and the ledger line is % cents',
      v_txn_cents, v_signed;
  end if;

  return new;
end;
$$;

create trigger bank_statement_matches_validate
  before insert on pilot.bank_statement_matches
  for each row execute function pilot.bank_statement_matches_validate();

-- ---------------------------------------------------------------------------
-- RLS + grants. Matching and unmatching are plain tenant-scoped writes
-- (the trigger + FKs + unique indexes carry the integrity), so unlike the
-- journal tables these get direct policies. No UPDATE anywhere: a match is
-- made or it is deleted, never edited into pointing somewhere else.
-- ---------------------------------------------------------------------------
alter table pilot.bank_statement_matches enable row level security;

create policy bank_statement_matches_select on pilot.bank_statement_matches
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy bank_statement_matches_insert on pilot.bank_statement_matches
  for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_statement_matches_delete on pilot.bank_statement_matches
  for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

grant select, delete on pilot.bank_statement_matches to authenticated;
grant insert (account_id, bank_transaction_id, journal_line_id)
  on pilot.bank_statement_matches to authenticated;

grant select, insert, update, delete on pilot.bank_statement_matches to service_role;
