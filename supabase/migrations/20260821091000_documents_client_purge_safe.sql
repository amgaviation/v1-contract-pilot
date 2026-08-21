-- ===========================================================================
-- pilot.documents.client_id: ON DELETE CASCADE -> ON DELETE SET NULL
-- (a hold expiry currently destroys the documents wallet)
-- ===========================================================================
--
-- 20260805070000:192 gave pilot.documents
--
--   foreign key (account_id, client_id) references pilot.clients (account_id, id)
--     on delete cascade
--
-- back when a document existed only as an annotation on a client. It has not
-- meant that for a long time: client_id is NULLABLE and the column's own
-- comment is explicit that "a passport isn't held 'for' any one client".
--
-- The account-lifecycle machinery is what turns the stale CASCADE into a
-- data-loss bug. purge_business_data_rows deletes pilot.clients
-- (20260818200000:130) and RETAINS pilot.documents — its own comment at
-- :140-146 names "documents" in the list of airman records it "deliberately
-- spares", repeated in prose at :306-309, and 20260818090000:105-106 states
-- flatly that "The airman records are never purged here". The CASCADE makes
-- all three untrue: every document a pilot ever attached to a client — an
-- insurance certificate, a W-9, a signed agreement — is destroyed by a
-- LAPSED BILLING HOLD. Silently, with no error, on the automated path.
--
-- The three promises are the correct behaviour and the FK is the thing that
-- is wrong. SET NULL is the honest resolution of "a retained record
-- referencing a purged one", exactly as 20260818230000 argued for
-- pilot.aircraft: the airman record survives untouched and the commercial
-- link, which cannot outlive the client it names, clears. The column is
-- already nullable and null already means "not held for any one client", so
-- this needs no column-nullability change and introduces no new state — it
-- lands the row in a state the schema already models.
--
-- THE COLUMN LIST IS LOAD-BEARING, for the fifth time in this repo's
-- history and for the reason 20260810030000's header is titled after: a
-- composite FK's bare `on delete set null` nulls EVERY referencing column,
-- account_id included, and account_id is NOT NULL. Writing this fix without
-- `(client_id)` would swap silent data loss for a 23502 that aborts
-- pilot.expire_hold forever — the same stuck hold with a different error
-- code. `set null (client_id)` clears only the link. The companion migration
-- 20260821090000 fixes the six pre-existing bare forms, and
-- scripts/account-lifecycle-db-verify.mjs now asserts this property from the
-- catalog on every `verify:all`.
--
-- INTERACTIVELY nothing observable changes: no code path hard-deletes a
-- client (the UI archives), so the only difference is that a lifecycle purge
-- now keeps the wallet instead of emptying it.
--
-- STILL OPEN, deliberately not fixed here: pilot.operator_qualifications
-- carries the identical CASCADE to pilot.clients (20260807060000:85) over a
-- NOT NULL client_id, and is likewise on the retain list. SET NULL is not
-- available there — the column's comment holds that an operator
-- qualification with no operator is a contradiction in terms — so resolving
-- it means deciding whether such a row should be purged with the client or
-- kept detached, which is a product decision the owner has not made. It is
-- carried as a named, reasoned exemption in the new catalog assertion rather
-- than passing it unnoticed.
--
-- Idempotent drop-then-add, so a replay from scratch and an in-place upgrade
-- land in the same end state.
-- ===========================================================================

alter table pilot.documents
  drop constraint if exists documents_account_id_client_id_fkey;

alter table pilot.documents
  add constraint documents_account_id_client_id_fkey
  foreign key (account_id, client_id) references pilot.clients (account_id, id)
  on delete set null (client_id);

comment on constraint documents_account_id_client_id_fkey on pilot.documents is
  'Same-account clients only (composite key). ON DELETE SET NULL (client_id), not CASCADE: documents are RETAINED by the account-lifecycle purge while clients are deleted (20260818200000), so a lapsed hold must clear the link and keep the document — three migrations promise the airman records are never purged. The column list keeps account_id (NOT NULL) out of the SET NULL; the bare composite form would null it and abort the purge instead. See 20260821091000.';

comment on column pilot.documents.client_id is
  'Which client this document is held for, when it is held for one at all. Nullable BY DESIGN and null is a real answer: a passport isn''t held "for" any one client. ON DELETE SET NULL (client_id) — deleting or purging the client clears the link and keeps the document, because pilot.documents is an airman record the lifecycle purge must never destroy.';
