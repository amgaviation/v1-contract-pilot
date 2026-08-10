-- ===========================================================================
-- Correcting a payment, without rewriting the ledger
--
-- THE GAP. pilot.invoice_payments has no UPDATE and no DELETE grant, by
-- design — Phase 5's own header calls a recorded payment "a fact about
-- money that arrived". The consequence nobody wrote down: a pilot who
-- types 450000 instead of 45000 has an invoice that reads PAID, a client
-- who still owes $4,050, and a year-end tax report overstated by the same
-- amount, with no way in the product to fix any of it.
--
-- THE SHAPE CHOSEN, and why it is not an UPDATE grant. A reversal is a new
-- row that negates the old one; the wrong payment stays visible with its
-- correction beside it. That is how an accountant expects a ledger to
-- behave, and it is the difference between "this invoice was paid $450"
-- and "this invoice was recorded as paid $4,500, corrected on 10 AUG, and
-- then paid $450". If a client ever disputes what they paid, the second
-- one is evidence and the first is a number that changed silently.
--
-- WHAT THIS DOES NOT ALLOW:
--   * Reversing a reversal. The correction to a correction is the
--     original payment, re-entered.
--   * Reversing part of a payment. A reversal is exactly the negative of
--     the row it names — a partial reversal is arithmetic dressed up as a
--     record, and "how much did they actually pay" stops being readable.
--   * Reversing the same payment twice. A unique index, not a convention.
--
-- THE STATUS PROBLEM, which is the reason this is a migration and not a
-- one-line CHECK change. invoices_protect_issued enforces a forward-only
-- status machine, and invoice_payments_validate refuses any payment on an
-- invoice that is not 'sent' or 'partial'. The exact case this feature
-- exists for — an overstated payment that marked the invoice PAID — is
-- therefore refused twice over. Both are widened here, and both are
-- widened NARROWLY: the reversal path sets a session-local flag that
-- nothing else can set, copying the pattern 20260809040000 established
-- for connect_account_id rather than loosening either rule generally.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The column, and the arithmetic that makes a reversal a reversal.
-- ---------------------------------------------------------------------------
alter table pilot.invoice_payments
  add column if not exists reverses_payment_id uuid,
  add column if not exists reversal_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_payments_reverses_fkey'
      and conrelid = 'pilot.invoice_payments'::regclass
  ) then
    alter table pilot.invoice_payments
      add constraint invoice_payments_reverses_fkey
      foreign key (account_id, reverses_payment_id)
      references pilot.invoice_payments (account_id, id)
      on delete restrict;
  end if;
end $$;

-- The original CHECK was `amount_cents > 0`, which is what makes a
-- reversal impossible to express. Widened to "not zero" — a zero-value
-- payment is still meaningless — with the sign now determined by whether
-- the row is a correction.
alter table pilot.invoice_payments
  drop constraint if exists invoice_payments_amount_cents_check;
alter table pilot.invoice_payments
  add constraint invoice_payments_amount_cents_check check (amount_cents <> 0);

alter table pilot.invoice_payments
  drop constraint if exists invoice_payments_reversal_sign;
alter table pilot.invoice_payments
  add constraint invoice_payments_reversal_sign check (
    (reverses_payment_id is null and amount_cents > 0)
    or (reverses_payment_id is not null and amount_cents < 0)
  );

-- One reversal per payment. A convention would be a comment; this is an
-- index, so a double-submit cannot credit a client twice.
create unique index if not exists invoice_payments_one_reversal_each
  on pilot.invoice_payments (account_id, reverses_payment_id)
  where reverses_payment_id is not null;

comment on column pilot.invoice_payments.reverses_payment_id is
  'Set on a CORRECTION row, naming the payment it cancels. Such a row carries exactly the negative of that payment''s amount and the same invoice. The reversed row is never edited or deleted — the ledger is append-only, so what was recorded and what corrected it both stay readable.';
comment on column pilot.invoice_payments.reversal_reason is
  'Why the pilot corrected it, in their own words. Optional, and shown beside the reversal — six months later "typo, meant $450" is the difference between a ledger that explains itself and one that looks like a mistake.';

-- ---------------------------------------------------------------------------
-- 2. Validation. The original rule is unchanged for an ordinary payment;
--    a reversal gets its own, stricter set.
-- ---------------------------------------------------------------------------
create or replace function pilot.invoice_payments_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  invoice_status text;
  original record;
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;

  -- `for share` for the reason the original comment gives: a payment
  -- INSERT's own FK takes only FOR KEY SHARE, which does not conflict
  -- with a concurrent status UPDATE, so an invoice being voided and a
  -- payment being recorded against it could each read the other's
  -- pre-write state and both commit.
  select status into invoice_status from pilot.invoices
    where account_id = new.account_id and id = new.invoice_id
    for share;

  if new.reverses_payment_id is null then
    if invoice_status is null or invoice_status not in ('sent', 'partial') then
      raise exception 'invoice % (status=%) cannot receive a payment', new.invoice_id, invoice_status;
    end if;
    return new;
  end if;

  -- From here down: a correction.
  --
  -- 'paid' is allowed here and nowhere else. An overstated payment that
  -- marked the invoice paid is the exact case this feature exists for, so
  -- refusing it would leave the one thing that needs fixing unfixable.
  -- 'draft' and 'void' stay refused: there is nothing on a draft to
  -- correct, and a voided invoice's payments are a closed record.
  if invoice_status is null or invoice_status not in ('sent', 'partial', 'paid') then
    raise exception 'invoice % (status=%) cannot have a payment corrected', new.invoice_id, invoice_status;
  end if;

  -- NO ROW LOCK. Every locking clause — FOR UPDATE, FOR SHARE, all of
  -- them — requires UPDATE, DELETE or SELECT FOR UPDATE privilege on the
  -- table, and pilot.invoice_payments deliberately grants `authenticated`
  -- none of those. Adding `for update` here made EVERY correction fail
  -- with 42501, caught by this migration's verify script before it
  -- shipped. The concurrency control is the unique index on
  -- (account_id, reverses_payment_id): two simultaneous corrections of one
  -- payment cannot both commit, whether or not this read took a lock.
  -- Nothing can delete the row underneath us either — there is no DELETE
  -- grant, and the FK from this row is ON DELETE RESTRICT.
  select id, invoice_id, amount_cents, reverses_payment_id
    into original
  from pilot.invoice_payments
  where account_id = new.account_id and id = new.reverses_payment_id;

  if original.id is null then
    raise exception 'no such payment to correct';
  end if;
  if original.invoice_id is distinct from new.invoice_id then
    raise exception 'a correction must be recorded against the same invoice as the payment it corrects';
  end if;
  if original.reverses_payment_id is not null then
    raise exception 'a correction cannot itself be corrected — record the payment again instead';
  end if;
  -- Exactly the negative. A partial reversal would make "how much did
  -- this client actually pay" a sum nobody can read off the rows.
  if new.amount_cents is distinct from -original.amount_cents then
    raise exception 'a correction must be exactly the negative of the payment it corrects';
  end if;

  return new;
end;
$$;

comment on function pilot.invoice_payments_validate() is
  'Guards pilot.invoice_payments on INSERT. An ordinary payment needs an invoice in sent/partial. A CORRECTION additionally permits paid — the overstated-payment case is the whole reason corrections exist — and must be exactly the negative of a non-correction payment on the same invoice.';

-- ---------------------------------------------------------------------------
-- 3. Putting the invoice's status back.
--
-- Without this, correcting the $4,500 leaves the invoice reading PAID
-- with $4,050 outstanding — which is the original bug with an audit trail
-- attached. The status has to move backwards, and invoices_protect_issued
-- is a forward-only machine, so this sets the same kind of session-local
-- flag 20260809040000 introduced for connect_account_id: settable only
-- from inside this function, never reachable from PostgREST.
--
-- SECURITY DEFINER because it writes pilot.invoices while running as the
-- pilot. The account_id and invoice_id both come from the row that was
-- just inserted — which RLS and the validation trigger above have already
-- confined to this tenant — so DEFINER here widens what the statement may
-- touch, not which tenant it may touch.
-- ---------------------------------------------------------------------------
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
  if current_status <> 'paid' then
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

drop trigger if exists invoice_payments_resync_status on pilot.invoice_payments;
create trigger invoice_payments_resync_status
  after insert on pilot.invoice_payments
  for each row execute function pilot.invoice_payments_resync_status();

-- ---------------------------------------------------------------------------
-- 4. Let the status machine run backwards, for this one reason only.
--
-- Re-declared in full from 20260809040000, which is itself a verbatim
-- re-declaration of the Phase 5 original plus the payment-link columns.
-- Every existing rule below is unchanged; the ONLY additions are the two
-- paid-> transitions, and each is gated on the session-local flag that
-- only pilot.invoice_payments_resync_status sets.
-- ---------------------------------------------------------------------------
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
       'stripe_payment_link_id', 'stripe_payment_link_url', 'stripe_payment_link_livemode'
     ]
     is distinct from
     to_jsonb(old) - array[
       'status', 'sent_at', 'delivery_method', 'notes', 'updated_at',
       'stripe_payment_link_id', 'stripe_payment_link_url', 'stripe_payment_link_livemode'
     ]
  then
    raise exception 'invoice % is issued (status=%) and cannot be modified except status/sent_at/delivery_method/notes/payment-link fields', old.id, old.status;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants. ADDED to the existing column-scoped INSERT grant, never
--    re-granted: `revoke ... on <table>` drops every column privilege and
--    the following grant restores only what is listed, which has broken
--    this repository four separate times.
-- ---------------------------------------------------------------------------
grant insert (reverses_payment_id, reversal_reason)
  on pilot.invoice_payments to authenticated;
