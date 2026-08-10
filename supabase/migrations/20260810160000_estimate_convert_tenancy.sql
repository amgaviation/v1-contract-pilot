-- ===========================================================================
-- estimate_convert_to_invoice stops naming another tenant's account
--
-- THE LEAK. The function is SECURITY DEFINER and granted EXECUTE to
-- `authenticated`, so a signed-in pilot could call it with any estimate
-- id. It selected the row with NO account filter, found it, and only then
-- checked membership — raising 'not a member of account <uuid>'. The uuid
-- in that message is the OTHER tenant's account_id, returned straight to
-- the caller. A pilot could enumerate estimate ids and harvest account
-- identifiers for tenants they have nothing to do with.
--
-- Worse in a quieter way: the unfiltered SELECT took `for update` on the
-- foreign row before any tenancy test ran, so a caller could hold a lock
-- on another tenant's estimate for the length of their transaction.
--
-- THE FIX. The account filter moves INTO the lookup, so a foreign
-- estimate is simply not found — and 'estimate % not found' is what both
-- the missing and the foreign case now raise. Distinguishing them is the
-- disclosure; pilot.invoice_share_create and pilot.document_share_create
-- already take exactly this posture and this brings the third one into
-- line. service_role keeps its exemption as its own branch rather than as
-- a hole in the filter.
--
-- Everything else in the function is unchanged, verbatim.
-- ===========================================================================

create or replace function pilot.estimate_convert_to_invoice(target_estimate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  est pilot.estimates%rowtype;
  new_invoice_id uuid;
  terms_days integer;
begin
  -- Locked for the duration: two taps on a slow connection must not
  -- produce two invoices from one quote.
  -- TENANCY IS IN THE SELECT, not only after it. This lookup used to be
  -- unfiltered, with the membership check raising
  -- 'not a member of account <uuid>' AFTERWARDS — which handed the caller
  -- another tenant's account_id in the error string, and took a FOR UPDATE
  -- row lock on a foreign row before any tenancy test had run.
  --
  -- Now the filter is part of the lookup, and a foreign estimate is
  -- indistinguishable from one that does not exist: both raise
  -- 'estimate % not found'. That is the same posture invoice_share_create
  -- and document_share_create already take, and the reason is the same —
  -- telling a stranger which of their guesses was closer is itself the
  -- disclosure.
  --
  -- service_role keeps its exemption, as its own branch rather than as a
  -- hole in the filter.
  if coalesce(current_setting('role', true), '') = 'service_role' then
    select * into est from pilot.estimates
      where id = target_estimate_id
      for update;
  else
    select * into est from pilot.estimates
      where id = target_estimate_id
        and account_id in (select pilot.current_account_ids())
      for update;
  end if;

  if est.id is null then
    raise exception 'estimate % not found', target_estimate_id;
  end if;

  if est.converted_invoice_id is not null then
    raise exception 'estimate % has already been converted', coalesce(est.estimate_number, est.id::text);
  end if;
  if est.status <> 'accepted' then
    raise exception 'only an accepted estimate can become an invoice (this one is %)', est.status;
  end if;
  if not exists (select 1 from pilot.estimate_lines l where l.estimate_id = est.id) then
    raise exception 'estimate % has no lines to invoice', coalesce(est.estimate_number, est.id::text);
  end if;

  -- Terms come from the client as they stand TODAY, not from the quote:
  -- the invoice's due date is a fact about the invoice, and Phase 5 is
  -- explicit that it is snapshotted at issue. The quote's valid_until is a
  -- different thing entirely and is deliberately not carried over.
  select c.payment_terms_days into terms_days
    from pilot.clients c where c.id = est.client_id;

  insert into pilot.invoices (account_id, client_id, tax_rate_bps, notes)
  values (
    est.account_id,
    est.client_id,
    est.tax_rate_bps,
    -- The provenance travels with the document. A pilot looking at an
    -- invoice six months later should not have to guess which quote it
    -- came from, and a client querying it will cite the quote number.
    trim(both E'\n' from coalesce(est.notes, '') || E'\n' ||
      'From estimate ' || coalesce(est.estimate_number, '(draft)'))
  )
  returning id into new_invoice_id;

  insert into pilot.invoice_lines
    (account_id, invoice_id, line_type, description, quantity,
     unit_amount_cents, taxable, sort_order)
  select l.account_id, new_invoice_id, l.line_type, l.description, l.quantity,
         l.unit_amount_cents, l.taxable, l.sort_order
  from pilot.estimate_lines l
  where l.estimate_id = est.id
  order by l.sort_order, l.created_at;

  update pilot.estimates
     set converted_invoice_id = new_invoice_id,
         converted_at = now()
   where id = est.id;

  return new_invoice_id;
end;
$$;
