-- ============================================================================
-- Account onboarding profile — the columns a pilot fills in AFTER their trial
-- is provisioned, in the post-checkout onboarding wizard (app/(onboarding)/).
--
-- WHY THESE LIVE ON pilot.accounts and not a side table: every one of them is
-- a 1:1 fact about the account (its identity, its billing defaults, the
-- owner's certificate) that the rest of the product reads to pre-fill work —
-- a new invoice's payment terms, a new trip's day rate, the business name on a
-- PDF. A separate table would buy nothing but a join on every one of those
-- reads. They are all NULLable: onboarding collects them, but a pilot may skip
-- any field and fill it in later from Settings, so nothing here is NOT NULL.
--
-- THE ONE FLAG THAT GATES THE WIZARD: onboarding_complete. It is false for a
-- freshly-provisioned account (the column default), which is what the (app)
-- layout reads to bounce a provisioned-but-not-onboarded pilot into the
-- wizard, and true once they finish (or skip) it. It is a tenant-owned UX
-- flag, NOT an entitlement — see the grant note below for why it is safe for
-- the owner to write and is deliberately NOT in the billing-protect trigger.
-- ============================================================================

alter table pilot.accounts
  -- The wizard gate. New accounts start false (provisioning leaves the
  -- default); the wizard's final step sets it true. Backfilled to true for
  -- every account that predates this migration (below) so no existing tenant
  -- is trapped behind a wizard that did not exist when they signed up.
  add column onboarding_complete boolean not null default false,

  -- Business identity (step 1). legal_name / kind / address already exist on
  -- this table from the Phase 1 tenancy migration; these are the fields the
  -- wizard adds. dba_name is the "doing business as" trade name a sole
  -- proprietor may invoice under when it differs from their legal name.
  add column dba_name text,
  add column phone text,
  -- The pilot's based airport, stored as the identifier they type (ICAO like
  -- KTEB, or a local/FAA ident) — a free string, not FK'd to an airport table
  -- (there isn't one, and a pilot's home base is a label, not a validated
  -- reference). Feeds trip/leg defaults where a home field is useful.
  add column home_base text,

  -- Pilot / airman profile (step 2). This is the certificate the owner holds.
  -- certificate_type is constrained to the pilot certificates issued under
  -- 14 CFR 61.5(a)(1) — Student, Sport, Recreational, Private, Commercial,
  -- Airline Transport Pilot. (Flight-instructor and ground-instructor
  -- certificates under 61.5(a)(2)/(3) are separate credentials, not a pilot
  -- certificate LEVEL, and belong in the credential wallet as documents, not
  -- here.) Verify the current list against eCFR 14 CFR 61.5 before changing
  -- it. NULL is allowed for a pilot who would rather not record it.
  add column certificate_type text
    check (
      certificate_type is null
      or certificate_type in (
        'student', 'sport', 'recreational', 'private', 'commercial', 'atp'
      )
    ),
  add column certificate_number text,
  -- Ratings and type ratings as the airman writes them (e.g.
  -- "AMEL, Instrument Airplane, CE-525S") — a free label, not an enumerated
  -- set: category/class/type combinations are many and the value is displayed,
  -- never computed on. Currency (Phase 7) reads logbook entries, never this.
  add column ratings text,

  -- Rates & billing defaults (step 3). Cents integers, same money convention
  -- as every other amount in the schema (lib/format.ts renders them). These
  -- seed a new trip's day/travel rate and a new invoice's terms so a pilot
  -- who bills one client at one rate never retypes it; a per-client override
  -- (pilot.client_rates, Phase 9) still wins where it exists.
  add column default_day_rate_cents integer
    check (default_day_rate_cents is null or default_day_rate_cents >= 0),
  add column default_travel_day_rate_cents integer
    check (
      default_travel_day_rate_cents is null
      or default_travel_day_rate_cents >= 0
    ),
  add column default_per_diem_cents integer
    check (default_per_diem_cents is null or default_per_diem_cents >= 0),
  -- Net terms in days (Net 30 → 30). Calendar-day due semantics are computed
  -- at invoice time from this; stored as a plain day count.
  add column default_payment_terms_days integer
    check (
      default_payment_terms_days is null
      or default_payment_terms_days >= 0
    );

-- Every account that existed before onboarding did is already "onboarded" by
-- definition — it has been running without a wizard. Mark them complete so the
-- (app) layout never bounces an established tenant into a first-run flow. New
-- accounts created after this point keep the `false` default and go through it.
update pilot.accounts set onboarding_complete = true;

-- COLUMN-SCOPED UPDATE GRANT — the rule stated in the Phase 1 tenancy
-- migration: never `grant update on pilot.accounts`, always enumerate exactly
-- the columns a tenant may change themselves. These are all owner-writable
-- (the wizard and Settings run as the authenticated owner, RLS-scoped, NOT
-- service_role). Postgres column grants are additive, so this extends — does
-- not replace — the Phase 1 grant of (legal_name, address_*, city, state,
-- postal_code, country, logo_url, invoice_prefix).
--
-- onboarding_complete is INCLUDED here on purpose: finishing the wizard is a
-- tenant action, and the flag governs nothing but which screen the pilot sees
-- next. It is therefore deliberately NOT added to
-- pilot.protect_account_billing_columns() — it is not a billing or entitlement
-- column, and a pilot flipping it does nothing but re-enter or leave their own
-- first-run flow. plan / status / seat_count / stripe_* / connect_account_id /
-- kind remain service_role-only, unchanged.
grant update (
  onboarding_complete,
  dba_name, phone, home_base,
  certificate_type, certificate_number, ratings,
  default_day_rate_cents, default_travel_day_rate_cents,
  default_per_diem_cents, default_payment_terms_days
) on pilot.accounts to authenticated;
