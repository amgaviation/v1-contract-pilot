-- ===========================================================================
-- A COMPOSITE `on delete set null` NULLS EVERY COLUMN IN THE KEY — the
-- fourth occurrence, and the six constraints the three earlier fixes missed
-- ===========================================================================
--
-- THE DEFECT, restated once more because it has now shipped four times.
-- Written without a column list,
--
--   foreign key (account_id, trip_id) references pilot.trips (account_id, id)
--     on delete set null
--
-- makes Postgres null EVERY column of the referencing key when the parent
-- row goes — account_id included. account_id is `not null` on every table in
-- schema `pilot`, so the referential action cannot be performed and the
-- DELETE aborts:
--
--   ERROR:  null value in column "account_id" of relation "logbook_entries"
--           violates not-null constraint
--   CONTEXT: UPDATE ONLY pilot.logbook_entries
--            SET "account_id" = NULL, "trip_id" = NULL ...
--
-- `on delete set null (trip_id)` names the columns to clear and leaves
-- account_id alone, which is the behaviour every one of these constraints
-- was written believing it already had.
--
-- This repo has diagnosed and corrected this exact class three times:
-- 20260810030000 (pilot.bank_transactions — its header carries this file's
-- title), 20260815130000:207,:217 (pilot.expenses), and 20260818230000:45
-- (pilot.aircraft, whose header states the column-list caveat in full: the
-- bare form "would then fail on a not-null violation instead of a RESTRICT
-- one, which is the same stuck hold with a different error code"). Each fix
-- corrected the table in front of it and none swept the catalog, so six bare
-- composite SET NULL constraints survived untouched. They are all of them —
-- verified against the migrated catalog, not by grep:
--
--   select conname from pg_constraint
--    where contype = 'f' and confdeltype = 'n'
--      and cardinality(conkey) > 1
--      and coalesce(cardinality(confdelsetcols), 0) = 0;
--
-- scripts/account-lifecycle-db-verify.mjs now runs that assertion for the
-- retain/delete boundary on every `verify:all`, so a fifth occurrence on
-- that boundary fails CI instead of waiting for an audit.
--
-- WHY THE LOGBOOK PAIR IS THE SERIOUS ONE. pilot.logbook_entries is on the
-- purge's RETAIN list and pilot.trips / pilot.trip_legs are on its DELETE
-- list (20260818200000). So `delete from pilot.trips` inside
-- purge_business_data_rows raises 23502 for any account holding a single
-- trip-derived logbook entry — every account that has ever used the
-- confirm-from-leg flow. pilot.expire_hold then aborts, NOTHING is purged,
-- the scheduled pass retries forever and the account is stuck: verbatim the
-- failure 20260818230000 was written to prevent, reintroduced through a
-- different table. It also breaks interactive trip deletion, and it does the
-- precise opposite of the twenty-line comment above the constraint, which
-- promises that deleting a trip "must NEVER delete a CONFIRMED logbook entry
-- out from under the pilot". Today it does not delete the entry — it refuses
-- to delete the trip.
--
-- The other four are not on the retain/delete boundary (mileage_entries and
-- client_tax_forms are themselves purged, and the purge deletes children
-- before parents, so the purge path never reaches them). They are the same
-- defect on the interactive path: deleting a trip, a client or a document
-- that any of these rows cites fails with 23502, which friendlyDbError
-- renders as "Something required is missing." — nonsense for a delete — and
-- the parent record becomes permanently undeletable from the UI.
--
-- EVERY TARGET COLUMN IS ALREADY NULLABLE and every account_id is NOT NULL;
-- checked in information_schema before writing this file, per table:
--   logbook_entries.trip_id, .trip_leg_id            nullable
--   mileage_entries.trip_id, .client_id              nullable
--   operator_qualifications.document_id              nullable
--   client_tax_forms.document_id                     nullable
-- So `set null (<col>)` is the correct action in all six cases; none needed
-- forcing, and no column's own nullability changes here.
--
-- DELIBERATELY NOT TOUCHED: pilot.operator_qualifications' CLIENT FK
-- (20260807060000:85), which is `on delete cascade` over a NOT NULL
-- client_id. It is a genuine retain/delete boundary violation — a purge
-- destroys operator qualifications that three migrations promise to spare —
-- but its own comment holds that a qualification with no operator is a
-- contradiction in terms, so `set null` is unavailable and the fix needs a
-- product decision that has not been made. It is recorded as a named,
-- reasoned exemption in scripts/account-lifecycle-db-verify.mjs rather than
-- silently passing the new assertion. STILL OPEN.
--
-- Idempotent drop-then-add throughout, so a replay from scratch (CI applies
-- every file in order) lands in the same end state as an in-place upgrade.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- pilot.logbook_entries — the retain/delete boundary. The column list here is
-- what stops a hold expiry from erroring forever; without it Postgres nulls
-- account_id too and the whole purge transaction rolls back.
-- ---------------------------------------------------------------------------
alter table pilot.logbook_entries
  drop constraint if exists logbook_entries_account_id_trip_id_fkey;
alter table pilot.logbook_entries
  add constraint logbook_entries_account_id_trip_id_fkey
  foreign key (account_id, trip_id) references pilot.trips (account_id, id)
  on delete set null (trip_id);

comment on constraint logbook_entries_account_id_trip_id_fkey on pilot.logbook_entries is
  'Same-account trips only (composite key). ON DELETE SET NULL (trip_id) — the column list is load-bearing: a bare composite SET NULL nulls EVERY referencing column including account_id, which is NOT NULL, so the delete would abort with 23502 instead of orphaning the entry. The entry is the legal record and must survive its trip; the purge (20260818200000) deletes pilot.trips while retaining this table, so this constraint is on the retain/delete boundary. See 20260821090000.';

alter table pilot.logbook_entries
  drop constraint if exists logbook_entries_account_id_trip_leg_id_fkey;
alter table pilot.logbook_entries
  add constraint logbook_entries_account_id_trip_leg_id_fkey
  foreign key (account_id, trip_leg_id) references pilot.trip_legs (account_id, id)
  on delete set null (trip_leg_id);

comment on constraint logbook_entries_account_id_trip_leg_id_fkey on pilot.logbook_entries is
  'Same-account legs only (composite key). ON DELETE SET NULL (trip_leg_id), column list required for the same reason as the trip FK: the bare form nulls account_id (NOT NULL) and aborts the delete. Clearing trip_leg_id releases the one-entry-per-leg partial unique index along with the leg, which is correct — the leg it deduplicated against no longer exists. See 20260821090000.';

-- ---------------------------------------------------------------------------
-- pilot.mileage_entries — interactive path only (this table is purged before
-- both of its parents), but the same 23502 on any interactive delete.
-- ---------------------------------------------------------------------------
alter table pilot.mileage_entries
  drop constraint if exists mileage_entries_account_id_trip_id_fkey;
alter table pilot.mileage_entries
  add constraint mileage_entries_account_id_trip_id_fkey
  foreign key (account_id, trip_id) references pilot.trips (account_id, id)
  on delete set null (trip_id);

comment on constraint mileage_entries_account_id_trip_id_fkey on pilot.mileage_entries is
  'Same-account trips only (composite key). ON DELETE SET NULL (trip_id); the explicit column list keeps account_id (NOT NULL) out of the SET NULL, which the bare composite form would include and thereby abort the delete. A drive outlives the trip it was attached to — trip_id is nullable by design. See 20260821090000.';

alter table pilot.mileage_entries
  drop constraint if exists mileage_entries_account_id_client_id_fkey;
alter table pilot.mileage_entries
  add constraint mileage_entries_account_id_client_id_fkey
  foreign key (account_id, client_id) references pilot.clients (account_id, id)
  on delete set null (client_id);

comment on constraint mileage_entries_account_id_client_id_fkey on pilot.mileage_entries is
  'Same-account clients only (composite key). ON DELETE SET NULL (client_id); the explicit column list keeps account_id (NOT NULL) out of the SET NULL. Matches pilot.expenses'' client FK (20260815130000) in both shape and intent: the drive stays recorded, the attribution clears. See 20260821090000.';

-- ---------------------------------------------------------------------------
-- pilot.operator_qualifications.document_id — the DOCUMENT link only. This
-- table's CLIENT FK is deliberately untouched; see the header.
-- ---------------------------------------------------------------------------
alter table pilot.operator_qualifications
  drop constraint if exists operator_qualifications_account_id_document_id_fkey;
alter table pilot.operator_qualifications
  add constraint operator_qualifications_account_id_document_id_fkey
  foreign key (account_id, document_id) references pilot.documents (account_id, id)
  on delete set null (document_id);

comment on constraint operator_qualifications_account_id_document_id_fkey on pilot.operator_qualifications is
  'Same-account documents only (composite key). ON DELETE SET NULL (document_id); the explicit column list keeps account_id (NOT NULL) out of the SET NULL, which the bare composite form would include and thereby make the cited document undeletable. Losing the scanned copy must not erase the record that the qualification exists. See 20260821090000.';

-- ---------------------------------------------------------------------------
-- pilot.client_tax_forms.document_id — the migration's own comment already
-- states the intent ("losing the scanned copy of the form should not destroy
-- the pilot's record that the form arrived"); only the column list was
-- missing to make it true.
-- ---------------------------------------------------------------------------
alter table pilot.client_tax_forms
  drop constraint if exists client_tax_forms_account_id_document_id_fkey;
alter table pilot.client_tax_forms
  add constraint client_tax_forms_account_id_document_id_fkey
  foreign key (account_id, document_id) references pilot.documents (account_id, id)
  on delete set null (document_id);

comment on constraint client_tax_forms_account_id_document_id_fkey on pilot.client_tax_forms is
  'Same-account documents only (composite key). ON DELETE SET NULL (document_id); the explicit column list keeps account_id (NOT NULL) out of the SET NULL. Deleting the scanned 1099 leaves the recorded figure and the fact of receipt intact, which is what 20260807080000''s comment always claimed. See 20260821090000.';
