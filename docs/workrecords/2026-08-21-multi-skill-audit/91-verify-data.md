# 91 — Adversarial verification: data lane

Re-checked every finding in `04-database-optimizer.md` and `05-sql-optimizer.md` against the
migrations and call sites. Nothing was applied; nothing outside this file was written or edited.
The only database work was one four-statement probe in a throwaway schema (`fkprobe`, dropped
after) on the local Postgres, to confirm a Postgres semantic. No timing claim is accepted
anywhere — every database reachable from here is empty by construction.

## Schema/index findings (04)

| ID | Verdict | Severity (mine) |
| --- | --- | --- |
| DB-01 | confirmed | critical |
| DB-02 | adjusted | medium |
| DB-03 | adjusted | low |
| DB-04 | adjusted | low |
| DB-05 | adjusted | low |
| DB-06 | adjusted | low |
| DB-07 | confirmed | low |
| DB-08 | adjusted | info |
| DB-09 | adjusted | info |
| DB-10 | adjusted | info |

**DB-01 — confirmed, critical.** Every load-bearing fact holds.
`pilot.documents` carries `foreign key (account_id, client_id) references pilot.clients … on
delete cascade` (20260805070000:192) and `pilot.operator_qualifications` the same
(20260807060000:85) with `client_id uuid not null` (:84).
`purge_business_data_rows` deletes `pilot.clients` (20260818200000:129) and retains both tables.
The contradicted promises are where the report says they are: 20260818090000:105-106 ("The
airman records are never purged here") and the function comment at :270-276, which names
"documents, operator qualifications" explicitly. No later migration alters either FK — the only
subsequent constraint work on `operator_qualifications` (20260807110000:197-199, :323-327)
touches CHECKs and unique indexes, not the client FK. The verify blind spot is real:
`scripts/account-lifecycle-db-verify.mjs` never writes `client_id` anywhere (grep returns
nothing), so both document fixtures are unlinked and survive. The aircraft precedent
(20260818230000) and its column-list caveat are quoted accurately.

**DB-02 — adjusted, high → medium.** The mechanism is confirmed: no migration opens a
transaction (`grep -c '^begin;'` is 0 across all 88), `verify:all` replays with
`psql -X -q -f` per file in autocommit (package.json:38), so `set local role service_role`
(20260807070000:245) is a warning and a no-op, and the guard it was meant to bypass exempts
only `service_role` (20260807020000:210, :249) — not the `postgres` role the replay runs as.
Adjusted on blast radius, not on mechanism: the file is already applied in production, and
every replay target (`v1verify`, a fresh project) is empty, where the guard has no row to fire
on. The failure needs a populated database that has never seen this file — i.e. a `db push`
re-apply, which DEV-GUIDE:94-96 already warns is only partly safe. Also unverified from here:
whether the Supabase MCP `apply_migration` path (how these were actually applied, per
`supabase/migrations/README.md`) wraps the file in a transaction, which would make `SET LOCAL`
work on that path. Fix as proposed regardless — it is two lines and makes the file atomic.

**DB-03 — adjusted, high → low.** All eleven are real; I checked each against its table's
constraints. Exactly redundant: `invoice_shares_invoice_idx` vs `unique (account_id,
invoice_id)`; `invoice_late_fees_source_idx` vs `unique (account_id, source_invoice_id,
period_start)`; `trip_days_trip_idx` vs `unique (account_id, trip_id, day_on)`;
`recurring_invoice_generations_schedule_idx` vs `unique (account_id, schedule_id,
period_start)`; `estimate_shares_estimate_idx` vs `unique (account_id, estimate_id)`;
`bank_statement_matches_txn_idx` vs `unique (account_id, bank_transaction_id)`;
`aircraft_account_idx` vs `unique (account_id, tail_key)`. Prefix-redundant:
`client_tax_forms_client_year_idx` under `unique (account_id, client_id, tax_year,
form_type)`; `mileage_rates_account_year_idx (account_id, tax_year desc)` under `unique
(account_id, tax_year)` — the DESC is not a reason to keep it, a constant `account_id` plus a
backward scan of the unique index yields the same order. And the two Stripe partial uniques
duplicate the column-level `text unique` at 20260802190437:61-62. This is *not* the
"already-served-by-a-composite-constraint" trap: the repo's deliberate-omission comment
(20260802190437:147-149) documents omitting a redundant index, which is the opposite behaviour
and corroborates these eleven as oversights. Severity drops to low because the cost is write
amplification on B-trees over a pre-launch, per-tenant-small dataset — "six on money-path
tables" is a location, not an impact.

**DB-04 — adjusted, medium → low.** The unindexed-FK list is accurate where I sampled it:
`documents` has only `documents_expiry_idx (account_id, expires_on)`, so `client_id` is
uncovered; `mileage_entries` has `(account_id, drove_on desc)` and `(account_id, trip_id)` but
nothing on `client_id`; `recurring_invoice_schedules` has no `create index` at all;
`trip_days` and `client_rates` have nothing on `day_type_id`; `bank_transactions`' three
indexes all lead `(account_id, bank_account_id | posted_on)`. The *rationale* is partly wrong.
Five of the eleven are justified as "on the purge path", but `purge_business_data_rows` deletes
children before parents — `mileage_entries` and `recurring_invoice_schedules` are gone before
`clients` (20260818200000:110-114, :127-129), so those FK checks find nothing to scan. What
remains is the interactive delete path (a single client, a day type), on one tenant's rows.
Real, cheap to fix, low.

**DB-05 — adjusted, medium → low, and half of it refuted.** `connect_oauth_states`: refuted as
stated. RLS is enabled with *no policies* and `revoke all … from authenticated, anon`
(20260810010000:140-148) — deliberately, and documented as such — so there is no "RLS predicate
is account_id" here and no authenticated read path to be slow. The table is queried only by
`state` (the PK), by `user_id`, and by `created_at` (:176-187, :229); an `account_id` index
would serve nothing but an account-delete cascade over a table swept hourly. Do not add it.
`document_share_items`: the structural fact holds — indexes are `primary key (share_id,
document_id)` and `(share_id)` (20260810100000:72, :78), the policy filters `account_id`
(:225) — but "every authenticated SELECT scans the cross-tenant table" does not follow. Real
reads key on `share_id`, which is the leading column of an index; the RLS predicate lands as a
post-scan filter over an already-bounded set. Worth a `(account_id, document_id)` index only as
tidiness.

**DB-06 — adjusted, medium → low.** `estimate_lines_estimate_idx` is indeed `(estimate_id,
sort_order)` (20260810060000:264-265) against `(account_id, invoice_id, sort_order)`,
`(account_id, entry_id)` and `(account_id, trip_id, leg_date)` elsewhere — the inconsistency is
real. One sub-claim is wrong: "the (account_id, estimate_id) CASCADE FK is unindexed on its
leading column". The delete-side check keys on `estimate_id`, which *is* this index's leading
column, so the cascade is index-assisted. What is left is the RLS-predicate fallback to
`estimate_lines_account_id_id_key` and a lost index-order sort. Build-then-drop ordering in the
fix is correct.

**DB-07 — confirmed, low.** `stripe_customer_id text unique` and `stripe_subscription_id text
unique` at 20260802190437:61-62; the partial uniques at 20260805160000:82-88 justified by
"the many NULLs on unprovisioned rows don't collide". Postgres UNIQUE is NULLS DISTINCT by
default, so the predicate buys nothing and the Phase 1 constraints already deliver the stated
goal. The comment is the defect; the index is merely its cost.

**DB-08 — adjusted, low → info.** The two failing statements are real (`create table
pilot.accounts (` at 20260802190437:40 with no `if not exists`; `drop constraint
operator_qualifications_check1` at 20260807110000:199 with no `if exists`), as are the four
`create index` statements without `if not exists` (20260802190437:149, 20260807110000:323,
:327, 20260811050000:102). "Contradicting DEV-GUIDE's db push posture" is the part I reject:
:94-96 already says a push "will try to re-apply everything — safe only for the migrations
written as `create or replace`, which is most of them", i.e. the guide states the limitation
rather than promising idempotency. The NOT VALID observation is noise — 55 of the 56 `add
constraint` statements run against tables created moments earlier in the same replay.

**DB-09 — adjusted, low → info.** Both query shapes are as described (lib/autopay/run.ts:143-148,
lib/reminders/run.ts:771-777) and `pilot.accounts` has no `status` index. But this table holds
one row per *tenant*, scanned twice a day by cron; it is the smallest table in the schema. The
proposed partial index is also mis-shaped for half the finding: `where deactivated_at is null
and hold_started_at is null` cannot serve the reminders query, which filters neither column and
includes `past_due`. The `recurring_invoice_schedules` half is a heap filter over one account's
handful of schedules.

**DB-10 — adjusted, low → info, location wrong.** The three `integer` columns are not at
20260802190437:61 (that line is `stripe_customer_id`). They are added at
`supabase/migrations/20260812400000_account_onboarding_profile.sql:67`. The width mismatch
against `pilot.clients.default_day_rate_cents bigint` (20260805070000:46-47) and
`trips.day_rate_cents bigint` (:95) is genuine, and narrowing is the safe direction, as stated.

## Query-level findings (05)

| ID | Verdict | Severity (mine) |
| --- | --- | --- |
| SQL-01 | confirmed | medium |
| SQL-02 | confirmed | high |
| SQL-03 | confirmed | medium |
| SQL-04 | confirmed | medium |
| SQL-05 | confirmed | medium |
| SQL-06 | confirmed | medium |
| SQL-07 | confirmed | medium |
| SQL-08 | confirmed | low |
| SQL-10 | confirmed | medium |
| SQL-11 | confirmed | info |
| SQL-12 | confirmed | low |

**SQL-01 — confirmed, high → medium.** `pilot.ledger_sync` (20260812100000:390) is a
SECURITY DEFINER derive-and-delete pass with no watermark and no since-parameter, and there are
eight call sites, all on GET: accounting/page.tsx:27, accounting/journal/page.tsx:92,
accounting/journal/export/route.ts:72, accounting/reconcile/page.tsx:79,
reports/cash-flow/page.tsx:80 and its export/route.ts:47, reports/balance-sheet/page.tsx:57 and
its export/route.ts:39. Writes-on-GET, WAL and dead tuples on every render are all real.
Severity trimmed one notch because the pass is `target_account_id`-scoped throughout, so it
grows with one solo pilot's lifetime, not with tenant count. The zero-schema interim fix
(drop the call from the four export routes) is sound.

**SQL-02 — confirmed, high.** All eight sites read as claimed: :441, :468, :545, :590, :632,
:670, :708, :742 each write `not exists (select 1 from pilot.journal_lines jl where jl.entry_id
= …)` with no `account_id`, while the only index naming `entry_id` is `journal_lines_entry_idx
(account_id, entry_id)` (:309). The semantics argument for the fix is airtight and I checked
it: `journal_lines` carries the composite FK to `journal_entries (account_id, id)`, so
`jl.account_id` already equals its entry's — adding the predicate cannot change the result set.
This is the best finding in the query report: one-line-per-site, provably safe, inside the pass
SQL-01 shows running on every accounting page load.

**SQL-03 — confirmed, medium.** The convention is stated verbatim at
app/api/command-search/route.ts:26-30 ("there is no explicit `.eq(\"account_id\", …)` anywhere
below, deliberately"), and invoices/[id]/page.tsx:129-132 is exactly the shape described —
`.from("invoice_lines").select("*").eq("invoice_id", id).order("sort_order")` against
`invoice_lines_invoice_idx (account_id, invoice_id, sort_order)` (20260805090000:1372). The
plan detail is accepted as shape-only. The RLS caveat the report raises is the right one and
must survive into any fix: adding `.eq("account_id", account.id)` narrows and can never widen,
but it must not be pasted onto a deliberately cross-account read.

**SQL-04 — confirmed, high → medium.** lib/autopay/run.ts:162 loops accounts, awaiting a
schedules read at :180-185 and, inside a nested loop, a generations read at :203-207, then the
RPC. Strictly sequential, service-role, RLS not in the loop as a backstop — all as described.
Medium rather than high at current tenant count; the shape is what matters, and the caveat
about the per-account `try`/`catch` isolation boundary (:167) is correctly flagged as the thing
a batching rewrite must preserve.

**SQL-05 — confirmed, medium.** `pattern = \`%${escaped}%\`` at route.ts:175 (the report says
:170; the escape is at :175, close enough to be the same statement), and
`grep -rn 'pg_trgm|gin(|gist('` over the migrations confirms no trigram extension and no
GIN/GiST index anywhere. Minor correction: the file issues 14 `.ilike(` calls, not ten. The
LIMIT-bounds-rows-returned-not-examined reasoning is right, and the report is honest that the
prefix rewrite is a semantic change ("TEB" no longer finding "KTEB") rather than a free win.

**SQL-06 — confirmed, medium.** `select("*")` at invoices/[id]/page.tsx:126, :129, :134, :137,
and the clients read at :155-159 carries no `.limit()` — against the same file's own
house rule quoted from reports/year-end/queries.ts:9-13 ("Every list query below carries an
explicit `.limit()` … silently truncates").

**SQL-07 — confirmed, medium.** documents/page.tsx:72 is `supabase.from("documents").select("*")`
with no limit, no projection and no `account_id` filter, sitting inside the same `Promise.all`
as an expirations read that *does* filter `account_id` (:73-76) — three lines apart, which is
what makes it an oversight rather than a convention. The JS sort is at :87-95. The caveat about
verifying `pilot.expirations.expires_on` before moving the sort into SQL is the right
restraint.

**SQL-08 — confirmed, medium → low.** lib/email/send-invoice.ts:281-286 reads
`account_preferences` per send; lib/reminders/run.ts:466 loops up to
`MAX_INVOICES_PER_ACCOUNT = 100` (:213). Real and hoistable. Low because it is a single-row
primary-key read of a 1:1 table. Credit where due: the report explicitly declines to fault the
three per-invoice reads the file argues for at :595-601, which is the correct call.

**SQL-10 — confirmed, medium.** trips/actions.ts:1288-1298 (one `.in()` delete),
:1306-1309 (one array insert) and :1325-1341 (one request per changed day) are as described,
and the report is right that the defect is atomicity, not latency — the updates are issued via
`Promise.all`, not serially, and each binds all three columns of `trip_days_trip_idx`. The
half-commit path surfacing as "Some day rows didn't save." at :1349 and :1353 is real. The fix's
own caveat is the important part: a SECURITY DEFINER `trip_days_save` bypasses the narrow
column-level UPDATE grant that is currently doing the enforcing (:1321-1323), so the function
body must re-impose it by hand.

**SQL-11 — confirmed, info.** The retraction is correct and I verified each: `client_rates`
`unique (account_id, client_id, day_type_id)` and `unique (account_id, id)`;
`client_vendor_links` `unique (account_id, client_id)`; `document_shares` `unique (account_id,
client_id)`; `recurring_invoice_schedules` `unique (account_id, id)`; `estimate_lines` `unique
(account_id, id)`. All account_id-leading, all invisible to a `create index` grep. The
recommendation not to batch the per-account purge loop is right.

**SQL-12 — confirmed, low.** estimates/page.tsx:169-175 awaits each chunk inside the `for`,
and the chunking is justified at :161-165 purely by URL length. The requirement that a parallel
rewrite preserve "any chunk failed ⇒ the whole read failed" is the correct constraint —
:154-159 exists because of that exact failure.

## What both auditors missed

`supabase/migrations/20260805220000_phase6_logbook.sql:124`

```sql
  trip_id uuid,
  foreign key (account_id, trip_id)
    references pilot.trips (account_id, id) on delete set null,
```

A composite `on delete set null` with **no column list** nulls *every* column in the key,
`account_id` included — and `pilot.logbook_entries.account_id` is `not null` (:100). So deleting
a trip that has a confirmed logbook entry does not orphan the entry as the twenty-line comment
above it promises ("deleting the trip … must NEVER delete a CONFIRMED logbook entry out from
under the pilot"). It raises `null value in column "account_id" … violates not-null constraint`
and **aborts the delete**.

This is the same class the repo already diagnosed and fixed three times — bank_transactions
(20260810030000, whose header is literally titled "A COMPOSITE `on delete set null` NULLS EVERY
COLUMN IN THE KEY"), expenses (20260815130000:207, :217), aircraft (20260818230000:45) — and
each of those fixes wrote `set null (col)`. Four bare composite SET NULL FKs were never revisited:
`logbook_entries.trip_id` (:124) and `.trip_leg_id` (:132), `mileage_entries.trip_id` /
`.client_id` (20260809020000:147, :149), `operator_qualifications.document_id`
(20260807060000:124) and `client_tax_forms.document_id` (20260807080000:53).

Reproduced on the local Postgres 16 with a four-statement probe in a throwaway schema:

```
ERROR:  null value in column "account_id" of relation "logbook" violates not-null constraint
CONTEXT: SQL statement "UPDATE ONLY "fkprobe"."logbook" SET "account_id" = NULL, "trip_id" = NULL …"
```

Why it outranks everything above: `logbook_entries` is on the **retain** list and `pilot.trips`
is on the **purge** list, so `purge_business_data_rows`' `delete from pilot.trips`
(20260818200000:125) raises for any account whose logbook has a single trip-derived entry —
which is every account that has used the confirm-from-leg flow at all.
`pilot.expire_hold` then aborts, nothing is purged, the scheduled pass retries forever and the
account is stuck: verbatim the failure mode 20260818230000's header was written to prevent,
reintroduced through a different table. It also breaks interactive trip deletion.
`scripts/account-lifecycle-db-verify.mjs` cannot see it for the same reason it cannot see
DB-01 — its logbook fixtures (:87-88, :469-470) set no `trip_id`.

DB-01 and this share one root cause and want one fix pass: the purge's retain/delete split is
enforced only by prose, and every FK crossing that line — CASCADE *or* bare composite SET NULL —
is a hole. The durable fix is a `verify:all` catalog assertion that no table on the retain list
holds a FK to a table on the delete list unless it is `set null (<col>)` with an explicit column
list.
