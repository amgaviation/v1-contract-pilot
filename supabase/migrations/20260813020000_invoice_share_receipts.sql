-- ===========================================================================
-- Receipts on the CLIENT-FACING invoice page
--
-- Read supabase/migrations/20260809060000_invoice_public_share.sql in full
-- before touching this file. That migration built the share boundary and
-- its header is the security rationale for the whole surface; this one adds
-- exactly one function to it and takes a deliberately DIFFERENT position on
-- who may call it. The difference is the point, so it is stated first.
--
-- ***************************************************************************
-- WHAT A PILOT IS ACTUALLY ASKING FOR
--
-- A contract pilot who fronts a $412 hotel bill on a client's trip rebills
-- it, and the client's accounts-payable desk needs the receipt to
-- substantiate the line. The PDF already does this — lib/invoice-receipts.ts
-- classifies the bytes, lib/invoice-document.tsx embeds the decodable ones
-- as pages and degrades the rest to honestly-captioned fallback pages, and
-- the emailed copy carries them. The share LINK showed the lines and the
-- totals and no receipts at all. Same invoice, same client, same rebilled
-- hotel bill, two different answers depending on which one they opened.
--
-- WHAT AUTHORISES THE DISCLOSURE, STATED CAREFULLY, BECAUSE THE OBVIOUS
-- ARGUMENT IS WRONG. The tempting one — "this is not a new disclosure, the
-- same client was already emailed that same receipt as a page of that same
-- invoice's PDF", by analogy with 20260809060000's argument about `notes`
-- — does not survive contact with the send path, and an earlier draft of
-- this header made it anyway. It is false in three ordinary cases:
--
--   * The send dialog's "Attach N receipts for rebilled expenses" checkbox
--     (app/(app)/invoices/[id]/status-actions.tsx) was UNticked. That is a
--     per-send choice recorded nowhere, so nothing in this schema can
--     consult it.
--   * delivery_method = 'manual_download'. This product emailed nothing;
--     what the pilot sent by hand is unknown to it.
--   * The invoice was sent before receipt embedding existed (fb1ea11), so
--     its PDF carried no receipt pages at all.
--
-- A second false premise went with it: that the share link "is the one in
-- the email". It is not. lib/email/invoice-message.ts puts only the Stripe
-- paymentUrl in the body; the share link is minted separately in
-- pilot.invoice_share_create and copied out of the invoice screen's share
-- panel by hand. The two surfaces reach a client by different routes.
--
-- THE ARGUMENT THAT DOES HOLD is consent at the link, not precedent from
-- the email. An invoice has no public URL until a pilot presses "Create
-- client link" — sharing is opt-in per invoice (see pilot.invoice_shares
-- below), revocable in one press, and the pilot chooses who receives the
-- URL. That makes this an authorised disclosure exactly when the pilot
-- knows what the link discloses, which is a UI obligation, not a SQL one:
-- app/(app)/invoices/[id]/share-panel.tsx names the receipts in the panel
-- that mints the link, and status-actions.tsx says that the emailed PDF's
-- checkbox does not govern this surface. If either sentence is ever
-- removed, this function becomes a disclosure nobody agreed to — treat
-- them as part of this migration.
-- ***************************************************************************
--
-- ***************************************************************************
-- WHY THIS FUNCTION IS NOT GRANTED TO anon, UNLIKE EVERY OTHER FUNCTION ON
-- THIS BOUNDARY
--
-- pilot.invoice_public and pilot.document_packet_public are granted to anon
-- because their RESULTS are what the visitor may see. This function's result
-- is not: it returns STORAGE PATHS, which are `<account_id>/<uuid>.jpg`. The
-- account UUID and the expense-object UUIDs are internal identifiers, and
-- 20260809060000's field-by-field justification is explicit that internal
-- foreign keys (expense_id, trip_id) must never reach the client, "internal
-- foreign keys into tables this client must never be able to correlate
-- against". A path is one of those wearing a filename.
--
-- Granting it to anon would also be pointless: anon holds no privilege on
-- storage.objects and could not fetch a path it was handed. So the caller is
-- the SERVER, holding the secret key, and the grant says so —
-- `to service_role` and nothing else. anon's privilege set is byte-for-byte
-- unchanged by this migration: no new table grant, no new function it may
-- execute, nothing added to its schema usage. That is worth checking rather
-- than believing; scripts/invoice-share-verify.mjs's SHARE-1/SHARE-1b
-- assertions still hold unchanged.
--
-- BE HONEST ABOUT WHAT THAT BUYS. A caller holding the service-role key
-- could run this join itself; the key bypasses RLS. This function is
-- therefore a DISCIPLINE boundary, not a privilege boundary — the same
-- distinction lib/supabase/service-role.ts's header draws about the product
-- as a whole ("the product's real guarantee is that no RLS policy and no
-- OTHER application code path grants tenant A anything about tenant B").
-- What it buys is real and worth the file: the token-to-receipt translation
-- exists in ONE place, written once, reviewable in one screen, and the
-- application never assembles a storage path from anything a visitor sent.
-- The route cannot widen it by editing a query, because the route has no
-- query.
-- ***************************************************************************
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   * No table is created, altered or dropped. There is nothing here to
--     enable RLS on and no column-scoped grant to write — the additive
--     template of 20260813000000 applies to tables, and this file has none.
--   * pilot.invoice_public is NOT modified. It keeps its exact result shape
--     and its anon grant; a reader comparing the public page against that
--     function's field-by-field list will still find them in agreement.
--   * NO STORAGE POLICY IS ADDED, and specifically none for anon. The
--     credential-packet migration (20260810100000) recorded the rule this
--     follows: "NO FILE BYTES CROSS THIS BOUNDARY... this migration
--     deliberately does not grant anon any path to storage.objects." Still
--     true here. The bytes are fetched server-side and inlined into the
--     already-token-gated page, so there is no signed URL, no addressable
--     image endpoint, and nothing that outlives a revoked share by even one
--     request — see lib/invoice-share-receipts.ts for that reasoning in
--     full. That packet warning stands, unchanged, for the packet's
--     documents.
--
-- WHY THE SAME STATUS/REVOCATION PREDICATE, WRITTEN OUT AGAIN. It is copied
-- from pilot.invoice_public verbatim (and matches
-- pilot.invoice_share_mark_viewed's, 20260812200000): a live token, an
-- unrevoked share, and an invoice still in ('sent','partial','paid'). Three
-- functions now carry it. Factoring it into a shared helper was considered
-- and rejected — the predicate IS the access boundary, and a boundary that
-- lives behind an indirection is one that a future edit can widen for three
-- callers while looking like it changed one. If they must ever diverge, the
-- divergence should be visible in the diff of the function that diverged.
-- ===========================================================================

create or replace function pilot.invoice_share_receipts(p_token text)
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
  -- Wrong length/charset cannot be a real token (the CHECK on
  -- invoice_shares.token guarantees every stored one matches this), so
  -- return before touching a table — the same early exit
  -- pilot.invoice_share_mark_viewed makes, and the same nothing a valid
  -- miss returns.
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;

  select s.account_id, s.invoice_id into v_account_id, v_invoice_id
  from pilot.invoice_shares s
  join pilot.invoices i on i.account_id = s.account_id and i.id = s.invoice_id
  where s.token = p_token
    and s.revoked_at is null
    and i.status in ('sent', 'partial', 'paid');

  -- Unknown token, revoked share, and an invoice that reverted out of a
  -- shareable status all return the same null — identical to
  -- pilot.invoice_public, so a caller cannot tell them apart here either.
  if v_account_id is null then
    return null;
  end if;

  select jsonb_build_object(
    -- Returned so the caller can prove the path it is about to fetch begins
    -- with the tenant it was authorised for, WITHOUT the caller having to
    -- know (or look up) which tenant that is. Storage RLS would enforce the
    -- same prefix rule for a session-scoped client; the service-role client
    -- bypasses it, so the check has to be made by the code that holds the
    -- key, from a value only this function can supply.
    'account_id', v_account_id,
    'receipts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          -- The invoice LINE's description and amount, not the expense's.
          -- The line is what the client is being billed and what they are
          -- reading; pilot.expenses.amount_cents is what the PILOT paid,
          -- which 20260809060000's header is explicit must never cross this
          -- boundary. Same pair lib/invoice-document.tsx captions its
          -- receipt pages with, so the page and the PDF caption identically.
          'description', l.description,
          'amount_cents', l.amount_cents,
          'path', e.receipt_path
        ) order by l.sort_order
      )
      from pilot.invoice_lines l
      join pilot.expenses e
        on e.account_id = l.account_id and e.id = l.expense_id
      where l.account_id = v_account_id
        and l.invoice_id = v_invoice_id
        -- A rebill line, by the same test lib/invoice-document.tsx uses
        -- (expense_id is not null), so the two surfaces attach receipts to
        -- exactly the same set of lines.
        and l.expense_id is not null
        -- A rebill line whose expense has no receipt on file yields nothing
        -- at all — never a "missing receipt" row, which would invent a
        -- problem in front of the client.
        and e.receipt_path is not null
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

comment on function pilot.invoice_share_receipts(text) is
  'Token -> the storage paths of the receipts attached to that shared invoice''s rebilled lines, plus the owning account_id for a prefix check. SAME live-token/unrevoked/shareable-status predicate as pilot.invoice_public. Deliberately NOT granted to anon or authenticated: it returns internal storage paths, and anon holds no storage privilege to use them with. service_role only — the server fetches the bytes and inlines them into the token-gated page; no signed URL and no public image endpoint exists.';

-- No anon grant, no authenticated grant. See the header.
revoke all on function pilot.invoice_share_receipts(text) from public;
grant execute on function pilot.invoice_share_receipts(text) to service_role;
