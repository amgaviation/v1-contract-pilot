# Accounting Ledger

Four tables: `accounts_chart` is the chart of accounts a pilot posts against; `journal_entries` and `journal_lines` are the double-entry journal itself (headers and debit/credit lines); `bank_statement_matches` pairs an imported bank statement line with the ledger line it clears.

## accounts_chart

The chart of accounts, one set per tenant. It is not `pilot.accounts` — that's the tenant table itself. Every account a pilot's business can own money in, owe money on, or post income/expense against lives here as a row: Cash & bank, Accounts receivable, the income categories that mirror how invoice lines are split (day rate, travel day, per diem, standby, reimbursed expenses), and expense categories that mirror `pilot.expenses`' own category vocabulary, plus two equity accounts (Owner draws / Owner contributions) standing in for payroll — a sole proprietor pilot doesn't run payroll on themselves, they take draws. Every account is seeded automatically the moment a tenant is created (`seed_accounts_chart`, fired by a trigger on `pilot.accounts` insert); a pilot can rename any account and add their own, but cannot delete or retype the seeded ones.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`. The account's identity within this table — distinct from `system_key` below, which is the identity that matters for posting.

#### `account_id`
`uuid`, not null. Foreign key to `pilot.accounts(id)` — the tenant this chart row belongs to. Every table in this schema is scoped by `account_id`; this is the chart's tenancy column.

#### `name`
`text`, not null. The account's display name, e.g. "Cash & bank" or "Airline tickets". Must be non-blank and at most 120 characters. Free to rename — a pilot who thinks in "duty days" instead of "flight days" can relabel the account without breaking anything, because nothing downstream keys off the name.

#### `kind`
`text`, not null. One of `asset`, `liability`, `equity`, `income`, `expense` — the five basic account types double-entry bookkeeping sorts everything into. Fixed once the row exists: a trigger blocks changing an account's `kind` after creation (see Notable constraints), because changing what kind of account a row full of posted history represents would silently corrupt every report that already summed it under the old kind.

#### `system_key`
`text`, nullable, no default. The stable posting identity for accounts the system seeded — values like `bank`, `accounts_receivable`, `expense_fuel`, `income_per_diem`. `ledger_sync` looks accounts up by `system_key`, never by `name`, so a pilot can rename an account freely without breaking automatic posting. Rows a pilot adds themselves have `system_key = null` and can never be automatic posting targets. Only `seed_accounts_chart` (a `SECURITY DEFINER` function not granted to `authenticated`) ever writes this column, and a trigger additionally blocks changing it on an existing row — it is the one column in this table that is permanently fixed at creation.

#### `archived_at`
`timestamptz`, nullable, no default. When set, the account is retired from being offered for new postings but every line already posted to it keeps rendering in history and reports — archiving never erases anything. A seeded (`system_key is not null`) account can never be archived, because it's a live target `ledger_sync` may still post to at any time; only pilot-added accounts can be archived. Archive is this table's entire "delete" story — there is deliberately no `DELETE` policy on this table (see Notable constraints).

#### `created_at`
`timestamptz`, not null, defaults to `now()`. Row creation time, set once.

#### `updated_at`
`timestamptz`, not null, defaults to `now()`. Bumped by the `accounts_chart_set_updated_at` trigger on every update; not meaningful as a change log by itself.

### Notable constraints

- **RLS is enabled**, scoped to `account_id in (select pilot.current_account_ids())` for select/insert/update. There is no delete policy — see `archived_at` above.
- `name` must be non-blank and ≤120 characters; `kind` must be one of the five standard account types (enforced by `CHECK`).
- `accounts_chart_system_key_uniq` is a partial unique index on `(account_id, system_key) where system_key is not null` — it's what makes the seeded rows single-valued per tenant (so `ledger_sync`'s joins never find two "the bank account" rows) and what makes seeding itself idempotent via `ON CONFLICT`.
- A trigger, `accounts_chart_protect`, enforces three rules a grant alone can't express because they depend on the specific row, not just the column: `system_key` can never change once set; `kind` can never change once set (retype by archiving and adding a new account instead); and a seeded (`system_key is not null`) account can never be archived. All three are bypassed for `service_role` only.
- `authenticated` can `INSERT` only `account_id, kind, name` and `UPDATE` only `archived_at, name` — everything else on this table is read-only to the app, which is what makes the trigger's extra row-level rules necessary (a column grant can't say "these columns, except on system rows").

### Changing this table

Renaming or archiving a pilot-added account here is low-risk and exactly what the app itself does — a direct `UPDATE` in the SQL Editor is fine for that. Anything touching `system_key` or `kind`, or archiving a seeded row, will be rejected by `accounts_chart_protect` regardless of who's connected except `service_role`; don't try to work around that trigger by connecting as `service_role` to force a change the trigger exists specifically to prevent. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for the general safety rules (transactions, look-before-you-touch queries).

```sql
-- Rename an account (safe — this is exactly what the app's own UPDATE grant allows)
begin;
update pilot.accounts_chart
set name = 'Duty days'
where account_id = '<account-uuid>' and id = '<chart-account-uuid>';
select id, name, system_key from pilot.accounts_chart where id = '<chart-account-uuid>';
rollback; -- or commit;

-- Archive a pilot-added account (fails via trigger if it's a seeded/system row)
begin;
update pilot.accounts_chart
set archived_at = now()
where account_id = '<account-uuid>' and id = '<chart-account-uuid>' and system_key is null;
rollback; -- or commit;
```

## journal_entries

The header row of one double-entry journal entry — a date, a memo, and (for anything the system posted automatically) a pointer back to the fact it was derived from. The actual money is in `journal_lines`; an entry by itself carries no amounts. Entries come from two places: a pilot typing a manual entry (`source_type = 'manual'`, created through `journal_entry_create`), or `ledger_sync` deriving one automatically from an issued invoice, a voided invoice, a received payment, a payment reclassified because its invoice went void, an expense, or a mileage entry. Every derived entry is immutable in the sense that matters — it gets deleted and recreated by `ledger_sync` when its source changes, never hand-edited — and a manual mistake is deleted (`journal_entry_delete`) and re-entered rather than corrected in place.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Foreign key to `pilot.accounts(id)` — the tenant. Also part of the composite `(account_id, id)` unique constraint that `journal_lines` foreign-keys against, so a line can never point at an entry belonging to a different tenant.

#### `entry_date`
`date`, not null. The accounting date the entry is booked on — not necessarily today. Must be on or after 2000-01-01. For a derived entry this is the date of the underlying event (an invoice's issue date, a payment's paid-on date), not the date `ledger_sync` happened to run.

#### `memo`
`text`, not null. A human-readable description, non-blank, at most 500 characters — e.g. "Invoice INV-0042 issued" or a pilot's own note on a manual entry.

#### `source_type`
`text`, not null, defaults to `'manual'`. One of `manual`, `invoice_issued`, `invoice_voided`, `payment`, `payment_void_reclass`, `expense`, `mileage`. This is what tells you whether an entry is something a pilot typed or something the ledger derived, and if derived, from which kind of fact. A `CHECK` constraint also ties this to `source_id`: `source_type = 'manual'` if and only if `source_id is null` — a manual entry can never carry a source pointer, and a derived entry can never lack one.

#### `source_id`
`uuid`, nullable, no default. For a derived entry, the id of the row it came from (an invoice id, a payment id, an expense id, a mileage entry id) — the target table depends on `source_type` and isn't enforced by a foreign key (it's a polymorphic pointer, not a single-table reference). Null for manual entries. Paired with `source_type` and `account_id`, this is the idempotency key: `journal_entries_source_uniq` is a unique index on `(account_id, source_type, source_id) where source_id is not null`, which is what makes re-running `ledger_sync` over the same invoice, payment, expense, or mileage row a guaranteed no-op rather than a duplicate post.

#### `created_at`
`timestamptz`, not null, defaults to `now()`. Row creation time.

### Notable constraints

- **RLS is enabled**, with a `SELECT`-only policy for `authenticated` scoped to `account_id in (select pilot.current_account_ids())`. There are **no insert, update, or delete policies for `authenticated` at all** — every write to this table goes through one of three `SECURITY DEFINER` functions (`journal_entry_create`, `journal_entry_delete`, `ledger_sync`), each checking tenant membership itself. The app cannot write this table directly even with a normal request; the door simply doesn't exist.
- `entry_date >= '2000-01-01'`; `memo` non-blank and ≤500 characters (both `CHECK`).
- `source_type = 'manual'` if and only if `source_id is null` (`CHECK`).
- `journal_entries_source_uniq`: unique on `(account_id, source_type, source_id)` where `source_id is not null` — the mechanism described under `source_id` above.
- **The balance rule** (shared with `journal_lines`, described fully there): a deferred constraint trigger, `journal_entries_balanced`, fires after every insert on this table and verifies the new entry's lines balance and number at least two — at commit, not immediately. See `journal_lines` below for what "deferred" means in practice.

### Changing this table

Do not `UPDATE` a row in this table directly, and think twice before even a corrective `DELETE`. Entries here are meant to be immutable: a manual mistake is fixed by deleting the entry (which cascades its lines) and creating a fresh, correct one — never by editing amounts, dates, or memos in place — and a derived entry is supposed to be refreshed only by `ledger_sync`, because it's keyed by `(source_type, source_id)` against the very fact it represents. A raw `UPDATE` here (e.g. hand-editing a memo or date) doesn't touch the balance at all by itself since amounts live in `journal_lines`, so it's less dangerous than editing lines — but it still leaves a derived entry telling a different story than the source row `ledger_sync` will keep comparing it against, and the next sync run may quietly delete and recreate it out from under you. If you must remove a bad manual entry directly rather than through `journal_entry_delete`, do it as a plain, transaction-wrapped `DELETE` (which cascades to its lines) and let the pilot re-enter it; see the `journal_lines` section below for why edits to lines are the genuinely dangerous case. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for the general safety rules.

## journal_lines

The actual debits and credits. Every journal entry is made of two or more of these rows, each one either a debit or a credit against one chart-of-accounts line, and — this is the whole point of double-entry bookkeeping — the debits and credits across one entry's lines always sum to zero. `amount_cents` is always stored positive; the `side` column is what carries direction. The database itself enforces that no entry can ever be left with an unbalanced set of lines or fewer than two lines, at commit time, no matter what wrote them.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Foreign key to `pilot.accounts(id)` — the tenant, repeated on every line so the composite foreign keys below can enforce that a line's entry and its chart account both belong to the same tenant as the line itself.

#### `entry_id`
`uuid`, not null. Together with `account_id`, a composite foreign key to `journal_entries (account_id, id)`, `ON DELETE CASCADE` — deleting an entry deletes its lines. Which entry this debit or credit belongs to.

#### `chart_account_id`
`uuid`, not null. Together with `account_id`, a composite foreign key to `accounts_chart (account_id, id)`, `ON DELETE RESTRICT` — a chart account that has any posted lines against it can never be deleted (only archived), so history can never lose the account it was posted to.

#### `side`
`text`, not null. Either `debit` or `credit` (`CHECK`). This is the direction; `amount_cents` is always positive, so `side` is what makes a line increase or decrease its account rather than the sign of the number.

#### `amount_cents`
`bigint`, not null. The line's amount in cents, always greater than zero (`CHECK amount_cents > 0`). Money is stored as integer cents throughout this schema to avoid floating-point rounding.

#### `line_no`
`integer`, not null, defaults to `0`. Non-negative (`CHECK`). Display ordering within an entry — the order lines were entered or generated in, not otherwise meaningful.

#### `created_at`
`timestamptz`, not null, defaults to `now()`. Row creation time.

### Notable constraints

- **RLS is enabled**, with a `SELECT`-only policy for `authenticated`, same shape as `journal_entries` — no insert, update, or delete policies for the app. Every line is written by the same three `SECURITY DEFINER` functions that write entries, in the same transaction as their header.
- `side` must be `debit` or `credit`; `amount_cents` must be positive; `line_no` must be non-negative (all `CHECK`).
- **The balance rule, in detail.** A plain `CHECK` constraint can't compare rows against each other, so this is enforced by `journal_entry_check_balanced()`, wired up as **`DEFERRABLE INITIALLY DEFERRED` constraint triggers** on both `journal_lines` (after insert/update/delete) and `journal_entries` (after insert). For a given entry, it sums `amount_cents` (positive for debits, negative for credits) across all of that entry's lines and requires the total to be exactly zero, and requires at least two lines to exist. What "deferred" means in plain terms: this check does not run after each individual `INSERT`/`UPDATE`/`DELETE` statement — it runs once, at the end of the transaction, right before `COMMIT`. That has a specific, easy-to-misjudge consequence in the SQL Editor: a single `UPDATE` that changes one line's amount, run and committed by itself (which is what a plain, non-transactional edit in the SQL Editor does), commits its own tiny one-statement transaction — so the balance check *does* run, on just that change, and *will* reject it if that one entry is now unbalanced. The genuinely dangerous case is a `BEGIN ... COMMIT` block (or an editor session with autocommit off) where you fix **two** lines that are meant to offset each other — say, correcting a $50 line to $75 and *also* correcting its $50 counterpart to $75 in the same transaction. Both edits land, the entry is still balanced at commit, and the trigger has nothing to object to — even though you touched the ledger's committed data directly, bypassing every application-level check `journal_entry_create`/`journal_entry_delete` would have run. The trigger only ever catches an *unbalanced* result; it cannot tell a correct paired edit from two edits that happen to still net to zero but no longer reflect anything real (wrong account, wrong amount split, wrong source). It is not a review mechanism — it's the last line of defense against a corrupted total, not protection against a wrong-but-balanced entry.

### Changing this table

Do not hand-edit rows here. This is the one table in the whole schema where a direct SQL Editor `UPDATE` can succeed, look fine, and still be wrong in a way nothing will ever flag: the deferred trigger guarantees debits equal credits at commit, it does not guarantee the numbers are *correct*. For a manual entry, the safe fix is always delete-and-recreate — delete the whole entry (cascades its lines) through `journal_entry_delete` or a plain `DELETE` on `journal_entries`, then re-enter it correctly, ideally through the app's own `journal_entry_create` so the two-line-minimum and balance checks run with a clear error message instead of a bare trigger failure. For a derived entry (`source_type <> 'manual'`), never hand-edit it at all — fix the *source* row (the invoice, payment, expense, or mileage entry) and call `pilot.ledger_sync(account_id)`, which deletes the stale derived entry and regenerates it correctly; anything you type directly into `journal_lines` for a derived entry will be silently blown away and regenerated the next time sync runs anyway. If you ever do touch this table directly for genuine data repair, do it inside an explicit transaction, recompute the entry's debit/credit sums yourself before committing, and only commit once you've confirmed the total nets to zero — the pattern from [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md):

```sql
begin;
-- ... your corrective inserts/updates/deletes on pilot.journal_lines ...

-- Verify the entry balances BEFORE committing — the trigger checks this too,
-- but check it yourself so a passing check isn't your only signal of correctness.
select entry_id, sum(case side when 'debit' then amount_cents else -amount_cents end) as balance,
       count(*) as line_count
from pilot.journal_lines
where entry_id = '<entry-uuid>'
group by entry_id;
-- balance must be exactly 0 and line_count must be >= 2

rollback; -- or commit, only once the select above confirms it
```

## bank_statement_matches

The reconciliation record: one row pairs one imported bank/card statement line (`pilot.bank_transactions`) with the one ledger `journal_lines` row (on the Cash & bank account) that it represents. A statement line with a matching row here is "cleared" — the pilot has confirmed the bank's record and the books agree on that specific movement of money. Deleting the row un-matches it; there is no update, because a match either exists correctly or it doesn't — it's never edited into pointing somewhere else.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Foreign key to `pilot.accounts(id)` — the tenant.

#### `bank_transaction_id`
`uuid`, not null. Together with `account_id`, a composite foreign key to `bank_transactions (account_id, id)`, `ON DELETE CASCADE` — if an imported statement row is ever removed, a match pointing at nothing isn't worth keeping. Also part of a unique constraint (see below): one statement line can be matched at most once.

#### `journal_line_id`
`uuid`, not null. Together with `account_id`, a composite foreign key to `journal_lines (account_id, id)`, `ON DELETE CASCADE` — if `ledger_sync` deletes and regenerates the derived entry this line belonged to (because its source changed), the match dies with the old line, honestly: the thing the pilot matched no longer exists, and the statement row goes back to being unreconciled until matched again. Also part of a unique constraint: one ledger line can be matched at most once.

#### `created_at`
`timestamptz`, not null, defaults to `now()`. When the match was made.

### Notable constraints

- **RLS is enabled**, with select/insert/delete policies for `authenticated`, all scoped to `account_id in (select pilot.current_account_ids())`. Unlike the journal tables, this table gets direct app-level write policies — matching and unmatching are plain tenant-scoped writes, and the integrity is carried by the foreign keys, unique indexes, and validation trigger rather than by routing everything through a function.
- **One-to-one in both directions**, by unique index rather than convention: `unique (account_id, bank_transaction_id)` and `unique (account_id, journal_line_id)` — a statement line can clear at most one ledger line and vice versa. A batched deposit (two payments arriving as a single statement line) deliberately does not match as a unit; both sides stay unreconciled and the split has to be entered as a manual journal entry.
- **Amounts must match exactly.** A trigger, `bank_statement_matches_validate`, runs before insert and rejects a match unless: the ledger line is actually on the Cash & bank account (`system_key = 'bank'` — you cannot match a statement line against, say, an expense line), and the statement line's signed amount equals the ledger line's signed amount exactly (a debit line's amount, or the negative of a credit line's amount, must equal `bank_transactions.amount_cents`). Without that second rule, a $12 coffee charge could be "matched" against a $1,200 hotel line and the difference would silently disappear — the trigger exists specifically to make that impossible.
- `authenticated`'s grant is `INSERT (account_id, bank_transaction_id, journal_line_id)` and `SELECT` on all columns. The migration also grants `DELETE` to `authenticated` at the table level (deleting a match row is how a pilot un-clears a transaction) — this doesn't show up as a column grant because `DELETE` has no per-column scope, only `SELECT`/`INSERT`/`UPDATE` do. There is no `UPDATE` grant anywhere: a match is made or removed, never repointed.

### Changing this table

A direct `INSERT` or `DELETE` here is low-risk relative to the journal tables — the validation trigger and the two unique indexes catch the failure modes that matter (wrong account, mismatched amount, double-matching a line). The one thing to check yourself before deleting a match by hand is *why* you're unmatching it — a deletion here doesn't touch `journal_lines` or `bank_transactions` at all, it only removes the pairing, so the statement line simply reappears as unreconciled. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for the general safety rules.

```sql
-- Unmatch a statement line (transaction-wrapped, per the general guide)
begin;
delete from pilot.bank_statement_matches
where account_id = '<account-uuid>' and bank_transaction_id = '<bank-transaction-uuid>';
rollback; -- or commit;
```
