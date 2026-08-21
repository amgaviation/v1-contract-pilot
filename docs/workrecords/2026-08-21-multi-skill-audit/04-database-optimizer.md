# Database & index review — V1 Contract Pilot

**Date:** 2026-08-21 · **Scope:** `supabase/migrations/**` (88 files, 50 tables, 192 indexes
including PK/unique), plus the app call sites that drive them.

## Environment reality

There is a Postgres 16 at `postgresql://postgres@127.0.0.1:55432`. `npm run verify:all`
builds `v1verify` by replaying every migration and then rolls back every suite, so **its
tables are empty and no `EXPLAIN ANALYZE` timing is available to me**. I did not modify
`v1verify` and did not write into `supabase/migrations/`. Instead I created two scratch
databases of my own, `dbaudit` (full 88-file replay) and `dbhazard` (replay stopped at
`20260807070000`), inspected `pg_index` / `pg_constraint` / `pg_proc` / `pg_policy`
directly, ran plain `EXPLAIN` with `enable_seqscan=off` to test whether an index *path
exists at all* (a structural question, not a timing one), and ran two live reproductions
against seeded rows in those scratch databases. **Every number below is a structural
count or a reproduced behaviour. No timing is claimed or estimated anywhere.**

The headline finding is not an index: a hold expiry deletes airman credential records
that three separate migration comments promise it keeps, and the reason the verify suite
misses it is that the suite's fixture happens to avoid the one shape that triggers it.
Index hygiene, by contrast, is mostly good — the real index problems are eleven duplicate
indexes nobody is paying for on purpose, and thirty-two foreign keys whose delete-side
check has no supporting index, both concentrated on the account-purge path.

---

## 1. A hold expiry destroys client-linked airman documents and operator qualifications

**Severity: critical** (data loss, on an automated path, of records the product promises
to keep) · **Location:** `supabase/migrations/20260805070000_phase3_clients_trips_expenses.sql:191-192`;
`supabase/migrations/20260807060000_operator_qualifications.sql:85`;
`supabase/migrations/20260818200000_monthly_hold.sql:129`

`pilot.purge_business_data_rows` deletes `pilot.clients`
(`20260818200000_monthly_hold.sql:129`) and deliberately does **not** delete
`pilot.documents` or `pilot.operator_qualifications`. The function's own comment states
the contract:

> `20260818090000_account_lifecycle.sql:274-276` — "deliberately keeps the airman's own:
> logbook, aircraft, **documents, operator qualifications** and currency snapshots"

and the column comment repeats it:

> `20260818090000_account_lifecycle.sql:105-106` — "its BUSINESS records are purged by
> `pilot.purge_business_data`. **The airman records are never purged here.**"

Both retained tables carry a composite FK to `clients` with `ON DELETE CASCADE`:

```
pilot.documents                 FOREIGN KEY (account_id, client_id)
                                REFERENCES pilot.clients(account_id, id) ON DELETE CASCADE
pilot.operator_qualifications   FOREIGN KEY (account_id, client_id)
                                REFERENCES pilot.clients(account_id, id) ON DELETE CASCADE
```

(verified with `pg_get_constraintdef` against the replayed `dbaudit` schema).

So `delete from pilot.clients` takes the client-linked documents with it. **Reproduced
in `dbaudit` on the fully replayed schema:**

```
insert accounts / clients
insert documents ('Client-linked medical', expires_on 2027-01-01, client_id set)
insert documents ('Unlinked medical',      expires_on 2027-01-01, client_id null)
docs_before = 2
select pilot.purge_business_data_rows(<account>)
-- surviving rows:
      label       | client_id
------------------+-----------
 Unlinked medical |
(1 row)
```

The first-class medical filed against a client is gone. So is every operator
qualification, which by construction is always client-linked — meaning the *entire*
`operator_qualifications` table for that tenant is emptied by a purge that claims to
retain it.

This reaches production through the unattended path: `app/api/holds/run/route.ts:197`
calls `pilot.expire_hold`, which calls `purge_business_data_rows`. A pilot who pauses for
a month and lets the hold lapse loses credential records the product's own copy says are
never at risk.

**Why the verify suite passes.** `scripts/account-lifecycle-db-verify.mjs` does assert
that documents survive — at `:90` and `:471` — but both fixtures insert a document with
**no `client_id`**:

```
scripts/account-lifecycle-db-verify.mjs:90    insert into pilot.documents (account_id, kind, label)
scripts/account-lifecycle-db-verify.mjs:471   insert into pilot.documents (account_id, kind, label) values ('${A}', 'passport', 'Passport');
```

That is exactly the row the cascade cannot reach. The test's blind spot is congruent with
the bug.

**The repo already knows this failure class.** `20260818230000_aircraft_client_purge_safe.sql`
exists solely to fix the same shape for `pilot.aircraft`, and its header states the
principle in full (`:16-22`): "SET NULL is the honest resolution of 'a retained record
referencing a purged one' … here it is **an airman record the purge must never touch**."
Two other airman tables were missed.

**Fix** — the same shape `20260818230000` used, including the column list, which is
load-bearing (a bare composite `SET NULL` nulls `account_id` too, and `account_id` is
`NOT NULL`):

```sql
-- DDL only; ACCESS EXCLUSIVE on the child table for the duration of the
-- constraint swap. The ADD re-validates every existing row (a full scan of
-- pilot.documents / pilot.operator_qualifications under that lock); on a
-- table of this size today that is negligible, but if these ever grow, add
-- the constraint NOT VALID and follow with VALIDATE CONSTRAINT, which takes
-- only SHARE UPDATE EXCLUSIVE and does not block writes.
alter table pilot.documents
  drop constraint if exists documents_account_id_client_id_fkey;
alter table pilot.documents
  add constraint documents_account_id_client_id_fkey
  foreign key (account_id, client_id) references pilot.clients (account_id, id)
  on delete set null (client_id);

alter table pilot.operator_qualifications
  drop constraint if exists operator_qualifications_account_id_client_id_fkey;
alter table pilot.operator_qualifications
  add constraint operator_qualifications_account_id_client_id_fkey
  foreign key (account_id, client_id) references pilot.clients (account_id, id)
  on delete set null (client_id);
```

`operator_qualifications.client_id` is currently `NOT NULL`, so it needs
`alter column client_id drop not null` first, or a decision that qualifications *are*
commercial records and belong in the purge delete list. **That decision is a product
call, not mine** — but the current state is the one outcome that is definitely wrong:
the code does one thing and three comments promise the other. Whichever way it goes,
`scripts/account-lifecycle-db-verify.mjs` needs a client-linked document in its fixture,
or the next such regression is invisible again.

---

## 2. `set local role service_role` in migration 20260807070000 is a no-op; the backfill aborts on any populated tenant

**Severity: high** (migration hazard; partial application, no rollback) ·
**Location:** `supabase/migrations/20260807070000_trip_day_units_away_cancel.sql:245-253`

The file writes a guarded backfill and protects it with a role switch:

```sql
-- :245
set local role service_role;

update pilot.trip_days td
   set away = true
  from pilot.day_types dt
 where dt.id = td.day_type_id ... ;

reset role;
```

Its header (`:202-244`) explains at length why the bypass is needed and claims it was
proved: "Proved against a local database built with exactly that shape … the bare UPDATE
fails with 'This trip is billed on a draft invoice…' (23514) and rolls back everything
this migration file did before it."

No migration file in this repo opens a transaction — `grep -c '^begin;' supabase/migrations/*.sql`
returns 0 for all 88 — and `SET LOCAL` outside a transaction block is a warning and a
no-op. Both the CI replay and `verify:all` emit it on every run:

```
psql:supabase/migrations/20260807070000_trip_day_units_away_cancel.sql:245: WARNING:  SET LOCAL can only be used in transaction blocks
```

**Reproduced end to end in `dbhazard`:** replay migrations up to but excluding this file,
seed exactly the shape the header names (account, client, completed trip, one
`counts_for_per_diem` trip_day, one draft invoice with one line billing that trip), then
apply the file:

```
psql:...20260807070000_trip_day_units_away_cancel.sql:245: WARNING:  SET LOCAL can only be used in transaction blocks
psql:...20260807070000_trip_day_units_away_cancel.sql:253: ERROR:  This trip is billed on a draft invoice. Remove it from that invoice before changing its days.
```

The predicted failure is the actual behaviour. Because the file is unwrapped and psql is
in autocommit, everything before line 245 has already committed and everything after —
including section 3's `canceled_at` / `cancellation_notice_from` columns — never runs.
That is a half-applied schema with no rollback and no marker.

The suite cannot catch this: `verify:all` replays into an empty database, where the
guard has no row to fire on, so the migration "passes" forever.

**Two honest caveats.** (a) The production apply path is the Supabase MCP
`apply_migration` tool per `docs/DEV-GUIDE.md:90-93`, and I could not determine from this
repo whether that path wraps a file in a transaction — if it does, `SET LOCAL` works
there and the damage is confined to the psql replay path. (b) Either way, the protection
the header describes is not demonstrated by any check this repo runs.

**Fix:** make the file's transaction explicit rather than assumed — `begin;` at the top,
`commit;` at the bottom — or replace `set local role` with `set role service_role; … reset role;`
which works in autocommit. Adding a `begin;/commit;` wrapper is the better change,
because it also makes the file all-or-nothing.

---

## 3. Eleven exactly-redundant indexes, six of them on money tables

**Severity: high** (write amplification on the invoice/payment path; the schema's stated
policy is not being enforced) · **Location:** listed below

The repo positions itself as deliberately omitting redundant indexes. Comparing
`pg_indexes` against `pg_constraint` on the replayed schema shows eleven indexes that
duplicate an existing unique constraint's index either exactly or as a prefix. Every one
of these is a second B-tree maintained on every insert, update and delete of the table,
for no read that the first one does not already serve.

| Redundant index | Duplicates | Declared at |
| --- | --- | --- |
| `invoice_shares_invoice_idx (account_id, invoice_id)` | `invoice_shares_account_id_invoice_id_key` | `20260809060000_invoice_public_share.sql:126` |
| `invoice_late_fees_source_idx (account_id, source_invoice_id, period_start)` | `invoice_late_fees_account_id_source_invoice_id_period_start_key` | `20260813130000_payment_reminders_and_late_fees.sql:655` |
| `trip_days_trip_idx (account_id, trip_id, day_on)` | `trip_days_account_id_trip_id_day_on_key` | `20260807000000_phase9_day_types_and_trip_days.sql:175` |
| `recurring_invoice_generations_schedule_idx (account_id, schedule_id, period_start)` | `recurring_invoice_generations_account_id_schedule_id_period_key` | `20260809030000_recurring_invoices.sql:225` |
| `estimate_shares_estimate_idx (account_id, estimate_id)` | `estimate_shares_account_id_estimate_id_key` | `20260814111000_estimate_share.sql:77` |
| `bank_statement_matches_txn_idx (account_id, bank_transaction_id)` | `bank_statement_matches_account_id_bank_transaction_id_key` | `20260812100001_bank_reconciliation.sql:63` |
| `aircraft_account_idx (account_id, tail_key)` | `aircraft_account_id_tail_key_key` | `20260810110000_aircraft_registry.sql:124` |
| `client_tax_forms_client_year_idx (account_id, client_id, tax_year)` | prefix of `client_tax_forms_account_id_client_id_tax_year_form_type_key` | `20260807080000_client_tax_forms.sql:72` |
| `mileage_rates_account_year_idx (account_id, tax_year DESC)` | `mileage_rates_account_id_tax_year_key` (a B-tree scans either direction) | `20260809020000_mileage.sql:114` |
| `accounts_stripe_customer_key` | `accounts_stripe_customer_id_key` (see finding 7) | `20260805160000_phase2_billing_events.sql:82` |
| `accounts_stripe_subscription_key` | `accounts_stripe_subscription_id_key` (see finding 7) | `20260805160000_phase2_billing_events.sql:86` |

`invoice_shares`, `invoice_late_fees`, `recurring_invoice_generations`, `trip_days` and
`bank_statement_matches` all sit on write paths that money flows through — the reminder
ladder, the recurring/autopay generator, trip commit, bank reconciliation.

**Fix.** Drop the plain index, keep the constraint's (the constraint cannot be dropped
without losing the uniqueness guarantee).

```sql
-- DROP INDEX CONCURRENTLY takes only SHARE UPDATE EXCLUSIVE: no reads or
-- writes are blocked. It cannot run inside a transaction block, so each
-- statement must be its own migration statement with no BEGIN wrapper —
-- which is this repo's default file shape anyway. If any of these ever
-- turns out to back a constraint, the DROP fails loudly rather than
-- silently weakening it.
drop index concurrently if exists pilot.invoice_shares_invoice_idx;
drop index concurrently if exists pilot.invoice_late_fees_source_idx;
drop index concurrently if exists pilot.trip_days_trip_idx;
drop index concurrently if exists pilot.recurring_invoice_generations_schedule_idx;
drop index concurrently if exists pilot.estimate_shares_estimate_idx;
drop index concurrently if exists pilot.bank_statement_matches_txn_idx;
drop index concurrently if exists pilot.aircraft_account_idx;
drop index concurrently if exists pilot.client_tax_forms_client_year_idx;
drop index concurrently if exists pilot.mileage_rates_account_year_idx;
drop index concurrently if exists pilot.accounts_stripe_customer_key;
drop index concurrently if exists pilot.accounts_stripe_subscription_key;
```

Worth pairing with a `verify:all` assertion that no non-constraint index is a
leading-column prefix of a constraint index on the same table — that is a catalog query,
and it would have caught all eleven.

---

## 4. Thirty-two foreign keys have no index supporting the delete-side check

**Severity: medium** (structural; concentrated on the purge and settings-delete paths) ·
**Location:** catalog-derived, table below

Postgres does not auto-index the referencing side of a FK. On a parent `DELETE` it must
find every child row by the FK columns; without an index leading with those columns it
scans. Querying `pg_constraint` against `pg_index` on the replayed schema returns 32 such
constraints. Not all matter equally — the ones that do are those whose parent actually
gets deleted in this product. Ranked by that:

**Parent is deleted on the purge path** (`purge_business_data_rows` deletes clients,
invoices, trips, expenses, bank batches, estimates — while the child table survives or is
deleted later):

| Child table | FK columns | On delete | Consequence |
| --- | --- | --- | --- |
| `documents` | `(account_id, client_id)` | cascade | see finding 1 |
| `mileage_entries` | `(account_id, client_id)` | set null | scan per client deleted |
| `bank_transactions` | `(account_id, expense_id)` | set null | scan of the largest import table per expense deleted |
| `bank_transactions` | `(account_id, trip_id)` | set null | same, per trip |
| `bank_transactions` | `(account_id, import_batch_id)` | restrict | scan per batch delete |
| `bank_transactions` | `(account_id, source_file_id)` | restrict | scan per source-file delete |
| `estimates` | `(account_id, converted_invoice_id)` | set null | scan per invoice delete |
| `invoice_late_fees` | `(account_id, fee_invoice_id)` | cascade | scan per invoice delete |
| `recurring_invoice_schedules` | `(account_id, client_id)` | restrict | scan per client delete |
| `estimate_lines` | `(account_id, estimate_id)` | cascade | see finding 6 |

**Parent is deleted from the settings UI:** `trip_days (account_id, day_type_id)` restrict
and `client_rates (account_id, day_type_id)` cascade. `app/(app)/settings/day-types-actions.ts`
deletes day types; each delete scans `trip_days` and `client_rates` in full.

**Parent is deleted on logbook import rollback:** `logbook_entries (account_id, import_batch_id)`
and `(account_id, source_file_id)`, both restrict. `logbook_entries` is one of the two
tables designed to grow without bound; deleting an import batch scans all of it.

The remainder are `created_by` / `airman_user_id` references to `auth.users` on
`document_shares`, `invoice_shares`, `estimate_shares`, `client_vendor_links`,
`documents`, `logbook_entries`, `currency_snapshots` — those parents are effectively
never deleted, and I would leave them alone rather than pay for seven more indexes.

**Fix** — the eleven that are on real delete paths:

```sql
-- CREATE INDEX CONCURRENTLY takes SHARE UPDATE EXCLUSIVE, not ACCESS
-- EXCLUSIVE: concurrent SELECT/INSERT/UPDATE/DELETE keep running. Cost is
-- two table passes instead of one and it cannot run inside a transaction
-- block, so each of these must be a standalone statement — no BEGIN
-- wrapper on the file. A CONCURRENTLY build that fails leaves an INVALID
-- index behind that must be dropped (also CONCURRENTLY) and rebuilt;
-- check `pg_index.indisvalid` after applying.
create index concurrently if not exists documents_client_idx
  on pilot.documents (account_id, client_id) where client_id is not null;

create index concurrently if not exists mileage_entries_client_idx
  on pilot.mileage_entries (account_id, client_id) where client_id is not null;

create index concurrently if not exists bank_transactions_expense_idx
  on pilot.bank_transactions (account_id, expense_id) where expense_id is not null;

create index concurrently if not exists bank_transactions_trip_idx
  on pilot.bank_transactions (account_id, trip_id) where trip_id is not null;

create index concurrently if not exists bank_transactions_batch_idx
  on pilot.bank_transactions (account_id, import_batch_id);

create index concurrently if not exists bank_transactions_source_file_idx
  on pilot.bank_transactions (account_id, source_file_id) where source_file_id is not null;

create index concurrently if not exists estimates_converted_invoice_idx
  on pilot.estimates (account_id, converted_invoice_id) where converted_invoice_id is not null;

create index concurrently if not exists invoice_late_fees_fee_invoice_idx
  on pilot.invoice_late_fees (account_id, fee_invoice_id) where fee_invoice_id is not null;

create index concurrently if not exists recurring_invoice_schedules_client_idx
  on pilot.recurring_invoice_schedules (account_id, client_id);

create index concurrently if not exists trip_days_day_type_idx
  on pilot.trip_days (account_id, day_type_id);

create index concurrently if not exists client_rates_day_type_idx
  on pilot.client_rates (account_id, day_type_id);
```

The partial predicates are not decoration: they keep the index off the (large) majority
of rows where the link is null, which is the normal case for `bank_transactions.trip_id`,
`expense_id` and `documents.client_id`. Net index count after findings 3 and 4 together:
−11 +11, i.e. flat, but each of the eleven that stay pays for itself on a delete path
that currently scans.

---

## 5. Three tables have no index path for `account_id` at all — including the one whose RLS predicate is `account_id`

**Severity: medium** · **Location:** `supabase/migrations/20260810100000_credential_packet_share.sql:67-79`;
`supabase/migrations/20260810010000_connect_link_hardening.sql` (connect_oauth_states)

Every other tenant table gets `account_id`-leading coverage free, from the
`(account_id, id)` unique constraint the schema puts on almost all of them — including
`account_members`, `client_rates`, `client_vendor_links`, `document_shares` and
`recurring_invoice_schedules`, which a `create index` grep alone would report as
uncovered. Verified per table with `EXPLAIN` under `enable_seqscan=off`; all of those
pick an index.

Three do not:

```
-- explain select 1 from pilot.document_share_items where account_id = '…'   (enable_seqscan=off)
 Seq Scan on document_share_items  (cost=10000000000.00..10000000023.38 rows=5 width=4)

-- explain select 1 from pilot.connect_oauth_states where account_id = '…'   (enable_seqscan=off)
 Seq Scan on connect_oauth_states  (cost=10000000000.00..10000000020.12 rows=4 width=4)

-- explain select 1 from pilot.stripe_connect_events where account_id = '…'  (enable_seqscan=off)
 Seq Scan on stripe_connect_events (cost=10000000000.00..10000000013.12 rows=1 width=4)
```

The planner cannot use an index even when told to avoid a seq scan — no path exists.

`document_share_items` is the one that matters. Its only indexes are
`primary key (share_id, document_id)` and `document_share_items_share_idx (share_id)`
(`20260810100000:72,78-79`), while its RLS policy is
`account_id IN (SELECT pilot.current_account_ids())` (confirmed from `pg_policy`). Every
authenticated SELECT on that table scans the whole cross-tenant table and filters. It is
also the child of `account_id → accounts ON DELETE CASCADE` with no index, so an account
deletion scans it too.

`connect_oauth_states` is short-lived and low-volume; both its FKs cascade from
account/user deletes. `stripe_connect_events` is a genuine exception and I would **not**
add an index: all four of its indexes are partial or `connected_account_id`-led by
design, and every query I read matches one of them —
`app/(app)/invoices/page.tsx:166-171` matches `stripe_connect_events_needs_review_idx`
exactly, `app/(app)/invoices/[id]/page.tsx:206-211` matches
`stripe_connect_events_invoice_idx`, and the webhook writes go by PK
(`app/api/stripe/connect-webhook/route.ts:293-297, 333-336`). The bare `account_id` scan
is a shape no code issues. Noting it only so a future reviewer does not re-derive it.

**Fix:**

```sql
create index concurrently if not exists document_share_items_account_idx
  on pilot.document_share_items (account_id, document_id);

create index concurrently if not exists connect_oauth_states_account_idx
  on pilot.connect_oauth_states (account_id);
```

---

## 6. `estimate_lines` is the only line-item table not led by `account_id`

**Severity: medium** · **Location:** `supabase/migrations/20260810060000_phase10_estimates.sql`
(index `estimate_lines_estimate_idx`)

Every other child-of-a-document table in this schema leads with `account_id`:
`invoice_lines_invoice_idx (account_id, invoice_id, sort_order)`,
`journal_lines_entry_idx (account_id, entry_id)`,
`trip_legs_trip_idx (account_id, trip_id, leg_date)`. `estimate_lines_estimate_idx` is
`(estimate_id, sort_order)`. Confirmed from `pg_indexes` on the replayed schema.

Consequences, both structural: the FK `(account_id, estimate_id) ON DELETE CASCADE` is
unindexed for its leading column (finding 4), and the RLS predicate on `account_id` has
to fall back to `estimate_lines_account_id_id_key`. The estimate detail read
(`app/(app)/estimates/[id]/page.tsx`) and the five `estimate_lines` writes in
`app/(app)/estimates/actions.ts` all filter by `(account_id, estimate_id)`.

**Fix** — replace it with the shape its five siblings use:

```sql
create index concurrently if not exists estimate_lines_estimate_idx_v2
  on pilot.estimate_lines (account_id, estimate_id, sort_order);
-- then, in a SEPARATE statement after the build reports valid:
drop index concurrently if exists pilot.estimate_lines_estimate_idx;
```

Build first, drop second: between the two statements the table carries both, which costs
write throughput briefly but never leaves the ordering query unindexed.

---

## 7. The two `accounts` Stripe partial-unique indexes duplicate column constraints, on a rationale that misstates Postgres UNIQUE/NULL semantics

**Severity: low** (two wasted indexes; the reasoning is the part worth correcting) ·
**Location:** `supabase/migrations/20260805160000_phase2_billing_events.sql:76-88`

`20260802190437_pilot_schema_tenancy.sql:61-62` already declares:

```sql
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
```

`20260805160000:82-88` then adds partial unique indexes over the same columns, explaining:

> "Partial indexes so the many NULLs on unprovisioned rows don't collide."

Nulls in a plain Postgres `UNIQUE` never collide — `NULL` is not equal to `NULL`, so a
unique constraint permits unlimited null rows without any partial predicate (this is
default `NULLS DISTINCT` behaviour; `NULLS NOT DISTINCT` is opt-in and is not used here).
The `where … is not null` clause therefore buys nothing the constraint did not already
provide, and the result is two extra unique B-trees on `pilot.accounts` — visible in the
catalog as `accounts_stripe_customer_id_key` alongside `accounts_stripe_customer_key`,
and likewise for subscription.

The *goal* stated in the header — "a webhook bug could provision a SECOND account for a
customer who already has one" — was already met by the Phase 1 constraints. Drop
statements are in finding 3's block.

---

## 8. Migration replay is not idempotent, contradicting the documented `db push` posture

**Severity: low** (blocks a recovery path rather than breaking a live one) ·
**Location:** `supabase/migrations/20260802190437_pilot_schema_tenancy.sql:88`,
`:149`; `supabase/migrations/20260807110000_operator_qualification_reg_corrections.sql:199,323,327`;
`docs/DEV-GUIDE.md:90-96`

`docs/DEV-GUIDE.md:94-96` says a `supabase db push` from this repo "will try to re-apply
everything — safe only for the migrations written as `create or replace`, which is most
of them, deliberately." I tested re-application against the fully replayed `dbaudit`:

```
--- re-apply 20260802190437_pilot_schema_tenancy
  ERROR:  relation "accounts" already exists                       (line 88)
--- re-apply 20260807110000_operator_qualification_reg_corrections
  ERROR:  constraint "operator_qualifications_check1" ... does not exist  (line 199)
--- re-apply 20260811050000_currency_snapshots_latest_by_computation
  (clean)
```

So re-apply aborts on file 1 of 88. Four `create index` statements also lack
`if not exists` — `20260802190437:149`, `20260807110000:323,327`,
`20260811050000:102` (the last is preceded by a `drop index if exists`, so it survives).

This does not affect today's forward path (Supabase MCP `apply_migration`, one file at a
time), and I am not claiming it should be fixed retroactively — but the DEV-GUIDE's
characterisation is optimistic, and "replay this repo onto a fresh project" is a real
disaster-recovery operation that currently does not work file-by-file. Worth either
correcting the doc or adding `if not exists` / `drop … if exists` to the five statements.

Separately: none of the 56 `alter table … add constraint` statements uses `NOT VALID`.
Each validates every existing row under `ACCESS EXCLUSIVE`. Irrelevant at current row
counts, but it is the standard hazard to reach for when any of these tables gets large.

---

## 9. Partial-index opportunities on the two cron sweep queries

**Severity: low** (structural; both are global, all-tenant scans that grow with tenant
count) · **Location:** `lib/autopay/run.ts:144-148, 182-186`; `lib/reminders/run.ts:772-777`

Both crons open with an unindexed status filter over the whole `pilot.accounts` table:

```
lib/autopay/run.ts:144-148     .from("accounts").in("status", ["trialing","active"])
                                 .is("deactivated_at", null).is("hold_started_at", null)
lib/reminders/run.ts:772-777   .from("accounts").in("status", ["trialing","active","past_due"])
```

`pilot.accounts` has no index on `status`; the only partial index is
`accounts_hold_ends_at_idx (hold_ends_at) WHERE hold_started_at IS NOT NULL`, which the
holds cron uses correctly and which is exactly the right shape.

Then `lib/autopay/run.ts:182-186` reads `recurring_invoice_schedules` per account by
`(account_id, active, autopay)`; the only usable index is `(account_id, id)`, so the
`active`/`autopay` filtering is a heap filter.

Neither is urgent — `accounts` is small and stays small relative to everything else — but
they are the two queries whose cost is a function of *total tenants* rather than one
tenant's data, which is the scaling shape worth pre-empting cheaply:

```sql
create index concurrently if not exists accounts_cron_sweep_idx
  on pilot.accounts (status)
  where deactivated_at is null and hold_started_at is null;

create index concurrently if not exists recurring_invoice_schedules_autopay_idx
  on pilot.recurring_invoice_schedules (account_id)
  where active and autopay;
```

The first will not serve the reminders sweep (which does not filter `deactivated_at`);
if that matters, index `(status)` unpartitioned instead and let both use it. I would take
the partial: autopay is the money path.

The two acknowledged N+1 cron loops (`app/api/holds/run/route.ts:196` one `expire_hold`
per due account, `lib/autopay/run.ts:243` one `generate_autopay_invoice` per due period)
are correctly characterised as a future scaling conversation, not a defect. They are
per-tenant RPCs doing per-tenant work; batching them would mean one long transaction
holding locks across tenants, which is worse at this size.

---

## 10. `accounts.default_*_cents` are `integer` where every sibling column is `bigint`

**Severity: low** (consistency; not a live overflow) ·
**Location:** catalog-derived; `pilot.accounts` vs `pilot.clients`

Of 38 money/rate columns, 35 are `bigint` (`*_cents`) or `numeric(6,x)`
(`rate_cents_per_mile`). Three are `integer`:

```
accounts | default_day_rate_cents        | integer
accounts | default_per_diem_cents        | integer
accounts | default_travel_day_rate_cents | integer
```

The identically named columns on `pilot.clients` are `bigint`, and account defaults flow
into client defaults and then into `trips.day_rate_cents` (`bigint`). Narrowing is the
safe direction so nothing overflows today, but a schema where the same concept has two
widths is a schema where someone eventually copies the wrong one. `alter column … type bigint`
rewrites the table under `ACCESS EXCLUSIVE`; on `pilot.accounts` at current size that is
sub-second, and it is the kind of thing to do now rather than at scale.

---

## 11. Constraint and function hygiene: clean, with the evidence

**Severity: informational** — recording what I checked and found sound, so a later
reviewer does not re-derive it.

**`search_path` and volatility on SECURITY DEFINER functions — clean.** 47 SECURITY
DEFINER functions in schema `pilot`. Querying `pg_proc` for any with
`proconfig IS NULL OR proconfig NOT LIKE '%search_path=%'` returns **zero rows**. All 47
pin `search_path = ''`. Volatility split: 8 `STABLE`, 39 `VOLATILE` — the STABLE ones are
the read helpers (`current_account_ids`, `is_account_owner`, the token-gated `*_public`
reads), which is correct; nothing that writes is mismarked STABLE. The reporting
functions (`trip_pl`, `unbilled_*`, `ledger_balances`, `logbook_filtered`, …) are
`SECURITY INVOKER`, and none of them has a null `proconfig` either.

**Execute grants — clean.** No SECURITY DEFINER function is executable by `PUBLIC` except
`invoice_payments_resync_status`, which returns `trigger` and so cannot be usefully
invoked via PostgREST. The destructive ones are correctly gated: `expire_hold`,
`generate_autopay_invoice`, `invoice_share_receipts` → `service_role` only;
`purge_business_data_rows` explicitly revoked from both `public` and `authenticated`
(`20260818200000_monthly_hold.sql:148-149`), with only the owner-checked wrapper
`purge_business_data` granted to `authenticated` — and that wrapper's first statement is
`perform pilot.assert_account_owner(target_account)` (`20260818200000:158`).

**Money CHECK discipline — strong.** Of 31 `*_cents` / `*_bps` columns, 30 carry an
explicit sign or range CHECK. The one without (`mileage_entries.amount_cents`) is a
`GENERATED ALWAYS AS (round(miles * rate_cents_per_mile))` column whose inputs are both
checked `> 0` / `>= 0`, so it cannot go negative. `invoice_lines.amount_cents` and
`estimate_lines.amount_cents` are generated the same way from `quantity > 0` and
`unit_amount_cents >= 0`. Reversal semantics are enforced at the row level:
`invoice_payments` requires `(reverses_payment_id IS NULL AND amount_cents > 0) OR (reverses_payment_id IS NOT NULL AND amount_cents < 0)`.
Tax is bounded (`tax_rate_bps BETWEEN 0 AND 2500`), late fees bounded
(`late_fee_bps_per_month BETWEEN 0 AND 500`, grace 0–90 days, flat and bps mutually
exclusive).

**Forward-only state machine — enforced in the database, not just the app.**
`pilot.invoices_protect_issued` (`20260805090000_phase5_invoices.sql:556`, re-issued
later) enumerates every legal status transition and raises on anything else; backwards
transitions (`paid → partial|sent`) are gated on a `pilot.allow_payment_reversal` session
setting rather than allowed generally. `draft → sent` additionally requires at least one
line and refuses a line whose trip belongs to a different client; `→ partial|paid`
re-derives from `invoice_totals` and refuses `paid` with a nonzero balance. Post-draft,
column-level immutability is enforced by a `to_jsonb(new) - allowlist IS DISTINCT FROM to_jsonb(old) - allowlist`
comparison — i.e. new columns default to immutable rather than to editable, which is the
correct default direction.

---

## 12. Corrections to the recon map handed to me

**Severity: informational** — the recon map was built by grep and flagged several tables
as index-less; the live catalog disagrees. Recording this so downstream agents do not act
on the grep result.

- **`pilot.invoices` has no `trip_id` column.** The map lists `invoices.trip_id → trips`
  as an unindexed FK; `EXPLAIN` returns `ERROR: column "trip_id" does not exist`, and
  `pg_constraint` shows only `account_id` and `client_id` FKs on that table.
- **`account_members`, `client_rates`, `client_vendor_links`, `document_shares`,
  `recurring_invoice_schedules` all have `account_id`-leading coverage** — from
  `account_members_account_id_user_id_key`, `client_rates_account_id_id_key`,
  `client_vendor_links_account_id_client_id_key`,
  `document_shares_account_id_client_id_key`,
  `recurring_invoice_schedules_account_id_id_key` respectively. All five were flagged as
  "verify — no index found"; all five pick an index under `enable_seqscan=off`. The
  `(account_id, id)` unique constraint the schema puts on nearly every tenant table is
  precisely the "existing composite unique already provides it" case, and it is why the
  repo's decision not to declare redundant `account_id` indexes is right.
- **`journal_lines.chart_account_id` is indexed** (`journal_lines_chart_idx`); the map's
  `bank_statement_matches.journal_line_id` gap is covered by
  `bank_statement_matches_account_id_journal_line_id_key`.
- **`guarantee_periods.client_id` is covered** by
  `guarantee_periods_account_id_client_id_period_month_key`.
- **`expenses` really is the best-indexed table in the schema** — that part of the map
  holds. The only expenses FK without leading coverage is the 3-column
  `(account_id, trip_id, client_id)`, which the 2-column `expenses_trip_idx` prefixes.

---

## What I did not cover

- **No timings, no `EXPLAIN ANALYZE`, no buffer ratios, no `pg_stat_statements`.** Every
  database available to me is empty by construction. All plan evidence above is shape
  only, obtained with plain `EXPLAIN` and `enable_seqscan=off` to answer "does an index
  path exist", never "is this fast". Nothing here is a measured regression, and the index
  proposals are not validated against a real distribution — they should be re-checked
  against production `pg_stat_user_indexes` before anything is dropped.
- **I did not apply anything.** No migration file written, no index created or dropped,
  no source file touched. My scratch databases `dbaudit` and `dbhazard` are still on the
  local server if someone wants to re-run the two reproductions; `v1verify` was not
  touched.
- **I did not run `npm run verify:all`.** I replayed the same 88 migrations by hand into
  my own databases (which is what its first half does) but did not run the ~20 verify
  harnesses, so I am not reporting on whether the suite currently passes. Finding 1 and
  finding 2 are both cases the suite structurally cannot catch, which is a statement
  about coverage, not about its current result.
- **RLS policy correctness and the service-role allow-list are out of my lane.** I read
  `pg_policy` only far enough to know which column each policy filters on, so I could
  judge index coverage for it. Whether the 153 policies are individually correct, whether
  every policy has a matching GRANT, and whether the ten service-role call sites are still
  the only ones — that belongs to the security and tenancy reviewers.
- **Query rewrites and the page-level fan-out are out of scope for this pass.** The
  16-round-trip invoice detail page, the 20+-round-trip client detail page and the three
  near-identical report query modules are real consolidation targets, but consolidating
  them is application work, and none of them is blocked on a missing index once finding 4
  lands.
- **Storage, `auth.*`, and `pilot.receipts` / bucket policies** were not examined.
- **Partitioning, autovacuum tuning and server configuration** were not examined; at this
  data size neither is the constraint, and recommending either without a measured
  baseline would be guessing.
- **The currency engine (`CURRENCY_ENGINE_ENABLED`)** is dark and has no page call sites;
  I checked `currency_snapshots`' indexes and left the rest alone.
