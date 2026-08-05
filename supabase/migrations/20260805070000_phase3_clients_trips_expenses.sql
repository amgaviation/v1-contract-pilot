-- Phase 3/4 — clients, trips, trip legs, expenses, documents, and the
-- expiration engine.
--
-- Requirements traced to docs/research/FLIGHTDEPTPRO-INSPIRATION.md (A2, A3,
-- A4, A10, B3, B6, C2, C3, C4) and docs/PLAN.md.
--
-- THE TWO SECURITY PATTERNS THIS FILE INHERITS FROM PHASE 1 — read
-- 20260802190437_pilot_schema_tenancy.sql before editing anything here:
--
--   1. COMPOSITE FOREIGN KEYS. Every tenant-scoped child references its
--      parent by (account_id, id), not by id alone. A plain `trip_id uuid
--      references pilot.trips(id)` would let tenant A attach a leg to tenant
--      B's trip: the RLS policy on trip_legs only checks the LEG's
--      account_id, and A owns that. The composite FK makes the cross-tenant
--      attach fail in the constraint layer, where it cannot be forgotten.
--      This requires a UNIQUE (account_id, id) on every parent — redundant
--      with the primary key by itself, and load-bearing as an FK target.
--
--   2. COLUMN-SCOPED GRANTS. Postgres RLS has NO column granularity. An
--      ownership-only policy plus a blanket UPDATE grant is exactly the
--      CRITICAL that Phase 1 shipped and then fixed. Every table below
--      enumerates the columns a tenant may write. Derived and system columns
--      are withheld, not merely undocumented.

-- ---------------------------------------------------------------------------
-- clients — the pilot's OWN customers. A4: rates configured once here and
-- multiplied into trips, never re-entered per trip.
-- ---------------------------------------------------------------------------
create table if not exists pilot.clients (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  -- A4. Money is integer minor units everywhere in this schema. Never float,
  -- never numeric-with-implicit-scale: a day rate multiplied by a day count
  -- and summed against expenses must be exact, and cents make that a property
  -- of the type rather than of every call site.
  default_day_rate_cents bigint check (default_day_rate_cents is null or default_day_rate_cents >= 0),
  default_per_diem_cents bigint check (default_per_diem_cents is null or default_per_diem_cents >= 0),
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  -- A3. The default an expense inherits when captured against this client's
  -- trip. The tag is still asked once at capture; this only seeds it.
  default_expense_treatment text not null default 'unassigned'
    check (default_expense_treatment in ('rebill', 'deduct', 'unassigned')),
  -- C10. Clients will 1099 the pilot, so W-9 state is a first-class field,
  -- not a note. Feeds the Needs Attention queue.
  w9_status text not null default 'not_requested'
    check (w9_status in ('not_requested', 'requested', 'on_file')),
  w9_sent_at timestamptz,
  w9_received_at timestamptz,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK target for tenant-scoped children. See pattern 1 above.
  unique (account_id, id)
);

comment on table pilot.clients is
  'The pilot''s own customers. NEVER visible to AMG — see docs/PLAN.md product boundary.';

-- ---------------------------------------------------------------------------
-- trips — the parent record and the product's financial atom (A2).
-- ---------------------------------------------------------------------------
create table if not exists pilot.trips (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid,
  -- Composite FK: a trip may only reference a client in the SAME account.
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete restrict,
  -- Ported verbatim from docs/PLAN.md "Verified ground truth". Do not
  -- half-copy this vocabulary.
  trip_kind text not null default 'contract_pilot'
    check (trip_kind in ('owner_trip', 'ferry', 'maintenance_flight', 'repositioning',
                         'contract_pilot', 'delivery_flight', 'other')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'canceled')),
  starts_on date not null,
  ends_on date not null,
  check (ends_on >= starts_on),
  aircraft_ident text,
  aircraft_type text,
  -- Snapshotted from the client at creation, then independently editable:
  -- the deal for THIS trip. Storing it rather than joining to the client is
  -- deliberate — re-reading the client's current rate would silently restate
  -- the value of work already flown when the pilot renegotiates.
  day_rate_cents bigint not null default 0 check (day_rate_cents >= 0),
  day_count numeric(5,1) not null default 0 check (day_count >= 0),
  billing_state text not null default 'unbilled'
    check (billing_state in ('unbilled', 'invoiced', 'paid', 'written_off')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.trips is
  'The parent record. A2: billable (day_rate x day_count + rebilled expenses) - deducted expenses = trip net.';

-- ---------------------------------------------------------------------------
-- trip_legs — A10: store UTC, derive display zone from the ICAO code. There
-- is deliberately NO timezone column anywhere in this schema.
-- ---------------------------------------------------------------------------
create table if not exists pilot.trip_legs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  trip_id uuid not null,
  foreign key (account_id, trip_id) references pilot.trips (account_id, id) on delete cascade,
  leg_date date not null,
  from_icao text check (from_icao is null or from_icao ~ '^[A-Z0-9]{3,4}$'),
  to_icao text check (to_icao is null or to_icao ~ '^[A-Z0-9]{3,4}$'),
  -- timestamptz, always UTC. A10.
  out_at timestamptz,
  in_at timestamptz,
  check (in_at is null or out_at is null or in_at >= out_at),
  block_hours numeric(4,1) check (block_hours is null or block_hours >= 0),
  night_hours numeric(4,1) check (night_hours is null or night_hours >= 0),
  instrument_hours numeric(4,1) check (instrument_hours is null or instrument_hours >= 0),
  day_landings integer not null default 0 check (day_landings >= 0),
  -- FAR 61.57(b) needs night takeoffs and FULL-STOP night landings. The AMG
  -- schema could not compute night currency because it recorded neither —
  -- docs/PLAN.md flags this as a defect to fix here, not later.
  night_takeoffs integer not null default 0 check (night_takeoffs >= 0),
  night_landings_full_stop integer not null default 0 check (night_landings_full_stop >= 0),
  night_landings_touch_go integer not null default 0 check (night_landings_touch_go >= 0),
  approaches integer not null default 0 check (approaches >= 0),
  holds integer not null default 0 check (holds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

-- ---------------------------------------------------------------------------
-- expenses — A3. The treatment tag is set ONCE at capture and drives margin
-- inclusion, invoice drafting, the deduction file and the accountant packet.
-- No downstream surface re-asks it.
-- ---------------------------------------------------------------------------
create table if not exists pilot.expenses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  -- Nullable BY DESIGN: the unassigned queue is a first-class surface. A
  -- receipt with no trip is neither billed nor deducted, and that is exactly
  -- the state the product exists to surface.
  trip_id uuid,
  foreign key (account_id, trip_id) references pilot.trips (account_id, id) on delete set null,
  incurred_on date not null,
  -- Ported verbatim from docs/PLAN.md.
  category text not null
    check (category in ('airline', 'hotel', 'rental_car', 'rideshare', 'fuel',
                        'meals', 'parking', 'other')),
  vendor text,
  amount_cents bigint not null check (amount_cents >= 0),
  treatment text not null default 'unassigned'
    check (treatment in ('rebill', 'deduct', 'unassigned')),
  receipt_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An expense cannot be rebilled to nobody. Enforced here rather than in the
  -- app, because A2's arithmetic silently breaks if a rebill line has no trip
  -- to attach to.
  check (treatment <> 'rebill' or trip_id is not null),
  unique (account_id, id)
);

-- ---------------------------------------------------------------------------
-- documents — every date-bearing credential. Feeds the expiration engine.
-- ---------------------------------------------------------------------------
create table if not exists pilot.documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  kind text not null
    check (kind in ('medical', 'flight_review', 'passport', 'certificate',
                    'insurance', 'w9', 'other')),
  label text not null,
  -- The column name is load-bearing: the expiration engine's coverage check
  -- (C4) finds date-bearing tables by looking for `expires_on`. Naming a new
  -- expiry column anything else is how a table silently escapes the ladder,
  -- which is precisely the FlightDeptPro failure this engine exists to avoid.
  expires_on date,
  issued_on date,
  check (issued_on is null or expires_on is null or expires_on >= issued_on),
  client_id uuid,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete cascade,
  file_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

-- ---------------------------------------------------------------------------
-- THE EXPIRATION ENGINE (A1 + C4)
--
-- FlightDeptPro's reminder ladder fired for crew documents but never for two
-- EXPIRED federal compliance programs, because those lived in a module nobody
-- wired in. The requirement is therefore not "add an expires_on column" — it
-- is that every date-bearing row participates BY CONSTRUCTION, and that a
-- verify script can PROVE nothing sits outside.
--
-- Mechanism: one view unions every source. The completeness check
-- (pilot.expiration_coverage_gaps) inspects the catalog for any table in
-- schema `pilot` carrying an `expires_on` column and reports any that the
-- view does not read from. A new date-bearing table therefore cannot be added
-- silently — tenancy:verify fails until it is unioned in.
--
-- The ladder itself (T-30 / T-14 / T-7 / T-1 / OVERDUE) is computed here so
-- there is exactly ONE definition of "due soon" in the product (C2: two
-- sources for one number is a defect).
-- ---------------------------------------------------------------------------
create or replace view pilot.expirations
with (security_invoker = true) as
  select
    'document'::text                as source_table,
    d.id                            as source_id,
    d.account_id,
    d.kind                          as item_kind,
    d.label                         as item_label,
    d.expires_on,
    (d.expires_on - current_date)   as days_remaining,
    case
      when d.expires_on < current_date                       then 'overdue'
      when d.expires_on <= current_date + 1                  then 't_minus_1'
      when d.expires_on <= current_date + 7                  then 't_minus_7'
      when d.expires_on <= current_date + 14                 then 't_minus_14'
      when d.expires_on <= current_date + 30                 then 't_minus_30'
      else 'ok'
    end                             as ladder_stage
  from pilot.documents d
  where d.expires_on is not null;

comment on view pilot.expirations is
  'A1/C4: the single expiry ladder. Every date-bearing row type in schema pilot MUST be unioned in here — pilot.expiration_coverage_gaps() proves it, and tenancy:verify fails if it is not empty. security_invoker so the underlying tables RLS still applies.';

-- C4's enforcement. Returns one row per table that carries an `expires_on`
-- column but is not read by the pilot.expirations view. A non-empty result is
-- a build failure, not a warning.
create or replace function pilot.expiration_coverage_gaps()
returns table (missing_table text)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.relname::text
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'pilot'
    and c.relkind = 'r'
    and a.attname = 'expires_on'
    and a.attnum > 0
    and not a.attisdropped
    and c.oid not in (
      -- tables the expirations view actually depends on
      select d.refobjid
      from pg_catalog.pg_depend d
      join pg_catalog.pg_rewrite r on r.oid = d.objid
      join pg_catalog.pg_class v on v.oid = r.ev_class
      join pg_catalog.pg_namespace vn on vn.oid = v.relnamespace
      where vn.nspname = 'pilot'
        and v.relname = 'expirations'
        and d.classid = 'pg_rewrite'::regclass
        and d.refclassid = 'pg_class'::regclass
    );
$$;

comment on function pilot.expiration_coverage_gaps() is
  'C4 enforcement: any table with an expires_on column that the expirations view does not read. Must return zero rows.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger clients_set_updated_at before update on pilot.clients
  for each row execute function pilot.set_updated_at();
create trigger trips_set_updated_at before update on pilot.trips
  for each row execute function pilot.set_updated_at();
create trigger trip_legs_set_updated_at before update on pilot.trip_legs
  for each row execute function pilot.set_updated_at();
create trigger expenses_set_updated_at before update on pilot.expenses
  for each row execute function pilot.set_updated_at();
create trigger documents_set_updated_at before update on pilot.documents
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- indexes. Every one serves a declared read path; none duplicates the
-- unique(account_id, id) that already backs the composite FKs.
-- ---------------------------------------------------------------------------
create index if not exists clients_account_idx on pilot.clients (account_id) where archived_at is null;
create index if not exists trips_account_status_idx on pilot.trips (account_id, status, starts_on desc);
create index if not exists trips_client_idx on pilot.trips (account_id, client_id);
create index if not exists trips_billing_idx on pilot.trips (account_id, billing_state) where billing_state = 'unbilled';
create index if not exists trip_legs_trip_idx on pilot.trip_legs (account_id, trip_id, leg_date);
create index if not exists expenses_trip_idx on pilot.expenses (account_id, trip_id);
-- The unassigned queue is a first-class surface, so it gets its own partial index.
create index if not exists expenses_unassigned_idx on pilot.expenses (account_id, incurred_on desc)
  where treatment = 'unassigned' or trip_id is null;
create index if not exists documents_expiry_idx on pilot.documents (account_id, expires_on)
  where expires_on is not null;

-- ---------------------------------------------------------------------------
-- RLS. Enabled on every table from this, its first migration — never
-- retrofitted. There is NO admin bypass policy and no AMG-facing read path;
-- that absence is the product's trust story.
-- ---------------------------------------------------------------------------
alter table pilot.clients    enable row level security;
alter table pilot.trips      enable row level security;
alter table pilot.trip_legs  enable row level security;
alter table pilot.expenses   enable row level security;
alter table pilot.documents  enable row level security;

-- One policy shape, five tables. Note WITH CHECK on every write policy: an
-- INSERT or UPDATE policy without it lets a tenant write a row it then cannot
-- read, which is a cross-tenant write dressed up as a no-op.
create policy clients_select on pilot.clients for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy clients_insert on pilot.clients for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy clients_update on pilot.clients for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy clients_delete on pilot.clients for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy trips_select on pilot.trips for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy trips_insert on pilot.trips for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy trips_update on pilot.trips for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy trips_delete on pilot.trips for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy trip_legs_select on pilot.trip_legs for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy trip_legs_insert on pilot.trip_legs for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy trip_legs_update on pilot.trip_legs for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy trip_legs_delete on pilot.trip_legs for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy expenses_select on pilot.expenses for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy expenses_insert on pilot.expenses for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy expenses_update on pilot.expenses for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy expenses_delete on pilot.expenses for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy documents_select on pilot.documents for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy documents_insert on pilot.documents for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy documents_update on pilot.documents for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy documents_delete on pilot.documents for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- GRANTS. Column-scoped on UPDATE, per the Phase 1 CRITICAL: RLS has no
-- column granularity, so the grant is the only place column-level authority
-- can be expressed. `account_id`, `id` and `created_at` are withheld from
-- every UPDATE grant — re-parenting a row to another tenant, or rewriting its
-- identity, is not a tenant operation. `updated_at` is withheld because the
-- trigger owns it.
-- ---------------------------------------------------------------------------
grant select, insert, delete on pilot.clients, pilot.trips, pilot.trip_legs,
  pilot.expenses, pilot.documents to authenticated;
grant select on pilot.expirations to authenticated;
grant execute on function pilot.expiration_coverage_gaps() to authenticated;

grant update (name, contact_name, contact_email, contact_phone, address_line1,
  address_line2, city, state, postal_code, country, default_day_rate_cents,
  default_per_diem_cents, payment_terms_days, default_expense_treatment,
  w9_status, w9_sent_at, w9_received_at, notes, archived_at)
  on pilot.clients to authenticated;

grant update (client_id, trip_kind, status, starts_on, ends_on, aircraft_ident,
  aircraft_type, day_rate_cents, day_count, billing_state, notes)
  on pilot.trips to authenticated;

grant update (trip_id, leg_date, from_icao, to_icao, out_at, in_at, block_hours,
  night_hours, instrument_hours, day_landings, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches, holds)
  on pilot.trip_legs to authenticated;

grant update (trip_id, incurred_on, category, vendor, amount_cents, treatment,
  receipt_path, notes) on pilot.expenses to authenticated;

grant update (kind, label, expires_on, issued_on, client_id, file_path, notes)
  on pilot.documents to authenticated;

grant select, insert, update, delete on pilot.clients, pilot.trips,
  pilot.trip_legs, pilot.expenses, pilot.documents to service_role;
grant select on pilot.expirations to service_role;
