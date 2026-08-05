-- Phase 4 — receipt storage.
--
-- Expenses already exist (20260805070000). What was missing is somewhere
-- to put the receipt image `pilot.expenses.receipt_path` points at.
--
-- WHY A PRIVATE BUCKET, NOT A PUBLIC ONE: a receipt carries the pilot's
-- client, route, dates and card detail. A public bucket serves any object
-- to anyone who learns its URL, and object names are guessable enough
-- that "nobody will find it" is not a control. Private + short-lived
-- signed URLs means the read goes through an authorization check every
-- time.
--
-- TENANCY: storage.objects is NOT in the `pilot` schema and carries no
-- account_id, so the tenant key has to live in the object NAME. The
-- convention is:
--
--     <account_id>/<expense_id>/<filename>
--
-- and every policy below checks that the FIRST path segment is an account
-- the caller belongs to. That makes the same `pilot.current_account_ids()`
-- helper the single source of tenancy for storage as for every table —
-- there is deliberately no second mechanism to keep in sync.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  -- 10 MB. A phone photo of a hotel folio is ~2-5 MB; this leaves room
  -- for a multi-page PDF without allowing an upload that could be used to
  -- exhaust the project's storage quota in a few requests.
  10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Policies. storage.objects already has RLS enabled by Supabase; these add
-- the tenant scoping for this bucket only. Each is restricted to
-- bucket_id = 'receipts' so nothing here widens access to any other
-- bucket a later phase adds.
--
-- `(storage.foldername(name))[1]` is the first path segment. It is
-- compared against pilot.current_account_ids(), the same SECURITY DEFINER
-- helper every table policy uses — so a pilot removed from an account
-- loses their receipts at exactly the moment they lose the rows.
-- ---------------------------------------------------------------------------

drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select a::text from pilot.current_account_ids() a
    )
  );

-- WITH CHECK on insert, or a tenant could write an object into another
-- tenant's folder and then be unable to see it — the write is the
-- dangerous half, not the read.
drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select a::text from pilot.current_account_ids() a
    )
  );

-- USING *and* WITH CHECK: without the second clause an update could move
-- an object from the caller's folder into someone else's, which is the
-- storage equivalent of re-parenting a row.
drop policy if exists receipts_update on storage.objects;
create policy receipts_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select a::text from pilot.current_account_ids() a
    )
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select a::text from pilot.current_account_ids() a
    )
  );

drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select a::text from pilot.current_account_ids() a
    )
  );

-- ---------------------------------------------------------------------------
-- pilot.stripe_events — grant correction.
--
-- The Phase 2 migration states this table is "never readable by
-- authenticated: RLS is enabled with NO policy for that role, and no
-- grant is issued to it", and docs/BILLING.md repeats that. The live
-- database disagreed: `authenticated` holds SELECT, almost certainly from
-- ALTER DEFAULT PRIVILEGES on the schema rather than from anything
-- written down.
--
-- Nothing leaked — RLS is on with no permissive policy, so every read
-- returns zero rows regardless. But a guarantee that is documented and
-- not enforced is one refactor away from being neither, and the cheapest
-- moment to close that gap is while it is still harmless.
-- ---------------------------------------------------------------------------
revoke all on pilot.stripe_events from authenticated;
