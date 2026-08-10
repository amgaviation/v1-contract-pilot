-- Bank/card statement import — CSV/OFX/QFX upload, review queue,
-- confirm-to-expense. No Plaid, no credentials, no live connection: every
-- bank exports a downloadable statement, and importing THAT is the entire
-- capability. See lib/bank-import/** for the client-side parsers and
-- app/(app)/expenses/import + app/(app)/expenses/transactions for the
-- draft-confirm flow this migration backs.
--
-- Mirrors two prior migrations almost exactly, and departs from neither
-- without saying why:
--   - Composite FKs + column-scoped grants: pattern from
--     20260805070000_phase3_clients_trips_expenses.sql's header.
--   - Import lineage shape (batch -> source file -> row, fingerprint dedup
--     via a partial unique index, RLS enabled here and never retrofitted):
--     pattern from 20260805220000_phase6_logbook.sql.
--
-- SIGN CONVENTION (read this before touching amount_cents anywhere):
-- bank_transactions.amount_cents is stored in ONE canonical sign
-- regardless of source account kind:
--
--     NEGATIVE = money left the pilot's pocket (an expense candidate)
--     POSITIVE = money came back (a deposit, a card payment, a refund)
--
-- A checking/savings export already writes it this way (a debit is
-- negative), so those rows are stored as-is. A CREDIT CARD export does
-- NOT: card issuers show a purchase as a POSITIVE charge (it increases
-- what you owe) and a payment/credit as NEGATIVE. Importing a credit
-- card statement therefore FLIPS the sign at parse time
-- (lib/bank-import/apply-mapping.ts, keyed on bank_accounts.kind =
-- 'credit_card') so a purchase lands here as negative, matching checking.
-- This is a deliberate, loud transformation of the source data, not a
-- silent one — the single canonical sign is what lets the review queue
-- and confirmImport treat every account kind identically ("negative row
-- -> abs(amount_cents) is what pilot.expenses.amount_cents gets"; a
-- positive row is a deposit/payment and is never turned into an expense).
create table if not exists pilot.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  -- The pilot's OWN label for a statement source. NEVER credentials, never
  -- a real account number — see last4 below. Deciding whether this table
  -- is even needed (vs. a plain text label on the batch) came down to:
  -- dedup needs a stable scope narrower than the whole tenant (two
  -- different real accounts can legitimately have transactions that
  -- collide on date+amount+description — see bank_transactions_fingerprint_uniq
  -- below), and a free-text label on every batch would let that scope
  -- drift by typo between imports of the SAME account. A row the pilot
  -- picks from a dropdown is a stable id; a label re-typed each import is
  -- not.
  label text not null check (btrim(label) <> ''),
  -- Last 4 digits/characters ONLY, exactly as a statement itself prints
  -- them (e.g. "4471"). Never a full account or card number — this
  -- product holds no credentials and no live bank data, ever.
  last4 text check (last4 is null or last4 ~ '^[A-Za-z0-9]{2,4}$'),
  kind text not null check (kind in ('checking', 'savings', 'credit_card')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.bank_accounts is
  'The pilot''s own labelling of a statement source (nickname/last4/kind). No credentials, ever — this is a label, not a connection.';

-- ---------------------------------------------------------------------------
-- bank_import_batches / bank_source_files — same shape as
-- logbook_import_batches / logbook_source_files, one batch per upload.
-- ---------------------------------------------------------------------------
create table if not exists pilot.bank_import_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  bank_account_id uuid not null,
  foreign key (account_id, bank_account_id)
    references pilot.bank_accounts (account_id, id) on delete restrict,
  source_format text not null
    check (source_format in ('csv_signed', 'csv_debit_credit', 'ofx', 'qfx')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'partial', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.bank_import_batches is
  'One row per statement upload. Mirrors pilot.logbook_import_batches.';

create table if not exists pilot.bank_source_files (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  import_batch_id uuid not null,
  foreign key (account_id, import_batch_id)
    references pilot.bank_import_batches (account_id, id) on delete cascade,
  file_name text not null,
  row_count integer check (row_count is null or row_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.bank_source_files is
  'The uploaded statement file(s) behind an import batch. Mirrors pilot.logbook_source_files.';

-- ---------------------------------------------------------------------------
-- bank_transactions — the review queue IS the product. A row starts
-- 'unreviewed'; the pilot assigns category + treatment; ONLY THEN does an
-- expense exist. confirmTransaction (app/(app)/expenses/transactions/actions.ts)
-- is the one place review_state moves to 'reviewed' and expense_id is set,
-- mirroring how confirmImport is the one place a trip-derived logbook
-- draft becomes a real entry.
-- ---------------------------------------------------------------------------
create table if not exists pilot.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,

  bank_account_id uuid not null,
  foreign key (account_id, bank_account_id)
    references pilot.bank_accounts (account_id, id) on delete restrict,

  import_batch_id uuid not null,
  foreign key (account_id, import_batch_id)
    references pilot.bank_import_batches (account_id, id) on delete restrict,
  source_file_id uuid not null,
  foreign key (account_id, source_file_id)
    references pilot.bank_source_files (account_id, id) on delete restrict,
  source_row_number integer not null check (source_row_number >= 1),
  -- The raw imported row (header-name -> raw string, or the OFX/QFX
  -- <STMTTRN> fields), kept verbatim for the same reason
  -- logbook_entries.source_row is: a rejected/disputed row must be
  -- traceable to exactly what the bank sent, not a re-serialized guess.
  source_row jsonb not null,

  posted_on date not null,
  -- Exactly as the bank wrote it. Never rewritten, truncated, or
  -- title-cased — a pilot reconciling against a paper/PDF statement needs
  -- to recognize the line, and a category label already exists as its own
  -- column.
  description text not null check (btrim(description) <> ''),
  -- Signed. See the file header for the canonical-sign rule. Never zero —
  -- a zero-dollar "transaction" is not a real bank line and would also
  -- collide with nothing meaningful in amount-based dedup.
  amount_cents bigint not null check (amount_cents <> 0),

  -- Dedup key. See fingerprint.ts for the exact field list and why —
  -- summary here: (bank_account_id, posted_on, description, amount_cents),
  -- NOT source_row_number/file order, computed server-side and never
  -- accepted from the client. account_id is deliberately not part of the
  -- hash, same reasoning as logbook_entries_fingerprint_uniq: the unique
  -- index below already scopes by account_id (and additionally by
  -- bank_account_id — two DIFFERENT declared accounts may legitimately
  -- share a coincidental fingerprint, e.g. the same $12.00 coffee charge
  -- posted the same day on two different cards, and that must not dedup
  -- across them).
  fingerprint text not null,

  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed', 'reviewed', 'ignored')),
  -- Set ONLY by a rule the pilot created (never guessed by this system on
  -- its own) — see lib/bank-import rule suggestion surface. Always
  -- visually distinct from `category` in the UI: this is a suggestion,
  -- never an assignment.
  suggested_category text
    check (suggested_category is null or suggested_category in
      ('airline', 'hotel', 'rental_car', 'rideshare', 'fuel', 'meals', 'parking', 'other')),

  -- The pilot's actual confirmed choice. Ported verbatim from
  -- pilot.expenses' vocabulary — never invented separately.
  category text
    check (category is null or category in
      ('airline', 'hotel', 'rental_car', 'rideshare', 'fuel', 'meals', 'parking', 'other')),
  treatment text
    check (treatment is null or treatment in ('rebill', 'deduct', 'unassigned')),
  trip_id uuid,
  foreign key (account_id, trip_id) references pilot.trips (account_id, id) on delete set null,

  -- THE invariant this whole feature exists to enforce: an unreviewed (or
  -- ignored) row can never carry a category/treatment, and a reviewed row
  -- must carry both. There is no in-between state where a category is
  -- set but "not really assigned yet" — confirmTransaction sets
  -- review_state, category and treatment together, in one UPDATE, or none
  -- of them.
  check (
    (review_state = 'reviewed' and category is not null and treatment is not null)
    or
    (review_state <> 'reviewed' and category is null and treatment is null)
  ),
  -- An expense cannot be rebilled to nobody — same rule pilot.expenses
  -- itself enforces, mirrored here so a bad confirm can never even reach
  -- the expenses insert.
  check (treatment is distinct from 'rebill' or trip_id is not null),

  -- The pilot.expenses row this transaction became, once (and only once)
  -- reviewed. ON DELETE SET NULL: if the pilot later deletes the expense
  -- itself (app/(app)/expenses' existing delete action), this transaction
  -- must not silently vanish or re-open as unreviewed — it stays
  -- 'reviewed' with expense_id null, a rare, visible "the expense this
  -- came from was removed" state rather than a cascade that erases import
  -- lineage.
  expense_id uuid,
  foreign key (account_id, expense_id) references pilot.expenses (account_id, id) on delete set null,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.bank_transactions is
  'Imported statement rows. review_state starts unreviewed; only confirmTransaction may move it to reviewed, and only together with category+treatment+expense_id. See file header for the amount_cents sign convention.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger bank_accounts_set_updated_at before update on pilot.bank_accounts
  for each row execute function pilot.set_updated_at();
create trigger bank_import_batches_set_updated_at before update on pilot.bank_import_batches
  for each row execute function pilot.set_updated_at();
create trigger bank_source_files_set_updated_at before update on pilot.bank_source_files
  for each row execute function pilot.set_updated_at();
create trigger bank_transactions_set_updated_at before update on pilot.bank_transactions
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index if not exists bank_accounts_account_idx on pilot.bank_accounts (account_id) where archived_at is null;
create index if not exists bank_import_batches_account_idx
  on pilot.bank_import_batches (account_id, created_at desc);
create index if not exists bank_source_files_batch_idx
  on pilot.bank_source_files (account_id, import_batch_id);
create index if not exists bank_transactions_account_idx
  on pilot.bank_transactions (account_id, bank_account_id, posted_on desc);
-- The review queue is a first-class surface, same treatment as
-- expenses_unassigned_idx.
create index if not exists bank_transactions_unreviewed_idx
  on pilot.bank_transactions (account_id, posted_on desc)
  where review_state = 'unreviewed';

-- THE dedup enforcement — in the database, not application code, because a
-- check-then-write in a server action races two overlapping-range
-- re-imports (or two tabs) exactly the way logbook_entries_fingerprint_uniq
-- exists to prevent for the logbook. Scoped by bank_account_id in addition
-- to account_id — see the fingerprint column's comment above for why.
create unique index if not exists bank_transactions_fingerprint_uniq
  on pilot.bank_transactions (account_id, bank_account_id, fingerprint);

-- ---------------------------------------------------------------------------
-- RLS. Enabled in this table's own first migration, never retrofitted. No
-- admin-bypass policy, no AMG-facing read path.
-- ---------------------------------------------------------------------------
alter table pilot.bank_accounts       enable row level security;
alter table pilot.bank_import_batches enable row level security;
alter table pilot.bank_source_files   enable row level security;
alter table pilot.bank_transactions   enable row level security;

create policy bank_accounts_select on pilot.bank_accounts for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy bank_accounts_insert on pilot.bank_accounts for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_accounts_update on pilot.bank_accounts for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_accounts_delete on pilot.bank_accounts for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy bank_import_batches_select on pilot.bank_import_batches for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy bank_import_batches_insert on pilot.bank_import_batches for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_import_batches_update on pilot.bank_import_batches for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_import_batches_delete on pilot.bank_import_batches for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy bank_source_files_select on pilot.bank_source_files for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy bank_source_files_insert on pilot.bank_source_files for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_source_files_update on pilot.bank_source_files for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_source_files_delete on pilot.bank_source_files for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy bank_transactions_select on pilot.bank_transactions for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy bank_transactions_insert on pilot.bank_transactions for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_transactions_update on pilot.bank_transactions for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy bank_transactions_delete on pilot.bank_transactions for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- GRANTS. Column-scoped on UPDATE per the Phase 1/3 CRITICAL — RLS has no
-- column granularity, the grant is the only place column authority lives.
-- account_id/id/created_at withheld everywhere; updated_at withheld
-- because the trigger owns it. Import-lineage columns
-- (import_batch_id/source_file_id/source_row_number/fingerprint/
-- source_row/bank_account_id/posted_on/description/amount_cents) are
-- withheld from bank_transactions' UPDATE grant entirely, same as
-- logbook_entries withholds its lineage columns — rewriting a fact the
-- bank sent, or moving a row to a different fingerprint after the fact,
-- is not a legitimate "edit" and letting the dedup key itself be
-- editable would let a pilot slip a real duplicate past the unique index.
-- ---------------------------------------------------------------------------
grant select, insert, delete on pilot.bank_accounts, pilot.bank_import_batches,
  pilot.bank_source_files, pilot.bank_transactions to authenticated;

grant update (label, last4, kind, archived_at) on pilot.bank_accounts to authenticated;

grant update (status, total_rows, imported_rows, rejected_rows, duplicate_rows, error_summary)
  on pilot.bank_import_batches to authenticated;

grant update (file_name, row_count) on pilot.bank_source_files to authenticated;

-- The review action's entire column surface: review_state moves together
-- with category/treatment/trip_id/expense_id (confirmTransaction), or a
-- pilot dismisses a row (review_state='ignored', the rest left null) or
-- edits a free-text note. Nothing else is writable post-import.
grant update (review_state, suggested_category, category, treatment, trip_id, expense_id, notes)
  on pilot.bank_transactions to authenticated;

grant select, insert, update, delete on pilot.bank_accounts, pilot.bank_import_batches,
  pilot.bank_source_files, pilot.bank_transactions to service_role;
