-- ===========================================================================
-- Saving a trip's days becomes ONE transaction
--
-- WHAT THIS IS. One SECURITY DEFINER function, pilot.trip_days_save, and its
-- grant. No table, column, constraint, policy, trigger or table-grant change
-- anywhere in this file.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM (audit SQL-10, confirmed)
-- ---------------------------------------------------------------------------
-- app/(app)/trips/actions.ts's saveTripDays wrote a trip's days as N+2
-- separate PostgREST requests: one `.in()` delete for the dates the pilot
-- cleared, one array `.insert()` for the dates that gained a row, and then
-- ONE `.update()` per changed day. The updates were issued through
-- Promise.all, so the defect was never latency — a trip is bounded by its
-- own date range and those statements ran concurrently and each bound all
-- three columns of trip_days_trip_idx.
--
-- The defect is ATOMICITY. Every one of those requests is its own implicit
-- transaction. Promise.all makes them concurrent; it does not make them one.
-- So if update 3 of 7 was refused — a rate that trips a check, a day type
-- deleted from another tab, the trip committed to an invoice between the
-- action's precheck and the write, a dropped connection — updates 1 and 2
-- had ALREADY COMMITTED. The action returned "Some day rows didn't save.
-- Refresh and try again." while the trip sat half-saved: some days carrying
-- the pilot's new rates, some carrying the old ones, and no way to tell them
-- apart by looking. That message is DETECTION AFTER PARTIAL DAMAGE. On a
-- grid that decides what a client is billed, a half-applied save is worse
-- than a refused one, because the refused one is obvious.
--
-- Inside this function the delete, the insert and every update are one
-- statement sequence in one transaction. A failure at any point — including
-- a trigger raising on the seventh row — rolls back the delete and the
-- insert and the six updates that preceded it. Either the save happened or
-- it did not.
--
-- ---------------------------------------------------------------------------
-- WHY SECURITY DEFINER, AND THE TRAP THAT COMES WITH IT
-- ---------------------------------------------------------------------------
-- Same reasoning as pilot.bank_transaction_confirm (20260810040000) and
-- pilot.invoice_share_create (20260809060000): a narrow, named door that
-- re-derives the caller from auth.uid(), not a second privileged entry point
-- in the sense lib/supabase/service-role.ts's header guards against. Nothing
-- here is reachable except through this one function with these five
-- arguments.
--
-- But SECURITY DEFINER runs the body as the function's OWNER, and that has
-- two consequences this file has to answer for by hand, because the two
-- protections it steps around are exactly the two that were doing the work:
--
--   (1) RLS DOES NOT APPLY. The owner also owns pilot.trip_days, and the
--       table-owner exemption means trip_days_select/insert/update/delete
--       never run. Answered by the membership check at the top of the body
--       (`pilot.current_account_ids()`) plus binding account_id and trip_id
--       to the PARAMETERS, never to anything in the payload, on every one of
--       the three statements. Same shape as every other DEFINER function in
--       this schema.
--
--   (2) THE COLUMN-LEVEL UPDATE GRANT DOES NOT APPLY. This is the one that
--       is easy to miss and expensive to get wrong, and it is the reason the
--       audit's verifier flagged this fix rather than just endorsing it.
--
--       pilot.trip_days deliberately has NO table-wide UPDATE grant. What
--       `authenticated` holds is column-scoped, assembled across three
--       migrations:
--
--         20260807000000:  grant update (day_on, day_type_id, rate_cents,
--                            notes) on pilot.trip_days to authenticated;
--         20260807020000:  grant update (quantity) ...
--         20260807070000:  grant update (units) ..., grant update (away) ...
--
--       id, account_id, trip_id, created_at and updated_at are withheld —
--       account_id and trip_id most of all, because they are the tenancy and
--       parentage keys. RLS has no column granularity anywhere in Postgres,
--       so that grant is the ONLY layer in this schema expressing "a tenant
--       may edit what a day says, never which account or which trip it
--       belongs to." saveTripDays's own comment records what enforcement
--       felt like from the app side: a single PostgREST `.upsert()` 42501s
--       on its conflict path precisely because ON CONFLICT DO UPDATE names
--       account_id and trip_id in its SET list, and Postgres checks UPDATE
--       privilege on every column named there even when the incoming value
--       is byte-identical to the stored one.
--
--       Executing as the owner, that check is simply not made. So the
--       careless version of this function — take a jsonb payload, hand it to
--       jsonb_populate_record, update from the result — would hand every
--       caller the ability to rewrite account_id and trip_id on an existing
--       row: move another tenant's day onto your trip, or your day onto
--       another tenant's. The grant that forbids that absolutely today would
--       be gone and nothing would have replaced it.
--
--       THE RE-IMPOSITION IS THE SHAPE OF THE UPDATE STATEMENT, and it is
--       deliberately boring: an explicit SET list naming the same six
--       columns and no others. There is no spread, no wildcard, no
--       jsonb_populate_record, no dynamic SQL, nothing that can be widened
--       by the shape of a payload. The payload is destructured through
--       jsonb_to_recordset with a fixed column list, so a key the recordset
--       does not name (`account_id`, `trip_id`, `id`, `created_at`, an
--       invented one) is not merely rejected — it has nowhere to land, and
--       adding one to the payload changes nothing about the statement that
--       runs. day_on appears only in the WHERE clause: it identifies the
--       row, and the old code never moved it either (moving a day is a
--       clear-plus-add through the grid, which is a delete and an insert).
--       The insert has the same property: account_id and trip_id come from
--       the PARAMETERS, not from the payload.
--
--       Read the two write statements below as the specification. If a
--       future edit needs a seventh editable column, it must be added to the
--       table's column-level grant AND to the SET list here, together, or
--       the two layers disagree.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY UNCHANGED
-- ---------------------------------------------------------------------------
-- NO TRIGGER IS DROPPED, WEAKENED OR ROUTED AROUND. All three still fire on
-- every row this function writes, and this is not an assumption — it is a
-- property of how SECURITY DEFINER interacts with each:
--
--   trip_days_validate_within_trip (20260807000000) is BEFORE INSERT OR
--     UPDATE OF day_on, trip_id. Every inserted row still passes through it.
--     The UPDATE below sets neither day_on nor trip_id, so it does not fire
--     there — exactly as it did not fire for the old per-day .update(),
--     which also named neither. Behaviour preserved, not bypassed.
--
--   trip_days_protect_billed (rewritten 20260807020000) is BEFORE INSERT OR
--     UPDATE OR DELETE and refuses any write to a trip committed to a live
--     invoice. It is SECURITY INVOKER and its escape hatch tests
--     `current_user = 'service_role' or current_setting('role', true) =
--     'service_role'`. THIS IS THE CHECK TO THINK ABOUT, because 20260807020000's
--     own header warns that inside a SECURITY DEFINER function current_user
--     reports the OWNER — "a mistake this build has already made once and
--     does not intend to make again." Here it is safe, and for a reason
--     worth writing down rather than trusting: the owner of these functions
--     is the migration role (postgres), NOT service_role, so current_user
--     inside this body is 'postgres' and the first disjunct is false. The
--     second disjunct reads the `role` GUC, which PostgREST sets with
--     `set local role authenticated` and which SECURITY DEFINER does not
--     touch — it still reads 'authenticated'. So the guard fires for a
--     pilot's save through this function exactly as it fired for the four
--     PostgREST writes it replaces. The invariant this depends on is
--     "pilot.* functions are not owned by service_role", which is true of
--     every function in this schema; if that ever changes, this guard and
--     every other one in the schema break together, not just this one.
--
--   trip_days_set_updated_at fires on the UPDATE as before.
--
-- The composite FKs (account_id, trip_id) -> pilot.trips and (account_id,
-- day_type_id) -> pilot.day_types, the unique (account_id, trip_id, day_on),
-- and the quantity/units/rate_cents CHECKs all still apply — the function
-- writes ordinary DML against the table, it does not defer or disable
-- anything.
--
-- EXACT-COUNT SEMANTICS ARE KEPT AND MADE STRICTER. The old code checked
-- `count !== 1` per update and `insertCount !== toInsert.length`, after the
-- fact, and reported. This raises instead, inside the transaction, so the
-- report is also a rollback:
--
--   * insert: rows inserted must equal the payload length.
--   * update: rows updated must equal the payload length, and the payload
--     may not name the same day twice — without that second check a payload
--     of two entries for one date would update one row twice in one
--     statement, count as 1, and the length comparison alone would call that
--     a mismatch for the wrong reason. Both raise P0002.
--   * delete: no count is asserted, matching today. Most cleared dates never
--     had a row, so zero is the normal case; only an error is a failure.
--
-- P0002 is this schema's existing "not found / not yours" code
-- (20260809050000, 20260819100000, 20260820100000). saveTripDays maps it
-- back to the same sentence the pilot used to get — the difference is that
-- now nothing was written when they read it.
--
-- revalidatePath and every other post-save side effect stay in the server
-- action, after this returns. Nothing about page caching moved into SQL.
--
-- Replay-safe from scratch and re-runnable against an already-migrated
-- database: `create or replace function`, then a revoke/grant pair that is
-- idempotent by definition.
-- ===========================================================================

create or replace function pilot.trip_days_save(
  p_account_id  uuid,
  p_trip_id     uuid,
  p_clear_dates date[],
  p_insert      jsonb,
  p_update      jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected int;
  v_actual   int;
  v_distinct int;
begin
  -- (1) Tenancy. RLS is not running (owner exemption), so this IS the
  -- boundary. 42501 rather than P0002: friendlyDbError already renders that
  -- code as "That change isn't allowed on this record.", and a caller who
  -- is not a member of the account should learn nothing about whether the
  -- trip exists.
  if p_account_id is null or p_trip_id is null then
    raise exception 'trip_days_save: account and trip are both required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from pilot.current_account_ids() a where a = p_account_id
  ) then
    raise exception 'trip_days_save: not a member of account %', p_account_id
      using errcode = '42501';
  end if;

  -- (2) The trip must exist under that account. The composite FK would catch
  -- an insert against a foreign trip, but the delete and the update would
  -- simply match nothing and — for the delete, whose zero count is legal —
  -- read as success. Say so plainly instead. The action checks this before
  -- calling; this backstops the race where the trip is deleted in between.
  if not exists (
    select 1 from pilot.trips
    where account_id = p_account_id and id = p_trip_id
  ) then
    raise exception 'trip_days_save: trip % not found in account %',
      p_trip_id, p_account_id
      using errcode = 'P0002';
  end if;

  -- (3) Payload shape. jsonb_to_recordset raises on a non-array anyway; this
  -- fails earlier with a code the app can render.
  if p_insert is not null and jsonb_typeof(p_insert) <> 'array' then
    raise exception 'trip_days_save: p_insert must be a json array'
      using errcode = '22023';
  end if;
  if p_update is not null and jsonb_typeof(p_update) <> 'array' then
    raise exception 'trip_days_save: p_update must be a json array'
      using errcode = '22023';
  end if;

  -- (4) DELETE — dates the pilot cleared. Scoped to this account and trip
  -- and to the listed dates, exactly as the old `.in()` was. A zero count is
  -- expected and fine: most cleared dates never had a row.
  if p_clear_dates is not null and array_length(p_clear_dates, 1) > 0 then
    delete from pilot.trip_days
     where account_id = p_account_id
       and trip_id    = p_trip_id
       and day_on     = any (p_clear_dates);
  end if;

  -- (5) INSERT — dates that gained a row. account_id and trip_id come from
  -- the PARAMETERS (already checked against current_account_ids above), so a
  -- payload cannot smuggle a different tenant or trip into a new row. Every
  -- other column is named explicitly and comes from a fixed recordset
  -- column list; a key that list does not name has nowhere to land.
  if p_insert is not null and jsonb_array_length(p_insert) > 0 then
    v_expected := jsonb_array_length(p_insert);

    insert into pilot.trip_days
      (account_id, trip_id, day_on, day_type_id, rate_cents, quantity, units, away, notes)
    select
      p_account_id,
      p_trip_id,
      i.day_on,
      i.day_type_id,
      i.rate_cents,
      i.quantity,
      i.units,
      i.away,
      i.notes
    from jsonb_to_recordset(p_insert) as i(
      day_on      date,
      day_type_id uuid,
      rate_cents  bigint,
      quantity    numeric(3,1),
      units       numeric(3,2),
      away        boolean,
      notes       text
    );

    get diagnostics v_actual = row_count;
    if v_actual <> v_expected then
      raise exception
        'trip_days_save: inserted % day row(s), expected %', v_actual, v_expected
        using errcode = 'P0002';
    end if;
  end if;

  -- (6) UPDATE — the changed days.
  --
  -- THIS STATEMENT IS THE RE-IMPOSED COLUMN GRANT. `authenticated` holds
  -- UPDATE on seven columns (day_on, day_type_id, rate_cents, quantity,
  -- units, away, notes); the SET list below names six of them — every one
  -- saveTripDays has ever written (day_type_id, rate_cents, quantity, units,
  -- away, notes) — and nothing else. It is a strict subset of the grant, not
  -- the whole of it: day_on is grantable but deliberately excluded, because
  -- it identifies the row (it's in the WHERE, not the SET) — moving a day
  -- has always been a clear-and-add (a delete plus an insert), never an
  -- update. account_id, trip_id, id, created_at and updated_at are absent
  -- from the list and cannot be reached: the recordset below does not
  -- expose them, so no payload key of those names has anywhere to go, and
  -- there is no spread, wildcard, populate_record or dynamic SQL through
  -- which the list could widen.
  --
  -- The WHERE also pins account_id and trip_id to the checked parameters, so
  -- this can only ever touch rows of this trip, in this caller's account.
  if p_update is not null and jsonb_array_length(p_update) > 0 then
    v_expected := jsonb_array_length(p_update);

    -- One date may appear only once. Two entries for the same day would
    -- update one row once, and the length check below would then blame the
    -- wrong thing.
    select count(distinct u.day_on) into v_distinct
    from jsonb_to_recordset(p_update) as u(day_on date);
    if v_distinct <> v_expected then
      raise exception
        'trip_days_save: the same day appears more than once in the update payload'
        using errcode = 'P0002';
    end if;

    update pilot.trip_days td
       set day_type_id = u.day_type_id,
           rate_cents  = u.rate_cents,
           quantity    = u.quantity,
           units       = u.units,
           away        = u.away,
           notes       = u.notes
      from jsonb_to_recordset(p_update) as u(
        day_on      date,
        day_type_id uuid,
        rate_cents  bigint,
        quantity    numeric(3,1),
        units       numeric(3,2),
        away        boolean,
        notes       text
      )
     where td.account_id = p_account_id
       and td.trip_id    = p_trip_id
       and td.day_on     = u.day_on;

    get diagnostics v_actual = row_count;

    -- Every entry came from a row the action had just read back, so the
    -- expected count is exactly the payload length — not "at least one",
    -- not "any". Anything else means a row the pilot edited was not there
    -- to receive the edit, and the whole save rolls back rather than
    -- landing the rest of it.
    if v_actual <> v_expected then
      raise exception
        'trip_days_save: updated % day row(s), expected %', v_actual, v_expected
        using errcode = 'P0002';
    end if;
  end if;
end;
$$;

revoke all on function pilot.trip_days_save(uuid, uuid, date[], jsonb, jsonb) from public;
grant execute on function pilot.trip_days_save(uuid, uuid, date[], jsonb, jsonb) to authenticated;

comment on function pilot.trip_days_save(uuid, uuid, date[], jsonb, jsonb) is
  'Saves one trip''s day grid as ONE transaction: the delete of cleared dates, the insert of new dates and every per-day update, all or nothing. Replaces N+2 separate PostgREST requests whose gaps were real — Promise.all made them concurrent, not atomic, so a failure on the seventh update left the first six committed and the trip half-saved behind a "Some day rows didn''t save" message. SECURITY DEFINER, so neither RLS nor pilot.trip_days''s column-level UPDATE grant applies inside: the membership check on pilot.current_account_ids() replaces the former, and the explicit six-column SET list (day_type_id, rate_cents, quantity, units, away, notes — never account_id, trip_id, id or created_at, and never a populate_record spread) replaces the latter. All three trip_days triggers still fire; the function owner is not service_role, so trip_days_protect_billed''s escape hatch does not match.';
