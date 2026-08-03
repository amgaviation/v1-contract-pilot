-- Pin `search_path` on the two plain trigger functions added in
-- 20260802190437_pilot_schema_tenancy.sql.
--
-- Why this exists as a separate migration rather than a fix folded into
-- the original: the original was already applied to the live project when
-- Supabase's own database linter (`get_advisors`) flagged both functions
-- with `function_search_path_mutable`. Editing an applied migration in
-- place would put the repo and the database into exactly the drift this
-- file exists to prevent.
--
-- What the finding actually is: a function without a pinned `search_path`
-- resolves unqualified names against whatever `search_path` the *calling*
-- session happens to have. For a SECURITY DEFINER function that is a
-- privilege-escalation vector — an attacker who can create a schema
-- earlier in the caller's search_path can shadow a table or operator the
-- function references and have it run with the definer's rights. Neither
-- function below is SECURITY DEFINER, so the escalation path does not
-- apply to them; the risk here is the milder one of a trigger silently
-- resolving `now()` or a type against an unexpected schema. Pinned anyway,
-- because the cost is one line and "this one is fine" is how the habit
-- erodes — the original migration already pins it on
-- pilot.current_account_ids() and pilot.is_account_owner(), which ARE
-- SECURITY DEFINER and where it is load-bearing.
--
-- `set search_path = ''` (empty, not a schema list) forces every reference
-- inside the body to be schema-qualified or fail loudly. Both bodies below
-- reference only `new`/`old` records and `now()` (a pg_catalog builtin,
-- always resolvable regardless of search_path), so neither needs a
-- qualification change to keep working.

create or replace function pilot.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function pilot.protect_account_billing_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'service_role' and (
    new.plan is distinct from old.plan or
    new.status is distinct from old.status or
    new.seat_count is distinct from old.seat_count or
    new.trial_ends_at is distinct from old.trial_ends_at or
    new.stripe_customer_id is distinct from old.stripe_customer_id or
    new.stripe_subscription_id is distinct from old.stripe_subscription_id or
    new.connect_account_id is distinct from old.connect_account_id or
    new.kind is distinct from old.kind
  ) then
    raise exception
      'pilot.accounts billing/entitlement columns can only be changed by service_role';
  end if;
  return new;
end;
$$;
