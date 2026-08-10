-- ===========================================================================
-- Put stripe_payment_link_amount_cents back in the issued-invoice allow-list
--
-- WHAT BROKE, AND HOW. 20260810120000 re-declared
-- pilot.invoices_protect_issued to let a payment CORRECTION walk an invoice
-- back from 'paid'. Its header says it was "Re-declared in full from
-- 20260809040000" — and that was the mistake. 20260809040000 was not the
-- deployed ancestor; 20260810010000 was, and 20260810010000 is the
-- migration that ADDED stripe_payment_link_amount_cents, granted UPDATE on
-- it, and listed it in this function's allow-list. Copying the older body
-- silently dropped the fourth column from both subtracted arrays.
--
-- The effect was not subtle. createInvoicePaymentLink writes that column on
-- an invoice whose status is 'sent' or 'partial', so the `old.status =
-- 'draft'` early-out never fires and the to_jsonb diff ran with the column
-- still in it: non-empty diff, trigger raises, UPDATE refused.
--
-- The reason this is worse than a failed save: the Stripe Payment Link is
-- created BEFORE the row is written. Every press of "Generate payment link"
-- minted a real, payable link on the pilot's connected account whose id this
-- product then failed to persist — so it could never be retired when the
-- invoice was paid, and never deactivated when it was voided. A client
-- could pay a link the software cannot see.
--
-- It also re-broke voidInvoice and retirePaymentLink, which clear all four
-- link columns at once. That is precisely the failure 20260810010000's own
-- FINDING 3 was written to fix, reintroduced eleven days later by a copy
-- from the wrong ancestor.
--
-- WHAT THIS CHANGES. Exactly one thing: both arrays gain
-- 'stripe_payment_link_amount_cents'. The paid-> transitions added by
-- 20260810120000 are preserved verbatim, gated on the same session-local
-- flag. Nothing else in the function moves.
--
-- THE LESSON, recorded because this is the fifth time this repository has
-- been bitten by re-declaring a shared object from a stale copy: when
-- re-declaring a function, diff it against the CURRENT definition in the
-- database, not against the migration you happen to remember.
-- ===========================================================================

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
