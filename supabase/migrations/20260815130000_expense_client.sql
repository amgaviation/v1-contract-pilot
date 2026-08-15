-- pilot.expenses.client_id -- attributing a cost to a client without a trip.
--
-- WHY THIS EXISTS. Until now an expense could only reach a client through a
-- trip. That covers the receipt picked up while flying and nothing else. A
-- contract pilot also spends money ON a client with no trip record to hang
-- it from: the recurrent training or operator indoc a client asks for
-- before they will roster you, the headset adapter bought for one owner's
-- panel, the FBO parking on a day that cancelled before it became a trip,
-- the airline ticket home from a trip that never happened. Those
-- costs were captured (pilot.expenses has always taken a trip-less row) but
-- were unattributable: nothing in the schema could say WHO they were spent
-- on, so no surface could add them up. "What has this client actually cost
-- me" had an answer that quietly omitted every cost that did not travel
-- through a trip.
--
-- THE PRECEDENT THIS FOLLOWS. pilot.mileage_entries (20260809020000)
-- already carries a nullable trip_id AND a nullable client_id for exactly
-- this reason -- a drive to an FBO for a client may have no trip. This
-- migration copies that shape rather than inventing a second one, plus the
-- composite-FK and column-scoped-grant patterns Phase 1 established.
--
-- ===========================================================================
-- WHAT THIS DOES NOT DO: DIRECT-TO-CLIENT REBILLING.
--
-- pilot.expenses still carries `check (treatment <> 'rebill' or trip_id is
-- not null)` and this migration deliberately leaves it exactly as it is.
-- 'rebill' means "put this on someone's invoice", and the invoice line
-- machinery attaches through the trip: pilot.invoice_lines_validate_trip
-- resolves a reimbursable_expense line's trip from the EXPENSE's own
-- trip_id, and pilot.invoices_sync_trip_billing_state walks the same edge
-- back to set trips.billing_state. Letting an expense be 'rebill' with a
-- client but no trip would give the line nowhere to land and would silently
-- break the A2 trip arithmetic (billable - deducted = trip net), which is
-- the precise failure the CHECK was written to prevent.
--
-- So client_id buys three things TODAY, and no more:
--   1. attributing a 'deduct' or 'unassigned' cost to a client with no trip;
--   2. filtering and reporting costs by client;
--   3. a client's true cost picture, including what never went through a
--      trip.
-- ===========================================================================
--
-- ===========================================================================
-- TRIP AND CLIENT TOGETHER: THEY MAY BOTH STAND, AND THEY MAY NOT DISAGREE.
--
-- An expense can now name a trip and a client at once, and the two could
-- contradict each other if the trip belongs to a different client. That is
-- not left to the application to remember. It is a composite foreign key,
-- in the same layer and for the same reason as every other cross-tenant
-- rule in this schema:
--
--   foreign key (account_id, trip_id, client_id)
--     references pilot.trips (account_id, id, client_id)
--
-- Postgres FKs are MATCH SIMPLE by default, which is what makes one
-- constraint express all four cases correctly:
--
--   * trip set, client null      -> not checked (a null in the referencing
--                                   columns satisfies MATCH SIMPLE). The
--                                   expense's client is DERIVED from the
--                                   trip at read time. This is the state
--                                   every existing row is in, and it stays
--                                   legal forever.
--   * trip null, client set      -> not checked by this FK. The new case:
--                                   a client-attributed cost with no trip.
--                                   Still checked by the plain
--                                   (account_id, client_id) FK below, so it
--                                   can only ever name a client in the same
--                                   account.
--   * trip set, client set       -> CHECKED. The pair must be a real row of
--                                   pilot.trips. An expense claiming client
--                                   B on client A's trip does not exist as
--                                   a storable state, and neither does one
--                                   claiming any client at all on a trip
--                                   that has none.
--   * both null                  -> not checked. The unassigned queue.
--
-- WHAT THE APP ACTUALLY WRITES, which is narrower than what the schema
-- allows: when an expense has a trip, the app stores NULL here and reads
-- the client through the trip. It never copies the trip's client into the
-- column. The both-set case above is therefore a guard rather than a state
-- the product produces on its own, and it stays because a future writer
-- (an import, a script, a later feature) must not be able to build the
-- mismatch either. See lib/expense-client.ts's clientIdForStorage for why
-- the app declines to materialise a derived value: it would split the table
-- between two conventions for one fact, and it would survive the deletion
-- of the trip it was copied from as an attribution the pilot never made.
--
-- ON UPDATE CASCADE, not the default NO ACTION: re-pointing a trip at a
-- different client carries that trip's expenses with it, rather than
-- failing the pilot's edit with a constraint error about rows they were not
-- thinking about. The trip is the stronger statement of who the work was
-- for, so the trip wins. (Re-pointing a BILLED trip is already refused
-- outright by pilot.trips_protect_billed_client from 20260805090000, so a
-- cascade can never restate an issued invoice's client. And the cascade
-- rewrites trip_id to the value it already had, which
-- pilot.expenses_protect_billed_trip explicitly early-returns on -- `if
-- new.trip_id is not distinct from old.trip_id then return new`.)
--
-- ON DELETE SET NULL (trip_id), matching the column-list form
-- 20260805090000 had to correct the two-column FK to: nulling the whole key
-- would null account_id, which is NOT NULL. Deleting a trip therefore
-- leaves the expense's client_id standing. That is the honest outcome: the
-- money was still spent on that client, and losing the attribution because
-- the trip record went away would be a silent downgrade of a fact the pilot
-- entered.
-- ===========================================================================
--
-- ===========================================================================
-- NO BACKFILL, AND WHY NOT.
--
-- Every existing expense keeps client_id null, including the ones already
-- attached to a trip that has a client. This is not caution about an
-- ambiguous derivation (it is not ambiguous -- a trip has at most one
-- client). It is that the backfill would buy nothing and cost a rewrite of
-- every historical row:
--
--   * The reading rule is `client_id, else the trip's client` -- see
--     lib/expense-client.ts, which is the single definition of it. A
--     trip-attached expense already answers "which client" through the trip
--     and reads identically before and after any backfill.
--   * The FK above guarantees the two can never disagree, so the derived
--     answer is never in tension with a stored one.
--   * Leaving it null keeps the column's meaning sharp: client_id is what
--     the pilot attributed DIRECTLY. Filling it from the trip would erase
--     the difference between "attributed to this client" and "happens to
--     sit on a trip of theirs", on rows nobody asked to change.
--
-- So this migration writes no row. It adds a nullable column with no
-- default (metadata-only in Postgres 11+, no table rewrite), two
-- constraints, one index and two column grants.
--
-- LOCKING, for a live database: the ALTER TABLEs each take a brief ACCESS
-- EXCLUSIVE lock. Adding the unique constraint on pilot.trips builds its
-- index under that lock, so it blocks reads and writes of pilot.trips for
-- the duration -- on a per-tenant table of this size (a working pilot logs
-- a few hundred trips a year) that is milliseconds, and it is the same move
-- 20260805090000 made on pilot.expenses. Both new FKs validate existing
-- rows on creation; every existing expense has client_id null, so both
-- validations are satisfied trivially by MATCH SIMPLE.
-- ===========================================================================
--
-- ===========================================================================
-- RLS IS UNCHANGED, AND CANNOT BE WIDENED BY THIS COLUMN. THE PROOF.
--
-- No policy is created, dropped or altered by this file. pilot.expenses
-- keeps exactly the four policies from 20260805070000, each of the form
-- `account_id in (select pilot.current_account_ids())`. Three facts make a
-- nullable client_id unable to widen any row's visibility:
--
--   1. THE PREDICATE DOES NOT MENTION IT. Row visibility on pilot.expenses
--      is a function of account_id alone. A column the policy expression
--      never reads cannot change which rows that expression admits, for any
--      value including null.
--   2. IT CANNOT NAME A FOREIGN ROW. Both new FKs lead with account_id, so
--      client_id can only ever hold the id of a client in the SAME account
--      as the expense. There is no value of this column that points out of
--      the tenant -- the constraint layer refuses it, exactly as it does
--      for trip_id.
--   3. IT OPENS NO NEW READ PATH. The FK makes pilot.clients embeddable
--      from pilot.expenses over PostgREST, but an embedded read runs the
--      embedded table's OWN policies (clients_select, same account_id
--      predicate) -- it is not a bypass, and it can return nothing this
--      caller could not already select directly from pilot.clients. No
--      SECURITY DEFINER function, no view, and no grant to anon or to a
--      share-link path reads this column.
--
-- Write authority stays column-scoped for the same reason it always has:
-- RLS has no column granularity, so the grants at the bottom of this file
-- are the only place it can be expressed, and ALTER TABLE ADD COLUMN does
-- not extend an existing column-scoped grant. account_id, id, created_at
-- and updated_at remain withheld.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The FK target. Redundant with pilot.trips' primary key on its own, and
-- load-bearing as the thing (account_id, trip_id, client_id) references --
-- the same reason every parent in this schema carries unique (account_id,
-- id). client_id is nullable and the default NULLS DISTINCT applies, which
-- is harmless here: (account_id, id) is already unique by the primary key,
-- so no pair of rows can collide on the triple either way.
-- ---------------------------------------------------------------------------
alter table pilot.trips
  add constraint trips_account_id_id_client_id_key unique (account_id, id, client_id);

-- ---------------------------------------------------------------------------
-- The column. Nullable BY DESIGN, and null is a real answer with a
-- meaning: "not attributed to a client directly". For an expense on a trip
-- that is the DEFAULT state and stays correct forever, because the client
-- is derived from the trip. For a trip-less expense it is the unattributed
-- state the pilot can now fix.
-- ---------------------------------------------------------------------------
alter table pilot.expenses
  add column if not exists client_id uuid;

comment on column pilot.expenses.client_id is
  'Who the cost was spent on, when the pilot attributes it directly. Null means not directly attributed, which for a trip-attached expense is normal: the client is derived from the trip (lib/expense-client.ts holds the single reading rule, client_id else the trip''s client). When both trip_id and client_id are set they cannot disagree -- the composite FK to pilot.trips (account_id, id, client_id) makes the mismatch unstorable. This column does NOT enable direct-to-client rebilling: `check (treatment <> ''rebill'' or trip_id is not null)` is untouched, because an invoice line still attaches through the trip.';

-- Same-account clients only, same composite shape as everywhere else. ON
-- DELETE SET NULL with an explicit column list, because the bare form nulls
-- every referencing column including account_id, which is NOT NULL -- the
-- defect 20260805090000 had to correct on this table's trip FK. Matches
-- pilot.mileage_entries' own client FK in intent.
alter table pilot.expenses
  add constraint expenses_account_id_client_id_fkey
  foreign key (account_id, client_id) references pilot.clients (account_id, id)
  on delete set null (client_id);

-- The agreement constraint. See the header for the four cases and for why
-- ON UPDATE CASCADE (the trip wins) and ON DELETE SET NULL (trip_id) (the
-- attribution survives the trip).
alter table pilot.expenses
  add constraint expenses_account_id_trip_id_client_id_fkey
  foreign key (account_id, trip_id, client_id)
  references pilot.trips (account_id, id, client_id)
  on update cascade
  on delete set null (trip_id);

-- Serves the by-client reads this column exists for: the /expenses list
-- filtered to a client, and the client record's own cost rollup. Partial on
-- `client_id is not null` -- the null rows are the majority and no read
-- ever asks for them by client.
create index if not exists expenses_client_idx
  on pilot.expenses (account_id, client_id)
  where client_id is not null;

-- ---------------------------------------------------------------------------
-- GRANTS. Additive only. There is deliberately NO `revoke ... from
-- authenticated` in this file: revoking a column-scoped privilege drops
-- EVERY column privilege for that grantee and the re-grant would then only
-- restate the columns listed here, silently withdrawing write access to
-- every other expense column. These two statements extend the existing
-- grants from 20260805070000 and 20260805090000 with the new column only.
-- ---------------------------------------------------------------------------
grant insert (client_id) on pilot.expenses to authenticated;
grant update (client_id) on pilot.expenses to authenticated;

-- service_role already holds table-level insert/update on pilot.expenses
-- (20260805070000), which covers a new column without restatement.
