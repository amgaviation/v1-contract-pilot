-- ===========================================================================
-- pilot.operator_qualifications survives a purge: denormalize the operator
-- name, make client_id nullable, ON DELETE CASCADE -> ON DELETE SET NULL
-- (a hold expiry currently destroys Part 135 qualification history)
-- ===========================================================================
--
-- THE BUG. 20260807060000:84-85 gave pilot.operator_qualifications
--
--   client_id uuid not null,
--   foreign key (account_id, client_id) references pilot.clients (account_id, id)
--     on delete cascade
--
-- and pilot.operator_qualifications is on the purge's RETAIN list. The
-- lifecycle machinery deletes pilot.clients (20260818200000:130) and promises
-- in three separate places that the airman records are spared:
-- 20260818200000:140-146 names "operator qualifications" in the list the
-- purge "deliberately spares", :306-309 repeats it in prose, and
-- 20260818090000:105-106 states flatly that "The airman records are never
-- purged here". The CASCADE makes all three untrue: every 135.293(a) written
-- test, 135.293(b) competency check, 135.297 IPC, 135.299 line check, basic
-- indoc and insurance approval a pilot ever recorded under an operator is
-- destroyed by a LAPSED BILLING HOLD. Silently, with no error, on the
-- automated path.
--
-- 20260821091000 fixed the identical defect on pilot.documents and left this
-- one open as a named exemption in scripts/account-lifecycle-db-verify.mjs'
-- BOUNDARY-1 assertion, because plain SET NULL was unavailable: client_id is
-- NOT NULL, and the column's own comment held that "an operator qualification
-- with no operator is a contradiction in terms". That was a product decision,
-- not an engineering one, and it has now been made.
--
-- THIS FILE SUPERSEDES TWO "STILL OPEN" NOTES that are still readable in the
-- migrations that wrote them, because shipped migrations are never edited in
-- place: 20260821090000:84 and 20260821091000:49-57. Both describe the state
-- of affairs BEFORE this migration. The exemption they refer to is gone from
-- scripts/account-lifecycle-db-verify.mjs, and BOUNDARY-1 now enforces this
-- FK like every other crossing.
--
-- THE DECISION: DENORMALIZE THE OPERATOR NAME ONTO THE ROW. A qualification
-- detached from a purged client survives as a standalone historical record
-- that still NAMES the operator it was held under. That dissolves the
-- contradiction the old comment described: the row no longer needs a
-- pilot.clients row to say who the operator was, because it says so itself.
-- What it loses on detachment is the LINK (rates, contacts, trips, invoices),
-- which genuinely cannot outlive the client — exactly the split
-- 20260818230000 argued for pilot.aircraft and 20260821091000 for
-- pilot.documents.
--
-- WHY THE NAME IS MAINTAINED IN THE DATABASE, NOT BY APP CODE. The name has
-- to be correct AT THE MOMENT THE CLIENT IS DELETED, and no app code runs at
-- that moment: pilot.expire_hold is called by a cron with no session
-- (app/api/holds/run/route.ts). A snapshot the app writes at insert time
-- would go stale the first time a pilot corrects an operator's name, and the
-- purge would then engrave the stale spelling forever. So this migration
-- keeps it in two triggers, matching how pilot.compute_operator_qualification_
-- expiry already keeps expires_on out of app code entirely:
--
--   (1) BEFORE INSERT OR UPDATE on pilot.operator_qualifications — resolves
--       operator_name from pilot.clients.name whenever client_id is set.
--   (2) AFTER UPDATE OF name on pilot.clients — propagates a rename to every
--       attached qualification, so (1)'s snapshot cannot go stale between the
--       rename and the purge. Without (2) the whole scheme is only correct
--       for operators nobody ever renamed, which is not a property worth
--       promising.
--
-- A SECOND TRIGGER, NOT AN EXTENSION OF THE EXISTING ONE. There is already a
-- BEFORE INSERT OR UPDATE trigger on this table
-- (operator_qualifications_compute_expiry -> pilot.compute_operator_
-- qualification_expiry, 20260807060000, corrected 20260807110000 and
-- 20260807130000). The name resolution is NOT folded into it, for two
-- reasons, both concrete:
--
--   * That function returns early three times before it ever reaches its
--     tail: for any requirement that is not one of the four Part 135 derived
--     kinds, for a null completed_on, and for the H1 idempotency gate.
--     Roughly EIGHT of the twelve requirement kinds bail out on the very
--     first guard. Name resolution placed anywhere in that body would simply
--     not run for most rows in the table, and the failure would be silent —
--     a blank operator_name discovered only after a purge, i.e. after the
--     client row it could have been resolved from is gone. Hoisting it above
--     the guards instead means restructuring the one function in this schema
--     whose control flow IS its bug history: its idempotency gate exists
--     because an earlier version fed its own output back in as input (see
--     20260807060000:178-205, the H1 fix). That function should be edited
--     when 14 CFR changes, and for no other reason.
--   * The two derivations have nothing to do with each other. One encodes
--     135.293/.297/.299/.301 calendar-month arithmetic; the other copies a
--     text column across a foreign key. Keeping them separate means each
--     function's comment stays true about what the function does.
--
-- Both are BEFORE ROW triggers on the same table, so Postgres fires them in
-- NAME order: operator_qualifications_compute_expiry, then
-- operator_qualifications_set_operator_name. The order does not matter —
-- neither reads a column the other writes — but it is stated here so a future
-- reader does not have to re-derive it.
--
-- THE NAME TRIGGER CANNOT PERTURB expires_on. It assigns exactly one column,
-- new.operator_name, and never reads or writes completed_on or expires_on.
-- The reverse direction is the one worth proving, because trigger (2) issues
-- a real UPDATE against this table: that UPDATE does not move completed_on,
-- so pilot.compute_operator_qualification_expiry() hits its H1 idempotency
-- gate (`old.completed_on is not distinct from new.completed_on`) and
-- executes `new.expires_on := old.expires_on` — the value is copied through
-- unchanged, not recomputed, and the 135.301(a) early/late branch is never
-- reached. The same holds for the FK's own ON DELETE SET NULL, which is
-- itself an UPDATE on this table and fires both triggers. This is not left as
-- an argument: scripts/account-lifecycle-db-verify.mjs asserts it
-- (QUAL-RENAME and PURGE-2d/HOLD-10d).
--
-- THE UNIQUE INDEXES ARE DELIBERATELY LEFT ALONE, AND DETACHED ROWS FALL
-- OUTSIDE THEM. 20260807110000:323-329 replaced the original
-- unique(account_id, client_id, requirement, type_designator) with two
-- partial unique indexes, both keyed on client_id:
--
--   operator_qualifications_type_specific_uidx
--     (account_id, client_id, requirement, type_designator)
--     where requirement in ('competency_check_135_293b', 'ipc_135_297')
--   operator_qualifications_fixed_uidx
--     (account_id, client_id, requirement)
--     where requirement not in (those two)
--
-- Postgres never treats two NULLs as equal for uniqueness, so once client_id
-- is nullable every DETACHED row is unique-by-default and detached rows can
-- accumulate. That is CORRECT, and it is the reason this migration does not
-- reach for NULLS NOT DISTINCT:
--
--   * What those indexes enforce is "one CURRENT row per (operator,
--     requirement[, type])" — 20260807110000:313-321 and 20260807060000:130-134
--     both say so in as many words. A detached row is not current state for an
--     operator; there is no operator row left for it to be the current state
--     OF. It is an archived historical record of a relationship that ended.
--     Two archived records naming two different purged operators are not a
--     duplicate of anything, and collapsing them under NULLS NOT DISTINCT
--     would DELETE HISTORY — the second purge would fail on a unique
--     violation, or (worse, if anyone "fixed" that by upserting) silently
--     overwrite the first operator's record with the second's.
--   * The 135.301(a) grace in pilot.compute_operator_qualification_expiry()
--     reconstructs "the required month" from OLD.expires_on, and
--     20260807060000:152-155 is explicit that this only works BECAUSE the
--     unique constraint forbids a history of past cycles — the OLD row is
--     guaranteed to be the previous cycle of the SAME requirement for the
--     SAME operator. A detached row can never again be that OLD row: the app
--     reaches a qualification only through its client's detail page
--     (app/(app)/clients/[id]/page.tsx queries .eq("client_id", id)), the
--     save action matches candidates on .eq("client_id", clientId), and
--     client_id is not in authenticated's UPDATE grant, so no pilot can
--     re-attach one (service_role and postgres do hold it; no service-role
--     call site touches this table today). A
--     detached row is therefore permanently outside the 301(a) machinery, and
--     admitting it to the unique index would gain nothing while risking the
--     history loss above.
--
-- THE INVARIANT, ENFORCED BY CHECK. The entire point of the change is that a
-- detached qualification names its operator, so a row that is both detached
-- and unattributable is worthless and must be impossible. operator_name is
-- NOT NULL and constrained non-blank on EVERY row — not merely on detached
-- ones — because "attributable" cannot be a property a row acquires at purge
-- time: by then pilot.clients is gone and there is nothing left to resolve
-- from. See operator_qualifications_operator_name_present below.
--
-- THE FK COLUMN LIST IS LOAD-BEARING, for the sixth time in this repo's
-- history and for the reason 20260810030000's header is titled after: a
-- composite FK's bare `on delete set null` nulls EVERY referencing column,
-- account_id included, and account_id is NOT NULL. Writing this fix without
-- `(client_id)` would swap silent data loss for a 23502 that aborts
-- pilot.expire_hold forever — the same stuck hold with a different error
-- code. `set null (client_id)` clears only the link.
--
-- INTERACTIVELY nothing observable changes: no code path hard-deletes a
-- client (the UI archives), so the only difference is that a lifecycle purge
-- now keeps the qualification history instead of destroying it.
--
-- Replay-safe from scratch and re-runnable against an already-migrated
-- database: every step is `if not exists` / `if exists` / drop-then-add.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — the denormalized column. `default ''` (never NULL, same posture as
-- type_designator on this table) so the ADD COLUMN itself cannot fail on
-- existing rows; STEP 4's CHECK is what makes '' unreachable, and it is added
-- only after STEP 3 has backfilled every row.
-- ---------------------------------------------------------------------------
alter table pilot.operator_qualifications
  add column if not exists operator_name text not null default '';

-- ---------------------------------------------------------------------------
-- STEP 2 — pilot.set_operator_qualification_name(). BEFORE INSERT OR UPDATE.
--
-- ATTACHED (client_id is not null): resolve from pilot.clients.name, always,
-- overwriting whatever the caller sent. The column is not in any INSERT or
-- UPDATE grant for `authenticated` (see STEP 6), so there is no caller-typed
-- value to preserve — this is a derived column with exactly one source, the
-- same discipline expires_on already follows.
--
-- The blank fallback is not decoration. pilot.clients.name is `not null` but
-- carries NO non-blank CHECK (20260805070000:32) — the app trims and rejects
-- an empty name, the schema does not — so a '' client name would otherwise
-- write a '' operator_name and trip STEP 4's CHECK, turning a cosmetic data
-- problem into a failed INSERT for the pilot and, on the purge path, into a
-- 23514 that aborts pilot.expire_hold. Falling back to the client's id keeps
-- the row attributable (the id is still the honest answer to "which
-- operator") and keeps every write path working.
--
-- DETACHED (client_id is null): PRESERVE the name already on the row. This
-- branch is the one the purge actually takes — a composite ON DELETE SET NULL
-- is implemented as an UPDATE on the referencing table, so this trigger fires
-- during `delete from pilot.clients` with new.client_id already null and
-- new.operator_name still holding the resolved name. Re-resolving here would
-- find no client row and blank the very field this migration exists to
-- preserve. An INSERT that arrives already-detached with no name is refused
-- outright rather than silently written as '': it is unattributable at the one
-- moment attribution was still possible.
-- ---------------------------------------------------------------------------
create or replace function pilot.set_operator_qualification_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  resolved text;
begin
  if new.client_id is null then
    -- Detached. Keep what is on the row; on the ON DELETE SET NULL update
    -- that is the name resolved while the client still existed.
    new.operator_name := coalesce(
      nullif(btrim(new.operator_name), ''),
      case when tg_op = 'UPDATE' then nullif(btrim(old.operator_name), '') end
    );
    if new.operator_name is null then
      raise exception
        'operator_qualifications: a qualification with no client_id must name its operator (operator_name is blank)'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select c.name into resolved
    from pilot.clients c
   where c.account_id = new.account_id
     and c.id = new.client_id;

  -- nullif(btrim(...)) covers both "no such client" (the composite FK rejects
  -- that a moment later anyway, but this trigger runs first) and a blank
  -- client name, which the clients table permits.
  new.operator_name := coalesce(
    nullif(btrim(resolved), ''),
    'Operator ' || new.client_id::text
  );
  return new;
end;
$$;

comment on function pilot.set_operator_qualification_name() is
  'Keeps pilot.operator_qualifications.operator_name equal to the owning pilot.clients.name while the row is attached, and preserves it verbatim once client_id is cleared — including during the ON DELETE SET NULL that the lifecycle purge triggers, which is the one moment the value has to be right. Assigns operator_name and nothing else; it can never perturb expires_on. Deliberately NOT folded into pilot.compute_operator_qualification_expiry(): that function returns early for most requirement kinds, so name resolution placed inside it would silently not run. See 20260821120000''s header.';

drop trigger if exists operator_qualifications_set_operator_name
  on pilot.operator_qualifications;
create trigger operator_qualifications_set_operator_name
  before insert or update on pilot.operator_qualifications
  for each row execute function pilot.set_operator_qualification_name();

-- ---------------------------------------------------------------------------
-- STEP 3 — BACKFILL, before any constraint can reject a row.
--
-- Written out explicitly rather than leaning on STEP 2's trigger (a no-op
-- `set operator_name = operator_name` would fire it and reach the same
-- answer) so that what the backfill computes is readable here, in the
-- migration, instead of only in a function body.
--
-- This UPDATE fires operator_qualifications_set_updated_at, so backfilled
-- rows get a fresh updated_at. That is accurate — the row did change — and
-- the alternative (disabling a trigger mid-migration) is worse.
--
-- Restricted to rows that need it, so a re-run against an already-migrated
-- database touches nothing at all.
-- ---------------------------------------------------------------------------
update pilot.operator_qualifications oq
   set operator_name = coalesce(
         nullif(btrim(c.name), ''),
         'Operator ' || oq.client_id::text
       )
  from pilot.clients c
 where c.account_id = oq.account_id
   and c.id = oq.client_id
   and btrim(oq.operator_name) = '';

-- Any row still blank here is one whose client_id does not resolve — which
-- the composite FK makes impossible for an attached row, so in practice this
-- can only be a row that is ALREADY detached (a re-run after a purge, on a
-- database where the name somehow never landed). Name it by account so the
-- CHECK below can be added without deleting anyone's history.
update pilot.operator_qualifications
   set operator_name = 'Operator (name not recorded)'
 where btrim(operator_name) = '';

-- ---------------------------------------------------------------------------
-- STEP 4 — the invariant. A row can never be both detached and
-- unattributable, because it can never be unattributable at all.
-- ---------------------------------------------------------------------------
alter table pilot.operator_qualifications
  drop constraint if exists operator_qualifications_operator_name_present;

alter table pilot.operator_qualifications
  add constraint operator_qualifications_operator_name_present
  check (btrim(operator_name) <> '');

-- ---------------------------------------------------------------------------
-- STEP 5 — client_id nullable, then CASCADE -> SET NULL (client_id).
--
-- Order matters: the column must be nullable before the FK action can be
-- SET NULL, or the first purge raises 23502 instead of detaching.
-- ---------------------------------------------------------------------------
alter table pilot.operator_qualifications
  alter column client_id drop not null;

alter table pilot.operator_qualifications
  drop constraint if exists operator_qualifications_account_id_client_id_fkey;

alter table pilot.operator_qualifications
  add constraint operator_qualifications_account_id_client_id_fkey
  foreign key (account_id, client_id) references pilot.clients (account_id, id)
  on delete set null (client_id);

-- ---------------------------------------------------------------------------
-- STEP 6 — GRANTS. operator_name is WITHHELD from `authenticated` on both
-- INSERT and UPDATE: the trigger owns it outright, exactly as id/created_at/
-- updated_at are withheld because their defaults and triggers own them. A
-- pilot can READ it — the table-wide `grant select ... to authenticated`
-- (20260807060000:395) covers new columns automatically — and cannot write a
-- name that disagrees with the client it is attached to.
--
-- client_id likewise stays out of the UPDATE grant, unchanged from
-- 20260807060000: that is what makes "a detached row can never be re-attached
-- into an inconsistent state" an enforced property rather than a UI
-- convention.
--
-- NEVER `revoke` — the house failure mode is that a REVOKE silently drops
-- column grants. Nothing is revoked here; nothing is added either, and this
-- comment is the record of that being deliberate.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 7 — propagate a client rename. AFTER UPDATE OF name ON pilot.clients.
--
-- Without this, operator_name is a snapshot taken at the qualification's last
-- write and goes stale the first time a pilot corrects an operator's spelling
-- — and the purge, which is the whole reason the column exists, would then
-- engrave the stale spelling permanently.
--
-- SECURITY DEFINER, deliberately: the pilot renaming the client holds no
-- UPDATE grant on operator_qualifications.operator_name (STEP 6, on purpose),
-- so a SECURITY INVOKER trigger would raise 42501 and make renaming a client
-- impossible. Scoped to exactly the rows of the client being renamed, keyed on
-- both halves of the tenant-composite key (account_id AND id) taken from the
-- row Postgres hands the trigger — it can reach no other tenant's data, and it
-- takes no argument a caller could aim somewhere else. `set search_path = ''`
-- and fully-qualified names throughout, per the house rule for every
-- definer-rights function in this schema.
--
-- `when (old.name is distinct from new.name)` keeps it off every other client
-- edit — a contact-phone change must not rewrite qualification rows.
--
-- The UPDATE it issues re-fires this table's own BEFORE triggers.
-- pilot.compute_operator_qualification_expiry() hits its H1 idempotency gate
-- (completed_on is untouched) and copies expires_on through unchanged; the
-- 135.301(a) branch is unreachable. Asserted in
-- scripts/account-lifecycle-db-verify.mjs as QUAL-RENAME.
-- ---------------------------------------------------------------------------
create or replace function pilot.propagate_client_name_to_qualifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Written explicitly rather than as a no-op touch, so what this function
  -- computes is readable here. pilot.set_operator_qualification_name() fires
  -- as a BEFORE trigger on this UPDATE and independently resolves the same
  -- value from the (already renamed) client row -- the two agree by
  -- construction, and the BEFORE trigger is the authority either way.
  update pilot.operator_qualifications
     set operator_name = coalesce(
           nullif(btrim(new.name), ''),
           'Operator ' || new.id::text
         )
   where account_id = new.account_id
     and client_id  = new.id;
  return null;
end;
$$;

comment on function pilot.propagate_client_name_to_qualifications() is
  'Keeps pilot.operator_qualifications.operator_name in step with a renamed pilot.clients.name, so the denormalized name is right at the moment the lifecycle purge detaches the row — the one moment it cannot be re-derived. SECURITY DEFINER because operator_name is deliberately not in any grant for `authenticated`; scoped to (new.account_id, new.id) taken from the trigger row, so it reaches nothing else. See 20260821120000.';

revoke all on function pilot.propagate_client_name_to_qualifications() from public;

drop trigger if exists clients_propagate_name_to_qualifications on pilot.clients;
create trigger clients_propagate_name_to_qualifications
  after update of name on pilot.clients
  for each row
  when (old.name is distinct from new.name)
  execute function pilot.propagate_client_name_to_qualifications();

-- ---------------------------------------------------------------------------
-- STEP 8 — pilot.expirations: say out loud that detached rows are NOT in the
-- ladder.
--
-- The three operator-qualification branches already inner-join pilot.clients,
-- so a detached row drops out silently. That is the right behaviour — an
-- archived record of a relationship that has ended must not generate an
-- "overdue" alert forever for an operator the pilot no longer flies for,
-- which is precisely the false-red failure 20260811020000 was written to stop
-- — but "right behaviour that happens as a side effect of a join" is how it
-- gets un-done by accident. The predicate below makes it a stated rule, and
-- costs nothing (it is implied by the join).
--
-- `create or replace view` matches columns POSITIONALLY and can only APPEND
-- safely. Nothing here adds, removes, reorders or retypes a column — the list
-- is source_table, source_id, account_id, item_kind, item_label, expires_on,
-- days_remaining, ladder_stage, exactly as 20260811020000 left it — so the
-- existing `grant select on pilot.expirations` to authenticated and
-- service_role carry forward untouched and there is no revoke-trap to fall
-- into re-granting them.
-- ---------------------------------------------------------------------------
create or replace view pilot.expirations
with (security_invoker = true) as
  select
    'document'::text                as source_table,
    d.id                            as source_id,
    d.account_id,
    d.kind                          as item_kind,
    d.label                         as item_label,
    d.expires_on,
    (d.expires_on - current_date)   as days_remaining,
    case
      when d.expires_on < current_date                       then 'overdue'
      when d.expires_on <= current_date + 1                  then 't_minus_1'
      when d.expires_on <= current_date + 7                  then 't_minus_7'
      when d.expires_on <= current_date + 14                 then 't_minus_14'
      when d.expires_on <= current_date + 30                 then 't_minus_30'
      else 'ok'
    end                             as ladder_stage
  from pilot.documents d
  where d.expires_on is not null

  union all

  -- Every operator-qualification requirement EXCEPT ipc_135_297: one row per
  -- pilot.operator_qualifications.id, unchanged since 20260807110000.
  select
    'operator_qualification'::text  as source_table,
    oq.id                           as source_id,
    oq.account_id,
    oq.requirement                  as item_kind,
    c.name || ' — ' || (case oq.requirement
      when 'basic_indoc'                 then 'Basic indoctrination'
      when 'initial_training'            then 'Initial training'
      when 'recurrent_training'          then 'Recurrent training'
      when 'written_test_135_293a'       then '135.293(a) written/oral test'
      when 'competency_check_135_293b'   then '135.293(b) competency check'
      when 'line_check_135_299'          then '135.299 line check'
      when 'drug_alcohol_program_120'    then '120.105/120.215 drug & alcohol program'
      when 'prd_consent_111'             then '111.310 PRD consent'
      when 'insurance_approval'          then 'Insurance approval'
      when 'company_manuals'             then 'Company manuals'
      else 'Other requirement'
    end) || (case when oq.type_designator <> '' then ' (' || oq.type_designator || ')' else '' end)
                                     as item_label,
    oq.expires_on,
    (oq.expires_on - current_date)  as days_remaining,
    case
      when oq.expires_on < current_date                       then 'overdue'
      when oq.expires_on <= current_date + 1                  then 't_minus_1'
      when oq.expires_on <= current_date + 7                  then 't_minus_7'
      when oq.expires_on <= current_date + 14                 then 't_minus_14'
      when oq.expires_on <= current_date + 30                 then 't_minus_30'
      else 'ok'
    end                              as ladder_stage
  from pilot.operator_qualifications oq
  join pilot.clients c on c.account_id = oq.account_id and c.id = oq.client_id
  where oq.expires_on is not null
    and oq.requirement <> 'ipc_135_297'
    -- 20260821120000: detached (purged-operator) rows are archived history,
    -- not a live requirement. Implied by the join; stated so it stays true.
    and oq.client_id is not null

  union all

  -- ipc_135_297: exactly ONE synthetic row per (account_id, client_id) — the
  -- row with the latest expires_on. See 20260811020000's header for the
  -- 135.297(a)/(e) rotation reasoning and for why the winner is picked by
  -- expires_on and never by completed_on.
  (
    select distinct on (oq.account_id, oq.client_id)
      'operator_qualification'::text  as source_table,
      oq.id                           as source_id,
      oq.account_id,
      oq.requirement                  as item_kind,
      c.name || ' — 135.297 IPC' ||
        (case when oq.type_designator <> '' then ' (' || oq.type_designator || ')' else '' end)
                                       as item_label,
      oq.expires_on,
      (oq.expires_on - current_date)  as days_remaining,
      case
        when oq.expires_on < current_date                       then 'overdue'
        when oq.expires_on <= current_date + 1                  then 't_minus_1'
        when oq.expires_on <= current_date + 7                  then 't_minus_7'
        when oq.expires_on <= current_date + 14                 then 't_minus_14'
        when oq.expires_on <= current_date + 30                 then 't_minus_30'
        else 'ok'
      end                              as ladder_stage
    from pilot.operator_qualifications oq
    join pilot.clients c on c.account_id = oq.account_id and c.id = oq.client_id
    where oq.expires_on is not null
      and oq.requirement = 'ipc_135_297'
      and oq.client_id is not null
    order by oq.account_id, oq.client_id, oq.expires_on desc, oq.type_designator asc
  );

-- ---------------------------------------------------------------------------
-- STEP 9 — COMMENTS. The prose 20260807060000 shipped is now false in two
-- places and is replaced here rather than left to contradict the schema.
-- ---------------------------------------------------------------------------

-- SUPERSEDES 20260807060000:79-83, which argued client_id must be NOT NULL
-- because "an operator qualification with no operator is a contradiction in
-- terms". The premise was right and the conclusion no longer follows: the row
-- now carries the operator's NAME (operator_name, non-blank on every row), so
-- a detached row still has an operator — it has stopped having a LINK. What
-- made the old reasoning untenable was not the philosophy but the purge: the
-- CASCADE that NOT NULL forced destroyed records three migrations promise are
-- spared.
comment on column pilot.operator_qualifications.client_id is
  'The operator this qualification is held under, while that operator is still a live pilot.clients row. NULLABLE since 20260821120000 and null is a real, terminal state: it means the client was purged by the account lifecycle (20260818200000) and this row is now an ARCHIVED historical record naming its operator through operator_name instead. ON DELETE SET NULL (client_id) — the column list keeps account_id (NOT NULL) out of the SET NULL; the bare composite form would null it and abort the purge with 23502. Not in authenticated''s UPDATE grant, so no pilot can re-attach a detached row or move it to another client — service_role and postgres do hold UPDATE (client_id), and no service-role call site touches this table today. Note the ROW is not read-only: authenticated retains UPDATE on completed_on, status, notes, expires_on, type_designator and document_id, and DELETE, and the RLS policies are account-scoped rather than attachment-scoped — so a direct PostgREST write by id can still edit an archived row even though no app surface reaches one. What is guaranteed here is the LINK, not immutability of the record. This supersedes 20260807060000''s argument that NOT NULL was required because "an operator qualification with no operator is a contradiction in terms" — the row names its operator now, and the CASCADE that NOT NULL forced destroyed Part 135 qualification history on every lapsed billing hold.';

comment on column pilot.operator_qualifications.operator_name is
  'The operator''s name, denormalized from pilot.clients.name so a qualification detached by the lifecycle purge is still attributable. DERIVED, never pilot-typed: pilot.set_operator_qualification_name() (BEFORE INSERT OR UPDATE) resolves it from the client while client_id is set and preserves it verbatim once client_id is cleared, and pilot.propagate_client_name_to_qualifications() (AFTER UPDATE OF name ON pilot.clients) keeps it current across a rename — the app never sends it and holds no grant to. NOT NULL and non-blank on EVERY row (operator_qualifications_operator_name_present), not just detached ones: attributability cannot be acquired at purge time, because by then pilot.clients is gone. Read it as the operator this was recorded under at the time, never as a live reference — for an attached row, pilot.clients.name is the live answer and is identical.';

comment on constraint operator_qualifications_account_id_client_id_fkey on pilot.operator_qualifications is
  'Same-account clients only (composite key). ON DELETE SET NULL (client_id), not CASCADE: operator qualifications are RETAINED by the account-lifecycle purge while clients are deleted (20260818200000), so a lapsed hold must clear the link and keep the qualification — 20260818090000:105-106 and 20260818200000:140-146/306-309 all promise the airman records are spared, and the CASCADE made all three untrue. The detached row stays attributable through operator_name. The column list keeps account_id (NOT NULL) out of the SET NULL; the bare composite form would null it and abort the purge instead. See 20260821120000.';

comment on constraint operator_qualifications_operator_name_present on pilot.operator_qualifications is
  'A qualification can never be unattributable. Enforced on every row rather than only on detached ones, because the name cannot be resolved once the client is purged — see 20260821120000.';

-- 20260807110000's type_designator comment justifies `NOT NULL DEFAULT ''''`
-- by reference to uniqueness, and that justification is UNCHANGED by this
-- migration and remains accurate: operator_qualifications_type_specific_uidx
-- still keys on type_designator for the two class/type-specific requirements,
-- and a NULL there would still let duplicates pile up because Postgres never
-- treats two NULLs as equal. (The ORIGINAL 20260807060000 wording — which
-- cited a single table-wide unique constraint covering every requirement —
-- was already superseded by 20260807110000, not by this migration.) The one
-- sentence worth adding is what nullable client_id does to those indexes.
comment on column pilot.operator_qualifications.type_designator is
  'Aircraft class/type designator (e.g. CE-560XL). REQUIRED (non-blank) for competency_check_135_293b and ipc_135_297 — 135.293(b) is class/type-specific and 135.297(e) rotates by type when a pilot is assigned more than one; those two requirements are repeatable, one row per class/type. OPTIONAL and purely informational for every other requirement, INCLUDING line_check_135_299 — 135.299(a) is answered by one check in any one type, so its type_designator records which type that was, not a separate requirement per type. Defaults to '''' (never NULL) so operator_qualifications_type_specific_uidx actually enforces one row per class/type; a nullable column here would have let duplicate rows exist since Postgres never treats two NULLs as equal for uniqueness. Corrected 20260807110000: the original version of this comment and its CHECK constraint had the type-specificity exactly backwards — see that migration''s header. Note (20260821120000) that BOTH partial unique indexes also key on client_id, which is now nullable, so DETACHED rows fall outside them by the same NULL-distinctness rule — deliberately: a detached row is archived history, not current state for an operator.';

comment on table pilot.operator_qualifications is
  'What the pilot has been told/shown by an operator about their standing on THAT operator''s Part 135 certificate — NOT a determination that they are on the certificate, and the app copy must never read as one. The 135.293/135.297/135.299 valid-through dates are a planning aid, not a determination of regulatory compliance (20260807110000). drug_alcohol_program_120 and prd_consent_111 rows are status the pilot noted (120.105/120.215 and 111.310/111.120 bind the OPERATOR or the pilot''s own consent action, never a determination this product computes or verifies) and are never computed or verified by this product. RETAINED by the account-lifecycle purge (20260818200000): since 20260821120000 a purged client leaves these rows in place with client_id cleared and operator_name preserved, as archived, read-only qualification history.';

comment on view pilot.expirations is
  'A1/C4: the single expiry ladder. Every date-bearing row type in schema pilot MUST be unioned in here -- pilot.expiration_coverage_gaps() proves it, and tenancy:verify fails if it is not empty. security_invoker so the underlying tables'' RLS still applies. source_table distinguishes ''document'' (pilot.documents) from ''operator_qualification'' (pilot.operator_qualifications, added 20260807060000, corrected 20260807110000) -- read this as evidence the pilot recorded, never as a legality or on-the-certificate determination, and (for the derived kinds) as a planning aid rather than a compliance determination. ipc_135_297 is the one exception to "one row per qualification row": 20260811020000 unions exactly one synthetic row per (account_id, client_id) -- the row with the latest expires_on -- because 135.297(a)''s 6-calendar-month window is not type-indexed and a pilot legitimately rotating types per 135.297(e) has exactly one row that is actually current at any moment; see that migration''s header, and operator-qualification-kinds.ts''s currentIpcRotationId() for the client-side mirror of the same rule. Operator qualifications DETACHED by the lifecycle purge (client_id null, 20260821120000) are excluded from the ladder: they are archived history of an operator relationship that has ended, and a permanent "overdue" alert for a purged operator is exactly the false red 20260811020000 exists to prevent.';
