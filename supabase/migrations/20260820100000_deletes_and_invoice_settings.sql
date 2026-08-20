-- ---------------------------------------------------------------------------
-- DELETES THE PILOT ASKED FOR, AND THE INVOICE SETTINGS AROUND THEM.
--
-- Two unrelated-looking halves, in one migration because they are the same
-- request: "let me tidy up my own data, and let me control how my invoices
-- are numbered and worded."
--
-- WHAT THIS DOES NOT DO, and why. Every delete here is scoped so that it
-- can only remove a row whose removal destroys no financial record:
--
--   * pilot.invoices  — DRAFTS ONLY, enforced in the POLICY, not in the
--     application. A number, once minted, never changes and never
--     disappears: an issued invoice is a document a client has, a tax
--     authority may ask about, and pilot.invoice_payments references with
--     ON DELETE RESTRICT. Cancelling one is `void` (see voidInvoice), which
--     keeps the number and says what happened. A draft has no number, no
--     payments and no reminder history — it is a piece of paper nobody has
--     seen, and there is no reason a pilot should have to void one.
--
--   * pilot.aircraft  — the previous policy was `using (false)`: a
--     deliberate refusal, on the grounds that "an airframe a pilot flew is
--     part of how their history reads." That reasoning holds for a tail
--     that HAS flown, and only for that tail. Nothing has a foreign key to
--     this table — the logbook joins by derived tail_key on the entry's own
--     `aircraft_ident` text — so deleting a registry row silently strips
--     type and category off historic entries rather than failing. The
--     database cannot see that join, so the application must: the
--     deleteAircraft action refuses when any logbook entry or trip carries
--     the tail, and this policy exists so the ones that carry nothing can
--     actually go. A typo'd tail added five minutes ago is the case.
--
--   * pilot.crew_members — nothing references this table at all (its own
--     migration says so), so a delete here loses exactly the row asked for.
--
-- pilot.clients already had both the policy and the grant; the FK web around
-- it is ON DELETE RESTRICT from trips, invoices, estimates and recurring
-- schedules, so the database already refuses to delete a client with any
-- billing history. The application pre-checks it only to say which one.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- INVOICES: delete a draft, never anything else.
--
-- THE STATUS PREDICATE IS IN THE POLICY ON PURPOSE. Putting it only in the
-- server action would make "you cannot delete an issued invoice" a property
-- of one TypeScript function — one that any future caller, or a raw
-- PostgREST request with the tenant's own token, walks straight past. Here
-- it is a property of the table.
--
-- `invoice_number is null` is redundant with `status = 'draft'` today
-- (invoices_assign_number_on_issue assigns on the transition out of draft,
-- and invoices_protect_issued forbids the return trip) and is kept anyway:
-- the cost is nothing, and it means a row that somehow holds a number is
-- undeletable even if the status column is ever wrong.
-- ---------------------------------------------------------------------------
drop policy if exists invoices_delete on pilot.invoices;
create policy invoices_delete on pilot.invoices for delete to authenticated
  using (
    account_id in (select pilot.current_account_ids())
    and status = 'draft'
    and invoice_number is null
  );

grant delete on pilot.invoices to authenticated;

-- ---------------------------------------------------------------------------
-- AIRCRAFT: replace the blanket refusal. See this file's header for why the
-- "has it flown?" half of the rule cannot live here.
-- ---------------------------------------------------------------------------
drop policy if exists aircraft_delete on pilot.aircraft;
create policy aircraft_delete on pilot.aircraft for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

grant delete on pilot.aircraft to authenticated;

comment on policy aircraft_delete on pilot.aircraft is
  'Tenancy only. The "no logbook entry or trip uses this tail" half of the rule is enforced in deleteAircraft, because the logbook joins this table by derived tail_key rather than by foreign key and the database therefore cannot see the reference.';

-- ---------------------------------------------------------------------------
-- CREW: nothing references it, so nothing can be orphaned.
-- ---------------------------------------------------------------------------
drop policy if exists crew_members_delete on pilot.crew_members;
create policy crew_members_delete on pilot.crew_members for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

grant delete on pilot.crew_members to authenticated;

-- ---------------------------------------------------------------------------
-- INVOICE SETTINGS.
--
-- Everything a pilot could previously control about an invoice's identity
-- was one field: invoice_prefix. These are the rest of the knobs that show
-- up on the document itself.
--
-- NOT NULL WITH DEFAULTS for the two numbering columns, nullable for the
-- three text/rate ones: the number FORMAT must always resolve to something
-- (next_invoice_number concatenates it, and SQL NULL-propagation through ||
-- would silently produce a numberless issued invoice — the exact failure
-- that function's `into strict` already guards the prefix against), whereas
-- "no default tax rate" and "no footer" are real, meaningful states.
-- ---------------------------------------------------------------------------
alter table pilot.accounts
  -- How many digits the sequence integer is padded to. 4 is what every
  -- invoice issued before today used, so this default is the status quo.
  -- Capped at 8 because the pad is cosmetic and a 20-digit invoice number
  -- is a data-entry hazard, not a preference.
  add column if not exists invoice_number_pad integer not null default 4
    check (invoice_number_pad between 1 and 8),
  -- Whether the issue year sits between the prefix and the sequence
  -- (INV-2026-0001 vs INV-0001). Off is a legitimate house style, and it is
  -- collision-free here because the per-account sequence is monotonic for
  -- the life of the account and never resets on New Year's Day.
  add column if not exists invoice_number_include_year boolean not null default true,
  -- Prefilled into the new-invoice form's tax field. Deliberately NOT a
  -- column default on pilot.invoices: the rate that matters is the one the
  -- pilot saw and accepted on the form, and a silent server-side default
  -- would apply to invoices created by paths that never showed it.
  add column if not exists default_tax_rate_bps integer
    check (default_tax_rate_bps is null
           or default_tax_rate_bps between 0 and 2500),
  -- Prefilled into the new-invoice form's notes field.
  add column if not exists default_invoice_notes text
    check (default_invoice_notes is null or length(default_invoice_notes) <= 2000),
  -- Rendered at the bottom of every invoice PDF. Read at render time, not
  -- snapshotted onto the invoice: it is boilerplate (remit-to wording, a
  -- late-fee sentence, a thank-you), not a billing fact, and a pilot who
  -- fixes a typo in it expects the fix to show everywhere.
  add column if not exists invoice_footer text
    check (invoice_footer is null or length(invoice_footer) <= 2000);

-- Column-scoped, per the rule in the Phase 1 tenancy migration: never
-- `grant update on pilot.accounts`. Additive — this extends the existing
-- grants rather than replacing them.
grant update (
  invoice_number_pad, invoice_number_include_year,
  default_tax_rate_bps, default_invoice_notes, invoice_footer
) on pilot.accounts to authenticated;

comment on column pilot.accounts.invoice_number_pad is
  'Digits the invoice sequence is zero-padded to. Changing it affects FUTURE numbers only; already-issued invoice_number values are immutable text.';
comment on column pilot.accounts.invoice_footer is
  'Boilerplate rendered at the foot of every invoice PDF, read live at render time rather than snapshotted — see this column''s migration.';

-- ---------------------------------------------------------------------------
-- next_invoice_number, re-declared to honour the two format columns.
--
-- RE-DECLARED IN FULL rather than patched, because that is the only honest
-- way to read it: the body below is 20260805090000's verbatim, with the
-- single `select invoice_prefix into strict` widened to also read the two
-- new columns and the final concatenation made conditional. THE MEMBERSHIP
-- CHECK AND THE service_role EXEMPTION ARE UNCHANGED AND MUST STAY — that
-- migration's header documents the live cross-tenant exploit they close.
-- ---------------------------------------------------------------------------
create or replace function pilot.next_invoice_number(target_account_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  seq integer;
  prefix text;
  pad integer;
  with_year boolean;
begin
  -- current_setting('role'), not current_user: inside SECURITY DEFINER the
  -- latter reports the function OWNER for the whole call and so could never
  -- match a real service_role caller. `not exists` rather than `not in`
  -- because `not in` against a set containing NULL fails OPEN.
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and not exists (
       select 1 from pilot.current_account_ids() a where a = target_account_id
     )
  then
    raise exception 'not a member of account %', target_account_id;
  end if;

  update pilot.invoice_number_sequences
    set next_number = next_number + 1
    where account_id = target_account_id
    returning next_number - 1 into seq;

  if seq is null then
    raise exception 'no invoice sequence row for account %; the accounts_seed_invoice_sequence trigger should have created one', target_account_id;
  end if;

  -- INTO STRICT: a missing row would otherwise concatenate to a silent NULL
  -- invoice_number. The two format columns are NOT NULL with defaults, so
  -- they cannot contribute a NULL of their own.
  select invoice_prefix, invoice_number_pad, invoice_number_include_year
    into strict prefix, pad, with_year
    from pilot.accounts where id = target_account_id;

  return prefix
    || '-'
    || case when with_year then to_char(now(), 'YYYY') || '-' else '' end
    || lpad(seq::text, pad, '0');
end;
$$;

comment on function pilot.next_invoice_number(uuid) is
  'SECURITY DEFINER with an explicit current_account_ids() membership check in the body — DEFINER bypasses RLS, so the check IS the tenancy boundary here, not decoration. Never remove it; never grant this to anon. Format follows pilot.accounts.invoice_prefix / invoice_number_pad / invoice_number_include_year.';

-- ---------------------------------------------------------------------------
-- SETTING THE NEXT INVOICE NUMBER — forward only.
--
-- The one thing a pilot migrating from another system actually needs and
-- could not do: start at 1043 because that is where their old book left
-- off. pilot.invoice_number_sequences carries no UPDATE grant for
-- `authenticated` and must not get one, because a tenant with direct write
-- access to that column could move the counter BACKWARDS and re-mint a
-- number an issued invoice already holds — at best a 23505 on the unique
-- (account_id, invoice_number), at worst two documents claiming to be
-- INV-2026-0007 if the earlier one was later voided out of the way.
--
-- So the capability is a function, and the function only ever raises. A
-- request to lower it is refused with P0001 rather than clamped: silently
-- doing nothing when a pilot typed a number is worse than saying no.
-- ---------------------------------------------------------------------------
create or replace function pilot.set_next_invoice_number(
  target_account uuid,
  p_next integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_next integer;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and not exists (
       select 1 from pilot.current_account_ids() a where a = target_account
     )
  then
    raise exception 'not a member of account %', target_account
      using errcode = 'P0002';
  end if;

  if p_next is null or p_next < 1 then
    raise exception 'the next invoice number must be a positive whole number';
  end if;

  select next_number into current_next
    from pilot.invoice_number_sequences
    where account_id = target_account
    for update;

  if current_next is null then
    raise exception 'no invoice sequence row for account %', target_account
      using errcode = 'P0002';
  end if;

  -- Equal is a no-op, not an error: a double-submit of the same value is
  -- the pilot asking for a state they are already in.
  if p_next < current_next then
    raise exception 'the next invoice number can only be moved forward (it is already %)', current_next;
  end if;

  update pilot.invoice_number_sequences
    set next_number = p_next
    where account_id = target_account;

  return p_next;
end;
$$;

-- A function's OWNER keeps implicit EXECUTE regardless of what is revoked
-- here, so this REVOKE is about `public` and `authenticated` reaching it as
-- themselves, which they must — but only through the grant below, and never
-- as anon.
revoke all on function pilot.set_next_invoice_number(uuid, integer) from public;
grant execute on function pilot.set_next_invoice_number(uuid, integer)
  to authenticated, service_role;

comment on function pilot.set_next_invoice_number(uuid, integer) is
  'Moves an account''s invoice counter FORWARD only. Exists so that pilot.invoice_number_sequences never needs a tenant-facing UPDATE grant, which would allow re-minting an already-issued number.';

-- ---------------------------------------------------------------------------
-- WHAT STILL POINTS AT AN AIRFRAME, when nothing has a foreign key to it.
--
-- deleteAircraft has to answer "has this tail flown, or been on a trip?"
-- before it removes a registry row, and it cannot answer it from the
-- application: the link is a normalised-text join computed at read time
-- (see pilot.aircraft_time_by_tail), and a client-side `ilike` cannot
-- reproduce it — 'N-123AB' and 'N123AB' are the same airframe and no
-- pattern match says so.
--
-- pilot.aircraft_time_by_tail already answers the logbook half via its
-- entry_count. This view answers the trips half, joining exactly the same
-- way. security_invoker so RLS on pilot.trips still applies to the caller —
-- a view that bypassed it would be a cross-tenant count of somebody else's
-- fleet activity.
--
-- LEFT JOIN, so an airframe that has never been on a trip reports 0 rather
-- than disappearing from the view: a missing row and a zero count read
-- identically to a `.maybeSingle()`, and "no row" must not be the thing
-- that makes a delete look safe.
-- ---------------------------------------------------------------------------
create or replace view pilot.aircraft_trip_usage
with (security_invoker = true) as
  select
    a.account_id,
    a.id                as aircraft_id,
    count(t.id)::bigint as trip_count
  from pilot.aircraft a
  left join pilot.trips t
    on t.account_id = a.account_id
   and upper(regexp_replace(coalesce(t.aircraft_ident, ''), '[^A-Za-z0-9]', '', 'g')) = a.tail_key
  group by a.account_id, a.id;

comment on view pilot.aircraft_trip_usage is
  'Trips matched to each registered airframe on the normalised tail key at read time, the same join pilot.aircraft_time_by_tail uses for logbook entries. Exists so deleteAircraft can refuse to remove a tail that trips still name — there is no foreign key to check.';

grant select on pilot.aircraft_trip_usage to authenticated, service_role;
