# Expenses & Imports

Seven tables: `expenses` (what was spent), `mileage_rates` (the IRS rate per tax year) and `mileage_entries` (drives logged against that rate), `bank_accounts` (labels for statement sources), `bank_import_batches` and `bank_source_files` (the upload lineage), and `bank_transactions` (imported statement rows working through a review queue).

## expenses

No table comment exists in the database, so this is inferred from the columns and constraints below. A row is one cost the pilot incurred — a hotel folio, a checkride fee, a headset — that either gets rebilled to a client through an invoice line or deducted on the pilot's own taxes. It can be entered by hand or produced automatically when a bank transaction is confirmed (see `bank_transactions` below).

### Columns

#### `id`
`uuid`, not null, defaults to `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. The tenant this expense belongs to; every RLS policy and every other table's composite foreign keys key off this.

#### `trip_id`
`uuid`, nullable. Which trip the expense is attached to. Null is a first-class, intended state — an expense with no trip is neither billed nor deducted through a trip, and the "unassigned" queue in the app surfaces exactly these rows. When set, it participates in a composite foreign key to `pilot.trips (account_id, id)`.

#### `incurred_on`
`date`, not null. The date the cost was actually incurred (not when it was entered or imported).

#### `category`
`text`, not null. A filing label constrained to a fixed list of fifteen values: `airline`, `hotel`, `rental_car`, `rideshare`, `fuel`, `meals`, `parking`, `other` (the original eight, all travel costs a pilot usually rebills), plus `training`, `medical`, `insurance`, `charts`, `equipment`, `uniform`, `dues` (added later — what a freelance pilot self-funds and deducts, since all of it used to land in `other` and swallowed the largest line on a pilot's year-end report). The column's own comment is explicit that category is filing taxonomy only — nothing in the app computes off it, and the list is additive: existing rows keep whatever they were originally filed under, nothing was renamed or backfilled.

#### `vendor`
`text`, nullable. Free-text merchant/payee name, typed by the pilot for a manual entry.

#### `amount_cents`
`bigint`, not null, `>= 0`. The cost in integer cents.

#### `treatment`
`text`, not null, defaults to `'unassigned'`. One of `rebill`, `deduct`, `unassigned` — whether this cost gets passed on to a client via an invoice line, deducted on the pilot's own taxes, or not yet decided.

#### `receipt_path`
`text`, nullable. Path to a stored receipt image/document, if one was attached.

#### `notes`
`text`, nullable. Free-text annotation.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`. Standard bookkeeping timestamps.

#### `bank_transaction_id`
`uuid`, nullable. The bank transaction this expense was confirmed from, if it came from an import rather than being entered by hand. This is **not** a foreign key — a real FK here would close a reference cycle with `bank_transactions.expense_id`, which is the actual lineage link of record. This column exists purely to carry a unique constraint (`expenses_bank_transaction_uniq`, scoped `(account_id, bank_transaction_id)` where not null): if `pilot.bank_transaction_confirm` is retried after a lost network reply, the retry hits a `23505` duplicate-key error instead of quietly creating a second expense for the same bank line.

#### `client_id`
`uuid`, nullable. Who the cost was spent on, when the pilot attributes it directly rather than through a trip. Null is normal for a trip-attached expense — the effective client is derived from the trip (the single reading rule lives in `lib/expense-client.ts`: `client_id` if set, otherwise the trip's client). When both `trip_id` and `client_id` are set, they cannot disagree: a composite foreign key to `pilot.trips (account_id, id, client_id)` makes a mismatched pair unstorable. This column does **not** enable rebilling straight to a client without a trip — the `treatment <> 'rebill' or trip_id is not null` check still applies, so a rebill line always attaches through a trip.

### Notable constraints

- **RLS is enabled.**
- `category` is restricted to the fifteen-value list above.
- `treatment` is restricted to `rebill` / `deduct` / `unassigned`.
- `amount_cents >= 0`.
- `check (treatment <> 'rebill' or trip_id is not null)` — an expense cannot be rebilled to no one; this exists because the invoicing arithmetic silently breaks if a rebill line has nothing to attach to.
- `expenses_bank_transaction_uniq`, a partial unique index on `(account_id, bank_transaction_id)` where `bank_transaction_id is not null` — makes confirming a bank transaction into an expense idempotent under retry.
- `expenses_account_id_trip_id_client_id_fkey` — when both `trip_id` and `client_id` are set, they must be the same pair recorded on the referenced trip.

### Changing this table

Direct `INSERT`/`UPDATE`/`SELECT` are all granted to `authenticated` (column-scoped; `id`, `created_at`, `updated_at`, and `bank_transaction_id` are withheld from both `INSERT` and `UPDATE` — the first three because they're system-owned, the last because it should only ever be set by the confirm flow described under `bank_transactions`). Editing by hand is straightforward:

```sql
begin;
update pilot.expenses
set treatment = 'deduct', category = 'training'
where account_id = '<account-uuid>' and id = '<expense-uuid>';
select * from pilot.expenses where id = '<expense-uuid>';
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for the general safety rules (this table is not gated, so those rules are all that applies).

## mileage_rates

Holds the IRS standard mileage rate the pilot enters for a given tax year, per account. Deliberately never hardcoded or pre-seeded with a real number in this codebase — the rate changes every year, and a stale baked-in figure would silently misstate every mileage entry snapshotted from it later.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. Tenant owner.

#### `tax_year`
`integer`, not null, constrained `2000–2100`. Which tax year this rate applies to.

#### `rate_cents_per_mile`
`numeric`, not null, `>= 0`. The rate itself, in cents per mile, as the pilot typed it. (Despite the name, this is entered in cents-as-a-decimal — e.g. IRS 2024's 67 cents/mile is stored as `67`, not `6700` — mirroring how `mileage_entries` uses it directly against `miles`.)

#### `notes`
`text`, nullable. Free-text annotation (e.g. "IRS Notice 2024-08").

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`. Standard bookkeeping timestamps.

### Notable constraints

- **RLS is enabled.**
- `tax_year` between 2000 and 2100.
- `rate_cents_per_mile >= 0`.
- `authenticated`'s `INSERT` privilege is column-scoped to `(account_id, tax_year, rate_cents_per_mile, notes)` only — there is no table-level `INSERT` grant, so `id`/`created_at`/`updated_at` can never be client-chosen. This replaced an earlier table-level grant after an adversarial review proved a crafted insert could set an attacker-chosen `id` and a back-dated `created_at` (migration `20260809050000`).

### Changing this table

Normal grants apply for insert/update on `notes` and `rate_cents_per_mile`. Adding a year's rate or correcting a typo in a not-yet-used rate is a plain statement:

```sql
begin;
insert into pilot.mileage_rates (account_id, tax_year, rate_cents_per_mile, notes)
values ('<account-uuid>', 2026, 70.0, 'IRS 2026 rate');
select * from pilot.mileage_rates where account_id = '<account-uuid>' and tax_year = 2026;
rollback; -- or commit;
```

Note that changing a rate here does **not** retroactively change any `mileage_entries` row already snapshotted from it — see that table below. See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for general safety rules.

## mileage_entries

One row per drive, used for the standard-mileage-rate method of claiming vehicle expense deductions. This table records what the pilot drove and how they describe it — it does **not** judge or label anything as "deductible": whether a given drive is commuting versus business, and whether the pilot is even using the standard-mileage method (as opposed to actual vehicle expenses) for the underlying vehicle that year, is a judgment call left to the pilot or their tax professional. The two methods are alternatives, never combined, and `pilot.expenses` rows filed under `fuel`/`rental_car` are never reconciled against this table.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. Tenant owner.

#### `drove_on`
`date`, not null. The date of the drive.

#### `miles`
`numeric`, not null, `> 0`. Distance driven.

#### `from_place` / `to_place`
`text`, not null each, length constrained to 1–200 trimmed characters. Where the drive started and ended, in the pilot's own words.

#### `purpose`
`text`, not null, length constrained to 1–500 trimmed characters. Why the drive happened.

#### `trip_id`
`uuid`, nullable. Optional link to the trip this drive supported.

#### `client_id`
`uuid`, nullable. Optional direct client attribution, same pattern as `expenses.client_id`.

#### `rate_cents_per_mile`
`numeric`, not null, `>= 0`. **Snapshotted at capture** from `pilot.mileage_rates` and genuinely immutable after insert — `authenticated` has no `UPDATE` grant on this specific column. This was a deliberately closed hole: an earlier version of the schema left this column updatable, and `updateMileageEntry` in the app would rewrite it on every save, silently re-pricing an already-recorded drive (proven live in migration `20260809050000`: a single update from `70.000` to `999.999` re-priced a $70.00 drive to $1,000.00 because `amount_cents` recomputed instantly). Correcting a wrong rate is delete-and-recreate the row, never an edit — the same discipline `pilot.recurring_invoice_schedules` uses for its own locked fields. **Do not "fix" a rate on an existing row by hand** — that reopens exactly the defect this grant restriction closes.

#### `amount_cents`
`bigint`, nullable per its catalog options but effectively always populated — this is a **GENERATED column**: `round(miles * rate_cents_per_mile)`, computed by Postgres itself and never writable directly. It can never drift from its inputs, which is precisely why `rate_cents_per_mile` above has to be locked — otherwise editing the rate would silently recompute this figure on a row that's supposed to be a permanent record.

#### `notes`
`text`, nullable. Free-text annotation.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

- **RLS is enabled.**
- `miles > 0`; `rate_cents_per_mile >= 0`; `from_place`/`to_place`/`purpose` have trimmed-length bounds.
- `amount_cents` is generated and cannot be set or edited directly by any role that isn't the table owner.
- `authenticated` has no `UPDATE` grant on `rate_cents_per_mile` — see above. `authenticated`'s `INSERT` is column-scoped (`id`/`amount_cents`/`created_at`/`updated_at` withheld) so a client can't mint its own id or back-date a row either.

### Changing this table

Correcting most fields (`miles`, `from_place`, `to_place`, `purpose`, dates, links, notes) is a normal grant-backed update. **Correcting `rate_cents_per_mile` on an existing row is not possible through the granted UPDATE path by design — delete the row and re-insert it with the right rate.** The SQL Editor runs as an admin connection and will let a raw `UPDATE ... set rate_cents_per_mile = ...` through anyway; see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for why that bypass exists and why it should still be avoided here specifically.

```sql
begin;
update pilot.mileage_entries
set purpose = 'Client meeting — corrected description'
where account_id = '<account-uuid>' and id = '<entry-uuid>';
rollback; -- or commit;

-- Correcting a wrong rate: delete and re-insert, not update.
begin;
delete from pilot.mileage_entries where account_id = '<account-uuid>' and id = '<entry-uuid>';
insert into pilot.mileage_entries (account_id, drove_on, miles, from_place, to_place, purpose, trip_id, client_id, rate_cents_per_mile, notes)
values ('<account-uuid>', '2026-03-01', 42.5, 'Base', 'Airport', 'Sim recurrent', null, null, 70.0, null);
rollback; -- or commit;
```

## bank_accounts

The pilot's own label for a statement source they import from — a nickname, the last 4 digits, and whether it's checking/savings/a credit card. This table never holds credentials or a live connection to any bank; it exists purely so imports of the same real account consistently scope to the same id (a free-typed label per import would drift by typo between imports of the same account, which matters for deduplication — see `bank_transactions`).

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. Tenant owner.

#### `label`
`text`, not null, constrained non-blank after trimming. The pilot's own name for this source, e.g. "Amex Business".

#### `last4`
`text`, nullable, constrained to match `^[A-Za-z0-9]{2,4}$` when present. The last 2-4 characters printed on a statement — never a full account or card number, by design; this product holds no credentials and no live bank data at all.

#### `kind`
`text`, not null, one of `checking`, `savings`, `credit_card`. Drives a real behavior at import time: a credit-card statement's sign convention gets flipped when parsed (see `bank_transactions` below), keyed off this column.

#### `archived_at`
`timestamptz`, nullable. When the pilot retired this source from active use; update-only, since a source is never created already archived.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

- **RLS is enabled.**
- `label` must be non-blank; `last4` must match the 2-4 alphanumeric pattern when present; `kind` restricted to the three values above.
- `authenticated`'s `INSERT` is column-scoped to `(account_id, kind, label, last4)` — `archived_at` is intentionally excluded from insert (archiving is an edit to an existing row, not something you create a row already in).

### Changing this table

Normal grant-backed inserts/updates.

```sql
begin;
update pilot.bank_accounts
set archived_at = now()
where account_id = '<account-uuid>' and id = '<bank-account-uuid>';
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for general safety rules.

## bank_import_batches

One row per statement upload — the CSV/OFX/QFX file(s) a pilot dropped in, tracked as a unit with counts of what happened. Mirrors `pilot.logbook_import_batches`, the equivalent table for flight-log imports.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. Tenant owner.

#### `bank_account_id`
`uuid`, not null. Which labeled statement source (see `bank_accounts`) this batch was imported into. Part of a composite foreign key `(account_id, bank_account_id)`.

#### `source_format`
`text`, not null, one of `csv_signed`, `csv_debit_credit`, `ofx`, `qfx`. Which parser was used.

#### `status`
`text`, not null, default `'pending'`, one of `pending`, `processing`, `completed`, `partial`, `failed`. Lifecycle of the import job.

#### `total_rows` / `imported_rows` / `rejected_rows` / `duplicate_rows`
`integer`, not null, default `0`, each `>= 0`. Running counts of what the import found and did with it.

#### `error_summary`
`text`, nullable. Human-readable explanation when `status` is `failed` or `partial`.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

- **RLS is enabled.**
- All four row-count columns are constrained `>= 0`; `source_format` and `status` restricted to their fixed lists.
- `authenticated`'s `INSERT` is column-scoped to `(account_id, bank_account_id, source_format, status, total_rows)` — the outcome counters (`imported_rows`, `rejected_rows`, `duplicate_rows`, `error_summary`) are withheld from insert on purpose: a batch is created with counts at zero, and only the later close-out `UPDATE` (which does have those columns granted) is allowed to say what actually happened. A client inserting "imported_rows: 900" up front would be writing an outcome before doing the work.

### Changing this table

Normal grant-backed updates for closing out or correcting a batch's status/counts.

```sql
begin;
update pilot.bank_import_batches
set status = 'completed', imported_rows = 42, rejected_rows = 0, duplicate_rows = 1
where account_id = '<account-uuid>' and id = '<batch-uuid>';
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for general safety rules.

## bank_source_files

The actual uploaded statement file(s) behind one import batch (a batch can, in principle, come from more than one file). Mirrors `pilot.logbook_source_files`.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. Tenant owner.

#### `import_batch_id`
`uuid`, not null. Which batch this file belongs to. Part of a composite foreign key `(account_id, import_batch_id)` to `bank_import_batches`.

#### `file_name`
`text`, not null. The original filename as uploaded.

#### `row_count`
`integer`, nullable, `>= 0` when present. How many data rows the file contained.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

- **RLS is enabled.**
- `row_count`, when present, must be `>= 0`.
- `authenticated`'s `INSERT` is column-scoped to `(account_id, file_name, import_batch_id, row_count)`.

### Changing this table

Normal grant-backed inserts/updates (`file_name`, `row_count`).

```sql
begin;
update pilot.bank_source_files
set row_count = 118
where account_id = '<account-uuid>' and id = '<source-file-uuid>';
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for general safety rules.

## bank_transactions

One row per line read out of an imported bank or card statement. This is the review queue — the whole feature is built around a row starting out `unreviewed` and staying inert (no category, no treatment, not attached to anything) until a pilot actively reviews it. A row only becomes a real expense through a specific database function, `pilot.bank_transaction_confirm`, never through a direct write — see the confirm flow below.

**Sign convention:** `amount_cents` is stored in one canonical sign no matter what kind of account it came from. Negative means money left the pilot's pocket (an expense candidate); positive means money came back (a deposit, a card payment, a refund). A checking/savings statement is already signed this way. A credit-card statement is not — card issuers show a purchase as positive — so importing a credit-card statement flips the sign at parse time (keyed off `bank_accounts.kind = 'credit_card'`) so a purchase always lands here as negative, matching checking. This lets the review queue and the confirm flow treat every account kind identically.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. Tenant owner.

#### `bank_account_id`
`uuid`, not null. Which labeled source this line came from.

#### `import_batch_id`
`uuid`, not null. Which upload produced this row.

#### `source_file_id`
`uuid`, not null. Which specific uploaded file produced this row.

#### `source_row_number`
`integer`, not null, `>= 1`. The row's position within the source file, for tracing a disputed row back to the original.

#### `source_row`
`jsonb`, not null. The raw imported row, kept verbatim (header name to raw string, or the OFX/QFX `<STMTTRN>` fields) — a rejected or disputed row needs to be traceable to exactly what the bank actually sent, not a re-serialized guess at it.

#### `posted_on`
`date`, not null. The date exactly as the bank stated it.

#### `description`
`text`, not null, constrained non-blank after trimming. The raw bank descriptor, never rewritten or title-cased — a pilot reconciling against their paper or PDF statement needs to recognize the line as printed, and a separate `category` column already exists for classification.

#### `amount_cents`
`bigint`, not null, constrained `<> 0` (a zero-dollar line isn't a real bank transaction). Signed per the convention described above — this is the canonical figure; nothing else in this table restates it.

#### `fingerprint`
`text`, not null. A deduplication key computed server-side from `(bank_account_id, posted_on, description, amount_cents)` — never accepted from the client, never derived from source-row order. A unique index (`bank_transactions_fingerprint_uniq`, scoped by `account_id` and `bank_account_id`) enforces this in the database rather than in application code, because a check-then-write in a server action would race two overlapping re-imports or two open tabs. It is deliberately scoped per `bank_account_id`, not just per tenant, because two genuinely different real accounts can legitimately produce a coincidentally identical fingerprint (the same $12 coffee charge posted the same day on two different cards) — that must not dedup across them.

#### `review_state`
`text`, not null, default `'unreviewed'`. One of `unreviewed`, `reviewed`, `ignored`. Every row is born `unreviewed`; the app's `INSERT` grant doesn't even include this column with any value other than the default, so a row can never be inserted already reviewed.

#### `suggested_category`
`text`, nullable, constrained to the same fifteen-value category list as `pilot.expenses.category`. A rule-driven guess the pilot created themselves (never machine-guessed) — always shown as visually distinct from the confirmed `category` in the app, since it's a suggestion, never an assignment.

#### `category`
`text`, nullable, constrained to the same fifteen-value list. The pilot's actual confirmed choice, ported verbatim from `pilot.expenses.category`'s vocabulary and meant to be kept in lockstep with it. A migration (`20260810070000`) widened `expenses.category` to fifteen values but initially missed updating this column's own CHECK, so seven of the categories the review-queue UI offered would fail with an opaque constraint violation on Confirm — a follow-up migration (`20260810140000`) brought this column's CHECK back in sync. If a future category is ever added, it has to be added in three places at once: this CHECK, `suggested_category`'s CHECK, and `pilot.expenses.category`'s CHECK.

#### `treatment`
`text`, nullable, one of `rebill`, `deduct`, `unassigned`.

#### `trip_id`
`uuid`, nullable. Trip this transaction (once confirmed) is attached to.

#### `expense_id`
`uuid`, nullable. The `pilot.expenses` row this transaction became, once and only once it's been reviewed. This is `ON DELETE SET NULL`: if the pilot later deletes the resulting expense, this row stays `reviewed` with `expense_id` set back to null rather than silently reopening as unreviewed or cascading away — it becomes a rare, visible "the expense this came from was removed" state instead.

#### `notes`
`text`, nullable. The pilot's own annotation on the row.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

- **RLS is enabled.**
- `description` must be non-blank; `amount_cents <> 0`; `source_row_number >= 1`.
- `review_state`, `category`, `suggested_category`, `treatment` are each restricted to their fixed lists.
- **The core invariant of this table:** a CHECK requires that a row where `review_state = 'reviewed'` must have both `category` and `treatment` set, and a row where `review_state <> 'reviewed'` must have both null — there is no reachable in-between state of "categorized but not really assigned yet." `pilot.bank_transaction_confirm` is the only path that sets all three together.
- `treatment is distinct from 'rebill' or trip_id is not null` — same "can't rebill to nobody" rule as `pilot.expenses`, mirrored here so a bad confirm can never even reach the expenses insert.
- `bank_transactions_fingerprint_uniq` — the actual duplicate-import guard; see `fingerprint` above.
- The foreign keys to `bank_accounts`, `bank_import_batches`, and `bank_source_files` are `ON DELETE RESTRICT` (import lineage can't be deleted out from under a transaction); the foreign keys to `trips` and `expenses` are `ON DELETE SET NULL`, each scoped to only null that one column rather than the whole composite key (an earlier version of this migration wrote the FK without a column list, which made Postgres null out every column in the key including the `not null` `account_id`, and deleting a bank-derived expense would fail outright with a confusing "something required is missing" error — fixed in `20260810030000`).

**The confirm flow, in plain English:** a row sits `unreviewed`. The pilot reviews it and either dismisses it (`review_state` set to `ignored` via a direct `UPDATE` — allowed, since that's a legitimate dead-end transition) or confirms it. Confirming calls `pilot.bank_transaction_confirm(transaction_id, category, treatment, trip_id, notes)`, a `SECURITY DEFINER` function that, in one atomic database transaction: locks the row (`FOR UPDATE`, so two simultaneous confirm attempts on the same row serialize instead of racing), checks it's still unreviewed and not a deposit, inserts the new `pilot.expenses` row (copying `posted_on`/`description`/`amount_cents` across, tagged with this transaction's id via `bank_transaction_id`), and then updates this row to `review_state = 'reviewed'` with `category`/`treatment`/`trip_id`/`notes`/`expense_id` all set together — all as one statement, so nothing can be left half-done by a crash or a lost network reply. This replaced an earlier three-separate-API-call version that could leave a row silently "reviewed with no expense" if the process died mid-sequence, or produce two expenses for one bank line if a lost reply on the second call was mistaken for a rejection and retried (migration `20260810040000`).

### Changing this table

This table is **gated**: `authenticated` has no direct `INSERT` access to `review_state`, `category`, `treatment`, `trip_id`, or `expense_id` at all (insert is column-scoped to the raw import fields only, so a row is always born unreviewed), and direct `UPDATE` is scoped to only `(review_state, notes)` — enough to dismiss a row (`review_state = 'ignored'`) or edit a note, not enough to reconstruct a confirm by hand. Turning a transaction into an expense is done exclusively by calling `pilot.bank_transaction_confirm(...)` as the app does, not by writing to this table directly. The SQL Editor runs as an admin connection and will bypass all of this — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) — but doing so recreates exactly the un-atomic multi-step sequence the confirm function exists to prevent, so prefer calling the function even from the SQL Editor:

```sql
select pilot.bank_transaction_confirm(
  '<bank-transaction-uuid>', 'training', 'deduct', null, 'Recurrent sim'
);

-- Dismissing a row without creating an expense (within the granted UPDATE scope):
begin;
update pilot.bank_transactions
set review_state = 'ignored'
where account_id = '<account-uuid>' and id = '<bank-transaction-uuid>';
rollback; -- or commit;
```
