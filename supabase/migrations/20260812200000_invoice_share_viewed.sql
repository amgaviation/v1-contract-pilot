-- Share-link viewed tracking (docs/WAVE-PARITY.md §8 item 1, the "share-link
-- view tracking is a column and a stamp" half — paid-notification is NOT
-- built here, for the Connect-Standard reason that row records).
--
-- Read 20260809060000_invoice_public_share.sql IN FULL before touching this
-- file. That migration is the entire access boundary for the product's one
-- unauthenticated tenant-data route, it survived six review rounds, and this
-- migration's job is to EXTEND it without weakening anything it guarantees:
--
--   * No new table grant to anon, on this table or any other. anon still
--     reaches pilot.invoice_shares data only through SECURITY DEFINER
--     functions, and the one added here writes two timestamp columns and
--     returns void — it can never be used to read anything.
--   * pilot.invoice_public is untouched. It stays `stable`, stays read-only,
--     and stays the only translation from token to invoice data.
--   * The stamp function's own token/validity checks mirror
--     pilot.invoice_public's WHERE clause exactly (live token, unrevoked,
--     invoice still in a shareable status), so a token that would 404 on the
--     public page can never leave a mark here — an unknown token, a revoked
--     one, and a voided invoice's token are all identical no-ops.
--
-- WHAT A STAMP MEANS, honestly: "this share link was FETCHED while valid."
-- Mail scanners and link-preview bots GET pages, and this product has no
-- deliverability-grade way to tell a human's browser from Outlook SafeLinks —
-- Wave's own viewed-tracking has the same property. So the UI (share-panel)
-- says "Viewed <timestamp>", a fact about the LINK, and never claims "your
-- client read it", a fact about a person. The one viewer this deliberately
-- does NOT count is the pilot themself: a signed-in member of the owning
-- account previewing their own link (share-panel's stated preview path) is
-- excluded in-body, because every pilot opens their own link right after
-- creating it and a stamp from that would make the feature permanently
-- report "Viewed" on every share ever made.

-- ---------------------------------------------------------------------------
-- 1. The two columns. Nullable, no default — NULL means "never fetched while
--    valid", which is real information the share panel renders as "Not viewed
--    yet". The CHECK holds for every writer including service_role (same
--    "a CHECK binds the most privileged role too" pattern as the token-shape
--    CHECK one migration down this file's lineage): the two stamps travel
--    together, and first can never postdate last.
-- ---------------------------------------------------------------------------
alter table pilot.invoice_shares
  add column if not exists first_viewed_at timestamptz,
  add column if not exists last_viewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_shares_viewed_pair'
      and conrelid = 'pilot.invoice_shares'::regclass
  ) then
    alter table pilot.invoice_shares
      add constraint invoice_shares_viewed_pair check (
        ((first_viewed_at is null) = (last_viewed_at is null))
        and (first_viewed_at is null or first_viewed_at <= last_viewed_at)
      );
  end if;
end $$;

-- Keep the table's contract comment truthful: there is now a third SECURITY
-- DEFINER writer, and it can touch exactly two columns.
comment on table pilot.invoice_shares is
  'One row per invoice ever shared, at most one live token per invoice (unique account_id,invoice_id — re-sharing ROTATES the token, see pilot.invoice_share_create). Written only through pilot.invoice_share_create/pilot.invoice_share_revoke/pilot.invoice_share_mark_viewed, all SECURITY DEFINER; there is no direct INSERT/UPDATE grant to authenticated. Read by pilot.invoice_public (anon + authenticated EXECUTE) — the token column is the entire access boundary for app/invoice/[token], so treat any change here as a security change. first_viewed_at/last_viewed_at mean "fetched while valid" (mail scanners count; the owning account''s own members do not) and are written ONLY by pilot.invoice_share_mark_viewed, which rejects revoked tokens and non-shareable statuses with the same conditions pilot.invoice_public 404s them.';

-- ---------------------------------------------------------------------------
-- 2. pilot.invoice_share_mark_viewed — the anon-callable stamp, and the ONLY
--    writer of the two columns above.
--
--    SECURITY POSTURE, item by item (per the house SECURITY DEFINER
--    conventions established in 20260802190437 and 20260809060000):
--      * security definer + `set search_path = ''` + every reference
--        schema-qualified.
--      * revoke all from public; grant execute to anon and authenticated
--        only. anon holds USAGE on schema pilot already (granted by
--        20260809060000 for invoice_public); NO table grant is added — the
--        function body running as the definer is the only path to the row.
--      * returns void, unconditionally. Not a boolean, not a count: a caller
--        probing tokens learns NOTHING from calling this — hit and miss are
--        byte-identical — so it cannot be used as a cheaper token oracle
--        than invoice_public itself (which already returns null for a miss).
--      * never raises for bad input. A malformed token, an unknown one, a
--        revoked one, a voided invoice's one: all fall through to "0 rows
--        updated", silently. Raising would leak the same hit/miss bit the
--        void return type exists to withhold.
--      * writes exactly two columns, both timestamps, both derived from
--        now() — no caller-supplied value is ever stored, so there is
--        nothing to inject: p_token is only ever COMPARED (indexed equality,
--        same non-timing-oracle argument as invoice_public's TIMING note).
--      * in-body tenancy: the update's WHERE re-proves everything
--        invoice_public proves (token live, unrevoked, invoice in
--        sent/partial/paid — via the invoice row itself, account-scoped by
--        the composite join exactly like invoice_public's own join), plus
--        one narrowing this function alone needs: the owning account's own
--        members never stamp (see the header). pilot.current_account_ids()
--        is empty for anon, so for the public visitor that predicate is
--        always true; for a signed-in pilot previewing their own invoice it
--        is false and the update matches nothing.
--
--    The shape pre-check duplicates app/invoice/[token]/page.tsx's regex ON
--    PURPOSE: the route checks it to spare the database a round trip, and
--    this function cannot assume its caller is that route — anon can invoke
--    any granted function directly over PostgREST, so the function carries
--    its own guard rather than trusting the app's.
-- ---------------------------------------------------------------------------
create or replace function pilot.invoice_share_mark_viewed(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Wrong length/charset can't be a real token (CHECK on the column
  -- guarantees every stored token matches this) — return before touching
  -- any table, and return the same nothing a valid miss returns.
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;

  update pilot.invoice_shares s
     set first_viewed_at = coalesce(s.first_viewed_at, now()),
         last_viewed_at  = now()
   where s.token = p_token
     and s.revoked_at is null
     -- The invoice must STILL be shareable at stamp time — same status set
     -- as invoice_public's join, account-scoped through the same composite
     -- key, so a token whose invoice reverted out of a shareable status
     -- stops stamping the instant it stops rendering.
     and exists (
       select 1
       from pilot.invoices i
       where i.account_id = s.account_id
         and i.id = s.invoice_id
         and i.status in ('sent', 'partial', 'paid')
     )
     -- A member of the owning account previewing their own link is not a
     -- client view. Empty set for anon (auth.uid() is null), so this only
     -- ever narrows the authenticated-preview case.
     and s.account_id not in (select pilot.current_account_ids());
end;
$$;

revoke all on function pilot.invoice_share_mark_viewed(text) from public;
-- anon is the point (the client opening the emailed link has no session);
-- authenticated so a signed-in viewer who is NOT a member of the owning
-- account still counts — the in-body membership predicate, not the grant,
-- is what excludes the pilot's own preview.
grant execute on function pilot.invoice_share_mark_viewed(text) to anon, authenticated;

comment on function pilot.invoice_share_mark_viewed(text) is
  'Stamps first_viewed_at (once) and last_viewed_at (every call) on a LIVE share — valid token, unrevoked, invoice still sent/partial/paid — and is a silent no-op for everything else, including the owning account''s own members previewing their link. Returns void unconditionally so it leaks no hit/miss bit; writes nothing caller-supplied; touches exactly these two columns and no others. SECURITY DEFINER granted to anon + authenticated: the in-body checks ARE the access boundary, mirroring pilot.invoice_public''s WHERE clause exactly. "Viewed" means the link was FETCHED while valid — mail scanners count, and the UI wording must never claim more (see share-panel.tsx).';

-- ---------------------------------------------------------------------------
-- 3. pilot.invoice_share_create — re-issued verbatim EXCEPT that rotation now
--    clears the view stamps. Without this, "Generate a new link" would carry
--    the OLD link's "Viewed Aug 10" onto a fresh token nobody has opened,
--    and the panel would claim a view of a link that has never been fetched.
--    A rotation is a new bearer credential; its view history starts empty,
--    exactly like its revocation state (revoked_at was already cleared here).
--
--    Diff against 20260809060000's version: the two `first_viewed_at = null,
--    last_viewed_at = null` assignments in the ON CONFLICT update. Nothing
--    else — same membership gate, same status gate, same token generation,
--    same return. Do not edit this copy without re-reading that migration's
--    own comments; they still govern.
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
  do update set
    token = excluded.token,
    revoked_at = null,
    created_by = excluded.created_by,
    created_at = now(),
    -- A rotated link is a NEW credential: its view history starts empty.
    first_viewed_at = null,
    last_viewed_at = null;

  return v_token;
end;
$$;

-- Grants unchanged from 20260809060000 (create or replace preserves them,
-- and nothing here should widen or narrow that function's audience).

comment on function pilot.invoice_share_create(uuid) is
  'Mints or ROTATES the one live share token for an invoice the caller is a member of. Owner-or-member gated via current_account_ids() (not owner-only — matches sendInvoice/voidInvoice). Rejects draft/void invoices. SECURITY DEFINER: the membership + status checks in the body ARE the access boundary, since DEFINER bypasses RLS entirely. Rotation clears first_viewed_at/last_viewed_at along with revoked_at — a new token has no view history (20260812200000).';
