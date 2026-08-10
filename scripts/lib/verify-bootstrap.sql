-- ===========================================================================
-- The scaffold every DB-backed verify script replays before the migrations
--
-- WHY THIS FILE IS IN THE REPO NOW. Six verify scripts each take a
-- <NAME>_VERIFY_BOOTSTRAP environment variable pointing at "a Supabase-shaped
-- scaffold", and until now no such file shipped — so the database half of
-- every one of them SKIPPED in CI, and the suite printed a pass having
-- asserted none of the RLS refusals, none of the CHECK constraints, and
-- neither side of the two-tenant isolation gate. A verification that silently
-- tests nothing is worse than one that is absent, because it reads as
-- coverage. This file is what makes those halves runnable by anyone.
--
-- WHAT IT IS. The parts of a Supabase database the migrations depend on but do
-- not create: the three roles, an auth schema with the auth.uid() the RLS
-- policies read, pgcrypto in an extensions schema, and a storage stub. It is
-- deliberately minimal — a scaffold has to satisfy exactly what is under test
-- and nothing more, because every extra guess about Supabase's real shape is a
-- way for a local run to disagree with production.
--
-- auth.users carries instance_id/aud/role/created_at/updated_at because the
-- verify scripts insert them. It began as a two-column stub and three suites
-- failed on the missing columns; that is the only reason the list is what it
-- is. Do not add columns speculatively.
--
-- THIS IS NOT A MIGRATION and must never become one. Supabase creates all of
-- this itself. Nothing here runs against any hosted project.
-- ===========================================================================

-- Minimal Supabase-shaped scaffold for locally testing scripts/*-verify.mjs
-- scratch-DB harness. NOT part of the repo; not a deliverable.

create schema if not exists auth;
-- Shaped to match the columns the verify scripts actually insert. Supabase's
-- real auth.users has many more, but a scaffold only has to satisfy the
-- inserts under test; the three suites that failed here were inserting
-- instance_id/aud/role/created_at/updated_at into a two-column stub.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    (current_setting('request.jwt.claims', true)::json ->> 'sub'),
    ''
  )::uuid
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- The migrations call extensions.gen_random_bytes() from SECURITY INVOKER
-- paths (the share-token generators), so the app roles need to reach the
-- schema. Without this, invoice-share:verify dies with "permission denied for
-- schema extensions" partway through — which reads like a product bug and is
-- not one.
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- storage stub
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql immutable
as $$
  select string_to_array(name, '/');
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated, service_role;
