-- ===========================================================================
-- An invoice can now be raised without a client record
-- ===========================================================================
-- WHAT CHANGED AND WHY.
--
-- pilot.invoices.client_id was `uuid not null`. That made "who am I billing"
-- a question only answerable by first creating a pilot.clients row, so a
-- one-off ferry flight for an operator the pilot will never fly for again
-- cost them a permanent client record, a rate card they do not want, a
-- reminder schedule they will never set, and a name that then appears in
-- every client picker forever. The product was asking for a relationship in
-- order to accept a transaction.
--
-- client_id is now nullable. An invoice may instead carry TYPED bill-to
-- details in the bill_to_* columns below. Exactly one of the two is present,
-- enforced by invoices_bill_to_or_client below.
--
-- ---------------------------------------------------------------------------
-- DESIGN DECISION 1: WHY DENORMALISED COLUMNS, AND WHY THIS SHAPE.
--
-- Checked first whether this codebase already snapshots bill-to details at
-- send time, so the snapshot could be reused rather than paralleled. It does
-- not. lib/invoice-document.tsx reads pilot.clients LIVE on every render, and
-- pilot.invoice_public does the same for the shared link. There is no
-- send-time freeze anywhere to reuse.
--
-- So these columns are new, and their names and set are taken verbatim from
-- the projection those two readers already ask pilot.clients for:
--
--   name, contact_name, address_line1, address_line2, city, state,
--   postal_code, country
--
-- plus one more, bill_to_email, because a client row also carries the address
-- a send goes to (contact_email, or billing_email when set) and an invoice
-- with no client has to carry its own or it can never be emailed.
--
-- Identical field names mean every renderer takes ONE shape: resolve the
-- bill-to block from the client row or from these columns, then hand the same
-- object to the same component. No second PDF layout, no second public
-- payload, no branch inside a renderer.
--
-- ---------------------------------------------------------------------------
-- DESIGN DECISION 2: THE CLIENT-LINKED CASE DOES NOT MOVE.
--
-- An invoice with a client_id keeps reading that client's CURRENT details,
-- exactly as it did yesterday, because that is what the code did and freezing
-- it now would silently change what an already-issued invoice renders. The
-- bill_to_* columns are read ONLY when client_id is null. The check constraint
-- below makes that a property of the data rather than a convention every
-- reader has to remember: a linked invoice cannot carry a bill_to_name at all,
-- so there is no row in which the two could disagree and no reader that could
-- pick the wrong one.
--
-- ---------------------------------------------------------------------------
-- DESIGN DECISION 3: RATE CARDS, MINIMUMS AND LATE FEES.
--
-- All three are per-client (pilot.client_rates, pilot.guarantee_periods,
-- clients.late_fee_*). An invoice with no client has none, and the answer is
-- to have none rather than to invent an account-level substitute:
--
--   * Rate cards and minimums only ever apply while DRAFTING FROM A TRIP, and
--     drafting from a trip still requires a client (a trip's lines carry the
--     trip's own client, and invoices_protect_issued re-checks that at send).
--     A clientless invoice is typed line by line, so nothing is silently
--     skipped: there was never a rate to apply.
--   * Late fees: no client, no agreed policy, no fee. The invoice screen says
--     so rather than showing an empty policy block.
--   * Reminder schedules: no client, no schedule, so the scheduled run does
--     not chase a clientless invoice at all. lib/reminders/run.ts scopes its
--     pass to clients that HAVE a schedule, so this was already true by
--     construction; it is now also an explicit filter there, and the invoice's
--     reminder panel states it in words instead of rendering an empty ladder.
--     Sending a reminder BY HAND still works, to the typed address.
--
-- The one thing a client did supply that an invoice genuinely cannot do
-- without is a due date: invoices_assign_number_on_issue derived it from
-- clients.payment_terms_days at issue. For a clientless invoice it now falls
-- back to pilot.accounts.default_payment_terms_days (20260812400000, whose own
-- comment says it exists to "seed a new invoice's terms"), and to 30 days when
-- that is unset, which is the same final fallback the client path already had.
-- Leaving due_on null instead was rejected: a null due date means the invoice
-- can never be overdue, so it would silently vanish from aging, from the
-- overview queue and from every past-due figure the pilot relies on.
--
-- ---------------------------------------------------------------------------
-- RLS: NOTHING WIDENS. THE PROOF.
--
-- Every policy on pilot.invoices (20260805090000, lines 1199-1205) reads:
--
--   using       (account_id in (select pilot.current_account_ids()))
--   with check  (account_id in (select pilot.current_account_ids()))
--
-- for select, insert and update; there is no delete policy. client_id appears
-- in NONE of them, in either the USING or the WITH CHECK clause, so no policy
-- decision on this table has ever consulted it and no policy decision can
-- change when it becomes null. account_id is still `not null` and is still the
-- entire predicate. A row visible after this migration is visible on exactly
-- the account_id it was visible on before it, and a row that was invisible
-- stays invisible: a null client_id cannot satisfy a predicate it does not
-- appear in.
--
-- The same is true one level out. pilot.invoice_totals and
-- pilot.invoices_overdue are security_invoker views over pilot.invoices, so
-- they inherit that predicate unchanged. pilot.invoice_public is SECURITY
-- DEFINER and therefore bypasses RLS by design, but its access boundary is the
-- 256-bit share token, not client_id: it resolves account_id and invoice_id
-- from pilot.invoice_shares FIRST and then constrains every subsequent read to
-- that pair. The rewrite below changes an inner join to a left join within
-- that already-resolved pair and adds no new row to its reach.
--
-- ---------------------------------------------------------------------------
-- THE `on delete restrict` PROPERTY IS PRESERVED.
--
-- The composite FK is untouched:
--
--   foreign key (account_id, client_id)
--     references pilot.clients (account_id, id) on delete restrict
--
-- A foreign key with no MATCH clause is MATCH SIMPLE, so a row is exempt from
-- the constraint when ANY of its referencing columns is null. A clientless
-- invoice (client_id null) therefore references no client and blocks no
-- deletion, which is correct: it points at nobody. A LINKED invoice has both
-- columns set, is fully constrained exactly as before, and still makes
-- `delete from pilot.clients` fail. The property the constraint exists for
-- ("a client with invoices cannot be deleted") is unchanged for every invoice
-- that has a client.
--
-- ---------------------------------------------------------------------------
-- SAFE ON A LIVE DATABASE WITH EXISTING ROWS.
--
--   * `drop not null` is a catalog flag change. No table rewrite, no scan.
--   * The eight added columns are nullable with no default, which since
--     PostgreSQL 11 is metadata-only: no rewrite, no scan, no default backfill.
--   * The check constraint is added NOT VALID and validated in a second
--     statement, so the ACCESS EXCLUSIVE lock is held only for the catalog
--     write and the row scan runs under SHARE UPDATE EXCLUSIVE alongside
--     ordinary traffic.
--   * NOTHING HERE WRITES A ROW. There is no UPDATE statement in this file.
--     Every existing invoice keeps the client it has, and every existing
--     invoice satisfies the new constraint by construction: client_id is
--     non-null on all of them and bill_to_name is null on all of them, so
--     `(client_id is null) = (bill_to_name is not null)` reads `false = false`.
-- ===========================================================================

alter table pilot.invoices
  alter column client_id drop not null;

comment on column pilot.invoices.client_id is
  'Nullable since 20260815100000. Null means this invoice bills the typed bill_to_* details instead of a pilot.clients row. When set, every reader takes the client''s CURRENT details, unchanged from before that migration. Exactly one of the two is present, per invoices_bill_to_or_client.';

alter table pilot.invoices
  -- The bill-to block, used only when client_id is null. Same field names as
  -- the pilot.clients projection every invoice renderer already asks for, so
  -- one resolved object feeds one component either way.
  add column if not exists bill_to_name text,
  add column if not exists bill_to_contact_name text,
  -- Where an emailed copy and a hand-sent reminder go. The client path picks
  -- billing_email over contact_email (20260814092000); there is only one
  -- address here because there is no relationship to keep two inboxes for.
  add column if not exists bill_to_email text,
  add column if not exists bill_to_address_line1 text,
  add column if not exists bill_to_address_line2 text,
  add column if not exists bill_to_city text,
  add column if not exists bill_to_state text,
  add column if not exists bill_to_postal_code text,
  add column if not exists bill_to_country text;

comment on column pilot.invoices.bill_to_name is
  'Who this invoice bills, typed rather than looked up. Present exactly when client_id is null. Never read when client_id is set.';
comment on column pilot.invoices.bill_to_email is
  'Where an emailed copy or a hand-sent reminder goes for a clientless invoice. No schedule attaches to it: the scheduled reminder run is per client and never chases an invoice with no client.';

-- ONE BILL-TO SOURCE PER INVOICE, AND NEVER ZERO.
--
-- Both halves matter. Forbidding bill_to_name on a linked invoice is what
-- makes "read the client when there is one" safe to write everywhere without
-- a tie-break rule: there is no row where both are set, so no reader can pick
-- the wrong one and no pair of readers can pick differently. Requiring it when
-- there is no client is what stops an invoice existing with nobody named on
-- it, which is not a draft in progress, it is a document that cannot be sent
-- and cannot be chased.
--
-- Only bill_to_name is constrained. The address parts are optional in exactly
-- the way pilot.clients' own address columns are optional (all nullable there
-- too), so a pilot billing "Gulfstream Ops LLC" with no street address is as
-- valid here as it already was there.
--
-- NOT VALID then VALIDATE: see the live-safety note in the header.
alter table pilot.invoices
  add constraint invoices_bill_to_or_client
  check ((client_id is null) = (bill_to_name is not null))
  not valid;

alter table pilot.invoices
  validate constraint invoices_bill_to_or_client;

-- COLUMN GRANTS. ALTER TABLE ADD COLUMN does not extend an existing
-- column-scoped grant, so a new column needs its own or it is unwritable by
-- the tenant no matter what the policy says (the note Phase 5 wrote above its
-- own trips/clients grants).
--
-- Both INSERT and UPDATE, because a clientless invoice is created with its
-- bill-to details typed and can be corrected while it is still a draft. There
-- is no state this grant makes writable that invoices_protect_issued does not
-- already freeze: that trigger diffs the WHOLE row minus
-- status/sent_at/delivery_method/notes, so these eight columns were protected
-- on an issued invoice from the instant they existed, with nothing to remember
-- to add. That is the structural check its own comment promised would cover
-- future columns, and this migration is the first test of it.
grant insert (bill_to_name, bill_to_contact_name, bill_to_email,
  bill_to_address_line1, bill_to_address_line2, bill_to_city,
  bill_to_state, bill_to_postal_code, bill_to_country)
  on pilot.invoices to authenticated;
grant update (bill_to_name, bill_to_contact_name, bill_to_email,
  bill_to_address_line1, bill_to_address_line2, bill_to_city,
  bill_to_state, bill_to_postal_code, bill_to_country)
  on pilot.invoices to authenticated;

-- ---------------------------------------------------------------------------
-- THE DUE DATE AT ISSUE, for an invoice with no client to take terms from.
--
-- Unchanged for a linked invoice, byte for byte: same lookup, same
-- account_id scoping, same `new.issued_on + terms` arithmetic that
-- 20260805090000's second-pass review fixed, same coalesce to 30.
--
-- The clientless branch reads pilot.accounts.default_payment_terms_days
-- instead. That column was added by 20260812400000 for exactly this ("Net
-- terms in days... Calendar-day due semantics are computed at invoice time
-- from this"), and until now nothing in the database consumed it: the onboarding
-- wizard collected a number that only ever seeded a form. It is nullable, so
-- the same coalesce to 30 catches every account that skipped the question.
-- ---------------------------------------------------------------------------
create or replace function pilot.invoices_assign_number_on_issue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'sent' and new.invoice_number is null then
    new.invoice_number := pilot.next_invoice_number(new.account_id);
    if new.issued_on is null then
      new.issued_on := current_date;
    end if;
    if new.due_on is null then
      if new.client_id is not null then
        -- Scoped by account_id as well as id: the composite FK already
        -- guarantees a same-tenant client, so this is belt and braces.
        select new.issued_on + coalesce(c.payment_terms_days, 30) into new.due_on
          from pilot.clients c where c.account_id = new.account_id and c.id = new.client_id;
      else
        select new.issued_on + coalesce(a.default_payment_terms_days, 30) into new.due_on
          from pilot.accounts a where a.id = new.account_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- THE SHARED LINK, which an inner join would have broken silently.
--
-- pilot.invoice_public built its whole payload from one SELECT ending in
--
--   join pilot.clients c on c.account_id = i.account_id and c.id = i.client_id
--
-- An inner join on a null client_id matches nothing, so the SELECT ... INTO
-- would leave `result` null and the function would return null. Its contract
-- says null means "unknown token, revoked, or not in a shareable status", and
-- app/invoice/[token]/page.tsx renders that as not-found. A pilot would have
-- shared a link, watched their own preview 404, and had no way to tell that
-- from a revoked token. Nothing would appear in a log.
--
-- Left join plus coalesce onto the bill_to_* columns. The `client` key keeps
-- its name and its exact eight fields, so the public page and the preview need
-- no change and the payload is not widened: this returns the same shape from a
-- second source, it does not expose a new one. `name` is guaranteed non-null
-- on both sides by invoices_bill_to_or_client above.
--
-- Everything else in the function is untouched, including the token/status
-- gate at the top, which is what actually authorises the read. Restated in
-- full rather than patched because `create or replace function` replaces the
-- whole body.
--
-- NO GRANT CHANGES. `create or replace function` preserves grants, so the
-- `grant execute ... to anon, authenticated` from 20260809060000 stands.
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
    -- The client row when there is one, the typed details when there is not.
    -- coalesce and not a CASE: the two are mutually exclusive by check
    -- constraint, so there is nothing for a coalesce to prefer wrongly, and
    -- the linked side still reads the client's CURRENT values exactly as it
    -- did before this migration.
    'client', jsonb_build_object(
      'name', coalesce(c.name, i.bill_to_name),
      'contact_name', coalesce(c.contact_name, i.bill_to_contact_name),
      'address_line1', coalesce(c.address_line1, i.bill_to_address_line1),
      'address_line2', coalesce(c.address_line2, i.bill_to_address_line2),
      'city', coalesce(c.city, i.bill_to_city),
      'state', coalesce(c.state, i.bill_to_state),
      'postal_code', coalesce(c.postal_code, i.bill_to_postal_code),
      'country', coalesce(c.country, i.bill_to_country)
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
      'amount_cents', i.stripe_payment_link_amount_cents
    )
  )
  into result
  from pilot.invoices i
  join pilot.accounts a on a.id = i.account_id
  left join pilot.clients c on c.account_id = i.account_id and c.id = i.client_id
  join pilot.invoice_totals t on t.invoice_id = i.id
  where i.account_id = v_account_id and i.id = v_invoice_id;

  return result;
end;
$$;

comment on function pilot.invoice_public(text) is
  'The ONE path from an unauthenticated request to invoice data. Returns null (never an error, never a partial object) for an unknown token, a revoked one, or an invoice no longer in a shareable status. SECURITY DEFINER, granted to anon: this function IS the access boundary pilot.invoice_shares/pilot.invoices/pilot.invoice_lines/pilot.invoice_totals/pilot.accounts/pilot.clients rely on for the public route. The client join is a LEFT join since 20260815100000 because pilot.invoices.client_id is nullable: the client object falls back to the invoice''s own bill_to_* columns, same eight fields, no widening. payment.amount_cents (20260811010000) is the snapshotted price of the stored link, not the current balance. Do not widen the jsonb it returns without re-reading app/invoice/[token]/page.tsx''s field-by-field justification comment.';

-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO.
--
--   * pilot.recurring_invoice_schedules.client_id stays `not null`. A
--     recurring schedule is a standing arrangement with somebody, its
--     generator (20260809030000) copies client_id onto each invoice it
--     creates, and its own grants make client_id insert-only because it is
--     part of the schedule's identity. Lifting it is a separate change with
--     its own generator and UI consequences, not a rider on this one.
--   * pilot.estimates.client_id stays `not null` for the same reason, and one
--     more: pilot.estimate_convert_to_invoice reads the client's
--     payment_terms_days and hands client_id straight to the invoice it
--     creates, so a clientless estimate needs its own bill-to columns, its own
--     PDF resolution and a conversion path that carries them across. That is
--     the same job again on a second table, not an extension of this one.
--
-- Both are still reachable the ordinary way: a pilot who wants a recurring
-- arrangement or a formal estimate has a relationship worth a client record.
-- What they no longer need one for is a single invoice.
--
--   * pilot.invoice_lines_validate_trip is untouched. It compares the trip's
--     client to the invoice's with `is distinct from`, so a trip belonging to a
--     client can never land on a clientless invoice, and a trip with no client
--     of its own can. That second case is coherent (both sides say "nobody")
--     and no UI offers it today; it is left as a property of the trigger
--     rather than designed against.
-- ---------------------------------------------------------------------------
