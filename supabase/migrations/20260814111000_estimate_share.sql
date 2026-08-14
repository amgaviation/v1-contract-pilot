-- Client-facing estimate share links — the second unauthenticated route
-- that exposes tenant data. Read
-- supabase/migrations/20260809060000_invoice_public_share.sql AND
-- supabase/migrations/20260812200000_invoice_share_viewed.sql IN FULL
-- before touching this file: every pattern below is that pair, adapted,
-- not reinvented, and both migrations' own "THE SHAPE OF THE PROBLEM" /
-- security-posture notes govern here too. This file combines what those
-- two migrations did in sequence (share + later, viewed tracking) into one,
-- since a single timestamp prefix is all this session has.
--
-- WHAT'S NEW HERE THAT INVOICES DON'T HAVE: pilot.estimate_public_accept
-- and pilot.estimate_public_decline. An estimate's own lifecycle
-- (pilot.estimates_protect, 20260810060000) already allows a 'sent' quote
-- to move to 'accepted' or 'declined' — that is literally the client
-- answering the quote — and today the ONLY way that answer reaches this
-- schema is the pilot re-typing it after a phone call or an email. These
-- two functions let the client record their own answer on the page they
-- were sent, through the same narrow SECURITY DEFINER shape every other
-- anon-reachable write in this schema uses (see pilot.invoice_share_mark_
-- viewed's own security-posture list, reproduced below item by item).
--
-- WHY THIS DOES NOT WIDEN THE ATTACK SURFACE BEYOND "one token can flip one
-- estimate's status once": both functions re-derive the estimate from the
-- TOKEN (never from a client-supplied id), require the token to be live
-- (unrevoked, in a shareable status), require the CURRENT status to be
-- 'sent' (so a token cannot re-answer an estimate a human already decided,
-- and cannot be used on a draft), and exclude the owning account's own
-- members (so a pilot previewing their own link can never accidentally
-- accept or decline their own quote by clicking through it) — the same
-- exclusion pilot.invoice_share_mark_viewed applies for "viewed", extended
-- here to an actual state change because the stakes of a false positive are
-- higher. pilot.estimates_protect (unchanged, still governs) is the second,
-- independent gate: it runs as a BEFORE UPDATE trigger regardless of which
-- role performs the UPDATE, and it is what actually enforces that only
-- sent -> accepted|declined is a legal move — these functions do not
-- reimplement that state machine, they only ever attempt the one
-- transition each is named for, and the trigger would reject anything else
-- even if this file had a bug.

create table if not exists pilot.estimate_shares (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  estimate_id uuid not null,
  foreign key (account_id, estimate_id) references pilot.estimates (account_id, id) on delete cascade,
  -- Same shape as pilot.invoice_shares.token — 32 random bytes,
  -- base64url, no padding. See that column's own comment for why this is
  -- pure randomness rather than derived from any visible id, and why it is
  -- stored plaintext rather than hashed.
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  revoked_at timestamptz,
  -- Same meaning as pilot.invoice_shares' pair (20260812200000): "this
  -- share link was FETCHED while valid." Included from the start here
  -- rather than as a follow-up migration, since one timestamp prefix is
  -- all this session has.
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  check (
    ((first_viewed_at is null) = (last_viewed_at is null))
    and (first_viewed_at is null or first_viewed_at <= last_viewed_at)
  ),
  unique (account_id, estimate_id)
);

comment on table pilot.estimate_shares is
  'One row per estimate ever shared, at most one live token per estimate (unique account_id,estimate_id — re-sharing ROTATES the token). Written only through pilot.estimate_share_create/pilot.estimate_share_revoke/pilot.estimate_share_mark_viewed/pilot.estimate_public_accept/pilot.estimate_public_decline, all SECURITY DEFINER; there is no direct INSERT/UPDATE grant to authenticated. Read by pilot.estimate_public (anon + authenticated EXECUTE) — the token column is the entire access boundary for app/estimate/[token]. first_viewed_at/last_viewed_at mean "fetched while valid" (mail scanners count; the owning account''s own members do not).';

alter table pilot.estimate_shares enable row level security;

create policy estimate_shares_select on pilot.estimate_shares for select to authenticated
  using (account_id in (select pilot.current_account_ids()));

grant select on pilot.estimate_shares to authenticated;
grant select, insert, update, delete on pilot.estimate_shares to service_role;

create index if not exists estimate_shares_estimate_idx on pilot.estimate_shares (account_id, estimate_id);

-- ---------------------------------------------------------------------------
-- pilot.estimate_share_create — mint or ROTATE the one live share token for
-- an estimate the caller is a member of.
--
-- STATUS GATE: anything but 'draft'. A draft is unnumbered, unissued and
-- still fully editable — the same reason pilot.invoice_share_create refuses
-- a draft invoice — so it is excluded here too. Unlike invoices there is no
-- terminal 'void' state to exclude; 'sent', 'accepted' and 'declined' are
-- all legitimate things for a client to be able to reopen and look at
-- again.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimate_share_create(p_estimate_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_status text;
  v_token text;
begin
  select account_id, status into v_account_id, v_status
  from pilot.estimates
  where id = p_estimate_id
    and account_id in (select pilot.current_account_ids());

  if v_account_id is null then
    raise exception 'estimate % not found', p_estimate_id;
  end if;

  if v_status = 'draft' then
    raise exception 'estimate % (status=%) cannot be shared — send it first', p_estimate_id, v_status;
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_');
  v_token := replace(v_token, '=', '');

  insert into pilot.estimate_shares (account_id, estimate_id, token, created_by)
  values (v_account_id, p_estimate_id, v_token, auth.uid())
  on conflict (account_id, estimate_id)
  do update set
    token = excluded.token,
    revoked_at = null,
    created_by = excluded.created_by,
    created_at = now(),
    -- A rotated link is a new credential: its view history starts empty,
    -- same rule as pilot.invoice_share_create since 20260812200000.
    first_viewed_at = null,
    last_viewed_at = null;

  return v_token;
end;
$$;

revoke all on function pilot.estimate_share_create(uuid) from public;
grant execute on function pilot.estimate_share_create(uuid) to authenticated;

comment on function pilot.estimate_share_create(uuid) is
  'Mints or ROTATES the one live share token for an estimate the caller is a member of. Rejects a draft estimate. SECURITY DEFINER: the membership + status checks in the body ARE the access boundary.';

-- ---------------------------------------------------------------------------
-- pilot.estimate_share_revoke — kill a token immediately.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimate_share_revoke(p_estimate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update pilot.estimate_shares
    set revoked_at = now()
    where estimate_id = p_estimate_id
      and account_id in (select pilot.current_account_ids())
      and revoked_at is null;
end;
$$;

revoke all on function pilot.estimate_share_revoke(uuid) from public;
grant execute on function pilot.estimate_share_revoke(uuid) to authenticated;

comment on function pilot.estimate_share_revoke(uuid) is
  'Revokes the caller''s own estimate''s share token immediately (idempotent no-op if already revoked or never shared).';

-- ---------------------------------------------------------------------------
-- pilot.estimate_public — the ONLY path from an unauthenticated request to
-- estimate data. Same null-for-everything-invalid contract as
-- pilot.invoice_public: an unknown token, a revoked one, and an estimate
-- reverted to draft all return null, indistinguishably.
--
-- FIELD LIST, deliberately narrower than an invoice's: no payment block (an
-- estimate has no Stripe payment link), valid_until in place of due_on, and
-- status is included so a client re-opening an old link sees whether it is
-- still live, already answered, or superseded. NOT included: terms/notes
-- beyond what is already on the PDF this pilot already sends, trip_id,
-- converted_invoice_id/converted_at (an internal fact about a DIFFERENT
-- document this client has no standing to see), created_by, or anything
-- about the account beyond this one document's own header.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimate_public(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_account_id uuid;
  v_estimate_id uuid;
  result jsonb;
begin
  select s.account_id, s.estimate_id into v_account_id, v_estimate_id
  from pilot.estimate_shares s
  join pilot.estimates e on e.account_id = s.account_id and e.id = s.estimate_id
  where s.token = p_token
    and s.revoked_at is null
    and e.status <> 'draft';

  if v_account_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'estimate', jsonb_build_object(
      'estimate_number', e.estimate_number,
      'status', e.status,
      'issued_on', e.issued_on,
      'valid_until', e.valid_until,
      'terms', e.terms,
      'notes', e.notes
    ),
    'account', jsonb_build_object(
      'legal_name', a.legal_name,
      'address_line1', a.address_line1,
      'address_line2', a.address_line2,
      'city', a.city,
      'state', a.state,
      'postal_code', a.postal_code,
      'country', a.country
    ),
    'client', jsonb_build_object(
      'name', c.name,
      'contact_name', c.contact_name,
      'address_line1', c.address_line1,
      'address_line2', c.address_line2,
      'city', c.city,
      'state', c.state,
      'postal_code', c.postal_code,
      'country', c.country
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', l.description,
        'quantity', l.quantity,
        'unit_amount_cents', l.unit_amount_cents,
        'amount_cents', l.amount_cents
      ) order by l.sort_order, l.id)
      from pilot.estimate_lines l
      where l.account_id = v_account_id and l.estimate_id = v_estimate_id
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subtotal_cents', t.subtotal_cents,
      'tax_cents', t.tax_cents,
      'total_cents', t.total_cents
    )
  )
  into result
  from pilot.estimates e
  join pilot.accounts a on a.id = e.account_id
  join pilot.clients c on c.account_id = e.account_id and c.id = e.client_id
  join pilot.estimate_totals t on t.estimate_id = e.id
  where e.account_id = v_account_id and e.id = v_estimate_id;

  return result;
end;
$$;

revoke all on function pilot.estimate_public(text) from public;
grant execute on function pilot.estimate_public(text) to anon, authenticated;

comment on function pilot.estimate_public(text) is
  'The ONE path from an unauthenticated request to estimate data. Returns null for an unknown token, a revoked one, or an estimate reverted to draft. SECURITY DEFINER, granted to anon. Do not widen the jsonb it returns without re-reading app/estimate/[token]/page.tsx''s field-by-field justification.';

-- ---------------------------------------------------------------------------
-- pilot.estimate_share_mark_viewed — mirrors pilot.invoice_share_mark_
-- viewed exactly (20260812200000): returns void unconditionally, never
-- raises, writes only the two timestamp columns, excludes the owning
-- account's own members. Read that function's comment for the full
-- security-posture rationale, item by item — it applies here verbatim.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimate_share_mark_viewed(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;

  update pilot.estimate_shares s
     set first_viewed_at = coalesce(s.first_viewed_at, now()),
         last_viewed_at  = now()
   where s.token = p_token
     and s.revoked_at is null
     and exists (
       select 1
       from pilot.estimates e
       where e.account_id = s.account_id
         and e.id = s.estimate_id
         and e.status <> 'draft'
     )
     and s.account_id not in (select pilot.current_account_ids());
end;
$$;

revoke all on function pilot.estimate_share_mark_viewed(text) from public;
grant execute on function pilot.estimate_share_mark_viewed(text) to anon, authenticated;

comment on function pilot.estimate_share_mark_viewed(text) is
  'Stamps first_viewed_at (once) and last_viewed_at (every call) on a LIVE share and is a silent no-op for everything else, including the owning account''s own members previewing their link. Returns void unconditionally so it leaks no hit/miss bit. Mirrors pilot.invoice_share_mark_viewed exactly.';

-- ---------------------------------------------------------------------------
-- pilot.estimate_public_accept / pilot.estimate_public_decline — the
-- client recording their own answer. See this file's header for the full
-- reasoning; the two functions are identical except for the target status.
--
-- ONLY FROM 'sent'. Not from 'declined' (a client who changed their mind
-- goes back through the pilot, who re-sends via markEstimateSent — see
-- app/(app)/estimates/actions.ts's own comment on that transition) and not
-- from 'accepted' (already answered; pilot.estimates_protect would refuse
-- accepted -> declined outright regardless). This keeps each token capable
-- of recording exactly one client answer per "sent" round, which is what
-- the real-world action ("I got the quote, here's my answer") actually is.
--
-- Returns void unconditionally, same non-oracle reasoning as mark_viewed:
-- an unknown token, a revoked one, an estimate not in 'sent', and the
-- owning account's own preview all fall through identically, silently.
-- pilot.estimates_protect (unchanged) is still the trigger that actually
-- enforces the transition is legal — these functions attempt only the one
-- transition each is named for and rely on that trigger as the backstop.
-- ---------------------------------------------------------------------------
create or replace function pilot.estimate_public_accept(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_estimate_id uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;

  select s.account_id, s.estimate_id into v_account_id, v_estimate_id
  from pilot.estimate_shares s
  join pilot.estimates e on e.account_id = s.account_id and e.id = s.estimate_id
  where s.token = p_token
    and s.revoked_at is null
    and e.status = 'sent'
    and s.account_id not in (select pilot.current_account_ids());

  if v_account_id is null then
    return;
  end if;

  update pilot.estimates
     set status = 'accepted'
   where account_id = v_account_id
     and id = v_estimate_id
     and status = 'sent';
end;
$$;

revoke all on function pilot.estimate_public_accept(text) from public;
grant execute on function pilot.estimate_public_accept(text) to anon, authenticated;

comment on function pilot.estimate_public_accept(text) is
  'Client-side accept of a live, sent estimate, reached only via app/estimate/[token]. Silent no-op for an unknown/revoked token, an estimate not currently sent, or the owning account''s own preview. pilot.estimates_protect is still the trigger that enforces the transition''s legality.';

create or replace function pilot.estimate_public_decline(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_estimate_id uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;

  select s.account_id, s.estimate_id into v_account_id, v_estimate_id
  from pilot.estimate_shares s
  join pilot.estimates e on e.account_id = s.account_id and e.id = s.estimate_id
  where s.token = p_token
    and s.revoked_at is null
    and e.status = 'sent'
    and s.account_id not in (select pilot.current_account_ids());

  if v_account_id is null then
    return;
  end if;

  update pilot.estimates
     set status = 'declined'
   where account_id = v_account_id
     and id = v_estimate_id
     and status = 'sent';
end;
$$;

revoke all on function pilot.estimate_public_decline(text) from public;
grant execute on function pilot.estimate_public_decline(text) to anon, authenticated;

comment on function pilot.estimate_public_decline(text) is
  'Client-side decline of a live, sent estimate, reached only via app/estimate/[token]. Silent no-op for an unknown/revoked token, an estimate not currently sent, or the owning account''s own preview. pilot.estimates_protect is still the trigger that enforces the transition''s legality.';
