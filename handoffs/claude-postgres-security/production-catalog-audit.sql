\set ON_ERROR_STOP on
\pset pager off

-- Metadata-only hosted audit. The transaction-level guard prevents accidental
-- DML even if this file is edited or included from another script later.
begin transaction read only;

\echo '=== Context (never prints the connection string) ==='
select current_database() as database_name,
       current_user as audit_role,
       current_setting('server_version') as postgres_version;

\echo '=== FAIL if non-empty: pilot tables without RLS ==='
select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'pilot'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity
order by c.relname;

\echo '=== FAIL if non-empty: pilot materialized views ==='
select c.relname as materialized_view
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'pilot' and c.relkind = 'm'
order by c.relname;

\echo '=== FAIL if non-empty: pilot views without security_invoker ==='
select c.relname as view_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'pilot'
  and c.relkind = 'v'
  and not coalesce(
    (select option_value::boolean
     from pg_options_to_table(c.reloptions)
     where option_name = 'security_invoker'),
    false
  )
order by c.relname;

\echo '=== Review: RLS policy inventory ==='
select tablename, policyname, permissive, roles, cmd,
       qual is not null as has_using,
       with_check is not null as has_with_check
from pg_policies
where schemaname = 'pilot'
order by tablename, policyname;

\echo '=== Review: direct table privileges for request-facing roles ==='
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'pilot'
  and lower(grantee) in ('anon', 'authenticated', 'public')
order by table_name, grantee, privilege_type;

\echo '=== FAIL/justify each: SECURITY DEFINER without pinned search_path ==='
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'pilot'
  and p.prosecdef
  and not exists (
    select 1
    from unnest(coalesce(p.proconfig, array[]::text[])) setting
    where setting like 'search_path=%'
  )
order by p.proname, arguments;

\echo '=== Review: effective request-role EXECUTE on pilot functions (includes PUBLIC grants) ==='
select r.rolname as effective_grantee,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (
  select rolname from pg_roles where rolname in ('anon', 'authenticated')
) r
where n.nspname = 'pilot'
  and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
order by p.proname, arguments, effective_grantee;

\echo '=== Review: storage bucket exposure and limits (no object rows) ==='
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

rollback;
