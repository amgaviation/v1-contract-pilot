# Query-level review — V1 Contract Pilot

**Date:** 2026-08-21 · **Scope:** query call sites in `app/`, `lib/`, and the SECURITY DEFINER
function bodies they call · **Engine:** PostgreSQL (hosted Supabase; local replay on
127.0.0.1:55432, database `dbaudit`, 51 `pilot.*` tables present)

This codebase is *unusually* disciplined at the level the recon map measured: the big render
paths are genuinely `Promise.all`-batched rather than serial, almost every list read carries an
explicit `.limit()` with a documented truncation-detection story, the two cron loops are
acknowledged in comments, and the "N+1" shapes the recon map flagged in `trips/actions.ts` and
`command-search` turn out to be correctly batched on inspection. The real problems are one level
down, in the *shape of the predicates* rather than the count of the round trips. Two findings
dominate everything else. First, `pilot.ledger_sync` is a full-account, unbounded, derive-and-
delete **write pass that runs synchronously on every GET** of seven read-only accounting and
reports surfaces, and eight of its correlated anti-joins omit `account_id`, which downgrades
`journal_lines_entry_idx` from a two-column index probe to a full-index scan *per candidate row*
— I confirmed both plan shapes with `EXPLAIN` against the replayed schema in this run. Second,
the house convention "RLS scopes this to the tenant; no `account_id` filter is needed or wanted
here" is correct for security and expensive for planning: every composite index in this schema
leads with `account_id`, and an RLS policy of the form `account_id in (select
pilot.current_account_ids())` lands in the plan as a **hashed SubPlan filter, not an index
condition**, so the leading column is left unbounded and the index is scanned in full. That one
convention degrades dozens of the app's hottest reads at once, and the fix (`.eq("account_id",
account.id)` alongside the existing filter) narrows rather than widens what RLS already permits.

Everything below cites a file and line I opened in this run. No timings appear anywhere — the
replayed database has empty tables, so only plan *shape* is evidence, and I say so where I lean
on it. Findings are ranked most severe first.

---

## 1. `pilot.ledger_sync` is a full-account write pass executed on every GET of seven pages

**Severity:** High · **Location:** `supabase/migrations/20260812100000_accounting_ledger.sql:390`
(definition); callers at `app/(app)/accounting/page.tsx:27`,
`app/(app)/accounting/journal/page.tsx:92`, `app/(app)/accounting/journal/export/route.ts:72`,
`app/(app)/accounting/reconcile/page.tsx:79`, `app/(app)/reports/cash-flow/page.tsx`,
`app/(app)/reports/balance-sheet/page.tsx` (+ both export routes)

**Evidence.** The function body runs, in one transaction, per call:

- **six unbounded `DELETE`s** over `pilot.journal_entries` for the account (lines 408, 428, 449,
  460, 476, 489), two of which carry a correlated `not exists` over `journal_lines` joined to
  `accounts_chart` (lines 436–443, 467–469);
- **six `INSERT … SELECT`s** into `journal_entries` and **six more** into `journal_lines`, each
  re-scanning the account's entire lifetime of `invoices` ⋈ `invoice_totals`, `invoice_payments`,
  `expenses`, and `mileage_entries` (lines 502, 545, 562, 590, 597, 632, 646, 670, 677, 708, 718,
  742).

There is no watermark, no `since` parameter, and no dirty flag: every call re-derives the whole
ledger from the beginning of the tenant's history. Cost is O(lifetime invoices + payments +
expenses + mileage rows), paid on **each page view**, before the page's own read queries start —
in `journal/page.tsx` the `await supabase.rpc("ledger_sync", …)` at line 92 is sequential and
blocks the `Promise.all` at line 96.

This is not mitigated by framework caching. `next.config.ts:172` enables only
`experimental.serverActions`; `cacheComponents` is not set, so per
`node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` the previous caching model
applies, and these routes read cookies through `lib/supabase/server.ts` and are therefore dynamic.
Every navigation, every refresh, and every export click pays the full pass. Two of the callers are
*a page and its own export route* for the same report, so "view balance sheet, click export" runs
the identical derive pass twice within seconds.

Beyond CPU: this writes on GET. Every accounting page load generates WAL, dead tuples in
`journal_entries`/`journal_lines`, and takes row locks that two concurrent renders of the same
tenant contend for. The function's own comment defends *idempotency* (it is idempotent, by the
unique index) but idempotent is not the same as free.

**Fix.** Do not restructure the derivation — it is correct and its correctness is load-bearing.
Gate it. Add a watermark column to `pilot.accounts` and make the pass a no-op when nothing that
feeds it has changed:

```sql
-- proposed, NOT applied (report-only pass)
alter table pilot.accounts
  add column if not exists ledger_synced_at timestamptz;

-- inside pilot.ledger_sync, immediately after the membership check:
--   if the newest source row predates the last sync, there is nothing to derive.
if exists (
  select 1 from pilot.accounts a
  where a.id = target_account_id
    and a.ledger_synced_at is not null
    and a.ledger_synced_at >= greatest(
      coalesce((select max(updated_at) from pilot.invoices        where account_id = target_account_id), '-infinity'),
      coalesce((select max(updated_at) from pilot.expenses        where account_id = target_account_id), '-infinity'),
      coalesce((select max(created_at) from pilot.invoice_payments where account_id = target_account_id), '-infinity'),
      coalesce((select max(updated_at) from pilot.mileage_entries  where account_id = target_account_id), '-infinity')
    )
) then
  return jsonb_build_object('created', 0, 'removed', 0, 'skipped', true);
end if;
```

**Why it is faster:** the common case (a pilot opening the balance sheet twice, or paging the
journal) collapses from a dozen table-wide passes to four `max()` probes, each of which can be an
index-only backward scan on an existing `(account_id, …)` index. The derive pass then runs only
when something actually changed.

**What must be true for it to be safe:** every source table must stamp the timestamp the guard
reads on *every* mutation that could change the ledger — including deletes. A delete leaves no
`max()` to observe, so the guard as written would miss a deleted expense; that case needs either a
row-count component in the watermark or a delete trigger that bumps `ledger_synced_at` to null.
Getting that wrong makes the ledger silently stale, which on an accounting surface is worse than
slow. This is why I am proposing it rather than applying it: it needs the schema owner's judgment
and a `verify` harness assertion.

**Cheaper interim step**, no schema change: drop the `ledger_sync` call from the four **export
route handlers** (`accounting/journal/export/route.ts:72`, `reports/cash-flow/export`,
`reports/balance-sheet/export`, and the reconcile path), on the grounds that a user reaches an
export from the page that just synced. That halves the calls immediately and is a one-line change
per file with no correctness question attached.

---

## 2. Eight anti-joins in `ledger_sync` omit `account_id` and cannot use `journal_lines_entry_idx`

**Severity:** High · **Location:** `supabase/migrations/20260812100000_accounting_ledger.sql:441`,
`:468`, `:545`, `:590`, `:632`, `:670`, `:708`, `:742`

**Evidence.** `journal_lines` has exactly one index that mentions `entry_id`, and `account_id`
leads it — confirmed against the replayed schema in this run:

```
journal_lines_entry_idx  CREATE INDEX journal_lines_entry_idx
                         ON pilot.journal_lines USING btree (account_id, entry_id)
```

All eight correlated subqueries filter on `entry_id` alone:

```sql
-- ledger_sync, six occurrences (545, 590, 632, 670, 708, 742)
and not exists (select 1 from pilot.journal_lines jl where jl.entry_id = x.entry_id);

-- and two inside the drift deletes (441, 468)
where jl.entry_id = je.id and jl.side = 'debit'
```

`EXPLAIN`, run in this session against `dbaudit`:

```
Nested Loop Anti Join
  ->  Bitmap Heap Scan on journal_entries je
        Index Cond: (account_id = '…'::uuid)
  ->  Bitmap Heap Scan on journal_lines jl
        Recheck Cond: (entry_id = je.id)
        ->  Bitmap Index Scan on journal_lines_entry_idx
              Index Cond: (entry_id = je.id)          <-- leading column unbounded
```

An `Index Cond` naming only the *second* column of a two-column btree is not a probe; Postgres
must walk the whole index applying the condition. That happens once **per outer row**, i.e. once
per candidate journal entry, in a function that already runs on every page load (finding 1).
Against the same table with the leading column supplied, the same session produced:

```
Index Only Scan using journal_lines_entry_idx on journal_lines jl
  Index Cond: ((account_id = '…'::uuid) AND (entry_id = '…'::uuid))
```

**Fix.** Every one of these subqueries already has the account id in scope (`x.account_id` in the
insert passes, `je.account_id` in the deletes). Add it:

```sql
-- before (six times, e.g. :545)
and not exists (select 1 from pilot.journal_lines jl where jl.entry_id = x.entry_id);

-- after
and not exists (
  select 1 from pilot.journal_lines jl
  where jl.account_id = x.account_id and jl.entry_id = x.entry_id
);
```

```sql
-- before (:468)
or not exists (
  select 1 from pilot.journal_lines jl
  where jl.entry_id = je.id and jl.side = 'debit'
    and jl.amount_cents = m.amount_cents
)

-- after
or not exists (
  select 1 from pilot.journal_lines jl
  where jl.account_id = je.account_id and jl.entry_id = je.id and jl.side = 'debit'
    and jl.amount_cents = m.amount_cents
)
```

(The same edit applies at `:441`, where the join to `accounts_chart` already supplies
`c.account_id = jl.account_id` but the `journal_lines` access itself does not.)

**Why it is faster:** full index scan per outer row → single index-only probe per outer row.

**Correctness / RLS:** semantics are unchanged, and provably so — `journal_lines` carries
`foreign key (account_id, entry_id) references pilot.journal_entries (account_id, id)`
(`20260812100000_accounting_ledger.sql:292–294`), so a line's `account_id` is *already* equal to
its entry's. The added predicate can never exclude a row that the original included. There is no
RLS-visibility change: `ledger_sync` is SECURITY DEFINER with an in-body membership check, so RLS
is not what scopes these statements in the first place.

---

## 3. App-wide: filtering on the non-leading column and leaving `account_id` to RLS costs the index

**Severity:** High (breadth) · **Location:** representative sites —
`app/(app)/invoices/[id]/page.tsx:129`, `:134`, `:137`, `:139`, `:167`, `:172`, `:206`;
`app/(app)/clients/[id]/page.tsx:115`, `:148`; `app/(app)/estimates/[id]/page.tsx:91`;
`app/(app)/documents/page.tsx:72`; `app/(app)/trips/[id]/page.tsx:64`

**Evidence.** The convention is stated explicitly and followed widely — see
`app/api/command-search/route.ts:26–30`: *"RLS scopes each `pilot.*` table to the caller's own
account_id, so there is no explicit `.eq("account_id", …)` anywhere below, deliberately."* That is
sound security reasoning. It is also, at the planner level, the removal of the leading column of
every index in the schema.

`EXPLAIN` in this session, as role `authenticated` with RLS active, for the exact shape at
`invoices/[id]/page.tsx:129` (`.from("invoice_lines").select("*").eq("invoice_id",
id).order("sort_order")`):

```
Sort  (Sort Key: invoice_lines.sort_order)
  ->  Bitmap Heap Scan on invoice_lines
        Recheck Cond: (invoice_id = '…'::uuid)
        Filter: (hashed SubPlan 1)              <-- the RLS policy, applied as a filter
        ->  Bitmap Index Scan on invoice_lines_invoice_idx
              Index Cond: (invoice_id = '…'::uuid)   <-- account_id unbounded
        SubPlan 1
          ->  ProjectSet -> Result              <-- pilot.current_account_ids()
```

Adding `account_id` to the same query, same session, same role:

```
Index Scan using invoice_lines_invoice_idx on invoice_lines
  Index Cond: ((account_id = '…'::uuid) AND (invoice_id = '…'::uuid))
  Filter: (hashed SubPlan 1)
```

Two things improve at once. The index becomes a genuine two-column probe instead of a full scan
of `(account_id, invoice_id, sort_order)`, **and the `Sort` node disappears** — with both leading
columns bound, the index already delivers rows in `sort_order`, so the explicit sort is elided.
The RLS SubPlan stays in the plan as a filter either way; it is a security check, not an access
path, and it never becomes an index condition because `account_id in (select …)` against a
set-returning function is hashed and applied after the scan.

**Fix.** Add the redundant-for-security, load-bearing-for-planning equality wherever the page has
already resolved an account (which is every `app/(app)` page — `requireAccount` returns it):

```ts
// before — app/(app)/invoices/[id]/page.tsx:127
supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sort_order", { ascending: true })

// after
supabase
  .from("invoice_lines")
  .select("id, invoice_id, line_type, description, quantity, unit_amount_cents, amount_cents, taxable, sort_order, expense_id, trip_id")
  .eq("account_id", account.id)
  .eq("invoice_id", id)
  .order("sort_order", { ascending: true })
```

The codebase already does this in the places where somebody clearly thought about it —
`app/(app)/documents/page.tsx:74` filters `expirations` by `account_id` with the comment
*"defence in depth, not the boundary"*, and every read in `reports/year-end/queries.ts` carries
`.eq("account_id", accountId)`. This finding is that the practice should be universal, and for a
performance reason, not only a defensive one.

**RLS-safety — flag this explicitly.** Adding `.eq("account_id", account.id)` **narrows**; RLS
still runs and can only narrow further, so no rewrite here can widen what a tenant sees. There is
one behavioural change to be deliberate about: `pilot.current_account_ids()` returns *every*
account a user belongs to, so for a hypothetical multi-account user a query that today would
return rows from both accounts would, after the change, return only the active one. On these pages
that is the intended semantics (the page is already rendered under one `account` from
`requireAccount`), and `app/(app)/logbook/page.tsx:132–137` documents the same reasoning for the
same reason. But it *is* a semantic change, and it must not be applied blindly to any query whose
job is deliberately cross-account.

---

## 4. Autopay cron: a three-level N+1 (accounts → schedules → generations → RPC)

**Severity:** High · **Location:** `lib/autopay/run.ts:162` (account loop), `:181`
(schedules read, per account), `:204` (generations read, per schedule), `:244`
(`generate_autopay_invoice`, per due period)

**Evidence.** Read in this run:

```ts
for (const account of accounts) {                                  // :162
  …
  const { data: schedData } = await serviceClient                   // :181  — 1 per account
    .from("recurring_invoice_schedules")
    .select("id, client_id, cadence, anchor_date, end_date")
    .eq("account_id", account.id).eq("active", true).eq("autopay", true);

  for (const schedule of schedules) {
    const { data: genData } = await serviceClient                   // :204  — 1 per schedule
      .from("recurring_invoice_generations")
      .select("period_start")
      .eq("account_id", account.id).eq("schedule_id", schedule.id);
    …
    for (const period of due) {
      await serviceClient.rpc("generate_autopay_invoice", …);       // :244  — 1 per period
    }
  }
}
```

Total round trips ≈ `A + S + P`, all strictly sequential (`await` inside `for`), where `A` is
every account in `trialing|active|past_due`, `S` every autopay schedule, `P` every due period. The
same shape sits in the holds cron: `app/api/holds/run/route.ts:197` calls `expire_hold` once per
due account inside `for (const account of due)`.

**Fix.** The per-period RPC must stay one call — it is the atomic invoice+line+ledger write and
its idempotency is the whole point. The two *reads* should be batched:

```ts
// after — one schedules read for the whole pass
const eligibleIds = accounts.filter(isEligible).map(a => a.id);
const { data: allSched } = await serviceClient
  .from("recurring_invoice_schedules")
  .select("id, account_id, client_id, cadence, anchor_date, end_date")
  .in("account_id", eligibleIds)
  .eq("active", true)
  .eq("autopay", true);

// one generations read for the whole pass
const { data: allGens } = await serviceClient
  .from("recurring_invoice_generations")
  .select("schedule_id, period_start")
  .in("schedule_id", allSched.map(s => s.id));

const generatedBySchedule = new Map<string, Set<string>>();
for (const g of allGens ?? []) {
  (generatedBySchedule.get(g.schedule_id) ?? generatedBySchedule.set(g.schedule_id, new Set()).get(g.schedule_id)!)
    .add(g.period_start);
}
```

**Why it is faster:** `A + S` sequential round trips collapse to 2. Each batched read is a single
index scan — `recurring_invoice_schedules_account_id_id_key` covers the `.in("account_id", …)`,
and `recurring_invoice_generations_schedule_idx` is `(account_id, schedule_id, period_start)`, so
the batched generations read should also carry `.in("account_id", eligibleIds)` to bind its
leading column (finding 3 again, in a cron).

**What must be true for it to be safe:** (a) `.in()` is emitted as a GET query string by
supabase-js, so both lists need the same chunking the codebase already applies elsewhere — see
`app/(app)/estimates/page.tsx:160–165`, which caps `.in()` at 100 uuids for exactly this reason;
(b) the per-account `try/catch` at `:166` currently isolates *one tenant's* failure, and a batched
read moves that failure to the whole pass — the batched reads need their own failure handling that
degrades to the current per-account path rather than aborting; (c) this runs on the service-role
client (`lib/autopay/run.ts` is one of the ten documented RLS-bypass call sites), so the batching
does not change any RLS predicate — but it does mean a bug in the grouping code silently mixes
tenants where RLS is not there to catch it. That risk is the reason I would batch the reads and
leave the per-period RPC exactly as it is: `generate_autopay_invoice` re-derives tenancy from
`target_account` on every call (`20260819100000_autopay_unattended_generation.sql:112–125`).

**Scale note, honestly stated:** at the current tenant count this is not urgent. It is listed high
because it is a *cron* — the failure mode is the pass silently running past its serverless
timeout, and nobody watching a cron notices latency until it stops finishing.

---

## 5. Ten leading-wildcard `ILIKE`s per keystroke, with no trigram index in the schema

**Severity:** Medium-High · **Location:** `app/api/command-search/route.ts:170` (`pattern =
"%" + escaped + "%"`), consumed at `:200`, `:206`, `:217`, `:225`, `:230`, `:236`, `:242`, `:248`,
`:254`, `:260`

**Evidence.** The route builds `%q%` and issues ten `.ilike()` queries in one `Promise.all` wave
against `clients.name`, `invoices.invoice_number`, `invoices.bill_to_name`,
`estimates.estimate_number`, `expenses.vendor`, `expenses.notes`, `documents.label`,
`documents.notes`, `trip_legs.from_icao`, and `trip_legs.to_icao`, then two more dependent waves
(`:305`, `:390`). Leading-wildcard `LIKE`/`ILIKE` cannot use a btree index — it is anti-pattern #4
in this skill's `references/anti-patterns.md`. The only index type that helps is a `pg_trgm` GIN
index, and I confirmed in this run that **the extension is not installed and no GIN or GiST index
exists anywhere in `supabase/migrations/`** (`grep -rn "pg_trgm\|gin(\|gist(" supabase/migrations/`
returns only false positives on function names ending in `begin(`).

So each of those ten queries is a sequential scan of the table, filtered by RLS, on every
debounced keystroke from the command palette — the app's highest-frequency query path by a wide
margin. Two of them (`expenses.notes`, `documents.notes`) scan a free-text column.

The `.limit(8)` on each does not save it. `LIMIT` bounds the rows *returned*, not the rows
*examined*: with `.order("created_at", { ascending: false })` and no usable index for the
predicate, Postgres must find all matches before it can order and truncate.

**Fix.** Two of these do not need a leading wildcard at all, and that is the cheapest win:

```ts
// before — :217 and :225 (ICAO), :206 (invoice number), :230 (estimate number)
.ilike("from_icao", pattern)          // pattern = "%KTEB%"

// after — a pilot typing "KTE" means a prefix, not a substring
.ilike("from_icao", `${escaped}%`)
```

A trailing-wildcard `ILIKE` on a `text` column still needs a `text_pattern_ops` index (or a
`lower()` expression index) to be index-assisted, so pair it with:

```sql
-- proposed, NOT applied
create index if not exists trip_legs_from_icao_prefix_idx
  on pilot.trip_legs (account_id, upper(from_icao) text_pattern_ops);
```

For the genuine substring searches (`clients.name`, `expenses.vendor`, the two `notes` columns):

```sql
-- proposed, NOT applied
create extension if not exists pg_trgm;
create index if not exists clients_name_trgm_idx
  on pilot.clients using gin (name gin_trgm_ops);
create index if not exists expenses_vendor_trgm_idx
  on pilot.expenses using gin (vendor gin_trgm_ops);
```

**Why it is faster:** seq scan of the whole table per keystroke → GIN posting-list lookup.
Trigram indexes are effective from three characters up, which lines up with the route's existing
`MIN_QUERY_LENGTH = 2` (`:105`) — a 2-char query would still fall back to a scan, so consider
raising that constant to 3 alongside the index.

**What must be true for it to be safe:** the prefix rewrite is a **semantic change** and must be
flagged as such — today, typing `TEB` finds `KTEB`; after the rewrite it does not. For ICAO that
is arguably an improvement (pilots type identifiers left-to-right) but it is a product decision,
not a free optimisation, and it should not be made by an optimiser. The trigram indexes are pure
additions with no semantic effect, at the cost of GIN write amplification on `clients`,
`expenses`, and `documents` — all low-write tables here, so the trade is favourable. Neither
change touches an RLS predicate: RLS is applied as a filter on top of whichever access path is
chosen (see the plan in finding 3), so swapping the access path cannot change which rows a tenant
sees.

---

## 6. `select("*")` on the highest-fan-out detail page, plus an unbounded client-picker read

**Severity:** Medium · **Location:** `app/(app)/invoices/[id]/page.tsx:126`, `:129`, `:134`,
`:137`, `:157`

**Evidence.** The invoice detail page issues 16 round trips in one `Promise.all` (recon's count,
confirmed by reading `:117–210`). Four of them are `select("*")`:

```ts
supabase.from("invoices").select("*").eq("id", id).maybeSingle(),          // :126
supabase.from("invoice_lines").select("*").eq("invoice_id", id)…,          // :129
supabase.from("invoice_payments").select("*").eq("invoice_id", id)…,       // :134
supabase.from("invoice_totals").select("*").eq("invoice_id", id)…,         // :137
```

and one is unbounded:

```ts
supabase.from("clients")
  .select("id, name, contact_email, billing_email")
  .eq(YOU_INVOICE_COLUMN, true)
  .order("name", { ascending: true }),                                      // :155–159
```

The same `select("*")` pattern appears at `app/(app)/trips/[id]/page.tsx:61`, `:64`;
`app/(app)/estimates/[id]/page.tsx:88`, `:91`, `:99`; `app/(app)/clients/[id]/page.tsx:70`,
`:112`, `:115`, `:148`.

Two costs. `select("*")` transfers every column including the free-text ones (`invoices.notes`,
`invoices.terms`, `invoice_lines.description`) whether the render uses them or not, and it
forecloses the index-only scans that finding 3's rewrite would otherwise unlock —
`invoice_lines_invoice_idx` covers `(account_id, invoice_id, sort_order)`, so a narrow projection
of just those columns could be served from the index alone. The unbounded `clients` read fetches
the tenant's entire billable client roster on every invoice view, purely to populate a `<select>`;
it also silently truncates at the Data API's row cap, which this codebase elsewhere treats as a
defect worth a comment (`app/(app)/overview/page.tsx:196–204`).

**Fix.** Enumerate the columns (see the diff in finding 3) and bound the picker:

```ts
// after — :155
supabase.from("clients")
  .select("id, name, contact_email, billing_email")
  .eq("account_id", account.id)
  .eq(YOU_INVOICE_COLUMN, true)
  .order("name", { ascending: true })
  .limit(CLIENT_PICKER_LIMIT),   // and surface truncation, per the house rule
```

**Why it is faster:** less bytes over the wire per render, and with `account_id` bound (finding 3)
`clients_account_idx` — `(account_id) where archived_at is null` — becomes usable.

**What must be true for it to be safe:** the column lists must be complete for every consumer of
the row, including the components the page passes rows into. `select("*")` on a page this wide is
load-bearing precisely because the consumer set is large; a mechanical narrowing here needs
TypeScript to be the check (the row types at the top of the file are already `Pick<>`-shaped,
which makes this tractable). The picker `.limit()` needs the truncation notice the repo's own
convention demands — silently showing 1000 of 1200 clients in a picker is worse than slow.

---

## 7. `documents/page.tsx` reads the whole table with `select("*")`, no limit, then sorts in JS

**Severity:** Medium · **Location:** `app/(app)/documents/page.tsx:72`

**Evidence.**

```ts
supabase.from("documents").select("*"),                              // :72  — no limit, no columns, no account filter
supabase.from("expirations").select("*")
  .eq("account_id", account.id).eq("source_table", "document"),      // :73–76
```

then, at `:87`, `const sorted = [...documents].sort(…)` — the ordering is computed in JavaScript
across the full result set.

This violates the codebase's own stated rule three ways at once. `app/(app)/reports/year-end/
queries.ts:9` states *"Every list query below carries an explicit `.limit()`"*; `overview/page.tsx:
196–204` explains at length that the Data API *"caps rows (commonly 1000) and TRUNCATES SILENTLY
… so a summed KPI from a truncated read would be silently wrong."* Both apply here. A pilot with
1000+ documents gets a silently truncated list, sorted by expiry in JS, presented as the whole
record — and `documents` is a table that grows monotonically for the life of the account (every
medical, every type rating, every insurance certificate, never deleted).

The only index on the table is `documents_expiry_idx`, `(account_id, expires_on) where expires_on
is not null` — a *partial* index that cannot serve a listing which must include documents with no
expiry (which this page explicitly does, per its sort comment at `:86–88`).

**Fix.**

```ts
// after
supabase
  .from("documents")
  .select("id, kind, label, issued_on, expires_on, client_id, archived_at")
  .eq("account_id", account.id)
  .order("expires_on", { ascending: true, nullsFirst: false })
  .order("label", { ascending: true })
  .limit(DOCUMENTS_LIMIT),
```

**Why it is faster:** the projection drops `notes` and any storage-path columns from the transfer;
`.eq("account_id", …)` binds the leading column of whatever index the planner picks; and pushing
the sort into SQL means the truncation, when it happens, drops a deterministic tail rather than a
server-arbitrary subset — the exact reasoning `reports/year-end/queries.ts:257–262` gives for its
own `.order()`.

**What must be true for it to be safe:** the JS sort at `:87` currently ranks by the *joined*
`expirations` row, not by `documents.expires_on` directly, so moving the sort into SQL only
reproduces today's order if the two agree. Read `pilot.expirations`' definition before making this
change; if its `expires_on` is derived rather than a straight passthrough, keep the JS sort and
apply only the projection, the `account_id` filter, and the `.limit()`.

---

## 8. Reminder cron re-reads account-constant preferences once per invoice inside the send loop

**Severity:** Medium · **Location:** `lib/reminders/run.ts:466` (per-invoice loop) →
`lib/email/send-invoice.ts:281`; also `lib/reminders/run.ts:798` (`ownerEmail`, per account)

**Evidence.** `runDueRemindersForAccount` reads up to `MAX_INVOICES_PER_ACCOUNT = 100`
(`lib/reminders/run.ts:213`) invoices, then loops:

```ts
for (const invoice of invoices) {          // :466
  …
  await runOneInvoice(invoice, entry);     // :479
}
```

and each `runOneInvoice` → `sendInvoiceEmail` performs, per invoice:
`invoices` re-read (`send-invoice.ts:125`), `clients` read (`:166`), **`account_preferences` read
(`:281`)**, `invoice_shares` read (`:386`) — plus the deliberate status re-check at
`lib/reminders/run.ts:607`.

Three of those five are per-invoice by necessity and are well argued in the comments — the status
re-check at `:595–601` explicitly exists because *"the gap between deciding and sending is exactly
where an invoice gets paid"*, and that reasoning is correct; I am not faulting it. But
`account_preferences` is keyed on `account_id` alone (it is a 1:1 table with `accounts`, PK
`account_id`) and cannot change between two invoices of the same account's pass. It is read up to
100 times per account per run for one unchanging `jsonb` blob.

**Fix.** Hoist it. `sendInvoiceEmail` already accepts a `SupabaseClient` and an `accountId`; give
it an optional resolved-preferences parameter, resolved once by the caller:

```ts
// lib/reminders/run.ts — once, before the loop at :466
const preferences = resolvePreferences(
  (await supabase.from("account_preferences").select("prefs")
     .eq("account_id", accountId).maybeSingle()).data?.prefs
);

// then pass it down; sendInvoiceEmail reads its parameter and only falls back
// to the query at send-invoice.ts:281 when the parameter is absent (the
// interactive single-send callers, which are unaffected).
```

**Why it is faster:** up to 100 round trips per account per run become 1. On a 10-account pass
that is ~1000 round trips removed from a serverless function that must finish inside its timeout.

**What must be true for it to be safe:** the fallback path must be preserved for the interactive
callers of `sendInvoiceEmail`, which pass no preferences and must keep working exactly as today.
`resolvePreferences` is already documented at `send-invoice.ts:275–279` as a *total* validator —
a failed read and a missing row both resolve to product defaults — so hoisting cannot introduce a
new failure mode; it only means one read's failure now costs the whole account's custom template
rather than one invoice's. Given that a preferences outage already costs the pilot their custom
opening line and never the send, that is an acceptable widening.

---

## 9. `journal_entry_create` inserts lines one statement at a time inside a PL/pgSQL loop

**Severity:** Medium · **Location:**
`supabase/migrations/20260812100000_accounting_ledger.sql:813` (loop), `:826` (per-line
existence check), `:847` (per-line INSERT)

**Evidence.**

```sql
for v_line in select value from jsonb_array_elements(p_lines) loop     -- :813
  …
  if v_chart is null or not exists (                                    -- :826
    select 1 from pilot.accounts_chart c
    where c.account_id = target_account_id and c.id = v_chart
      and c.archived_at is null
  ) then …
  insert into pilot.journal_lines                                       -- :847
    (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
  values (target_account_id, v_entry_id, v_chart, v_side, v_amount::bigint, v_idx);
end loop;
```

With the documented 30-line ceiling (`:806`), that is up to 30 separate `INSERT` statements and 30
separate `accounts_chart` probes, each with its own executor setup, inside one function call. The
existence check itself is fine — `accounts_chart` carries `(account_id, id)` uniqueness so each
probe is an index lookup — but it is repeated per line where one set-based check would do.

**Fix.** Validate the whole array once, then insert set-based:

```sql
-- after: one validation pass, one INSERT
with lines as (
  select ordinality - 1 as line_no,
         (value->>'chart_account_id')::uuid as chart_account_id,
         value->>'side'                     as side,
         (value->>'amount_cents')::bigint   as amount_cents
  from jsonb_array_elements(p_lines) with ordinality
)
insert into pilot.journal_lines
  (account_id, entry_id, chart_account_id, side, amount_cents, line_no)
select target_account_id, v_entry_id, l.chart_account_id, l.side, l.amount_cents, l.line_no
from lines l
where exists (
  select 1 from pilot.accounts_chart c
  where c.account_id = target_account_id and c.id = l.chart_account_id
    and c.archived_at is null
);
-- then assert the row count matches jsonb_array_length(p_lines), and raise otherwise
```

**Why it is faster:** 30 statements → 1, and the `accounts_chart` check becomes a single hash
semi-join over 30 rows instead of 30 nested-loop probes.

**What must be true for it to be safe — and this is the reason I would think twice.** The current
loop's *error messages* are its product: it raises a specific sentence for a bad side, a bad
chart account, and a bad amount, and the file's own comment at `:857–859` explains that raising
in-body rather than leaving it to the deferred trigger exists *"because it names the amounts,
which is the message a pilot can act on."* A set-based rewrite loses per-line attribution unless
the validation pass is written to find and name the first offending line before the insert. This
is a manual-entry path invoked by a human clicking Save on at most 30 lines — the latency saved is
small and the message quality at risk is high. **I would not make this change.** It is reported for
completeness, and my recommendation is to leave it as it is.

---

## 10. `trip_days` save issues one UPDATE round trip per changed day, non-atomically

**Severity:** Medium · **Location:** `app/(app)/trips/actions.ts:1326–1343`

**Evidence.** The delete and insert halves of this save are correctly batched (`:1288–1298`
one `.in()` delete; `:1306–1309` one array insert, with the comment *"one batched insert, not a
round trip per date"*). The update half is not:

```ts
const results = await Promise.all(
  toUpdate.map((row) => {                                 // :1327
    …
    return supabase.from("trip_days")
      .update(payload as never, { count: "exact" })
      .eq("account_id", account.id)
      .eq("trip_id", tripId)
      .eq("day_on", row.date);                            // :1336–1341
  })
);
```

The file acknowledges it (*"Run concurrently: a trip is bounded by its own date range, so this is
at most a few dozen statements, not a scan"*) and that assessment is fair on latency — they are
parallel, and each is an index probe on `trip_days_trip_idx` `(account_id, trip_id, day_on)` with
all three columns bound, which is the *correct* shape (contrast finding 3).

The real cost is not latency, it is **atomicity**. These are N independent PostgREST requests, so
there is no transaction around them: a failure on statement 12 of 20 leaves eight days saved and
twelve not, and the error handler at `:1345–1354` returns *"Some day rows didn't save. Refresh and
try again"* — an honest message for a genuinely half-committed state. Every other multi-row write
in this schema was deliberately moved into a SECURITY DEFINER function for exactly this reason
(`generate_recurring_invoice`'s comment at `20260809050000_mileage_and_recurring_fixes.sql:236`
describes replacing *"the three-separate-inserts app-layer version that could orphan an
invoice/line on partial failure"*).

**Fix.** One RPC taking the day array as `jsonb`, doing delete + insert + update in one
transaction — the same shape as `pilot.bank_transaction_confirm`:

```sql
-- proposed, NOT applied
create or replace function pilot.trip_days_save(
  target_account uuid, p_trip_id uuid, p_days jsonb, p_clear_dates date[]
) returns integer …
```

**Why it is faster:** N round trips → 1, and the whole save becomes one transaction the deferred
constraints can verify at commit.

**What must be true for it to be safe:** the current code's column discipline must survive the
move — the comment at `:1321–1323` notes it updates *"only the granted columns … never account_id
or trip_id"*, which is what keeps the `authenticated` UPDATE grant narrow. A SECURITY DEFINER
function bypasses that grant entirely, so the function body would have to re-impose the column
restriction by hand, and it must re-derive tenancy from `target_account` rather than trusting the
trip row. That is exactly the review burden every other function in this schema carries, and it is
why this is a "worth doing deliberately" item rather than a quick win.

---

## 11. `expire_hold` runs ~35 sequential deletes per account, inside a per-account cron loop

**Severity:** Low-Medium · **Location:** `app/api/holds/run/route.ts:196–197` (loop);
`supabase/migrations/20260818200000_monthly_hold.sql:274` (`expire_hold`) →
`:82–140` (`purge_business_data_rows`)

**Evidence.** `expire_hold` does three `accounts` reads/writes plus
`perform pilot.purge_business_data_rows(target_account)`, which is 35 sequential
`delete from pilot.X where account_id = target_account` statements (`:88–137`), one per tenant
table, in a fixed FK-safe order. That whole thing runs once per due account, sequentially, inside
`for (const account of due)` at `app/api/holds/run/route.ts:196`.

**Correction to the recon map, verified in this run.** The recon map flagged `client_rates`,
`client_vendor_links`, `document_shares`, and `recurring_invoice_schedules` as having *no index at
all*, which would have made those four deletes sequential scans of every tenant's rows. That is
not the case — the `create index` grep missed indexes created implicitly by `unique` constraints.
Queried directly against the replayed schema:

```
client_rates                 client_rates_account_id_id_key                 (account_id, id)
client_vendor_links          client_vendor_links_account_id_client_id_key   (account_id, client_id)
document_shares              document_shares_account_id_client_id_key       (account_id, client_id)
recurring_invoice_schedules  recurring_invoice_schedules_account_id_id_key  (account_id, id)
estimate_lines               estimate_lines_account_id_id_key               (account_id, id)
```

All five lead with `account_id`, so every delete in `purge_business_data_rows` is index-assisted.
**There is no missing-index defect here.** The cost is purely the 35 round-trip-free-but-sequential
statements times the number of due accounts, which is bounded by how many tenants let a hold lapse
on the same day — realistically single digits.

**Fix.** None recommended. The sequential order is FK-required, the statements are indexed, and
the per-account loop is the correct blast-radius boundary for a destructive operation — batching
`expire_hold` across accounts would mean one tenant's failure aborts another tenant's purge, which
is a far worse trade than the round trips it saves. Reported so the finding is on the record as
*examined and cleared*, and to retract the recon map's index claim before someone acts on it.

---

## 12. Sequential chunk/waterfall loops that could be one parallel wave

**Severity:** Low · **Location:** `app/(app)/estimates/page.tsx:169–184`;
`app/(app)/accounting/journal/page.tsx:63–81`; `app/(app)/reports/year-end/queries.ts:317`,
`:436`, `:455`

**Evidence.** Three shapes, all correct, all serial where they need not be:

```ts
// estimates/page.tsx:169 — chunked .in(), but awaited one chunk at a time
for (let i = 0; i < visibleIds.length; i += TOTALS_IN_CHUNK) {
  const chunkResult = rowsOf<TotalsRow>((await supabase.from("estimate_totals")…));
}
```

```ts
// accounting/journal/page.tsx:63 — chunk loop wrapping a page loop, both serial
for (let i = 0; i < entryIds.length; i += ENTRY_ID_CHUNK) {
  for (;;) { … await supabase.from("journal_lines")… .range(from, from + LINE_PAGE - 1) … }
}
```

```ts
// reports/year-end/queries.ts — three dependent round trips after the 8-wide Promise.all
const { data: invoiceData }     = … await supabase.from("invoices")…      // :317
const { data: lineData }        = … await supabase.from("invoice_lines")… // :436
const { data: lineInvoiceData } = … await supabase.from("invoices")…      // :455
```

**Fix.** For the two chunk loops, build the chunk queries and `await Promise.all(...)` — the
chunking exists for URL length (`estimates/page.tsx:160–165` explains the 8 KB header budget), not
for ordering, so the chunks are independent. For `year-end/queries.ts`, `:317` and `:436` are
genuinely independent of each other (one depends on `payments`, the other on `rebillExpensesRaw`,
both available after the opening `Promise.all` at `:183`) and can be one wave; `:455` genuinely
depends on `:436` and must stay sequential.

**Why it is faster:** on a serverless function talking to a hosted Postgres over the network,
round-trip latency dominates. Three sequential waits become one; K chunks become one wave.

**What must be true for it to be safe:** the chunk loops both `break` on the first error and
return the partial result as a failure — a parallel version must preserve "any chunk failed ⇒ the
whole read failed," not silently merge the successful chunks. That is the difference between a
correct rewrite and a report that shows a pilot 8 of 12 estimates' totals as though it were all of
them, which is precisely the failure mode `estimates/page.tsx:151–156` was written to close. The
year-end waterfall change is unconditionally safe (no shared state, no ordering dependency between
`:317` and `:436`).

---

## What I did not cover

- **No timings anywhere.** The replayed database (`dbaudit` on 127.0.0.1:55432) has empty tables,
  so every `EXPLAIN` I ran gives plan *shape* only. Costs quoted above are the planner's estimates
  on empty relations and mean nothing in absolute terms; the shape (which `Index Cond` columns are
  bound, whether a `Sort` node survives, anti-join vs hash) is the evidence, and I never inferred a
  speedup factor from it. Findings 2 and 3 additionally used `set enable_seqscan = off` to force
  the planner to reveal the best *available* index path on an empty table; on a populated table the
  same predicates may well produce a sequential scan instead, which is not better.
- **The `EXPLAIN` sample is small.** I ran plans for four queries: the `journal_lines` predicate
  with and without `account_id`, the `invoice_lines` predicate with and without `account_id` under
  role `authenticated`, and the `ledger_sync` expense-drift anti-join. Every other finding is
  structural — read from source, not measured.
- **I did not `EXPLAIN` `ledger_sync` as a whole**, nor `generate_recurring_invoice`,
  `generate_autopay_invoice`, or `expire_hold` end to end. Their bodies are PL/pgSQL, so a plan
  requires either `auto_explain` or executing them against seeded data, neither of which was
  available. Findings 1, 2, 4, 9 and 11 are read from the SQL text.
- **`pilot.invoice_totals` and `pilot.estimate_totals`** are views
  (`20260805090000_phase5_invoices.sql:1111`) and I did not read their bodies. `ledger_sync` joins
  `invoice_totals` on `t.invoice_id = je.source_id` with **no `account_id` predicate** at six sites
  (`:504`, `:521`, `:533`, `:566`, `:583`) — that is very likely the same defect as finding 2, but
  I cannot assert it without knowing whether the view aggregates per invoice or per account, so I
  left it out of the ranked findings. It is the first thing the next pass should check.
- **`pilot.trip_pl`, `logbook_filtered`, `logbook_filtered_totals`, `ledger_cash_flow`,
  `ledger_balances`, `unbilled_summary`** — the SECURITY INVOKER reporting functions. Not read.
  They are the read path behind `reports/trip-pl`, `logbook/page.tsx` and `overview/page.tsx`, and
  because they are INVOKER they inherit the caller's RLS predicates, which means finding 3's
  hashed-SubPlan problem plausibly applies *inside* their bodies too. Unexamined.
- **`app/(app)/overview/page.tsx` beyond line 330.** I confirmed the recon map's claim that the
  16-wide `Promise.all` at `:258` is genuinely parallel and that the `for (const leg of legs)` at
  `:175` does no I/O, but I did not read the second wave at `:523` or trace what the 20 call sites
  select.
- **Storage round trips.** `lib/invoice-document.tsx:319` and
  `app/(app)/invoices/[id]/reimbursables-packet/route.tsx:193` download receipt blobs one at a
  time inside a loop. That is a genuine N+1 in latency terms, but it is Supabase Storage, not SQL,
  and out of this skill's scope.
- **The write paths I did not open at all:** `app/api/stripe/connect-webhook/route.ts` (25
  `.from()` calls, the largest single file in the app and a money path), `expenses/import/
  actions.ts` chunked-insert-with-per-row-fallback at `:409–415`, and `logbook/import/actions.ts`
  at `:778–790`. The webhook in particular deserves its own pass — it is per-event rather than
  per-render, so it did not surface under a "hot render path" brief, but it is the highest-stakes
  query surface in the product.
- **Index *additions*.** Beyond the trigram indexes proposed in finding 5, I made no
  missing-index recommendations. The recon map's four "no index at all" flags all turned out to be
  implicit unique-constraint indexes (finding 11), which is a good reason to distrust any index
  recommendation not verified against `pg_indexes` — and I verified only the eight tables relevant
  to my findings, not all 50.
- **Nothing was applied.** This is a report-only pass: no file outside this one was created,
  edited or deleted, no migration was written, and no `verify` suite was run. Every SQL and TypeScript
  block above is a proposal.
