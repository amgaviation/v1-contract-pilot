-- client_tax_forms — the year-end 1099 reconciliation record.
--
-- WHY THIS TABLE EXISTS: pilot.invoice_payments is the pilot's OWN
-- cash-basis ledger (see that table's comment in
-- 20260805090000_phase5_invoices.sql — "C3: one row per payment, dated").
-- A client's 1099-NEC reports what THAT CLIENT paid in THEIR tax year,
-- which is a second, independent ledger the pilot does not control and
-- cannot assume matches. A cheque the client mails 28 Dec and the pilot
-- deposits/records 4 Jan sits in two different tax years on the two
-- ledgers, and the IRS's matching program compares the pilot's return
-- against the CLIENT's 1099 filings, not the other way around. This table
-- is where that second ledger's numbers get recorded so the delta against
-- pilot.invoice_payments is a computed, visible fact instead of something
-- the pilot has to notice by eye every April.
--
-- This is bookkeeping, not tax advice: nothing here computes tax owed, and
-- nothing in this migration or the surface built on it may start doing so.
--
-- ---------------------------------------------------------------------------
-- Inherits both Phase 1 tenancy patterns (see
-- 20260802190437_pilot_schema_tenancy.sql and every phase since):
--   1. COMPOSITE FOREIGN KEYS — client_id is checked against (account_id,
--      id) on pilot.clients, not id alone, so a row can never be attached
--      to another tenant's client even by a caller who already knows a
--      valid client id somewhere else in the system.
--   2. COLUMN-SCOPED GRANTS — RLS has no column granularity, so INSERT/
--      UPDATE below enumerate exactly the columns a tenant may write.
-- ---------------------------------------------------------------------------

create table if not exists pilot.client_tax_forms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid not null,
  -- Composite FK: a tax form may only reference a client in the SAME
  -- account. on delete cascade (not restrict, unlike trips->clients):
  -- this row only ever exists to annotate that client's own 1099, so it
  -- has no meaning once the client itself is gone — matching
  -- pilot.documents.client_id, the other client-scoped annotation table.
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete cascade,
  tax_year integer not null check (tax_year between 2000 and 2100),
  form_type text not null default '1099-NEC'
    check (form_type in ('1099-NEC', '1099-MISC', 'other')),
  -- What the CLIENT'S form says, in cents — never derived from this
  -- pilot's own ledger, which is exactly the point of recording it
  -- separately.
  reported_amount_cents bigint not null check (reported_amount_cents >= 0),
  received_on date,
  -- Nullable, and SET NULL on delete: losing the scanned copy of the form
  -- should not destroy the pilot's record that the form arrived and what
  -- it said. Composite FK to pilot.documents, same tenancy pattern as
  -- above.
  document_id uuid,
  foreign key (account_id, document_id) references pilot.documents (account_id, id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK target for any future tenant-scoped child.
  unique (account_id, id),
  -- One row per client/year/form-type: a corrected 1099-NEC replaces the
  -- prior figure by editing this row, not by inserting a second row that
  -- would make "the ledger vs their form" ambiguous about which figure to
  -- reconcile against.
  unique (account_id, client_id, tax_year, form_type)
);

comment on table pilot.client_tax_forms is
  'The 1099 the CLIENT issued, as the client reported it — reconciled on /reports/year-end against pilot.invoice_payments (the pilot''s own cash-basis ledger). A delta is normal (Dec/Jan payment timing), not necessarily an error. Not tax advice; the pilot''s CPA is the authority on what to do with the delta.';

create trigger client_tax_forms_set_updated_at before update on pilot.client_tax_forms
  for each row execute function pilot.set_updated_at();

create index if not exists client_tax_forms_client_year_idx
  on pilot.client_tax_forms (account_id, client_id, tax_year);

-- ---------------------------------------------------------------------------
-- RLS. Enabled from this, the table's first migration — never retrofitted,
-- matching every table since Phase 1. No admin bypass policy, no
-- AMG-facing read path.
-- ---------------------------------------------------------------------------
alter table pilot.client_tax_forms enable row level security;

create policy client_tax_forms_select on pilot.client_tax_forms for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy client_tax_forms_insert on pilot.client_tax_forms for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy client_tax_forms_update on pilot.client_tax_forms for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
-- Unlike pilot.invoice_payments, a client_tax_forms row is the pilot's OWN
-- annotation of a document that arrived from someone else — correcting a
-- mis-typed reported_amount_cents, or removing a row entered against the
-- wrong client/year, is exactly the kind of self-serve fix the no-delete
-- rule on invoice_payments deliberately does NOT extend to (that rule
-- exists because a payment is this product's own ledger entry; this table
-- is not that). A delete policy is therefore included.
create policy client_tax_forms_delete on pilot.client_tax_forms for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- GRANTS. Column-scoped per the Phase 1 pattern: id/created_at/updated_at
-- are withheld from every write grant. account_id is granted on insert only
-- (a row has to be created against an account, and the with-check policies
-- above pin it to one of the caller's own) but withheld from update, so an
-- existing row can never be re-parented to a different account.
-- ---------------------------------------------------------------------------
grant select, delete on pilot.client_tax_forms to authenticated;
grant insert (account_id, client_id, tax_year, form_type, reported_amount_cents,
  received_on, document_id, notes)
  on pilot.client_tax_forms to authenticated;
grant update (client_id, tax_year, form_type, reported_amount_cents,
  received_on, document_id, notes)
  on pilot.client_tax_forms to authenticated;

grant select, insert, update, delete on pilot.client_tax_forms to service_role;
