-- Phase 9 Layer 1 — the same mistake, twice in one file.
--
-- 20260807020000 section 4 exists because two guard triggers fired inside
-- the cascade from `delete from pilot.accounts` and blocked tenant deletion —
-- the only offboarding and erasure primitive there is. It fixed both by
-- adding a "the parent is already gone, so this is a cascade" branch:
--
--   if not exists (select 1 from pilot.accounts where id = old.account_id)
--   then return old; end if;
--
-- And then, three sections later, that same migration added a THIRD guard —
-- day_types_protect_builtin_delete — without it. Every account carries four
-- is_builtin rows from the seeding trigger, and pilot.day_types.account_id
-- cascades from pilot.accounts, so deleting a tenant raised
--
--   23514  This is one of the starting day types and cannot be deleted.
--
-- mid-cascade. Exactly the CRITICAL the file claimed to close, relocated
-- from the trip guards to the day-type guard, in the same commit.
--
-- Found because the verification asked the question twice — once as
-- service_role and once as `postgres`. Only the service_role path was
-- exempt, and `postgres` in the SQL editor is precisely how an operator
-- would run an account deletion today, since no app code path exists for it.
-- A test that had checked only the privileged role would have reported PASS.
--
-- THE LESSON, which is the reason this is its own migration rather than a
-- quiet amendment: a guard added to a table that CASCADES FROM ANOTHER must
-- answer "what happens when my parent is being deleted?" — and a
-- service_role exemption is not that answer, because the cascade runs as
-- whoever issued the delete. Any future BEFORE DELETE trigger on a
-- tenant-scoped table in this schema needs both branches, not one.

create or replace function pilot.day_types_protect_builtin_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return old;
  end if;

  -- The account row is already gone, so this delete is a cascade from
  -- pilot.accounts — the tenant is being removed, not their vocabulary
  -- edited. Postgres deletes the parent row before running the referential
  -- action, which is what makes this check reliable.
  if not exists (select 1 from pilot.accounts where id = old.account_id) then
    return old;
  end if;

  if old.is_builtin then
    raise exception
      'This is one of the starting day types and cannot be deleted. Archive it instead — archived types stay on the trips that already use them.'
      using errcode = '23514';
  end if;

  return old;
end;
$$;

-- Defence in depth on the one function 20260807020000 made SECURITY DEFINER.
-- It returns `trigger`, so Postgres already refuses to invoke it outside
-- trigger context ("trigger functions can only be called as triggers",
-- verified live) and it is not callable via PostgREST. This revoke costs
-- nothing, removes the standing advisor warning, and means the protection
-- does not depend on a return-type technicality staying true.
revoke all on function pilot.invoices_sync_trip_billing_state() from public;
