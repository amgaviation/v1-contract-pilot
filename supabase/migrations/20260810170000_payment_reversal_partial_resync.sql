-- ===========================================================================
-- A correction on a PARTIAL invoice walks the status back too
--
-- 20260810120000 taught pilot.invoices to stop reading "paid" when the
-- payment that settled them was corrected. It guarded on `status = 'paid'`
-- and stopped there, which leaves the other half of the same bug in place.
--
-- THE CASE IT MISSED. Invoice for $10,000, status 'sent'. The pilot
-- records one payment and types $6,000 instead of $600 — not enough to
-- settle it, so recordPayment moves the invoice to 'partial'. They notice
-- and click Correct. The -600000 row inserts, invoice_totals now reads
-- amount_paid_cents = 0 and balance_due_cents = 1000000 — and the resync
-- trigger read status = 'partial', failed its equality test, and returned.
-- The invoice went on saying "Partially paid" with $0.00 actually recorded
-- against it, which is a state no screen in the product can explain.
--
-- TWO CHANGES, and the second is why this is not a one-line fix. Widening
-- the trigger's guard is not enough on its own: the status machine has no
-- partial -> sent transition, so the resync would have RAISED and taken
-- the pilot's correction down with it. 20260810120000 added paid->partial
-- and paid->sent behind the reversal flag and stopped there. partial->sent
-- joins them, behind the same flag.
--
-- invoices_protect_issued is re-declared from 20260810130000 — the CURRENT
-- definition — and not from any older copy. Re-declaring a shared function
-- from a stale ancestor is exactly how 20260810120000 dropped
-- stripe_payment_link_amount_cents and broke every payment link in
-- production. All four link columns are present below; check before
-- editing.
-- ===========================================================================

create or replace function pilot.invoice_payments_resync_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_cents bigint;
  paid_cents bigint;
  current_status text;
begin
  if new.reverses_payment_id is null then
    return null;
  end if;

  select status into current_status from pilot.invoices
    where account_id = new.account_id and id = new.invoice_id;
  -- 'partial' belongs here as much as 'paid' does, and leaving it out was
  -- the bug. A $10,000 invoice with a mistyped $6,000 payment sits at
  -- 'partial'; correcting that payment takes amount_paid to zero, and this
  -- guard returned early, so the invoice went on reading "Partially paid"
  -- with $0.00 recorded and no payment behind it. The block below already
  -- computes the right destination from paid_cents — it just never ran.
  if current_status not in ('paid', 'partial') then
    return null;
  end if;

  select amount_paid_cents, balance_due_cents into paid_cents, due_cents
    from pilot.invoice_totals where invoice_id = new.invoice_id;

  if coalesce(due_cents, 0) <= 0 then
    return null; -- still settled; nothing to walk back
  end if;

  perform set_config('pilot.allow_payment_reversal', 'on', true);
  update pilot.invoices
     set status = case when coalesce(paid_cents, 0) > 0 then 'partial' else 'sent' end
   where account_id = new.account_id and id = new.invoice_id;

  return null;
end;
$$;

create or replace function pilot.invoices_protect_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reversal_allowed boolean :=
    coalesce(current_setting('pilot.allow_payment_reversal', true), '') = 'on';
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new; -- webhook/service paths (e.g. payment reconciliation) are exempt
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'   and new.status in ('sent', 'void')) or
      (old.status = 'sent'    and new.status in ('partial', 'paid', 'void')) or
      (old.status = 'partial' and new.status in ('paid', 'void')) or
      -- partial -> sent, correction-driven only. Without this the resync
      -- trigger below RAISES instead of walking the status back, and the
      -- pilot's correction fails outright.
      (old.status = 'partial' and new.status = 'sent' and reversal_allowed) or
      -- Backwards, and only ever driven by a correction row: an invoice
      -- that was marked paid by an overstated payment has to be able to
      -- stop reading as paid once that payment is reversed.
      (old.status = 'paid'    and new.status in ('partial', 'sent') and reversal_allowed)
    ) then
      raise exception 'invoice % cannot move from status % to %', old.id, old.status, new.status;
    end if;

    if old.status = 'draft' and new.status = 'sent' then
      if not exists (
        select 1 from pilot.invoice_lines where account_id = new.account_id and invoice_id = new.id
      ) then
        raise exception 'invoice % cannot be sent with no line items', new.id;
      end if;

      if exists (
        select 1
        from pilot.invoice_lines l
        left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
        left join pilot.trips t on t.account_id = l.account_id and t.id = coalesce(l.trip_id, e.trip_id)
        where l.account_id = new.account_id and l.invoice_id = new.id
          and coalesce(l.trip_id, e.trip_id) is not null
          and t.client_id is distinct from new.client_id
      ) then
        raise exception 'invoice % cannot be sent: one or more line items'' trips belong to a different client', new.id;
      end if;
    end if;

    if new.status in ('partial', 'paid') then
      declare
        paid_cents bigint;
        due_cents bigint;
      begin
        select amount_paid_cents, balance_due_cents into paid_cents, due_cents
          from pilot.invoice_totals where invoice_id = new.id;
        if coalesce(paid_cents, 0) <= 0 then
          raise exception 'invoice % cannot become status=% with no recorded payment', new.id, new.status;
        end if;
        if new.status = 'paid' and coalesce(due_cents, 0) > 0 then
          raise exception 'invoice % cannot become paid with a nonzero balance due (%)', new.id, due_cents;
        end if;
      end;
    end if;
  end if;

  if old.status = 'draft' then
    return new; -- draft rows are otherwise freely editable
  end if;

  if to_jsonb(new) - array[
       'status', 'sent_at', 'delivery_method', 'notes', 'updated_at',
       'stripe_payment_link_id', 'stripe_payment_link_url',
       'stripe_payment_link_livemode', 'stripe_payment_link_amount_cents'
     ]
     is distinct from
     to_jsonb(old) - array[
       'status', 'sent_at', 'delivery_method', 'notes', 'updated_at',
       'stripe_payment_link_id', 'stripe_payment_link_url',
       'stripe_payment_link_livemode', 'stripe_payment_link_amount_cents'
     ]
  then
    raise exception 'invoice % is issued (status=%) and cannot be modified except status/sent_at/delivery_method/notes/payment-link fields', old.id, old.status;
  end if;

  return new;
end;
$$;
