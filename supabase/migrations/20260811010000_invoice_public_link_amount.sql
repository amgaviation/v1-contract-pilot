-- ===========================================================================
-- pilot.invoice_public was showing a client one number and charging another
-- ===========================================================================
-- app/invoice/[token]/page.tsx labels the "Pay online" button with
-- invoice.totals.balance_due_cents — the CURRENT balance — but the Stripe
-- Payment Link it links to charges whatever pilot.invoices.
-- stripe_payment_link_amount_cents was when the link was GENERATED (a
-- Payment Link snapshots a Price at creation time; it does not track the
-- invoice afterwards). The two agree only until the balance changes without
-- the link being retired.
--
-- pilot.invoice_public (20260809060000) predates
-- stripe_payment_link_amount_cents (added a day later, 20260810010000), so
-- it never had the column to return. The signed-in screen has always had
-- both numbers and used them to detect exactly this mismatch —
-- payment-panel.tsx's `stale` callout, lines ~134-139 of that file — but
-- the public page could only ever show the balance, never compare it to
-- what the link actually charges.
--
-- The realistic path there: pilot records a mistyped payment (typo, wrong
-- digit), generates a link priced off the wrong balance, then runs
-- correctPayment to fix the typo (see this same date's app/(app)/invoices/
-- actions.ts change, which now retires the link on a correction the same
-- way recordPayment always has). Between "link generated" and "link
-- retired" there is a real window — and, for any invoice.payment row this
-- function returns, the ONLY way the app can tell whether that window has
-- closed is by comparing this new column to the live balance.
--
-- THE FIX. Return stripe_payment_link_amount_cents alongside url/livemode
-- in the `payment` object. Nothing else about the function's access
-- boundary changes: this is one more column off a table the function
-- already reads in full as SECURITY DEFINER (see FIELD-BY-FIELD
-- justification below, and the field-by-field comment on
-- app/invoice/[token]/page.tsx, which this migration's own header points
-- readers to rather than duplicating).
--
-- NOT A VIEW, so none of the "create or replace view is positional and
-- append-only" trap applies here — this function returns a plain jsonb
-- object built fresh on every call by jsonb_build_object, which has no
-- fixed column list to violate. The new key is still added at the END of
-- the `payment` object purely for readability, matching how this file's
-- other objects read.
--
-- NO GRANT CHANGES NEEDED. `create or replace function` does not drop the
-- function's existing grants (unlike a DROP + CREATE), so the
-- `grant execute ... to anon, authenticated` from 20260809060000 is
-- untouched and does not need restating. And because this function is
-- SECURITY DEFINER, it already reads pilot.invoices in full as the
-- function's owner — anon has never held (and still does not hold) any
-- column-level SELECT privilege on pilot.invoices itself, so there is no
-- revoke/grant to touch and no risk of the revoke trap
-- (20260810130000's header) applying here.
-- ===========================================================================

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
      'livemode', i.stripe_payment_link_livemode,
      -- NEW. The balance the stored link was actually priced for, at
      -- generation time — see this migration's header. Lets the public
      -- page detect a stale link the same way payment-panel.tsx's `stale`
      -- callout already does for the signed-in screen, instead of
      -- labelling "Pay online" with a number Stripe will not charge.
      'amount_cents', i.stripe_payment_link_amount_cents
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

comment on function pilot.invoice_public(text) is
  'The ONE path from an unauthenticated request to invoice data. Returns null (never an error, never a partial object) for an unknown token, a revoked one, or an invoice no longer in a shareable status — all three are indistinguishable to the caller by design. SECURITY DEFINER, granted to anon: this function IS the access boundary pilot.invoice_shares/pilot.invoices/pilot.invoice_lines/pilot.invoice_totals/pilot.accounts/pilot.clients rely on for the public route, since none of those tables grant anon anything directly. payment.amount_cents (20260811010000) is the snapshotted price of the stored link, not the current balance — app/invoice/[token]/page.tsx compares it to totals.balance_due_cents before ever treating the link as payable. Do not widen the jsonb it returns without re-reading app/invoice/[token]/page.tsx''s field-by-field justification comment.';
