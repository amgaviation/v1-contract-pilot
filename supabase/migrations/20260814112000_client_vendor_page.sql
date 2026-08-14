-- ===========================================================================
-- The vendor page — one persistent link per client, killing the constant
-- re-sending of "what do we owe you and where's your paperwork"
--
-- WHAT A PILOT DOES TODAY. A 135 operator's AP desk periodically asks two
-- questions by email: "what invoices are still open" and "send your W-9/COI
-- again, ours expired." The first already has an answer per-invoice (the
-- invoice share link, 20260809060000) but no per-client rollup — AP has to
-- hold N separate emailed links and re-derive the total themselves. The
-- second already has an answer (the credential packet, 20260810100000) but
-- nothing points from one to the other. Research roadmap item #12 names
-- this by name: a "vendor page," the FreshBooks/Zoho-portal pattern this
-- product's clients expect, scoped as a share-link extension rather than an
-- authed portal (no login exists for a pilot's clients and this does not
-- add one).
--
-- WHAT THIS ADDS. pilot.client_vendor_links: one revocable link per client
-- that serves a read-only rollup — open invoices, total outstanding, a
-- condensed paid history — plus (read-only, never minted here) a pointer to
-- that same client's live credential packet if the pilot already has one
-- out. Copied wholesale from pilot.invoice_shares/pilot.estimate_shares
-- (20260809060000, 20260814111000) for the token shape, the SECURITY
-- DEFINER-only write path, and the rotate-on-reshare unique constraint; and
-- from pilot.document_shares (20260810100000) for the mandatory expiry.
-- Viewed tracking is copied from pilot.invoice_shares' own later addition
-- (20260812200000) and pilot.estimate_shares, which folded it in from the
-- start — first_viewed_at/last_viewed_at, same meaning: "this link was
-- fetched while valid," not a claim about a human.
--
-- WHY THIS TABLE SITS BETWEEN THE TWO PATTERNS, NOT COPYING EITHER ALONE:
--
--   * EXPIRES, LIKE THE PACKET, UNLIKE AN INVOICE SHARE. An invoice share
--     names one already-finished transaction; revoking it is enough because
--     nothing about it changes shape over time. A vendor page is a standing
--     view onto every open invoice a client has AND, transitively, whatever
--     the packet link on the same client currently points at — closer in
--     kind to the packet's "standing personal-and-financial data" than to
--     one invoice's fixed figures, so it gets the packet's discipline:
--     expires_at is NOT NULL, bounded 1-365 days by
--     pilot.client_vendor_link_create, same as pilot.document_share_create.
--   * VIEWED TRACKING, WHICH THE PACKET DOES NOT HAVE. The packet migration
--     predates first_viewed_at/last_viewed_at (added to invoices later,
--     20260812200000) and was never revisited. This table is new today, so
--     it ships with the tracking from the start, matching
--     pilot.estimate_shares' choice to do the same rather than defer it to
--     a follow-up migration.
--
-- NO NEW PACKET IS EVER MINTED HERE. pilot.client_vendor_page_public reads
-- pilot.document_shares for the same client, filtered exactly the way
-- pilot.document_packet_public filters it (unrevoked, unexpired), and
-- returns that packet's token if one is already live — never creates,
-- rotates, or extends one. A pilot who wants the vendor page to carry a
-- packet link still has to create the packet the normal way, on the
-- client's own management panel; this only surfaces what already exists.
--
-- LEAST DATA, matching pilot.invoice_public's own field-by-field discipline
-- (see that migration's header and app/invoice/[token]/page.tsx's comment):
-- the client block is name ONLY — no address, no contact — because a
-- vendor page names the client back to itself for orientation, not as a
-- second copy of their own mailing details. Nothing from pilot.clients
-- beyond that one column is selected anywhere below.
-- ===========================================================================

create table if not exists pilot.client_vendor_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid not null,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete cascade,
  -- Same shape as every other share token in this schema: 32 random bytes,
  -- base64url, no padding. Pure randomness, not derived from any visible
  -- id — see pilot.invoice_shares.token's own comment for why.
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  -- NOT NULL, matching pilot.document_shares — see the header above for why
  -- a standing per-client rollup gets the packet's expiry discipline rather
  -- than an invoice share's open-ended one.
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  revoked_at timestamptz,
  -- "fetched while valid" — same meaning as pilot.invoice_shares' and
  -- pilot.estimate_shares' pair, added from the start here rather than as
  -- a follow-up (this table is new today; there is no earlier version of
  -- it to have omitted this from).
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  check (
    ((first_viewed_at is null) = (last_viewed_at is null))
    and (first_viewed_at is null or first_viewed_at <= last_viewed_at)
  ),
  -- At most one live vendor page per client; re-creating rotates the token,
  -- same as every other share table here.
  unique (account_id, client_id)
);

comment on table pilot.client_vendor_links is
  'One revocable, EXPIRING link per client, serving the read-only rollup pilot.client_vendor_page_public returns (open invoices, total outstanding, condensed paid history, and a pointer to that client''s own live credential packet if one exists). Written only through pilot.client_vendor_link_create/pilot.client_vendor_link_revoke/pilot.client_vendor_link_mark_viewed, all SECURITY DEFINER — no direct INSERT/UPDATE grant to authenticated. The token column is the entire access boundary for app/vendor/[token]; treat any change here as a security change.';

alter table pilot.client_vendor_links enable row level security;

-- The pilot can see and re-copy their own clients' links; every write goes
-- through the SECURITY DEFINER functions below, same reasoning as every
-- sibling share table in this schema.
create policy client_vendor_links_select on pilot.client_vendor_links for select to authenticated
  using (account_id in (select pilot.current_account_ids()));

grant select on pilot.client_vendor_links to authenticated;
grant select, insert, update, delete on pilot.client_vendor_links to service_role;

-- ---------------------------------------------------------------------------
-- pilot.client_vendor_link_create — mint or ROTATE the one live vendor page
-- link for a client the caller is a member of. No status gate to apply
-- here (unlike an invoice or estimate share): a client, not a single
-- document, has no draft/void state of its own — membership is the whole
-- check, same as pilot.document_share_create.
-- ---------------------------------------------------------------------------
create or replace function pilot.client_vendor_link_create(
  p_client_id uuid,
  p_days_valid integer default 90
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_token text;
begin
  select account_id into v_account_id
  from pilot.clients
  where id = p_client_id
    and account_id in (select pilot.current_account_ids());

  if v_account_id is null then
    raise exception 'client % not found', p_client_id;
  end if;

  -- Bounded on both ends, same reasoning and same bounds as
  -- pilot.document_share_create: a zero-or-negative window is a dead
  -- link on arrival, a multi-year one is the forever-link this column
  -- exists to avoid.
  if p_days_valid < 1 or p_days_valid > 365 then
    raise exception 'a vendor page link must be valid for between 1 and 365 days';
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_');
  v_token := replace(v_token, '=', '');

  insert into pilot.client_vendor_links
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
    created_at = now(),
    -- A rotated link is a new credential: its view history starts empty,
    -- same rule as pilot.invoice_share_create/pilot.estimate_share_create.
    first_viewed_at = null,
    last_viewed_at = null;

  return v_token;
end;
$$;

revoke all on function pilot.client_vendor_link_create(uuid, integer) from public;
grant execute on function pilot.client_vendor_link_create(uuid, integer) to authenticated;

comment on function pilot.client_vendor_link_create(uuid, integer) is
  'Mints or ROTATES the one live vendor page link for a client the caller is a member of. SECURITY DEFINER: the membership check in the body IS the access boundary, since DEFINER bypasses RLS.';

-- ---------------------------------------------------------------------------
-- pilot.client_vendor_link_revoke — kill a token immediately.
-- ---------------------------------------------------------------------------
create or replace function pilot.client_vendor_link_revoke(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update pilot.client_vendor_links
    set revoked_at = now()
    where client_id = p_client_id
      and account_id in (select pilot.current_account_ids())
      and revoked_at is null;
end;
$$;

revoke all on function pilot.client_vendor_link_revoke(uuid) from public;
grant execute on function pilot.client_vendor_link_revoke(uuid) to authenticated;

comment on function pilot.client_vendor_link_revoke(uuid) is
  'Revokes the caller''s own client''s vendor page link immediately (idempotent no-op if already revoked or never created).';

-- ---------------------------------------------------------------------------
-- pilot.client_vendor_page_public — the ONLY path from an unauthenticated
-- request to the vendor rollup. Returns null for an unknown token, a
-- revoked one, or an expired one — indistinguishable, same enumeration-
-- resistance posture as pilot.invoice_public/pilot.estimate_public.
--
-- FIELD LIST:
--   account.legal_name/address*  The pilot's own business identity —
--                          already on every invoice this client has ever
--                          received, and the identical field set
--                          pilot.invoice_public already exposes.
--   client.name            The client's own name, for orientation ("this
--                          page is about you") — NOT their address or
--                          contact fields, which add nothing a client
--                          needs told back to themselves and which
--                          pilot.invoice_public itself only shows because
--                          it renders a Bill To block; this page renders
--                          no such block.
--   open_invoices[]         invoice_number, due_on, status, balance_due_cents
--                          for every 'sent' or 'partial' invoice — the
--                          same "outstanding" definition
--                          app/(app)/clients/[id]/page.tsx already uses.
--                          Capped at 200 rows (open_invoices_truncated
--                          says so); total_outstanding_cents below is
--                          summed over ALL of them, uncapped, so the total
--                          is never wrong even if the list is cut short.
--   total_outstanding_cents  sum(balance_due_cents) over every open
--                          invoice, not just the ones listed.
--   paid_invoices[]         invoice_number, paid_on, total_cents for the
--                          50 most recently paid invoices — "payment
--                          history, condensed," exactly as asked; a full
--                          ledger is what the pilot's own Statement page
--                          (app/(app)/clients/[id]/statement) is for, not
--                          this link. paid_invoices_truncated says so if
--                          the client has more.
--   packet_token            The token of this SAME client's live
--                          credential packet, if pilot.document_shares
--                          has one that is unrevoked and unexpired right
--                          now — filtered exactly the way
--                          pilot.document_packet_public itself filters.
--                          Null otherwise. NEVER minted by this function;
--                          see the file header.
--
-- NOT INCLUDED: any other client's data (the token names exactly one
-- client_id, fixed at share-creation time), draft/void invoices (nothing a
-- client should ever see — matches pilot.invoice_public's own status
-- gate), invoice_lines (line-item detail belongs on that invoice's own
-- share link, not folded into a rollup), any pilot.accounts column beyond
-- the business-identity fields already public on every invoice, and the
-- packet's own document rows (a vendor page LINKS to the packet page; it
-- does not inline the packet's contents, so a change to what the packet
-- exposes never has to be mirrored here).
-- ---------------------------------------------------------------------------
create or replace function pilot.client_vendor_page_public(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_account_id uuid;
  v_client_id uuid;
  result jsonb;
begin
  select s.account_id, s.client_id into v_account_id, v_client_id
  from pilot.client_vendor_links s
  where s.token = p_token
    and s.revoked_at is null
    -- Expiry enforced HERE, in the only path anon can reach — not by a
    -- sweep job that has to remember to run. Same as
    -- pilot.document_packet_public.
    and s.expires_at > now();

  if v_account_id is null then
    return null;
  end if;

  select jsonb_build_object(
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
      'name', c.name
    ),
    'open_invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'invoice_number', o.invoice_number,
        'due_on', o.due_on,
        'status', o.status,
        'balance_due_cents', o.balance_due_cents
      ) order by o.due_on nulls last, o.invoice_number)
      from (
        select i.invoice_number, i.due_on, i.status, t.balance_due_cents
        from pilot.invoices i
        join pilot.invoice_totals t on t.invoice_id = i.id
        where i.account_id = v_account_id
          and i.client_id = v_client_id
          and i.status in ('sent', 'partial')
        order by i.due_on nulls last, i.invoice_number
        limit 200
      ) o
    ), '[]'::jsonb),
    'open_invoices_truncated', (
      select count(*) > 200
      from pilot.invoices i
      where i.account_id = v_account_id
        and i.client_id = v_client_id
        and i.status in ('sent', 'partial')
    ),
    'total_outstanding_cents', coalesce((
      select sum(t.balance_due_cents)
      from pilot.invoices i
      join pilot.invoice_totals t on t.invoice_id = i.id
      where i.account_id = v_account_id
        and i.client_id = v_client_id
        and i.status in ('sent', 'partial')
    ), 0)::bigint,
    'paid_invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'invoice_number', p.invoice_number,
        'paid_on', p.paid_on,
        'total_cents', p.total_cents
      ) order by p.paid_on desc nulls last, p.invoice_number desc)
      from (
        select i.invoice_number, t.last_paid_on as paid_on, t.total_cents
        from pilot.invoices i
        join pilot.invoice_totals t on t.invoice_id = i.id
        where i.account_id = v_account_id
          and i.client_id = v_client_id
          and i.status = 'paid'
        order by t.last_paid_on desc nulls last, i.invoice_number desc
        limit 50
      ) p
    ), '[]'::jsonb),
    'paid_invoices_truncated', (
      select count(*) > 50
      from pilot.invoices i
      where i.account_id = v_account_id
        and i.client_id = v_client_id
        and i.status = 'paid'
    ),
    -- Read-only lookup of an EXISTING packet share for this same client —
    -- never created, rotated, or extended here. See the file header.
    'packet_token', (
      select d.token
      from pilot.document_shares d
      where d.account_id = v_account_id
        and d.client_id = v_client_id
        and d.revoked_at is null
        and d.expires_at > now()
    )
  )
  into result
  from pilot.accounts a
  join pilot.clients c on c.account_id = a.id and c.id = v_client_id
  where a.id = v_account_id;

  return result;
end;
$$;

revoke all on function pilot.client_vendor_page_public(text) from public;
grant execute on function pilot.client_vendor_page_public(text) to anon, authenticated;

comment on function pilot.client_vendor_page_public(text) is
  'The ONE path from an unauthenticated request to the per-client vendor rollup. Returns null for an unknown token, a revoked one, or an expired one — indistinguishable by design. SECURITY DEFINER, granted to anon. Reads pilot.document_shares read-only to surface an existing packet link; never writes it. Do not widen the jsonb it returns without re-reading app/vendor/[token]/page.tsx''s field-by-field justification.';

-- ---------------------------------------------------------------------------
-- pilot.client_vendor_link_mark_viewed — mirrors pilot.invoice_share_mark_
-- viewed / pilot.estimate_share_mark_viewed exactly: returns void
-- unconditionally, never raises, writes only the two timestamp columns,
-- excludes the owning account's own members previewing their own link.
-- ---------------------------------------------------------------------------
create or replace function pilot.client_vendor_link_mark_viewed(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;

  update pilot.client_vendor_links s
     set first_viewed_at = coalesce(s.first_viewed_at, now()),
         last_viewed_at  = now()
   where s.token = p_token
     and s.revoked_at is null
     and s.expires_at > now()
     and s.account_id not in (select pilot.current_account_ids());
end;
$$;

revoke all on function pilot.client_vendor_link_mark_viewed(text) from public;
grant execute on function pilot.client_vendor_link_mark_viewed(text) to anon, authenticated;

comment on function pilot.client_vendor_link_mark_viewed(text) is
  'Stamps first_viewed_at (once) and last_viewed_at (every call) on a LIVE vendor page link and is a silent no-op for everything else, including the owning account''s own members previewing their link. Returns void unconditionally so it leaks no hit/miss bit. Mirrors pilot.invoice_share_mark_viewed and pilot.estimate_share_mark_viewed.';
