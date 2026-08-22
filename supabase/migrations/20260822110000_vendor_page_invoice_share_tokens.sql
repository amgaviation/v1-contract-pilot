-- ===========================================================================
-- The vendor page's open invoices get their own share links
--
-- WHAT WAS MISSING. pilot.client_vendor_page_public (20260814112000) lists a
-- client's open invoices — number, due date, status, balance — and that
-- migration's own field list explains that line-item detail "belongs on that
-- invoice's own share link, not folded into a rollup". Correct, and the page
-- never carried those links: an AP clerk who wanted to see what an invoice
-- was FOR, or to pay it, had to go back to their inbox and find the mail the
-- pilot sent weeks ago. That is the exact chore ("AP has to hold N separate
-- emailed links") the vendor page's own header names as the reason the
-- feature exists, so the rollup was solving half of its own problem.
--
-- WHAT THIS CHANGES. One key — share_token — on each open_invoices element:
-- the token of that invoice's OWN live share, or null when the pilot has not
-- shared that invoice (or has revoked it). Nothing else about
-- pilot.client_vendor_page_public moves; the function is restated in full
-- below because it is `create or replace` and this file must be readable as
-- the whole current definition, not as a diff. paid_invoices deliberately
-- gets NO token: the only question a clerk has about a paid invoice is "did
-- you get it", which the row already answers, and a second live credential
-- that answers nothing new is data leaving the tenant for free.
--
-- NEVER MINTS, EXACTLY LIKE packet_token. The subquery reads
-- pilot.invoice_shares; it does not create, rotate, or extend a share. An
-- invoice the pilot has never shared shows as plain text on the page, and
-- the honest answer stays "ask your pilot" rather than a link this function
-- manufactured on the pilot's behalf. Same rule, same reason, as the packet
-- pass-through below it.
--
-- WHY THIS DOES NOT WIDEN WHAT A VENDOR TOKEN CAN READ:
--
--   * SAME SCOPE AS THE ROLLUP ITSELF. The lookup is bound to the account
--     the vendor link resolved to (s.account_id = v_account_id) and to an
--     invoice row that already passed this function's own
--     `i.client_id = v_client_id` filter — the invoice must be billed to the
--     very client the token names. There is no path from here to another
--     client's invoice, or another account's, because the only invoice ids
--     the subquery ever sees are the ones the rollup was already allowed to
--     list.
--   * ONLY WHILE THE VENDOR LINK IS LIVE. An unknown, revoked or expired
--     vendor token returns null several statements above this point, so a
--     dead vendor page hands out nothing at all.
--   * ONLY LIVE SHARES. `revoked_at is null` is the same filter
--     pilot.invoice_public applies before it will serve anything, so a token
--     surfaced here is a token that still works. `unique (account_id,
--     invoice_id)` on pilot.invoice_shares (20260809060000) means the scalar
--     subquery can match at most one row — no aggregation, no "more than one
--     row returned" hazard.
--   * NOTHING THIS CLIENT WAS NOT ALREADY SENT. An invoice share token is
--     minted by the pilot for one invoice billed to this client and mailed
--     to that client's own billing contact. Handing the same client the same
--     token on the same client's own vendor page is a second surface for a
--     credential they were already given, not a new disclosure — the same
--     reasoning pilot.invoice_public's field list uses for the notes column.
--   * NO NEW PRIVILEGE ANYWHERE. No grant, no policy, no table, no column.
--     The read happens inside a SECURITY DEFINER function that already reads
--     pilot.invoices and pilot.invoice_totals for these same rows; anon's
--     privileges on pilot.invoice_shares stay exactly what they have always
--     been, which is none.
--
-- ONE ASYMMETRY, STATED RATHER THAN GLOSSED. A vendor link expires
-- (expires_at NOT NULL, 1-365 days); an invoice share does not — it is
-- revocable only. So a token read off this page keeps working after the
-- vendor page that showed it has expired. That is a property of
-- pilot.invoice_shares as designed in 20260809060000 (one already-finished
-- transaction, revoked when the pilot decides it is done), not something
-- this migration introduces or can fix here: making it expire would retire
-- the emailed link the client is holding at the same moment, which is a
-- change to the invoice-share feature, not to the vendor page.
--
-- STATUS. Only 'sent' and 'partial' invoices are listed here, and both are
-- inside pilot.invoice_public's shareable set ('sent', 'partial', 'paid'),
-- so a token this function surfaces always resolves to a rendered invoice.
-- The vendor page never hands its reader a link that 404s.
-- ===========================================================================

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
        'balance_due_cents', o.balance_due_cents,
        'share_token', o.share_token
      ) order by o.due_on nulls last, o.invoice_number)
      from (
        select
          i.invoice_number,
          i.due_on,
          i.status,
          t.balance_due_cents,
          -- Read-only lookup of an EXISTING share for THIS invoice — never
          -- created, rotated, or extended here. See the file header.
          (
            select sh.token
            from pilot.invoice_shares sh
            where sh.account_id = v_account_id
              and sh.invoice_id = i.id
              and sh.revoked_at is null
          ) as share_token
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

-- No grant statement here, and none is needed: the function already exists
-- with `execute` granted to anon and authenticated (20260814112000), and
-- `create or replace` preserves that. Adding a grant would be noise; a
-- revoke/grant pair would be the trap supabase/migrations/README.md
-- describes.

comment on function pilot.client_vendor_page_public(text) is
  'The ONE path from an unauthenticated request to the per-client vendor rollup. Returns null for an unknown token, a revoked one, or an expired one — indistinguishable by design. SECURITY DEFINER, granted to anon. Reads pilot.document_shares (packet_token) and pilot.invoice_shares (open_invoices[].share_token) read-only to surface links the pilot already minted for this same client; never writes either. Do not widen the jsonb it returns without re-reading app/vendor/[token]/page.tsx''s field-by-field justification.';
