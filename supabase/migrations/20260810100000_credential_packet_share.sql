-- ===========================================================================
-- The credential packet — send a client your paperwork once, revocably
--
-- WHAT A PILOT DOES TODAY. Every new client asks for the same envelope: a
-- W-9, a certificate of insurance, the signed day-rate agreement,
-- sometimes a certificate or medical. The aviation reference calls this
-- out by name — "pilots re-send these constantly" — and names a
-- "credential + vendor packet wallet" as an obvious product feature.
--
-- This product already stores all of it. pilot.documents holds the files
-- with expiry tracking and per-client linkage, and it is genuinely good.
-- But DocumentLink mints a signed URL for the SIGNED-IN PILOT only. There
-- is no way to give a client anything, so the packet still goes out as
-- email attachments, by hand, per client, and again whenever something
-- expires. clients.w9_status is a three-state flag with no action behind
-- it at all.
--
-- WHAT THIS ADDS. One revocable, expiring link per client that serves a
-- SET of documents the pilot chose. Copied wholesale from
-- pilot.invoice_shares (20260809060000) — same 32-byte base64url token
-- under a CHECK, same SECURITY-DEFINER-only write path, same
-- rotate-on-reshare, same anon RPC that takes the token as an argument
-- rather than exposing the table. That migration's header is the security
-- rationale for all of it and is worth reading before changing anything
-- here.
--
-- WHERE IT DELIBERATELY DIFFERS, and why:
--
--   * IT EXPIRES BY DEFAULT. An invoice share is a document about one
--     finished transaction. A credential packet is a passport number, an
--     insurance certificate and a tax identification form — standing
--     personal data, and a link to it should not live forever because
--     someone forgot to revoke it. expires_at is NOT NULL.
--   * THE PILOT PICKS THE DOCUMENTS, one row per inclusion, rather than
--     the link meaning "everything I have". A client who needs a W-9 does
--     not get the pilot's passport because it happened to be in the
--     wallet.
--   * NO FILE BYTES CROSS THIS BOUNDARY. The RPC returns metadata only —
--     kind, label, expiry. Serving the file itself is a Storage concern
--     and stays one; this migration deliberately does not grant anon any
--     path to storage.objects. Read the route's own comment before
--     wiring one.
-- ===========================================================================

create table if not exists pilot.document_shares (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid not null,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete cascade,
  -- Same shape and same CHECK as invoice_shares.token: 32 random bytes,
  -- base64url, no padding.
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  -- NOT NULL, unlike the invoice equivalent. See the header.
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  revoked_at timestamptz,
  -- At most one live packet per client; re-sharing rotates the token.
  unique (account_id, client_id)
);

comment on table pilot.document_shares is
  'One revocable, EXPIRING link per client, serving the documents named in pilot.document_share_items. Written only through the SECURITY DEFINER functions below — no direct INSERT/UPDATE grant to authenticated. The token is the entire access boundary for the public packet route; treat any change here as a security change.';

-- Which documents this packet contains. A set the pilot chose, not
-- "everything on file".
create table if not exists pilot.document_share_items (
  share_id uuid not null references pilot.document_shares(id) on delete cascade,
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  document_id uuid not null,
  foreign key (account_id, document_id) references pilot.documents (account_id, id) on delete cascade,
  primary key (share_id, document_id)
);

comment on table pilot.document_share_items is
  'The documents a packet includes. Deliberately explicit: a client who asked for a W-9 must not receive a passport because it happened to be in the same wallet.';

create index if not exists document_share_items_share_idx
  on pilot.document_share_items (share_id);

-- ---------------------------------------------------------------------------
-- Mint or rotate a packet.
-- ---------------------------------------------------------------------------
create or replace function pilot.document_share_create(
  p_client_id uuid,
  p_document_ids uuid[],
  p_days_valid integer default 30
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_share_id uuid;
  v_token text;
  v_kept integer;
begin
  select account_id into v_account_id
  from pilot.clients
  where id = p_client_id
    and account_id in (select pilot.current_account_ids());

  if v_account_id is null then
    raise exception 'client % not found', p_client_id;
  end if;

  if p_document_ids is null or array_length(p_document_ids, 1) is null then
    raise exception 'a packet needs at least one document';
  end if;

  -- Bounded on both ends. A zero-or-negative window makes a link that is
  -- dead on arrival and reads as a bug; a multi-year one is the
  -- forever-link this table exists to avoid.
  if p_days_valid < 1 or p_days_valid > 365 then
    raise exception 'a packet link must be valid for between 1 and 365 days';
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_');
  v_token := replace(v_token, '=', '');

  insert into pilot.document_shares
    (account_id, client_id, token, expires_at, created_by)
  values
    (v_account_id, p_client_id, v_token,
     now() + make_interval(days => p_days_valid), auth.uid())
  on conflict (account_id, client_id)
  do update set
    token = excluded.token,
    expires_at = excluded.expires_at,
    revoked_at = null,
    created_by = excluded.created_by,
    created_at = now()
  returning id into v_share_id;

  -- Replaced wholesale, not merged: re-sharing means "the packet is now
  -- THIS", and a document the pilot removed must actually leave.
  delete from pilot.document_share_items where share_id = v_share_id;

  -- The account_id filter is what stops a caller naming another tenant's
  -- document id. DEFINER bypasses RLS, so this WHERE clause is the access
  -- boundary, not a convenience.
  insert into pilot.document_share_items (share_id, account_id, document_id)
  select v_share_id, v_account_id, d.id
  from pilot.documents d
  where d.id = any(p_document_ids)
    and d.account_id = v_account_id;

  get diagnostics v_kept = row_count;
  if v_kept = 0 then
    raise exception 'none of those documents belong to this account';
  end if;

  return v_token;
end;
$$;

comment on function pilot.document_share_create(uuid, uuid[], integer) is
  'Mints or ROTATES the one live packet link for a client, containing exactly the documents named. SECURITY DEFINER: the membership check and the account_id filter on the item insert ARE the access boundary, since DEFINER bypasses RLS.';

create or replace function pilot.document_share_revoke(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update pilot.document_shares
  set revoked_at = now()
  where client_id = p_client_id
    and account_id in (select pilot.current_account_ids())
    and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the client sees. Metadata only — no file bytes, no storage path.
-- ---------------------------------------------------------------------------
create or replace function pilot.document_packet_public(p_token text)
returns table (
  business_name text,
  document_kind text,
  document_label text,
  expires_on date,
  issued_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.legal_name,
    d.kind,
    d.label,
    d.expires_on,
    d.issued_on
  from pilot.document_shares s
  join pilot.accounts a on a.id = s.account_id
  join pilot.document_share_items i on i.share_id = s.id
  join pilot.documents d on d.id = i.document_id
  where s.token = p_token
    and s.revoked_at is null
    -- Expiry is enforced HERE, in the only path anon can reach, not by a
    -- sweep job that has to remember to run.
    and s.expires_at > now()
  order by d.kind, d.label;
$$;

comment on function pilot.document_packet_public(text) is
  'The anon-facing read for a packet link. Returns METADATA ONLY — no file path and no bytes — and enforces revocation and expiry itself, because it is the only path anon can reach. Serving a file is a Storage concern and is deliberately not wired here.';

-- ---------------------------------------------------------------------------
-- RLS and grants. Same shape as invoice_shares.
-- ---------------------------------------------------------------------------
alter table pilot.document_shares enable row level security;
alter table pilot.document_share_items enable row level security;

-- SELECT only: the pilot can see and re-copy their own links. Every write
-- goes through the SECURITY DEFINER functions above, which is what lets
-- each carry checks RLS cannot express.
create policy document_shares_select on pilot.document_shares for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy document_share_items_select on pilot.document_share_items for select to authenticated
  using (account_id in (select pilot.current_account_ids()));

grant select on pilot.document_shares, pilot.document_share_items to authenticated;
grant select, insert, update, delete
  on pilot.document_shares, pilot.document_share_items to service_role;

revoke all on function pilot.document_share_create(uuid, uuid[], integer) from public;
grant execute on function pilot.document_share_create(uuid, uuid[], integer) to authenticated;
revoke all on function pilot.document_share_revoke(uuid) from public;
grant execute on function pilot.document_share_revoke(uuid) to authenticated;
revoke all on function pilot.document_packet_public(text) from public;
grant execute on function pilot.document_packet_public(text) to anon, authenticated;
