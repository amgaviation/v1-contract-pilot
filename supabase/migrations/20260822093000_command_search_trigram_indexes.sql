-- ===========================================================================
-- Trigram indexes for the command palette's ten substring searches
--
-- WHAT THIS IS. One `create extension if not exists` and ten
-- `create index if not exists` statements, nothing else. No table, column,
-- constraint, policy, grant or QUERY changes. The route that benefits
-- (app/api/command-search/route.ts) is not touched by this migration and
-- does not need to be — see "why no query rewrite" below.
--
-- THE PROBLEM. app/api/command-search/route.ts builds `%<typed query>%` once
-- (route.ts:174-175) and fires ten `.ilike(column, pattern)` reads at it in
-- a single Promise.all (route.ts:200-266). A LEADING-wildcard ILIKE is
-- unindexable by a B-tree: a B-tree can only seek on a known prefix, and
-- `%TEB%` has none. So each of those ten reads is a sequential scan of the
-- whole table, on the interactive path of a keystroke-driven palette, and
-- they run ten-wide at once. Nothing in this schema indexed them: before
-- this file there was no GIN index and no trigram operator class anywhere in
-- pilot.* (grep of supabase/migrations confirms — every index in the schema
-- is btree).
--
-- WHY TRIGRAM, AND WHY NOT THE PREFIX REWRITE. The other way to make these
-- queries indexable is to drop the leading wildcard and search `TEB%`
-- against a text_pattern_ops btree. That is a BEHAVIOUR CHANGE, not an
-- optimisation: today a pilot typing "TEB" finds "KTEB", and every US ICAO a
-- pilot types without its leading K is exactly that case. A GIN trigram
-- index changes nothing about what matches — `ILIKE '%x%'` keeps its exact
-- current semantics, Postgres just gets the option of finding the candidate
-- rows through the index instead of reading every row. That is why this
-- migration ships alone, with no accompanying edit to the route.
--
-- WHERE pg_trgm LIVES. `with schema extensions`, matching pgcrypto in
-- 20260809060000:63 — the one other extension this schema enables — and
-- matching Supabase's own convention of keeping extensions out of public and
-- out of pilot. The consequence is that `gin_trgm_ops` is NOT on the default
-- search_path, so every index below names it as `extensions.gin_trgm_ops`,
-- the same schema-qualification discipline the rest of this schema applies
-- to `extensions.gen_random_bytes`. The OPERATORS the planner needs at query
-- time (`~~*` against the index) are found through the opclass, not through
-- the caller's search_path, so a PostgREST request with `search_path =
-- pilot, public` still gets the index — nothing about the route's
-- connection has to change.
--
-- ONE INDEX PER DISTINCT (table, column). Ten ilike calls, ten distinct
-- pairs — two of the ten tables are searched on two columns each
-- (expenses.vendor + expenses.notes, documents.label + documents.notes) and
-- invoices/trip_legs likewise, so the ten calls do not collapse to fewer
-- than ten indexes. Verified against pg_indexes on a full replay: none of
-- these ten columns had any index, trigram or otherwise, before this file.
--
-- NO account_id IN THESE INDEXES, deliberately, unlike every btree in this
-- schema. A GIN index takes a single opclass per column and there is no
-- useful trigram opclass for a uuid; a composite (account_id, col
-- gin_trgm_ops) would need btree_gin, a THIRD extension, to buy a filter
-- Postgres already applies cheaply from the RLS predicate against a
-- trigram-narrowed candidate set. Tenant isolation is unaffected either way:
-- RLS is enforced above the index, and an index has never been what scopes a
-- read in this schema.
--
-- COST. Ten GIN indexes are write amplification on insert/update of these
-- columns. All ten sit on low-write, human-typed text (a client's name, a
-- receipt's vendor, a note) — none is on a money column, a ledger row, or
-- anything on the autopay/reminder cron path.
--
-- NOT `concurrently`, deliberately: this repo has no CONCURRENTLY anywhere
-- (grep confirms), and verify:all replays each file with `psql -f` in
-- autocommit where the distinction is moot. Following the house pattern set
-- by 20260822091000.
--
-- Replay-safe from scratch and re-runnable: every statement is
-- `if not exists`.
-- ===========================================================================

-- pg_trgm supplies gin_trgm_ops, the operator class that lets a GIN index
-- answer `ILIKE '%…%'`. Core-adjacent contrib, shipped with Postgres and
-- enabled by default on Supabase projects; `if not exists` makes this a
-- no-op where it is already present.
create extension if not exists pg_trgm with schema extensions;

-- route.ts:203 — .ilike("name", pattern) on clients. The palette's "clients"
-- results, and the seed of PASS 2: every invoice/trip/estimate reached via a
-- client match hangs off this one scan.
create index if not exists clients_name_trgm_idx
  on pilot.clients using gin (name extensions.gin_trgm_ops);

-- route.ts:209 — .ilike("invoice_number", pattern) on invoices. Indexed
-- despite invoices_account_id_invoice_number_key existing: that unique btree
-- covers equality and prefix, never a leading wildcard, and a pilot typing
-- "0142" of "INV-2026-0142" is the leading-wildcard case.
create index if not exists invoices_invoice_number_trgm_idx
  on pilot.invoices using gin (invoice_number extensions.gin_trgm_ops);

-- route.ts:221 — .ilike("bill_to_name", pattern) on invoices. The only way
-- to find a clientless draft invoice (20260815100000) by who it is for.
create index if not exists invoices_bill_to_name_trgm_idx
  on pilot.invoices using gin (bill_to_name extensions.gin_trgm_ops);

-- route.ts:227 — .ilike("estimate_number", pattern) on estimates. Same
-- reasoning as invoice_number against
-- estimates_account_id_estimate_number_key.
create index if not exists estimates_estimate_number_trgm_idx
  on pilot.estimates using gin (estimate_number extensions.gin_trgm_ops);

-- route.ts:233 — .ilike("vendor", pattern) on expenses.
create index if not exists expenses_vendor_trgm_idx
  on pilot.expenses using gin (vendor extensions.gin_trgm_ops);

-- route.ts:239 — .ilike("notes", pattern) on expenses. A DIFFERENT column of
-- the same table as the index above, issued as its own query rather than an
-- `.or(...)` (route.ts:183-187); it needs its own index.
create index if not exists expenses_notes_trgm_idx
  on pilot.expenses using gin (notes extensions.gin_trgm_ops);

-- route.ts:245 — .ilike("label", pattern) on documents.
create index if not exists documents_label_trgm_idx
  on pilot.documents using gin (label extensions.gin_trgm_ops);

-- route.ts:251 — .ilike("notes", pattern) on documents. Same table, second
-- column, same reasoning as the expenses pair.
create index if not exists documents_notes_trgm_idx
  on pilot.documents using gin (notes extensions.gin_trgm_ops);

-- route.ts:257 — .ilike("from_icao", pattern) on trip_legs. The heaviest of
-- the ten: trip_legs is the highest-row-count table in this set (one row per
-- leg, not per trip) and this read is capped at LOOKUP_LIMIT 20, not 8.
create index if not exists trip_legs_from_icao_trgm_idx
  on pilot.trip_legs using gin (from_icao extensions.gin_trgm_ops);

-- route.ts:263 — .ilike("to_icao", pattern) on trip_legs. Searched in either
-- direction (route.ts:180-182), so both ends are separate queries and both
-- need an index.
create index if not exists trip_legs_to_icao_trgm_idx
  on pilot.trip_legs using gin (to_icao extensions.gin_trgm_ops);
