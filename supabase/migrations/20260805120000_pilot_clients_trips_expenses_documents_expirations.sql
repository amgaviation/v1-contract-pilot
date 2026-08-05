-- ============================================================================
-- Phase 3 + Phase 4 — clients, trips, trip_legs, expenses, documents
--                     + THE EXPIRATION ENGINE (cross-cutting: A1, C4)
-- ============================================================================
-- Builds on 20260802190437_pilot_schema_tenancy.sql and
-- 20260802190518_pin_trigger_function_search_path.sql. Neither is modified.
-- Four patterns from that migration govern everything here; check any future
-- addition against them:
--   1. RLS on every table, in the migration that creates it, scoped through
--      pilot.current_account_ids(). NO admin-bypass policy exists and none may
--      be added — that absence is the product (docs/PLAN.md).
--   2. COLUMN-SCOPED GRANTS. RLS has no column granularity; a whole-table
--      `grant update` plus an ownership-only policy is what produced the Phase
--      1 CRITICAL. Every write grant below enumerates columns.
--   3. COMPOSITE FKs between tenant tables. A plain FK checks existence only
--      and FK verification bypasses RLS, so `update pilot.expenses set trip_id
--      = '<other tenant''s trip>'` would pass an account_id-only policy. Every
--      parent carries `unique (id, account_id)`; every child references
--      `(parent_id, account_id)`.
--   4. `set search_path = ''` on every function; every reference qualified.
--
-- MONEY: integer minor units (US cents) in `bigint` columns named `*_cents`.
-- Chosen over numeric because every arithmetic path here (including the
-- GENERATED columns) is then exact integer math with no rounding policy to get
-- wrong; because Stripe speaks minor units natively on both integrations
-- (decision #8), so Phase 5 needs no conversion layer; and because integers
-- round-trip losslessly through CSV (C6). Mixing the two representations is
-- the failure mode, so the rule is absolute and asserted rather than wrapped
-- in a domain:
--   INVARIANT: schema `pilot` contains NO real/double precision/numeric/money
--   column. Anywhere. Tax is basis points (`_bp`); time is whole minutes
--   (`_minutes`); Phase 6 DERIVES decimal logbook hours and never stores them.
-- No currency column: the user is a US contract pilot with W-9/1099 exposure
-- (C10) and USD is a locked assumption. Deliberate limitation — adding
-- `currency` later is a rule change, not a column add, because minor-unit
-- scale is currency-dependent (JPY has none). It would belong on
-- pilot.clients with a CHECK forcing every trip and expense under that client
-- to match.
--
-- DELIBERATELY NOT STORED (C2: "two sources for one number is a defect"):
--   * trips.billing_state — docs/PLAN.md sketches it and it is a defect.
--     Invoice state lives on invoices (Phase 5). A mirror column here is
--     exactly the audited failure (their P&L said -$50k while their payments
--     ledger said +$580k). Derive it; see pilot.trip_paperwork.
--   * clients.w9_status — derivable from w9_sent_on plus the W-9 document.
--   * any trip total/margin/net — see pilot.trip_financials.
--   * days_remaining — a function of current_date; stored it is wrong the next
--     day. See pilot.expirations.
--   * logbook hours — Phase 6 derives them from leg minutes.
-- Derived values that must live in the row are GENERATED ... STORED so they
-- cannot drift. Values depending on another table are views.
-- ============================================================================


-- ============================================================================
-- 0. Shared machinery
-- ============================================================================

-- pilot.expiry_date — the load-bearing domain of the expiration engine, not
-- decoration. The engine finds its participants by scanning pg_attribute for
-- THIS DOMAIN, so typing an expiry `date` instead is the one way to smuggle a
-- date-bearing record type past it — precisely what happened in the audited
-- product (ladder fired for crew docs, never for two expired compliance
-- programs in another module). The DDL guard in §7 rejects that at
-- CREATE/ALTER TABLE. The range CHECK is a fat-finger guard: a two-digit year
-- typo would otherwise pin the whole Needs Attention queue to OVERDUE forever.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
      join pg_catalog.pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'pilot' and t.typname = 'expiry_date'
  ) then
    create domain pilot.expiry_date as date
      check (value > date '1900-01-01' and value < date '2200-01-01');
  end if;
end
$$;

comment on domain pilot.expiry_date is
  'Marker type for the expiration engine (A1, C4). Any date after which '
  'something stops being valid MUST use this domain — a plain `date` is '
  'invisible to the engine, which is the exact failure C4 prevents.';

-- Second lock behind the column-scoped UPDATE grants, for the same reason
-- pilot.protect_account_billing_columns() exists in Phase 1: a future
-- migration that re-widens a grant by accident must not silently open a
-- re-parenting path. Re-parenting a row into another tenant is never
-- legitimate for anyone, including service_role; a data fix that needs it
-- should drop this trigger explicitly, in its own migration, and say why.
create or replace function pilot.freeze_tenancy_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.account_id is distinct from old.account_id
     or new.created_at is distinct from old.created_at then
    raise exception
      'pilot.%: id, account_id and created_at are immutable (row %)',
      tg_table_name, old.id
      using hint = 'Delete and re-create the row, or write an explicit data migration.';
  end if;
  return new;
end;
$$;


-- ============================================================================
-- 1. pilot.clients — the pilot's own customers (Phase 3)
-- ============================================================================
-- docs/PLAN.md: "no existing table represents a customer of a pilot. That is
-- the central gap." This is that table.
-- A4 config-once rates: the default_* columns multiply into NEW trips. They
-- are not the rate of any existing trip — pilot.trips snapshots its own, so
-- renegotiating never rewrites money on work already flown. Two columns
-- holding a similar-looking number, answering different questions: NOT a C2
-- violation. Do not "normalise" trips to reference these.
create table if not exists pilot.clients (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references pilot.accounts (id) on delete cascade,

  display_name            text not null check (length(btrim(display_name)) > 0),
  legal_name              text,
  contact_name            text,
  contact_email           text check (contact_email is null or contact_email like '%@%'),
  contact_phone           text,
  billing_address_line1   text,
  billing_address_line2   text,
  billing_city            text,
  billing_state           text,
  billing_postal_code     text,
  billing_country         text,

  -- Nullable: "no standing rate yet" is a real state; 0 is a different claim.
  default_day_rate_cents  bigint check (default_day_rate_cents >= 0),
  default_per_diem_cents  bigint check (default_per_diem_cents >= 0),

  -- A3: treatment is asked ONCE at capture. Pre-filling per client from the
  -- deal terms is how "once" stays true. 'unassigned' is the honest default —
  -- it routes the receipt to the first-class queue instead of guessing.
  default_expense_treatment text not null default 'unassigned'
    check (default_expense_treatment in ('rebill', 'deduct', 'unassigned')),

  -- C10: tax supported on invoice lines from Phase 5, not retrofitted. Basis
  -- points, integer, exact. Phase 5 SNAPSHOTS these onto the line, for the
  -- same reason trips snapshot the day rate.
  default_tax_rate_bp     integer not null default 0
    check (default_tax_rate_bp between 0 and 10000),
  tax_label               text,

  payment_terms_days      integer not null default 15
    check (payment_terms_days between 0 and 365),

  -- C10 / Needs Attention queue. The pilot's W-9 FILE lives in
  -- pilot.documents, account-scoped (one W-9, not one per client). What is
  -- per-client is the transmission fact. Deliberately NO w9_status column:
  -- status is `w9_sent_on is null`, and storing both is C2's defect.
  w9_sent_on              date,

  status                  text not null default 'active'
    check (status in ('active', 'archived')),
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Composite-FK target: required by Postgres as the referenced key.
  unique (id, account_id)
);

comment on table pilot.clients is
  'The pilot''s own customers. No code path surfaces these rows outside the '
  'owning account. Rate columns are DEFAULTS for future trips (A4); the rate '
  'governing a flown trip is snapshotted on pilot.trips.';
comment on column pilot.clients.w9_sent_on is
  'Date the pilot sent THEIR W-9 to this client (clients 1099 the pilot, C10). '
  'Null = outstanding. Do not add a w9_status column — second source.';

-- Two active clients with the same name in one book is a data-entry error, so
-- it is a constraint. Scoped to active rows so archive-then-re-add works.
create unique index if not exists clients_account_active_name_key
  on pilot.clients (account_id, lower(btrim(display_name))) where status = 'active';
create index if not exists clients_account_id_idx on pilot.clients (account_id);
create index if not exists clients_w9_outstanding_idx
  on pilot.clients (account_id) where w9_sent_on is null and status = 'active';

create or replace trigger clients_set_updated_at before update on pilot.clients
  for each row execute function pilot.set_updated_at();
create or replace trigger clients_freeze_tenancy before update on pilot.clients
  for each row execute function pilot.freeze_tenancy_columns();


-- ============================================================================
-- 2. pilot.trips — the parent record, the financial atom (Phase 3)
-- ============================================================================
-- A2: billable (days x rate + rebilled expenses) - deducted expenses = net,
-- each figure traceable to its artifact. The components depending only on this
-- row are GENERATED ... STORED so they cannot drift; the components depending
-- on pilot.expenses are NOT STORED AT ALL and live in pilot.trip_financials.
-- If you find yourself adding trips.total_cents, stop — that is the C2 defect.
--
-- B3 lives in pilot.trip_paperwork, NOT here. There is no readiness, release,
-- frat or airworthy column on this table and there must never be one: that is
-- a LOCKED liability boundary (docs/PLAN.md §D). Paperwork completeness only.
create table if not exists pilot.trips (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references pilot.accounts (id) on delete cascade,

  -- NOT NULL: the financial atom owes money to somebody. A flight with no
  -- customer is a logbook entry (Phase 6), not a trip.
  client_id       uuid not null,

  -- The pilot's own job number. Invoice numbering is separate and sequential
  -- (Phase 5) — do not conflate them.
  reference       text,
  title           text,

  -- Ported VERBATIM from docs/PLAN.md. Enum drift is a named risk; do not
  -- half-copy this list.
  trip_kind       text not null
    check (trip_kind in ('owner_trip', 'ferry', 'maintenance_flight',
                         'repositioning', 'contract_pilot', 'delivery_flight',
                         'other')),

  -- Lifecycle of the WORK. Not the paperwork, not the money — both derived.
  status          text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'canceled')),

  start_date      date not null,
  end_date        date not null,
  constraint trips_end_after_start check (end_date >= start_date),

  -- Nullable at planning time. pilot.trip_legs may override per leg for a
  -- multi-aircraft trip; resolution is coalesce(leg, trip) — one value with a
  -- documented override, not two sources.
  aircraft_ident  text check (aircraft_ident is null or
                    (aircraft_ident = upper(aircraft_ident)
                     and aircraft_ident ~ '^[A-Z0-9-]{2,10}$')),
  aircraft_type   text,

  -- DELIBERATELY NOT (end_date - start_date + 1). Contract-pilot day counts
  -- are negotiated: travel days, split duty, two calendar days billed as
  -- three. Generating it would encode a billing rule that does not exist and
  -- would restate agreed money whenever a date was corrected. The calendar
  -- span and the billable day count are DIFFERENT NUMBERS.
  day_count       integer not null default 0 check (day_count >= 0),

  -- Snapshot of the agreed rate, pre-filled from pilot.clients at creation
  -- (A4) and frozen after. Not denormalisation: "my standing rate" and "what
  -- this job pays" are different facts.
  day_rate_cents  bigint not null default 0 check (day_rate_cents >= 0),
  per_diem_cents  bigint not null default 0 check (per_diem_cents >= 0),

  -- The half of A2 that depends on nothing outside this row: indexable, exact
  -- integer math, incapable of disagreeing with its sources.
  day_billable_cents      bigint generated always as (day_count::bigint * day_rate_cents) stored,
  per_diem_billable_cents bigint generated always as (day_count::bigint * per_diem_cents) stored,

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (id, account_id),
  foreign key (client_id, account_id) references pilot.clients (id, account_id)
    on update restrict on delete restrict
);

comment on table pilot.trips is
  'Parent record and financial atom (A2). Trip net is NOT stored here (see '
  'pilot.trip_financials); paperwork state is NOT stored here (see '
  'pilot.trip_paperwork); operational readiness does not exist in this product '
  'at all (docs/PLAN.md §D, locked liability boundary).';
comment on column pilot.trips.day_count is
  'Billable days as agreed. Deliberately NOT derived from the date range — a '
  'negotiated day count and a calendar span are different numbers.';
comment on column pilot.trips.day_rate_cents is
  'Rate snapshot for THIS trip, pre-filled from the client default (A4) and '
  'frozen, so renegotiating cannot restate money on work already flown.';

create index if not exists trips_account_id_idx     on pilot.trips (account_id);
create index if not exists trips_account_client_idx on pilot.trips (account_id, client_id);
create index if not exists trips_account_status_idx on pilot.trips (account_id, status, end_date desc);
create unique index if not exists trips_account_reference_key
  on pilot.trips (account_id, reference) where reference is not null;

create or replace trigger trips_set_updated_at before update on pilot.trips
  for each row execute function pilot.set_updated_at();
create or replace trigger trips_freeze_tenancy before update on pilot.trips
  for each row execute function pilot.freeze_tenancy_columns();


-- ============================================================================
-- 3. pilot.trip_legs — flight legs (Phase 3; feeds Phase 6)
-- ============================================================================
-- A10: store UTC, display airport-local + Zulu derived from the ident. THERE
-- IS NO TIMEZONE COLUMN ON THIS TABLE AND THERE MUST NEVER BE ONE. The display
-- zone is a pure function of from_ident/to_ident against a static airport
-- dataset at render time; a tz column would be a second source for a fact the
-- ident already determines, and would go stale on a DST rule change.
--
-- PHASE 6, cheap now and ruinous later: the landing/takeoff breakdown is the
-- single most expensive thing to retrofit here, because retrofitting means
-- asking a pilot to re-derive months of night full-stop landings from memory.
-- docs/PLAN.md records that AMG's existing logbook schema CANNOT compute FAR
-- 61.57(b) — night_landings with no full-stop flag and no night takeoff count.
-- Fixed here, at the source. Hours are NOT stored: minutes are the record.
create table if not exists pilot.trip_legs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references pilot.accounts (id) on delete cascade,
  trip_id        uuid not null,

  -- Leg order is load-bearing for the logbook draft; "whatever the query
  -- returns" is not an order. Unique so two legs cannot share a position.
  leg_seq        integer not null check (leg_seq >= 1),

  -- Local calendar date of departure — the date the pilot writes in a
  -- logbook. A `date`, and not a timezone.
  leg_date       date not null,

  -- Permissive on purpose: '^[A-Z]{4}$' would reject real destinations (0S9,
  -- 1G4, L35 are FAA identifiers a contract pilot files to). Uppercase is a
  -- CHECK rather than a normalising trigger because C1 forbids silent writes:
  -- a lowercase ident fails loudly and the app fixes it.
  from_ident     text not null check (from_ident = upper(from_ident)
                                      and from_ident ~ '^[A-Z0-9]{3,4}$'),
  to_ident       text not null check (to_ident = upper(to_ident)
                                      and to_ident ~ '^[A-Z0-9]{3,4}$'),

  -- Nullable: route and date are entered at the airplane, times later.
  -- Requiring them would make the product invite fabrication.
  out_time_utc   timestamptz,
  in_time_utc    timestamptz,
  constraint trip_legs_in_after_out
    check (out_time_utc is null or in_time_utc is null or in_time_utc > out_time_utc),

  -- Per-leg override; null means "use pilot.trips.aircraft_ident".
  aircraft_ident text check (aircraft_ident is null or
                    (aircraft_ident = upper(aircraft_ident)
                     and aircraft_ident ~ '^[A-Z0-9-]{2,10}$')),

  block_minutes  integer generated always as (
                   (extract(epoch from (in_time_utc - out_time_utc)) / 60)::integer) stored,

  night_minutes                integer not null default 0 check (night_minutes >= 0),
  instrument_actual_minutes    integer not null default 0 check (instrument_actual_minutes >= 0),
  instrument_simulated_minutes integer not null default 0 check (instrument_simulated_minutes >= 0),

  -- 61.57(a) needs landings; 61.57(b) needs night TAKEOFFS and landings to a
  -- FULL STOP; tailwheel rules need day full-stops. All four, from day one.
  day_landings                integer not null default 0 check (day_landings >= 0),
  day_landings_full_stop      integer not null default 0 check (day_landings_full_stop >= 0),
  night_landings_full_stop    integer not null default 0 check (night_landings_full_stop >= 0),
  night_landings_touch_and_go integer not null default 0 check (night_landings_touch_and_go >= 0),
  night_takeoffs              integer not null default 0 check (night_takeoffs >= 0),

  -- 61.57(c) requires an approach COUNT.
  approaches     integer not null default 0 check (approaches >= 0),
  holds          integer not null default 0 check (holds >= 0),

  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint trip_legs_full_stop_within_landings
    check (day_landings_full_stop <= day_landings),

  -- Time inside the leg cannot exceed the leg. Written against the SOURCE
  -- expression rather than block_minutes: a CHECK referencing a generated
  -- column is a portability trap, and this form is provably immutable.
  constraint trip_legs_night_within_block
    check (out_time_utc is null or in_time_utc is null
           or night_minutes <= (extract(epoch from (in_time_utc - out_time_utc)) / 60)),
  constraint trip_legs_instrument_within_block
    check (out_time_utc is null or in_time_utc is null
           or instrument_actual_minutes
              <= (extract(epoch from (in_time_utc - out_time_utc)) / 60)),

  unique (id, account_id),
  unique (trip_id, leg_seq),
  foreign key (trip_id, account_id) references pilot.trips (id, account_id)
    on update restrict on delete cascade
);

comment on table pilot.trip_legs is
  'Legs of a trip. A10: times stored UTC, displayed in the airport-local zone '
  'derived from the ident plus Zulu. THERE IS NO TIMEZONE COLUMN AND THERE '
  'MUST NEVER BE ONE. The landing/takeoff breakdown exists from day one '
  'because FAR 61.57(b) is uncomputable without it and cannot be reconstructed.';
comment on column pilot.trip_legs.block_minutes is
  'Generated and stored — cannot drift from out/in. Phase 6 DERIVES decimal '
  'hours from minutes at read time and must not store them.';

create index if not exists trip_legs_account_id_idx   on pilot.trip_legs (account_id);
create index if not exists trip_legs_trip_idx         on pilot.trip_legs (trip_id, leg_seq);
create index if not exists trip_legs_account_date_idx on pilot.trip_legs (account_id, leg_date desc);

create or replace trigger trip_legs_set_updated_at before update on pilot.trip_legs
  for each row execute function pilot.set_updated_at();
create or replace trigger trip_legs_freeze_tenancy before update on pilot.trip_legs
  for each row execute function pilot.freeze_tenancy_columns();


-- ============================================================================
-- 4. pilot.trip_participants — requirement B6, made structural
-- ============================================================================
-- "Trip participants are DATA, not identities; account_members stays the only
-- auth model." A comment saying so is not enforcement — a table with nowhere
-- to put a user_id is. THERE IS NO user_id COLUMN HERE AND THERE MUST NEVER BE
-- ONE: a participant who needs to log in gets a pilot.account_members row.
-- Adding `user_id uuid references auth.users` here IS the identity-model drift
-- docs/PLAN.md names as a risk.
-- The crew_role vocabulary has NO passenger value, deliberately: passenger
-- manifests are rejected scope (§D), and this CHECK is what keeps them out.
create table if not exists pilot.trip_participants (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references pilot.accounts (id) on delete cascade,
  trip_id      uuid not null,
  display_name text not null check (length(btrim(display_name)) > 0),
  crew_role    text not null
    check (crew_role in ('pic', 'sic', 'instructor', 'check_airman', 'other_crew')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, account_id),
  foreign key (trip_id, account_id) references pilot.trips (id, account_id)
    on update restrict on delete cascade
);

comment on table pilot.trip_participants is
  'Other crew on a trip, as DATA (B6). NO user_id column, ever — '
  'pilot.account_members is the only identity model. No passenger role: '
  'passenger manifests are rejected scope (§D).';

create index if not exists trip_participants_trip_idx       on pilot.trip_participants (trip_id);
create index if not exists trip_participants_account_id_idx on pilot.trip_participants (account_id);

create or replace trigger trip_participants_set_updated_at before update on pilot.trip_participants
  for each row execute function pilot.set_updated_at();
create or replace trigger trip_participants_freeze_tenancy before update on pilot.trip_participants
  for each row execute function pilot.freeze_tenancy_columns();


-- ============================================================================
-- 5. pilot.expenses — one classification, set at capture (Phase 4)
-- ============================================================================
-- A3 is the whole point of this table: `treatment` is asked ONCE, at capture,
-- and every downstream surface DERIVES from it — invoice draft (Phase 5),
-- deduction file, year-end packet, the client-copy vs internal-copy expense
-- reports (A6). No surface re-asks; no surface stores its own copy.
-- 'unassigned' is a first-class state, not a null-shaped placeholder: those
-- receipts are neither billed nor deducted, and that is the point. NOT NULL
-- with a default, so a receipt snapped at the FBO always lands somewhere real.
create table if not exists pilot.expenses (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references pilot.accounts (id) on delete cascade,

  -- Nullable by design: a business expense with no trip (subscription,
  -- headset, insurance) is deductible and belongs here.
  trip_id       uuid,

  -- THE CASH-BASIS ANCHOR (C3). Named for what it is so nobody confuses it
  -- with created_at, which is never a money date.
  incurred_on   date not null,

  -- Ported VERBATIM from docs/PLAN.md (amg1 expenses.category). Do not extend
  -- casually: every added value is a new column on every expense report and a
  -- new row in the accountant packet.
  category      text not null
    check (category in ('airline', 'hotel', 'rental_car', 'rideshare',
                        'fuel', 'meals', 'parking', 'other')),
  vendor        text,

  -- Non-zero rather than positive: a fuel credit or refunded hotel night is a
  -- real row and belongs in the same ledger with a negative amount. A
  -- zero-amount expense is always a defect. Report authors: SUM, never
  -- SUM(abs(...)).
  amount_cents  bigint not null check (amount_cents <> 0),

  -- A3, locked vocabulary.
  treatment     text not null default 'unassigned'
    check (treatment in ('rebill', 'deduct', 'unassigned')),

  -- Storage path for the receipt — part of C6's "expenses with receipt files".
  receipt_path  text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A rebilled expense is billed TO SOMEBODY, and that somebody is the trip's
  -- client. Rebill-with-no-trip is unrepresentable, not a validation message
  -- the app is trusted to show. This is also what makes
  -- trip_financials.billable_cents complete by construction: every rebilled
  -- cent in the account is attached to exactly one trip.
  constraint expenses_rebill_requires_trip
    check (treatment <> 'rebill' or trip_id is not null),

  unique (id, account_id),
  foreign key (trip_id, account_id) references pilot.trips (id, account_id)
    on update restrict on delete restrict
);

comment on table pilot.expenses is
  'A3: the treatment tag is set ONCE at capture and drives every downstream '
  'surface. No surface re-asks and none stores its own copy. ''unassigned'' is '
  'a first-class queue state, not a placeholder.';
comment on column pilot.expenses.incurred_on is
  'Cash-basis anchor (C3). created_at is never a money date.';
comment on column pilot.expenses.amount_cents is
  'Signed. Negative rows are credits/refunds. Reports SUM, never SUM(abs()).';
comment on constraint expenses_trip_id_account_id_fkey on pilot.expenses is
  'ON DELETE RESTRICT deliberately: deleting a trip with money attached must '
  'force the pilot to deal with the money first. Consequence: cascade-from-'
  'account deletion is unreliable, so account closure (deferred in '
  'docs/PLAN.md) must delete children explicitly, in dependency order.';

create index if not exists expenses_account_id_idx on pilot.expenses (account_id);
create index if not exists expenses_trip_idx on pilot.expenses (trip_id) where trip_id is not null;
-- The Overview's Needs Attention queue reads exactly this partial index.
create index if not exists expenses_unassigned_queue_idx
  on pilot.expenses (account_id, incurred_on desc) where treatment = 'unassigned';
-- Deductible Expenses KPI + accountant packet, both cash-basis by year.
create index if not exists expenses_account_basis_idx
  on pilot.expenses (account_id, incurred_on desc, treatment);

create or replace trigger expenses_set_updated_at before update on pilot.expenses
  for each row execute function pilot.set_updated_at();
create or replace trigger expenses_freeze_tenancy before update on pilot.expenses
  for each row execute function pilot.freeze_tenancy_columns();


-- ============================================================================
-- 6. pilot.documents — the date-bearing records (A1; Phase 8 surfaces them)
-- ============================================================================
-- Medical, flight review, passport, certificates, W-9. This is the FIRST
-- participant in the expiration engine and, for now, the only one — which is
-- exactly the condition under which the audited product got C4 wrong. §7 is
-- built so the SECOND participant enrols itself.
-- Subject scoping: a document is about the account (the pilot's medical, their
-- W-9), a client (a contract, a cert), or a trip. subject_kind plus the
-- exactly-one-target CHECK makes "a client document with a trip_id"
-- unrepresentable rather than merely discouraged.
create table if not exists pilot.documents (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references pilot.accounts (id) on delete cascade,

  doc_type       text not null
    check (doc_type in ('medical', 'flight_review', 'passport', 'certificate',
                        'w9', 'insurance', 'contract', 'other')),

  subject_kind   text not null check (subject_kind in ('account', 'client', 'trip')),
  client_id      uuid,
  trip_id        uuid,

  title            text not null check (length(btrim(title)) > 0),
  reference_number text,

  -- Phase 7 needs the class to compute medical duration under 61.23 (first/
  -- second/third expire on different schedules by age). Cheap now; a retrofit
  -- means asking the pilot to re-enter every medical.
  medical_class  text check (medical_class in ('first', 'second', 'third')),
  constraint documents_medical_class_only_on_medical
    check (medical_class is null or doc_type = 'medical'),

  issued_on      date,

  -- THE expiry. Domain-typed, which is what enrols this table in the engine.
  -- Nullable: a certificate that never expires is a real document.
  expires_on     pilot.expiry_date,
  constraint documents_expiry_after_issue
    check (expires_on is null or issued_on is null or expires_on >= issued_on),

  -- Engine contract column: a GENERATED copy of doc_type, so it cannot
  -- disagree with it. Its job is to give the generated pilot.expirations view
  -- a uniform column across every participant, so the queue carries a type tag
  -- (A7) without joining back to each source.
  expiry_kind    text generated always as (doc_type) stored,

  file_path      text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint documents_exactly_one_subject check (
    (subject_kind = 'account' and client_id is null     and trip_id is null)
    or (subject_kind = 'client' and client_id is not null and trip_id is null)
    or (subject_kind = 'trip'   and client_id is null     and trip_id is not null)
  ),

  unique (id, account_id),
  foreign key (client_id, account_id) references pilot.clients (id, account_id)
    on update restrict on delete restrict,
  foreign key (trip_id, account_id) references pilot.trips (id, account_id)
    on update restrict on delete restrict
);

comment on table pilot.documents is
  'Date-bearing records (A1). Participates in the expiration engine BY '
  'CONSTRUCTION: expires_on is typed pilot.expiry_date, which is how '
  'pilot.rebuild_expirations_view() finds it. Nobody wired this table in by '
  'hand and nobody can forget to wire in the next one.';
comment on column pilot.documents.expires_on is
  'Typed pilot.expiry_date, NOT date. A plain `date` here would make this row '
  'type invisible to the engine — the precise failure C4 prevents. The DDL '
  'guard rejects it.';
comment on column pilot.documents.expiry_kind is
  'Engine contract column. Every table with a pilot.expiry_date column must '
  'expose id, account_id and expiry_kind or the rebuild fails at DDL time.';

create index if not exists documents_account_id_idx on pilot.documents (account_id);
create index if not exists documents_client_idx on pilot.documents (client_id) where client_id is not null;
create index if not exists documents_trip_idx   on pilot.documents (trip_id)   where trip_id is not null;
-- The engine's hot path: everything expiring, soonest first, for this tenant.
create index if not exists documents_expiry_idx
  on pilot.documents (account_id, expires_on) where expires_on is not null;
-- The W-9 paperwork gate reads exactly this.
create index if not exists documents_account_w9_idx
  on pilot.documents (account_id, expires_on)
  where doc_type = 'w9' and subject_kind = 'account';

create or replace trigger documents_set_updated_at before update on pilot.documents
  for each row execute function pilot.set_updated_at();
create or replace trigger documents_freeze_tenancy before update on pilot.documents
  for each row execute function pilot.freeze_tenancy_columns();


-- ============================================================================
-- 7. THE EXPIRATION ENGINE (A1 + C4)
-- ============================================================================
-- The failure this exists to make impossible: the audited product had a
-- perfectly good escalation ladder. It fired for crew documents. It never
-- fired for two EXPIRED federal compliance programs, because those lived in a
-- different module and nobody wired that module in. Nothing was broken.
-- Something was simply not connected, and nothing in the system could tell.
--
-- C4: "any table carrying an expiry participates BY CONSTRUCTION — one code
-- path, and a verify script asserting no date-bearing row type is outside it."
-- Four layered mechanisms, strongest first:
--   (1) TYPE — an expiry is a pilot.expiry_date, making the set of
--       date-bearing columns discoverable EXACTLY by catalog lookup rather
--       than by guessing at column names.
--   (2) GENERATION — pilot.expirations is NOT a hand-written UNION somebody
--       must remember to extend. It is generated from the catalog by
--       pilot.rebuild_expirations_view(). A new participant is not "wired in";
--       there is nothing to wire. It appears.
--   (3) DDL AUTOMATION — an event trigger runs the generator after any
--       CREATE/ALTER TABLE in schema pilot, so a table with an expiry column
--       is enrolled in the same statement that creates it. The same trigger
--       REJECTS both ways of breaking the rule: a plain-`date` column named
--       like an expiry, and a participant missing the (id, account_id,
--       expiry_kind) contract.
--   (4) ASSERTION — pilot.assert_expiry_coverage() re-derives coverage from
--       pg_depend. This is what `npm run expiry:verify` calls in CI, and the
--       backstop for the one environment where (3) may be unavailable:
--       Supabase does not always permit CREATE EVENT TRIGGER, so its creation
--       below is best-effort and degrades to a loud WARNING.
--
-- ONE CODE PATH: the ladder is pilot.expiry_ladder_stage() and
-- pilot.expiry_status(), read by the generated view and by nothing that
-- reimplements them. A screen computing "days remaining" in TypeScript is the
-- defect C2 names.
-- ============================================================================

-- 7a. The ladder — the T-30 / T-14 / T-7 / T-1 / OVERDUE rungs from A1, ported
-- verbatim as strings so the engine and the dispatcher cannot drift apart.
-- STABLE not IMMUTABLE because it reads current_date, which is also exactly
-- why days_remaining and ladder_stage can never be stored columns: a stored
-- "days remaining" is wrong the day after it is written.
create or replace function pilot.expiry_ladder_stage(expires_on date)
returns text language sql stable set search_path = '' as $$
  select case
           when expires_on is null               then null
           when expires_on <  current_date       then 'OVERDUE'
           when expires_on -  current_date <=  1 then 'T-1'
           when expires_on -  current_date <=  7 then 'T-7'
           when expires_on -  current_date <= 14 then 'T-14'
           when expires_on -  current_date <= 30 then 'T-30'
           else                                       'OK'
         end;
$$;

comment on function pilot.expiry_ladder_stage(date) is
  'The A1 escalation ladder, in one place. Every surface showing a rung reads '
  'this. Reimplementing it in application code is C2''s "two sources".';

create or replace function pilot.expiry_status(expires_on date)
returns text language sql stable set search_path = '' as $$
  select case
           when expires_on is null              then null
           when expires_on <  current_date      then 'expired'
           when expires_on - current_date <= 30 then 'expiring_soon'
           else                                      'current'
         end;
$$;

comment on function pilot.expiry_status(date) is
  'Red/amber/green for A1: expired / expiring_soon (within 30 days) / current. '
  'Distinct from the ladder rung, which is about which reminder became due.';

-- 7b. Participant discovery — the catalog IS the registry. There is
-- deliberately no registry table: a registry table is a second place to
-- forget, and it would have to be a table in `pilot` with no account_id, which
-- this schema does not permit. pg_attribute already knows the answer.
create or replace function pilot.expiry_participants()
returns table (source_table name, source_column name)
language sql stable set search_path = '' as $$
  select c.relname, a.attname
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class     c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_type      t on t.oid = a.atttypid
   where n.nspname = 'pilot'
     and c.relkind in ('r', 'p')
     and a.attnum > 0
     and not a.attisdropped
     and t.typtype = 'd'
     and t.typname = 'expiry_date'
   order by c.relname, a.attname;
$$;

-- 7c. The generator. The view's COLUMN LIST IS FIXED and must stay fixed:
-- `create or replace view` cannot change a view's columns or types, so future
-- participants adapt to this shape rather than the shape adapting to them.
-- That is the point of the (id, account_id, expiry_kind) contract, and
-- violating it fails HERE, at DDL time, with the fix in the message.
create or replace function pilot.rebuild_expirations_view()
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  p       record;
  missing text;
  parts   text[] := array[]::text[];
  body    text;
begin
  for p in select * from pilot.expiry_participants() loop
    select string_agg(v.needed, ', ' order by v.needed)
      into missing
      from (values ('id'), ('account_id'), ('expiry_kind')) as v(needed)
     where not exists (
             select 1
               from pg_catalog.pg_attribute a
               join pg_catalog.pg_class     c on c.oid = a.attrelid
               join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'pilot'
                and c.relname = p.source_table
                and a.attname = v.needed
                and a.attnum > 0
                and not a.attisdropped);

    if missing is not null then
      raise exception
        'EXPIRATION ENGINE: pilot.% has a pilot.expiry_date column (%) but is missing: %',
        p.source_table, p.source_column, missing
        using hint =
          'Every table carrying an expiry must expose id uuid, account_id uuid and '
          'expiry_kind text (a generated copy of whatever names the kind of thing). '
          'See C4 and pilot.documents for the reference shape.';
    end if;

    parts := parts || format(
      $q$select %L::text as source_table,
                %L::text as source_column,
                s.id                as source_id,
                s.account_id        as account_id,
                s.expiry_kind::text as expiry_kind,
                s.%I::date          as expires_on
           from pilot.%I s
          where s.%I is not null$q$,
      p.source_table, p.source_column,
      p.source_column, p.source_table, p.source_column);
  end loop;

  if cardinality(parts) = 0 then
    -- No participants. The view must still exist with the right shape, or
    -- every consumer breaks on a schema where documents was dropped.
    body := $q$select null::text as source_table, null::text as source_column,
                     null::uuid as source_id,    null::uuid as account_id,
                     null::text as expiry_kind,  null::date as expires_on
                where false$q$;
  else
    body := array_to_string(parts, E'\n    union all\n');
  end if;

  -- security_invoker is LOAD-BEARING, not stylistic. Without it the view runs
  -- as its owner, that owner owns the base tables, and a table's owner is
  -- exempt from its own RLS — the view would be a complete, silent,
  -- cross-tenant bypass of every policy in this schema. The Phase 1 migration
  -- warns about this for convenience views in `public`; it is just as true for
  -- a view sitting next to its tables.
  execute format($v$
    create or replace view pilot.expirations with (security_invoker = true) as
    with sources as (
    %s
    )
    select s.account_id, s.source_table, s.source_column, s.source_id,
           s.expiry_kind, s.expires_on,
           (s.expires_on - current_date)::integer  as days_remaining,
           pilot.expiry_ladder_stage(s.expires_on) as ladder_stage,
           pilot.expiry_status(s.expires_on)       as status
      from sources s
  $v$, body);

  -- create or replace view preserves ACLs on an existing view but grants
  -- nothing on first creation, so re-granting is necessary and idempotent.
  execute 'grant select on pilot.expirations to authenticated';
  execute 'grant select on pilot.expirations to service_role';
  execute $c$comment on view pilot.expirations is
    'THE expiration engine (A1, C4). GENERATED — never hand-edit; regenerate '
    'with select pilot.rebuild_expirations_view(). Every pilot.* table with a '
    'pilot.expiry_date column appears here automatically, which is what '
    '"participates by construction" means. Deep-link with (source_table, source_id).'$c$;
end;
$fn$;

-- 7d. The two assertions — the "verify script asserting no date-bearing row
-- type is outside it" half of C4, implemented in the database so the script
-- and the DDL guard share ONE implementation.

-- Coverage, derived from pg_depend rather than by string-matching
-- pg_get_viewdef, so it cannot be fooled by a name in a comment or dead branch.
create or replace function pilot.assert_expiry_coverage()
returns void language plpgsql stable set search_path = '' as $$
declare uncovered text;
begin
  select string_agg(format('pilot.%s.%s', p.source_table, p.source_column), ', ')
    into uncovered
    from pilot.expiry_participants() p
   where not exists (
     select 1
       from pg_catalog.pg_depend    d
       join pg_catalog.pg_rewrite   rw  on rw.oid  = d.objid
       join pg_catalog.pg_class     v   on v.oid   = rw.ev_class
       join pg_catalog.pg_namespace vn  on vn.oid  = v.relnamespace
       join pg_catalog.pg_class     src on src.oid = d.refobjid
       join pg_catalog.pg_namespace sn  on sn.oid  = src.relnamespace
       join pg_catalog.pg_attribute sa  on sa.attrelid = src.oid
                                       and sa.attnum   = d.refobjsubid
      where d.classid    = 'pg_catalog.pg_rewrite'::regclass
        and d.refclassid = 'pg_catalog.pg_class'::regclass
        and vn.nspname = 'pilot' and v.relname   = 'expirations'
        and sn.nspname = 'pilot' and src.relname = p.source_table
        and sa.attname = p.source_column);

  if uncovered is not null then
    raise exception 'EXPIRY COVERAGE FAILURE (C4): % is not read by pilot.expirations',
      uncovered using hint = 'select pilot.rebuild_expirations_view();';
  end if;
end;
$$;

-- Anti-dodge: the only way to hide a date-bearing record type from the engine
-- is to type its expiry `date`/`timestamptz` instead of pilot.expiry_date.
-- This catches that by name. The exclusion is STRUCTURAL, not an allowlist: a
-- table with a `source_table` column is a polymorphic SINK (the dispatch log
-- below), holding a COPY of an expiry sourced elsewhere. Sinks are not
-- sources. Wanting to add a second exclusion — by name, for one table — is the
-- erosion this comment exists to stop; make that table a real participant.
create or replace function pilot.assert_no_unmanaged_expiry_columns()
returns void language plpgsql stable set search_path = '' as $$
declare offenders text;
begin
  select string_agg(format('pilot.%s.%s (%s)', c.relname, a.attname,
                    pg_catalog.format_type(a.atttypid, a.atttypmod)), ', ')
    into offenders
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class     c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_type      t on t.oid = a.atttypid
   where n.nspname = 'pilot'
     and c.relkind in ('r', 'p')
     and a.attnum > 0
     and not a.attisdropped
     and t.typtype = 'b'
     and t.typname in ('date', 'timestamp', 'timestamptz')
     and a.attname ~ '(expir|valid_until|renew)'
     and not exists (select 1 from pg_catalog.pg_attribute sa
                      where sa.attrelid = c.oid and sa.attname = 'source_table'
                        and sa.attnum > 0 and not sa.attisdropped);

  if offenders is not null then
    raise exception 'UNMANAGED EXPIRY COLUMN(S) (C4): %', offenders
      using hint = 'Type the column pilot.expiry_date so the engine picks it up '
                   'automatically, and give the table id/account_id/expiry_kind.';
  end if;
end;
$$;

-- 7e. pilot.expiration_notices — the ladder's dispatch log. Idempotency is a
-- UNIQUE CONSTRAINT, not application logic, and the key includes the expiry
-- value itself. That buys two properties for free: a rung fires exactly once
-- however many times the notifier runs (crash, retry, pg_cron overlap, two
-- workers); and RENEWING a document RESETS the ladder automatically, because
-- the new expires_on is a different key — there is no "reset reminders" code
-- path to forget to call.
-- No FK to the source row (polymorphic), but the tenant boundary is still
-- hard: account_id has a real FK and RLS scopes through current_account_ids().
-- source_expires_on is a plain `date`, NOT pilot.expiry_date, and that is
-- correct — it is a snapshot of somebody else's expiry, and the domain would
-- make the engine union its own dispatch log back into itself.
create table if not exists pilot.expiration_notices (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references pilot.accounts (id) on delete cascade,
  source_table      text not null,
  source_column     text not null,
  source_id         uuid not null,
  source_expires_on date not null,
  -- Same vocabulary as pilot.expiry_ladder_stage(); both live in this one file
  -- on purpose. Adding a rung means editing both, here.
  stage             text not null
    check (stage in ('T-30', 'T-14', 'T-7', 'T-1', 'OVERDUE')),
  sent_at           timestamptz not null default now(),
  channel           text not null default 'email' check (channel in ('email', 'in_app')),
  unique (account_id, source_table, source_column, source_id, source_expires_on, stage, channel)
);

comment on table pilot.expiration_notices is
  'Dispatch log for the A1 ladder. The unique constraint IS the idempotency '
  'mechanism, and because source_expires_on is in the key, renewing a document '
  'resets its ladder with no code involved. Written by the notifier '
  '(service_role) only; tenants read their own history and nothing else.';

create index if not exists expiration_notices_account_idx
  on pilot.expiration_notices (account_id, sent_at desc);
create index if not exists expiration_notices_source_idx
  on pilot.expiration_notices (source_table, source_id);

-- Build the view now that a participant exists.
select pilot.rebuild_expirations_view();


-- ============================================================================
-- 8. Derived reads. Every number in the product comes from one of these or
--    from a generated column. Nothing computes money twice.
-- ============================================================================
-- All of these are security_invoker = true. A view without it runs as its
-- owner, that owner owns the base tables, and a table's owner is exempt from
-- its own RLS — so an un-invoker'd view here would serve every tenant's money
-- to every tenant.

-- 8a. pilot.trip_financials — A2, and the ONLY place trip money is computed:
--   billable = days x rate + per diem + rebilled expenses
--   trip net = billable - deducted expenses
-- Each figure is traceable to its artifact: the day/per-diem components to the
-- generated columns on pilot.trips, the expense components to the individual
-- pilot.expenses rows whose treatment tag (A3) decided their side.
-- unassigned_expense_cents is exposed and is in NEITHER total — deliberately.
-- That is A3's point made visible: an undecided receipt is neither billed nor
-- deducted, and the trip page should say so rather than quietly bury it.
-- Per diem: A2 states the formula as (days x rate + rebilled) - deducted. Per
-- diem is a real billable component for a contract pilot and is kept as its own
-- column so the stated formula still reads exactly, with the per diem visible
-- as the extension it is. If a pilot's per diem is NOT billable to a client,
-- the correct modelling is per_diem_cents = 0 plus a 'deduct' expense — never a
-- hidden flag.
create or replace view pilot.trip_financials with (security_invoker = true) as
select t.account_id,
       t.id as trip_id,
       t.client_id,
       t.status,
       t.start_date,
       t.end_date,
       t.day_count,
       t.day_rate_cents,
       t.day_billable_cents,
       t.per_diem_billable_cents,
       coalesce(sum(e.amount_cents) filter (where e.treatment = 'rebill'), 0)
         as rebilled_expense_cents,
       coalesce(sum(e.amount_cents) filter (where e.treatment = 'deduct'), 0)
         as deducted_expense_cents,
       coalesce(sum(e.amount_cents) filter (where e.treatment = 'unassigned'), 0)
         as unassigned_expense_cents,
       t.day_billable_cents + t.per_diem_billable_cents
         + coalesce(sum(e.amount_cents) filter (where e.treatment = 'rebill'), 0)
         as billable_cents,
       t.day_billable_cents + t.per_diem_billable_cents
         + coalesce(sum(e.amount_cents) filter (where e.treatment = 'rebill'), 0)
         - coalesce(sum(e.amount_cents) filter (where e.treatment = 'deduct'), 0)
         as trip_net_cents,
       count(e.id) filter (where e.treatment = 'unassigned') as unassigned_expense_count
  from pilot.trips t
  left join pilot.expenses e on e.trip_id = t.id and e.account_id = t.account_id
 group by t.id;

comment on view pilot.trip_financials is
  'Requirement A2, and the single source for every trip money figure. Nothing '
  'stores billable_cents or trip_net_cents — adding such a column is C2''s '
  'defect. unassigned_expense_cents is in neither total, on purpose (A3).';

-- 8b. pilot.trip_paperwork — B3, enumerable, one row per gate.
--
-- ===================== READ THIS BEFORE EDITING =====================
-- THESE ARE PAPERWORK GATES. NOT OPERATIONAL GATES. EVER. No airworthiness,
-- no release, no FRAT, no weight and balance, no duty/rest, no fit-for-duty,
-- no go/no-go of any kind may be added here. That is a LOCKED liability
-- boundary (docs/PLAN.md §D, inspiration B3): this product organises
-- paperwork; the operator and the PIC make operational decisions. A gate here
-- that reads like a clearance is an existential product defect.
-- ====================================================================
--
-- met is three-valued: true = satisfied, false = not satisfied, null = the
-- module answering this gate does not exist yet. The full seven-gate
-- vocabulary is present from day one so the shape of "Paperwork complete 4 of
-- 6" is fixed and Phase 5/6 wiring is a `create or replace view` in this one
-- file rather than a new concept. Counting only non-null gates keeps today's
-- count honest (B7).
create or replace view pilot.trip_paperwork with (security_invoker = true) as
select t.account_id, t.id as trip_id, g.gate_key, g.gate_phase, g.met
  from pilot.trips t
  cross join lateral (
    values
      ('legs_entered'::text, 3::integer,
        (exists (select 1 from pilot.trip_legs l
                  where l.trip_id = t.id and l.account_id = t.account_id))::boolean),

      ('expenses_assigned', 4,
        (not exists (select 1 from pilot.expenses e
                      where e.trip_id = t.id and e.account_id = t.account_id
                        and e.treatment = 'unassigned'))),

      -- C10: clients 1099 the pilot, so the pilot's W-9 must be on file (not
      -- expired) AND actually sent to THIS client. Both halves read their
      -- single source: the document, and clients.w9_sent_on.
      ('w9_on_file', 4,
        (    exists (select 1 from pilot.documents d
                      where d.account_id = t.account_id and d.doc_type = 'w9'
                        and d.subject_kind = 'account'
                        and (d.expires_on is null or d.expires_on >= current_date))
         and exists (select 1 from pilot.clients c
                      where c.id = t.client_id and c.account_id = t.account_id
                        and c.w9_sent_on is not null))),

      -- Phase 5: replace null with the real predicate here and nowhere else.
      ('invoice_drafted',   5, null::boolean),
      ('invoice_sent',      5, null::boolean),
      ('invoice_paid',      5, null::boolean),

      -- Phase 6: satisfied by a CONFIRMED logbook entry, never by a draft
      -- (docs/PLAN.md decision #14 is locked).
      ('logbook_confirmed', 6, null::boolean)
  ) as g(gate_key, gate_phase, met);

comment on view pilot.trip_paperwork is
  'B3: enumerable PAPERWORK completeness per trip. NEVER operational go/no-go '
  '— locked liability boundary; see the warning block above this view in the '
  'migration. met = null means that gate''s module ships in a later phase.';

create or replace view pilot.trip_paperwork_summary with (security_invoker = true) as
select account_id, trip_id,
       count(*) filter (where met is not null) as gates_total,
       count(*) filter (where met)             as gates_met,
       count(*) filter (where met is null)     as gates_awaiting_module,
       bool_and(coalesce(met, true))           as paperwork_complete
  from pilot.trip_paperwork
 group by account_id, trip_id;

comment on view pilot.trip_paperwork_summary is
  'The "Paperwork complete 4/6" figure (B3). paperwork_complete ignores gates '
  'whose module does not exist yet — "complete as far as this product can '
  'currently tell", which is the honest claim (B7).';


-- ============================================================================
-- 9. RLS — every table, in the migration that creates it
-- ============================================================================
-- Every policy scopes through pilot.current_account_ids() and nothing else.
-- UPDATE policies carry the SAME predicate in USING and WITH CHECK, per the
-- Phase 1 reasoning on accounts_update: USING gates which existing rows may be
-- touched, WITH CHECK gates what the resulting row may look like; USING alone
-- would let a tenant rewrite account_id and push a row into another tenant.
-- (The column grants and freeze_tenancy_columns() also block that. Three
-- locks, because this is the one thing that must not fail.)
--
-- THERE IS NO ADMIN-BYPASS POLICY ANYWHERE IN THIS FILE AND THERE MUST NEVER
-- BE ONE. Support tooling, if ever needed, gets its own explicit, audited,
-- per-request mechanism — never a broadened policy (docs/PLAN.md).
--
-- Role note: all three member roles (owner/member/bookkeeper) may write here,
-- deliberately — a bookkeeper who cannot assign an expense treatment cannot do
-- the job their seat was bought for. None of these tables carries entitlement
-- state, which is what pilot.is_account_owner() exists to protect; gate a
-- future table on that helper if it ever does.
--
-- Do NOT add `force row level security` to any of these. Phase 1 explains at
-- length why pilot.account_members must never have it (42P17 infinite
-- recursion in current_account_ids() on every authenticated read of every
-- table here). These tables lack that specific recursion, but forcing RLS on
-- them while the helpers rely on the table-owner exemption is the kind of
-- half-applied hardening that reads as consistent and behaves as an outage.
alter table pilot.clients            enable row level security;
alter table pilot.trips              enable row level security;
alter table pilot.trip_legs          enable row level security;
alter table pilot.trip_participants  enable row level security;
alter table pilot.expenses           enable row level security;
alter table pilot.documents          enable row level security;
alter table pilot.expiration_notices enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clients','trips','trip_legs','trip_participants',
                           'expenses','documents']
  loop
    execute format('drop policy if exists %I on pilot.%I', t || '_select', t);
    execute format('drop policy if exists %I on pilot.%I', t || '_insert', t);
    execute format('drop policy if exists %I on pilot.%I', t || '_update', t);
    execute format('drop policy if exists %I on pilot.%I', t || '_delete', t);

    execute format($p$create policy %I on pilot.%I for select to authenticated
      using (account_id in (select pilot.current_account_ids()))$p$, t || '_select', t);
    execute format($p$create policy %I on pilot.%I for insert to authenticated
      with check (account_id in (select pilot.current_account_ids()))$p$, t || '_insert', t);
    execute format($p$create policy %I on pilot.%I for update to authenticated
      using (account_id in (select pilot.current_account_ids()))
      with check (account_id in (select pilot.current_account_ids()))$p$, t || '_update', t);
    execute format($p$create policy %I on pilot.%I for delete to authenticated
      using (account_id in (select pilot.current_account_ids()))$p$, t || '_delete', t);
  end loop;
end
$$;

-- The dispatch log is read-only to tenants. A tenant who could INSERT here
-- would suppress their own overdue-medical reminder by pre-writing its
-- idempotency key; a tenant who could DELETE would make the ladder fire twice.
-- Neither is a feature. No write policy AND no write grant — Phase 1's rule is
-- that the two move in lockstep.
drop policy if exists expiration_notices_select on pilot.expiration_notices;
create policy expiration_notices_select on pilot.expiration_notices
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));


-- ============================================================================
-- 10. Grants — column-scoped, per the Phase 1 CRITICAL
-- ============================================================================
-- "THIS IS THE RULE FOR EVERY FUTURE TABLE": never `grant update on <table>`;
-- always enumerate exactly the columns a tenant may change. These tables carry
-- no entitlement state so the enumeration is close to "everything" — but it is
-- written out because what it EXCLUDES is load-bearing:
--   * id — excluded from INSERT everywhere. If a tenant may choose a row's id,
--     `insert ... id = <guess>` turns the primary key into a CROSS-TENANT
--     EXISTENCE ORACLE: unique violation means "exists in some other tenant",
--     success means it does not. Same class of leak the Phase 1 review found
--     on accounts.connect_account_id. Excluded from UPDATE too.
--   * account_id — INSERTable (the row needs one, and the RLS WITH CHECK
--     constrains it to the caller's accounts), never UPDATEable.
--   * created_at / updated_at — server-owned audit signal; updated_at is
--     trigger-maintained precisely so it stays meaningful whatever writes.
--   * generated columns — cannot be granted at all; listing them would fail.
--     That is the point of GENERATED: derived money is writable by nobody,
--     including service_role.
-- Keep grants and policies in lockstep: a policy without a grant is inert, a
-- grant without a policy is a real hole.

grant select on pilot.clients to authenticated;
grant insert (account_id, display_name, legal_name, contact_name, contact_email,
  contact_phone, billing_address_line1, billing_address_line2, billing_city,
  billing_state, billing_postal_code, billing_country, default_day_rate_cents,
  default_per_diem_cents, default_expense_treatment, default_tax_rate_bp,
  tax_label, payment_terms_days, w9_sent_on, status, notes)
  on pilot.clients to authenticated;
grant update (display_name, legal_name, contact_name, contact_email,
  contact_phone, billing_address_line1, billing_address_line2, billing_city,
  billing_state, billing_postal_code, billing_country, default_day_rate_cents,
  default_per_diem_cents, default_expense_treatment, default_tax_rate_bp,
  tax_label, payment_terms_days, w9_sent_on, status, notes)
  on pilot.clients to authenticated;
grant delete on pilot.clients to authenticated;

grant select on pilot.trips to authenticated;
grant insert (account_id, client_id, reference, title, trip_kind, status,
  start_date, end_date, aircraft_ident, aircraft_type, day_count,
  day_rate_cents, per_diem_cents, notes) on pilot.trips to authenticated;
grant update (client_id, reference, title, trip_kind, status,
  start_date, end_date, aircraft_ident, aircraft_type, day_count,
  day_rate_cents, per_diem_cents, notes) on pilot.trips to authenticated;
grant delete on pilot.trips to authenticated;

grant select on pilot.trip_legs to authenticated;
grant insert (account_id, trip_id, leg_seq, leg_date, from_ident, to_ident,
  out_time_utc, in_time_utc, aircraft_ident, night_minutes,
  instrument_actual_minutes, instrument_simulated_minutes, day_landings,
  day_landings_full_stop, night_landings_full_stop, night_landings_touch_and_go,
  night_takeoffs, approaches, holds, notes) on pilot.trip_legs to authenticated;
grant update (trip_id, leg_seq, leg_date, from_ident, to_ident,
  out_time_utc, in_time_utc, aircraft_ident, night_minutes,
  instrument_actual_minutes, instrument_simulated_minutes, day_landings,
  day_landings_full_stop, night_landings_full_stop, night_landings_touch_and_go,
  night_takeoffs, approaches, holds, notes) on pilot.trip_legs to authenticated;
grant delete on pilot.trip_legs to authenticated;

grant select on pilot.trip_participants to authenticated;
grant insert (account_id, trip_id, display_name, crew_role, notes)
  on pilot.trip_participants to authenticated;
grant update (trip_id, display_name, crew_role, notes)
  on pilot.trip_participants to authenticated;
grant delete on pilot.trip_participants to authenticated;

grant select on pilot.expenses to authenticated;
grant insert (account_id, trip_id, incurred_on, category, vendor, amount_cents,
  treatment, receipt_path, notes) on pilot.expenses to authenticated;
grant update (trip_id, incurred_on, category, vendor, amount_cents,
  treatment, receipt_path, notes) on pilot.expenses to authenticated;
grant delete on pilot.expenses to authenticated;

grant select on pilot.documents to authenticated;
grant insert (account_id, doc_type, subject_kind, client_id, trip_id, title,
  reference_number, medical_class, issued_on, expires_on, file_path, notes)
  on pilot.documents to authenticated;
grant update (doc_type, subject_kind, client_id, trip_id, title,
  reference_number, medical_class, issued_on, expires_on, file_path, notes)
  on pilot.documents to authenticated;
grant delete on pilot.documents to authenticated;

-- SELECT only; see the policy comment above.
grant select on pilot.expiration_notices to authenticated;

grant select on pilot.trip_financials        to authenticated;
grant select on pilot.trip_paperwork         to authenticated;
grant select on pilot.trip_paperwork_summary to authenticated;

-- service_role (Stripe webhook, expiry notifier, export job). Broad on purpose
-- and NOT a hole: service_role bypasses RLS entirely by design in every
-- Supabase project, so narrowing its grants would be security theatre. The
-- control on it is operational — who holds the key — which docs/PLAN.md states
-- plainly and which product copy must not collapse into "we cannot technically
-- see your data".
grant select, insert, update, delete on
  pilot.clients, pilot.trips, pilot.trip_legs, pilot.trip_participants,
  pilot.expenses, pilot.documents, pilot.expiration_notices to service_role;
grant select on
  pilot.trip_financials, pilot.trip_paperwork, pilot.trip_paperwork_summary
  to service_role;

grant execute on function pilot.expiry_ladder_stage(date) to authenticated;
grant execute on function pilot.expiry_status(date)       to authenticated;
revoke all on function pilot.rebuild_expirations_view()           from public;
revoke all on function pilot.assert_expiry_coverage()             from public;
revoke all on function pilot.assert_no_unmanaged_expiry_columns() from public;
revoke all on function pilot.expiry_participants()                from public;


-- ============================================================================
-- 11. THE DDL GUARD — must be the LAST thing in this file
-- ============================================================================
-- Mechanism (3) from §7: the piece that makes forgetting structurally
-- impossible rather than merely detectable. After any CREATE/ALTER TABLE in
-- schema pilot it rejects a plain date/timestamptz column named like an expiry
-- (the only way to dodge the engine) and regenerates pilot.expirations so a new
-- participant is already in it.
--
-- The practical consequence, and the whole point: a future migration writing
-- `create table pilot.aircraft_insurance (... expires_on pilot.expiry_date
-- ...)` enrols that table in the escalation ladder IN THE SAME STATEMENT — no
-- second step, no registry to update, no code review that has to catch it. A
-- migration writing `expires_on date` instead FAILS, with the fix in the error.
--
-- IT MUST BE CREATED LAST. Once it exists it fires on every subsequent ALTER
-- TABLE here (harmless, the rebuild is idempotent), and had it existed before
-- pilot.documents it would have fired against a half-built schema.
--
-- WHY BEST-EFFORT: CREATE EVENT TRIGGER requires superuser and the `postgres`
-- role in a hosted Supabase project is not one. If refused, this degrades to a
-- WARNING and the guarantee falls back to mechanism (4) — the two assert
-- functions, called by `npm run expiry:verify` in CI. THAT IS A REAL
-- DOWNGRADE: CI catches the mistake after it is written instead of preventing
-- it, so if the warning fires the verify script is not optional and must be
-- wired into CI before the next date-bearing table ships. Do not delete this
-- block because "it didn't work" — it is free where it works, and it is the
-- difference between a guarantee and a habit.
-- ============================================================================
create or replace function pilot.expiry_engine_ddl_sync()
returns event_trigger language plpgsql security definer set search_path = '' as $$
begin
  -- This database hosts one schema per product (decision #1). Do not react to
  -- another product's DDL, or to Supabase's own internal schema churn.
  if not exists (select 1 from pg_catalog.pg_event_trigger_ddl_commands()
                  where schema_name = 'pilot') then
    return;
  end if;
  perform pilot.assert_no_unmanaged_expiry_columns();
  perform pilot.rebuild_expirations_view();
end;
$$;

create or replace function pilot.expiry_engine_drop_sync()
returns event_trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Dropping a participant normally fails on the view dependency, which is the
  -- correct default. With CASCADE the view goes too, so rebuild it. Guarded on
  -- the schema still existing so `drop schema pilot cascade` is not made
  -- un-runnable by its own housekeeping.
  if not exists (select 1 from pg_catalog.pg_event_trigger_dropped_objects()
                  where schema_name = 'pilot') then
    return;
  end if;
  if not exists (select 1 from pg_catalog.pg_namespace where nspname = 'pilot') then
    return;
  end if;
  perform pilot.rebuild_expirations_view();
end;
$$;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_event_trigger
                  where evtname = 'pilot_expiry_engine_sync') then
    begin
      execute $e$create event trigger pilot_expiry_engine_sync
                 on ddl_command_end when tag in ('CREATE TABLE', 'ALTER TABLE')
                 execute function pilot.expiry_engine_ddl_sync()$e$;
    exception when insufficient_privilege or others then
      raise warning
        'pilot: could not create event trigger pilot_expiry_engine_sync (%). The '
        'expiration engine still works, but enrolment of FUTURE date-bearing tables '
        'is no longer automatic. Wire `npm run expiry:verify` '
        '(pilot.assert_expiry_coverage + pilot.assert_no_unmanaged_expiry_columns) '
        'into CI before shipping another table with an expiry — requirement C4.',
        sqlerrm;
    end;
  end if;

  if not exists (select 1 from pg_catalog.pg_event_trigger
                  where evtname = 'pilot_expiry_engine_drop_sync') then
    begin
      execute $e$create event trigger pilot_expiry_engine_drop_sync
                 on sql_drop execute function pilot.expiry_engine_drop_sync()$e$;
    exception when insufficient_privilege or others then
      raise warning 'pilot: could not create event trigger pilot_expiry_engine_drop_sync (%)',
        sqlerrm;
    end;
  end if;
end
$$;

-- Prove the engine is coherent at the end of the migration that built it. If
-- either raises, the migration rolls back and nothing half-wired reaches the
-- database — which is the behaviour C4 asks for.
select pilot.assert_no_unmanaged_expiry_columns();
select pilot.assert_expiry_coverage();


-- ============================================================================
-- WHAT THE VERIFY SCRIPTS MUST ASSERT (house convention: executable scripts,
-- not checklists). The cross-module invariants this migration makes checkable
-- — C2, "two sources for one number is a defect":
--   1. select pilot.assert_expiry_coverage();                            (C4)
--   2. select pilot.assert_no_unmanaged_expiry_columns();                (C4)
--   3. Every table in pilot has account_id, has RLS enabled, has >= 1 policy,
--      and NO policy's qual/with_check mentions anything but
--      current_account_ids() (pg_policies) — "no admin bypass", asserted.
--   4. No column in pilot has type real/double precision/numeric/money.
--   5. Every FK between two tenant tables is COMPOSITE and includes account_id
--      (pg_constraint.conkey). A single-column FK to a tenant table is the
--      cross-tenant hole Phase 1 warns about; it should fail the build.
--   6. Per tenant-writable table: NOT has_table_privilege('authenticated', t,
--      'UPDATE') AND has_any_column_privilege(..., 'UPDATE'). The Phase 1
--      CRITICAL as an assertion: column-scoped write present, blanket absent.
--   7. NOT has_column_privilege('authenticated', t, 'id', 'INSERT') anywhere
--      (the cross-tenant existence-oracle rule).
--   8. For a seeded trip, recompute trip_net_cents independently in the script
--      and require equality with pilot.trip_financials. Two implementations
--      agreeing is the only way to know the view says what it claims.
--   9. Changing clients.default_day_rate_cents changes NO existing trip's
--      financials (the rate-snapshot rule).
--  10. pilot.trip_paperwork emits exactly the seven documented gate keys and
--      none of: airworthy, release, frat, weight_balance, duty, fit_duty,
--      go_no_go. The liability boundary asserted rather than remembered.
--  11. An expense with treatment='rebill' and trip_id=null is rejected by the
--      DATABASE, not by the app.
--  12. Renewing a document's expires_on leaves every prior
--      expiration_notices row unmatched by the unique key, so the ladder
--      re-fires from the top.
--  13. Extend scripts/tenancy-verify.mjs to every table here — including the
--      attack it predates: as tenant A, `update pilot.expenses set trip_id =
--      '<tenant B trip>'` must fail on the FK, not merely return zero rows.
--
-- PHASE 5 / 6 — already here so they need no retrofit:
--   * unique (id, account_id) on clients/trips/trip_legs/expenses/documents:
--     invoice_lines can carry composite FKs from its first migration.
--   * clients.payment_terms_days / default_tax_rate_bp / tax_label: invoice
--     due dates and per-line tax (C10) have their config-once source. Phase 5
--     SNAPSHOTS them onto the line, as trips snapshot the day rate.
--   * expenses.incurred_on plus (Phase 5) invoice issued_at/paid_at give C3
--     both bases from the same rows — no third table, no second ledger.
--   * trip_legs.night_takeoffs and the full-stop/touch-and-go split, without
--     which FAR 61.57(b) is uncomputable and which cannot be reconstructed.
--   * trip_paperwork already enumerates invoice_*/logbook_confirmed as null;
--     wiring them is one `create or replace view` in this one file.
--   * documents already handles doc_type='w9' and medical_class.
--   * Nothing here writes a logbook. The draft-confirm boundary (decision #14)
--     is untouched — do NOT "fix" trip completion into a logbook trigger.
-- ============================================================================
