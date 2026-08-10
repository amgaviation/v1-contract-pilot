-- Client-facing invoice share links — this product's first unauthenticated
-- route that exposes tenant data. Read this whole file before touching it.
--
-- ***************************************************************************
-- THE SHAPE OF THE PROBLEM
-- ***************************************************************************
-- Every other read in `pilot` goes through RLS scoped to
-- `account_id in (select pilot.current_account_ids())`, which depends on a
-- Supabase auth session. A client opening an emailed invoice link has none.
--
-- `anon` had NO grant whatsoever on schema `pilot` before this migration
-- (tenancy-verify.mjs's own invariant). Calling ANY function that lives in
-- a schema requires USAGE on that schema — not just EXECUTE on the
-- function — so this migration necessarily grants `usage on schema pilot
-- to anon` below, the first grant of any kind anon has ever had here.
-- This is narrower than it might sound: USAGE only lets a role look up
-- names inside the schema (resolve `pilot.invoice_public` as a callable
-- object at all); it grants NOTHING on any TABLE, which is a separate,
-- per-relation privilege this migration never touches for anon. Every
-- table stays exactly as unreachable to anon as before — proved by
-- scripts/invoice-share-verify.mjs's SHARE-1/SHARE-1b assertions, which
-- run AFTER this schema-usage grant exists and still get 42501
-- (insufficient_privilege) on a bare `select from pilot.invoices` — and no
-- table grant is added anywhere in this file.
--
-- The door is a single SECURITY DEFINER function, `pilot.invoice_public`,
-- matching this branch's own `pilot.connect_account_link` pattern: pinned
-- `search_path`, `revoke all from public`, a narrow `grant execute` (here,
-- to `anon` AND `authenticated` — a signed-in pilot previewing their own
-- share link should see exactly what their client sees), and the function
-- itself is the ONLY thing that can translate a token into invoice data.
-- It bypasses RLS by construction (DEFINER always does) — the token check
-- inside its body IS the access boundary, not a courtesy.
--
-- ***************************************************************************
-- TOKEN DESIGN
-- ***************************************************************************
-- 32 bytes (256 bits) from gen_random_bytes(32) — Postgres's CSPRNG, not
-- gen_random_uuid(). A v4 UUID has only 122 random bits (6 bits are fixed
-- version/variant markers) and, more importantly, READS as an identifier —
-- something people are trained to paste into a URL bar next to other UUIDs
-- they've seen in this very product (invoice ids, client ids). A 256-bit
-- token encoded base64url (43 characters, no padding) reads as what it is:
-- a bearer credential, not a row reference. 256 bits is well beyond what
-- 128 bits already guarantees (a uniform 128-bit space is not brute-
-- forceable by any realistic attacker); the extra margin costs nothing and
-- removes any need to reason precisely about the minimum, the same way
-- next_invoice_number() over-provisions its own guarantees where cheap.
--
-- The token is NOT derived from the invoice id, invoice_number, account id,
-- or anything else visible to a client — it is pure randomness, generated
-- once at share-creation time and stored verbatim (see the "why not hash
-- it" note on pilot.invoice_shares below).
-- ***************************************************************************

-- gen_random_bytes needs pgcrypto (gen_random_uuid(), used everywhere else
-- in this schema, is core Postgres since v13 and needs nothing — this is
-- the first migration on this branch that needs a REAL CSPRNG byte
-- generator rather than a random uuid). Supabase's `extensions` schema is
-- on PostgREST's search path (see supabase/config.toml) but every function
-- below pins `search_path = ''`, so every call site schema-qualifies it as
-- `extensions.gen_random_bytes` regardless of whether this already existed.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. pilot.invoice_shares — one row per invoice that has EVER been shared.
--    An invoice with no row here has no public URL: sharing is opt-in per
--    invoice, never automatic. `unique (account_id, invoice_id)` means
--    "share again" is a ROTATION (new token, clears revoked_at) rather than
--    a second live link — see pilot.invoice_share_create below — so an old,
--    emailed link that got rotated away is a natural revoke, not something
--    that has to be separately tracked.
--
--    WHY THE TOKEN IS STORED PLAINTEXT, NOT HASHED: unlike a password, this
--    token is never compared against anything the LEGITIMATE holder typed —
--    it's a bearer capability the pilot generates and hands out, structurally
--    identical to `pilot.invoices.stripe_payment_link_url` two migrations
--    up the branch (also a plaintext bearer secret, also the exact string
--    Stripe hands anyone who has the link). Hashing would add a second
--    lookup shape (compare-by-hash instead of an index equality match) for
--    no real gain here: the value is never logged (see invoice-share-verify
--    and the public route below), RLS still restricts SELECT on this table
--    to the owning account's own members (a pilot can see their own
--    invoice's token to copy it again; nobody else can), and a leak of this
--    table is already a leak of the database, at which point row-level
--    hashing of one bearer token is not the containment boundary that
--    matters.
-- ---------------------------------------------------------------------------
create table if not exists pilot.invoice_shares (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  invoice_id uuid not null,
  foreign key (account_id, invoice_id) references pilot.invoices (account_id, id) on delete cascade,
  -- 32 random bytes, base64url, no padding: 43 chars from [A-Za-z0-9_-].
  -- CHECK enforces the shape for every writer (including a hypothetical
  -- future service_role caller) — the same "a CHECK holds even for the
  -- most privileged role" pattern as accounts_connect_account_id_format
  -- two migrations up this branch.
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  revoked_at timestamptz,
  unique (account_id, invoice_id)
);

comment on table pilot.invoice_shares is
  'One row per invoice ever shared, at most one live token per invoice (unique account_id,invoice_id — re-sharing ROTATES the token, see pilot.invoice_share_create). Written only through pilot.invoice_share_create/pilot.invoice_share_revoke, both SECURITY DEFINER; there is no direct INSERT/UPDATE grant to authenticated. Read by pilot.invoice_public (anon + authenticated EXECUTE) — the token column is the entire access boundary for app/invoice/[token], so treat any change here as a security change.';

alter table pilot.invoice_shares enable row level security;

-- The pilot can see their own invoices' tokens (to re-copy a link) but
-- nothing else here needs a policy: there is deliberately no INSERT/UPDATE/
-- DELETE policy for `authenticated` — every write goes through the two
-- SECURITY DEFINER functions below, which is what lets each one carry its
-- own membership + status checks that a bare RLS policy cannot express
-- (RLS has no way to say "only if the invoice is currently sent/partial/
-- paid", which is a cross-table, cross-time-of-write invariant).
create policy invoice_shares_select on pilot.invoice_shares for select to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- No grant to anon at all — anon reaches this table's data ONLY through
-- pilot.invoice_public below, never directly.
grant select on pilot.invoice_shares to authenticated;
grant select, insert, update, delete on pilot.invoice_shares to service_role;

create index if not exists invoice_shares_invoice_idx on pilot.invoice_shares (account_id, invoice_id);

-- ---------------------------------------------------------------------------
-- 2. pilot.invoice_share_create — mint (or rotate) a share token for one of
--    the caller's own invoices. Membership-gated the same way
--    createInvoiceDraft/sendInvoice/voidInvoice are (any member, not
--    owner-only — sharing an invoice with a client is an ordinary billing
--    action, not an account-level entitlement change like Connect
--    onboarding). Returns the new token as plain text — this is the ONE
--    moment the plaintext travels through a return value the app then
--    displays to the pilot; nothing downstream of this call logs it (see
--    share-actions.ts).
--
--    STATUS GATE: only 'sent', 'partial', or 'paid' may be shared. A draft
--    is explicitly excluded — draft is the one status a client must never
--    see (unissued, unreviewed, no invoice_number, still fully editable —
--    sharing a draft would let a client watch line items change under
--    them, and would leak "this pilot drafts invoices they never send" as
--    a side channel). 'void' is excluded too: nothing to collect, nothing
--    worth a client link.
-- ---------------------------------------------------------------------------
create or replace function pilot.invoice_share_create(p_invoice_id uuid)
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
  from pilot.invoices
  where id = p_invoice_id
    and account_id in (select pilot.current_account_ids());

  if v_account_id is null then
    raise exception 'invoice % not found', p_invoice_id;
  end if;

  if v_status not in ('sent', 'partial', 'paid') then
    raise exception 'invoice % (status=%) cannot be shared — only a sent, partially paid, or paid invoice may have a public link', p_invoice_id, v_status;
  end if;

  -- base64url, no padding: translate the two characters that differ from
  -- plain base64 and strip the trailing '=' padding gen_random_bytes(32)'s
  -- encoding always produces for a 32-byte input.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_');
  v_token := replace(v_token, '=', '');

  insert into pilot.invoice_shares (account_id, invoice_id, token, created_by)
  values (v_account_id, p_invoice_id, v_token, auth.uid())
  on conflict (account_id, invoice_id)
  do update set token = excluded.token, revoked_at = null, created_by = excluded.created_by, created_at = now();

  return v_token;
end;
$$;

revoke all on function pilot.invoice_share_create(uuid) from public;
grant execute on function pilot.invoice_share_create(uuid) to authenticated;

comment on function pilot.invoice_share_create(uuid) is
  'Mints or ROTATES the one live share token for an invoice the caller is a member of. Owner-or-member gated via current_account_ids() (not owner-only — matches sendInvoice/voidInvoice). Rejects draft/void invoices. SECURITY DEFINER: the membership + status checks in the body ARE the access boundary, since DEFINER bypasses RLS entirely.';

-- ---------------------------------------------------------------------------
-- 3. pilot.invoice_share_revoke — kill a token immediately. A revoked
--    token's row still exists (for audit / so re-sharing rotates rather
--    than duplicates) but pilot.invoice_public's `revoked_at is null`
--    filter makes it return nothing from the instant this commits.
-- ---------------------------------------------------------------------------
create or replace function pilot.invoice_share_revoke(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update pilot.invoice_shares
    set revoked_at = now()
    where invoice_id = p_invoice_id
      and account_id in (select pilot.current_account_ids())
      and revoked_at is null;
end;
$$;

revoke all on function pilot.invoice_share_revoke(uuid) from public;
grant execute on function pilot.invoice_share_revoke(uuid) to authenticated;

comment on function pilot.invoice_share_revoke(uuid) is
  'Revokes the caller''s own invoice''s share token immediately (idempotent no-op if already revoked or never shared). Membership-gated the same way as pilot.invoice_share_create.';

-- ---------------------------------------------------------------------------
-- 4. pilot.invoice_public — the ONLY path from an unauthenticated request
--    to invoice data. Takes a token, returns exactly one invoice's
--    rendering data as jsonb, or NULL for anything that isn't a live
--    token on a shareable invoice — an unknown token, a revoked one, and a
--    token whose invoice somehow reverted out of a shareable status all
--    take the identical NULL path, so the public route (app/invoice/
--    [token]/page.tsx) 404s the same way for all three and never learns
--    which case it was.
--
--    FIELD-BY-FIELD justification for every column selected below lives in
--    app/invoice/[token]/page.tsx's own header comment, which is the
--    caller that actually renders these fields — keeping the "why this
--    field" reasoning next to the "how it's displayed" code rather than
--    duplicating it here. This function's OWN job is narrower: prove the
--    token maps to exactly one invoice, and go no wider than that
--    invoice's own header, lines, totals, the billing pilot's business
--    identity, and the billed client's own name/address — never another
--    invoice, another client, or anything about the account beyond what
--    already appears on this one document.
--
--    TIMING: no constant-time comparison is attempted here. `token = ...`
--    is a plain btree-indexed equality lookup — its cost is a function of
--    table SIZE (O(log n) index descent), not of how many leading
--    characters of the guess happen to match, so it does not have the
--    classic byte-by-byte string-compare timing side channel a naive
--    `for i in 1..length loop ... end loop` verifier would. The residual
--    timing difference between a hit and a miss (a miss stops at the
--    index; a hit goes on to fetch and join four more tables) is real but
--    is the wrong signal to defend against here: an attacker who can
--    already distinguish "index says maybe" from "index says no" against
--    a 256-bit random space has nothing to gain from that distinction —
--    the search space is what makes this safe, not the timing profile of
--    one lookup. Treated as OUT OF SCOPE for this reason, not overlooked.
-- ---------------------------------------------------------------------------
create or replace function pilot.invoice_public(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_account_id uuid;
  v_invoice_id uuid;
  result jsonb;
begin
  select s.account_id, s.invoice_id into v_account_id, v_invoice_id
  from pilot.invoice_shares s
  join pilot.invoices i on i.account_id = s.account_id and i.id = s.invoice_id
  where s.token = p_token
    and s.revoked_at is null
    and i.status in ('sent', 'partial', 'paid');

  if v_account_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'invoice', jsonb_build_object(
      'invoice_number', i.invoice_number,
      'status', i.status,
      'issued_on', i.issued_on,
      'due_on', i.due_on,
      'notes', i.notes
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
      ) order by l.sort_order)
      from pilot.invoice_lines l
      where l.account_id = v_account_id and l.invoice_id = v_invoice_id
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subtotal_cents', t.subtotal_cents,
      'tax_cents', t.tax_cents,
      'total_cents', t.total_cents,
      'amount_paid_cents', t.amount_paid_cents,
      'balance_due_cents', t.balance_due_cents,
      'last_paid_on', t.last_paid_on
    ),
    'payment', jsonb_build_object(
      'url', i.stripe_payment_link_url,
      'livemode', i.stripe_payment_link_livemode
    )
  )
  into result
  from pilot.invoices i
  join pilot.accounts a on a.id = i.account_id
  join pilot.clients c on c.account_id = i.account_id and c.id = i.client_id
  join pilot.invoice_totals t on t.invoice_id = i.id
  where i.account_id = v_account_id and i.id = v_invoice_id;

  return result;
end;
$$;

-- The one schema-level grant this whole migration adds to anon — see the
-- file header's "THE SHAPE OF THE PROBLEM" note for exactly what this
-- does and does not permit.
grant usage on schema pilot to anon;

revoke all on function pilot.invoice_public(text) from public;
-- anon is the whole point of this function; authenticated too, so a
-- signed-in pilot previewing their own share link (share-panel.tsx) sees
-- byte-for-byte what their client will see, through the same code path.
grant execute on function pilot.invoice_public(text) to anon, authenticated;

comment on function pilot.invoice_public(text) is
  'The ONE path from an unauthenticated request to invoice data. Returns null (never an error, never a partial object) for an unknown token, a revoked one, or an invoice no longer in a shareable status — all three are indistinguishable to the caller by design. SECURITY DEFINER, granted to anon: this function IS the access boundary pilot.invoice_shares/pilot.invoices/pilot.invoice_lines/pilot.invoice_totals/pilot.accounts/pilot.clients rely on for the public route, since none of those tables grant anon anything directly. Do not widen the jsonb it returns without re-reading app/invoice/[token]/page.tsx''s field-by-field justification comment.';
