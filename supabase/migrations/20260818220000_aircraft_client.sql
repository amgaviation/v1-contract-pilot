-- pilot.aircraft.client_id -- whose airplane this is, when it is anyone's
-- but the pilot's own.
--
-- WHY THIS EXISTS. pilot.aircraft (20260810110000) answers "how much time
-- do you have in the 560?" and "how much time in N447SP?" -- the two
-- questions an insurance underwriter's pilot-history form and an
-- open-pilot warranty ask. Neither form stops there: both also want to
-- know WHOSE airplane it was, because "1,200 hours in type" reads
-- differently for a pilot who has flown one owner's jet for three years
-- than for one who has flown six different owners' jets for 200 hours
-- each. The registry had no way to answer that at all, so this adds one
-- column rather than a new table -- the same "cheap now, expensive to
-- retrofit" reasoning 20260810110000 used for the gear column.
--
-- WHY THE LINK LIVES ON THE REGISTRY ROW, not on a trip or a logbook
-- entry. An airframe a pilot flies for an owner is a fact about the
-- AIRFRAME: who owns it, or who it is chartered or managed for, does not
-- change flight to flight the way a TRIP's client can differ from the
-- aircraft's owner (a management company's jet flown on one client's
-- trip this month and a different client's the next). Recording it once,
-- on the one row that already stands for the airframe, is the same
-- reasoning 20260810110000 used to put type_rating and gear there
-- instead of on every logbook entry: one fact, one place, never re-typed.
--
-- WHY NULLABLE. A freelance-fleet tail -- an FBO rental, a flight
-- school's trainer, a demo flight -- belongs to no client the pilot
-- invoices. Forcing a client onto every aircraft would either invent an
-- owner that does not exist or block the row outright; null is the
-- honest "not recorded, and possibly not applicable" this table already
-- uses for gear, is_turbine and is_retractable, and must never be read as
-- an assertion either way.
--
-- WHY A COMPOSITE FK. Every tenant-scoped reference in this schema keys
-- through (account_id, id) rather than id alone (20260802190437's header
-- is the canonical statement of why): a plain `client_id uuid references
-- pilot.clients(id)` would let one account's aircraft point at another
-- account's client, because the RLS policy on pilot.aircraft only checks
-- the AIRCRAFT's own account_id. The composite FK below makes that
-- cross-tenant attach fail in the constraint layer instead of depending
-- on the app to remember. Both FK targets already exist -- pilot.clients
-- carries `unique (account_id, id)` (20260805070000) and pilot.aircraft
-- carries the same on itself (20260810110000) -- so this migration adds
-- no supporting unique constraint, only the column, the FK, and grants.
--
-- ON DELETE RESTRICT, matching pilot.trips.client_id exactly
-- (20260805070000, the identical column/FK shape on the identical
-- question -- "which client does this tenant record name"). A client
-- with a registered aircraft on file cannot be deleted out from under
-- it; the pilot corrects or clears the aircraft's client first. This is
-- also why pilot.expenses.client_id's ON DELETE SET NULL
-- (20260815130000) is NOT the model here -- that column's whole reason
-- for existing is to survive the loss of a DIFFERENT record (the trip),
-- with the client attribution itself deliberately left standing. There
-- is no analogous "outlives what it was attached to" case for an
-- aircraft's owner, so this reuses trips.client_id's decision rather
-- than inventing a third.
--
-- NO BACKFILL. Every existing aircraft keeps client_id null. Nothing in
-- this schema has ever recorded which client an airframe belongs to, so
-- there is no source to backfill FROM -- a pilot who wants this fact on
-- file sets it once, going forward, the same as every other optional
-- field this table already carries.
--
-- RLS IS UNCHANGED. No policy is created, dropped or altered. Row
-- visibility on pilot.aircraft stays a function of account_id alone
-- (aircraft_select/_insert/_update, 20260810110000); the new FK leads
-- with account_id, so client_id can only ever name a client in the SAME
-- account, and the column opens no read path pilot.clients' own RLS does
-- not already gate (same three-point proof 20260815130000's header
-- walks through for the identical shape on pilot.expenses).
--
-- THE THREE READ-SIDE VIEWS (pilot.logbook_time_by_type,
-- pilot.aircraft_time_by_tail, pilot.aircraft_unregistered_idents) are
-- deliberately UNTOUCHED. None of the questions they answer -- hours by
-- type, hours by tail, unregistered idents -- needs whose aircraft it
-- is, and `create or replace view` is positional: touching one of them
-- to add a column nothing reads would only risk the append-only column
-- order every `select *` caller against it relies on.
--
-- GRANTS ARE ADDITIVE, per this tree's standing rule (see README.md):
-- a bare `revoke` on a column-scoped grant drops EVERY column privilege
-- for that grantee, not just the one being changed. The two grants below
-- only ADD client_id to the insert/update column lists 20260810110000
-- already established; every other withheld column (id, account_id,
-- tail_key, created_at, updated_at) stays withheld.

-- ---------------------------------------------------------------------------
-- The column. Nullable by design -- see the header. Metadata-only in
-- Postgres 11+ (no table rewrite), and cheap regardless: a working
-- pilot's own fleet is a few dozen rows at most.
-- ---------------------------------------------------------------------------
alter table pilot.aircraft
  add column if not exists client_id uuid;

comment on column pilot.aircraft.client_id is
  'Which client this airframe belongs to, or is flown for -- a fact about the AIRFRAME, not about any one trip. Null means not recorded, which covers both "nobody said" and a freelance-fleet tail (FBO rental, trainer, demo) that belongs to no client at all -- never read as an assertion either way. Composite FK to pilot.clients (account_id, id), same shape and same ON DELETE RESTRICT as pilot.trips.client_id.';

-- Same-account clients only, same composite shape as pilot.trips.client_id
-- (20260805070000) and every other cross-tenant FK in this schema.
-- ON DELETE RESTRICT matches trips.client_id exactly -- see the header for
-- why this column follows that precedent rather than expenses.client_id's
-- ON DELETE SET NULL.
alter table pilot.aircraft
  add constraint aircraft_client_fk
  foreign key (account_id, client_id) references pilot.clients (account_id, id)
  on delete restrict;

-- ---------------------------------------------------------------------------
-- GRANTS. Additive only -- see the header. These extend
-- 20260810110000's insert/update column lists with client_id and nothing
-- else.
-- ---------------------------------------------------------------------------
grant insert (client_id) on pilot.aircraft to authenticated;
grant update (client_id) on pilot.aircraft to authenticated;

-- service_role already holds table-level insert/update on pilot.aircraft
-- (20260810110000), which covers a new column without restatement.
