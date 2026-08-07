# v1 — Contract Pilot Portal — Build Plan

**Product name: “v1”. Full lockup: “v1 — powered by AMG Aviation”.**
This is the shipping name, not a placeholder and not a version number. Nothing in the codebase,
copy, or repo should treat it as provisional.

## Context

AMG's full coordination business is capital-gated: it waits on bound aviation insurance,
Florida aviation counsel review, and a staffed pilot bench. This product exists to get in
front of that. It is a standalone SaaS for **independent contract pilots** to run their own
business — their clients, their invoices, their expenses, their logbook and currency. It is
the initial launch product: low capital to start, generates cash and an audience of working
pilots, and proves demand while the capital-intensive model waits.

**Product thesis:** a contract pilot's single trip generates three records — a logbook entry,
a billable line, and expenses. Every existing tool makes them enter it three times.
**Log the trip once → logbook entry, invoice line, and expense file all post from it.**
Every decision below is tested against whether it preserves that.

**Tony is a software vendor here, nothing more.** AMG does not participate in, broker, or take
a position in the pilot's relationship with the pilot's clients. Nothing in this product may
surface a pilot's clients, rates, or revenue into AMG's CRM, outreach, or crew sourcing. That
has to hold technically, not by policy.

**CORRECTION (post-security-review, still accurate to the intent above, more precise about the
mechanism):** "holds technically" is true of the application layer — no RLS policy and no
application code path grants tenant A anything about tenant B, and that was adversarially
tested (see `supabase/migrations/20260802120000_pilot_schema_tenancy.sql`'s header). It is a
narrower claim than "AMG cannot see your client list" as a flat statement, because the
service-role key (the Phase 2 webhook's own credential), the Postgres role that owns these
tables, and anyone with Supabase dashboard access can all read every tenant's data — Postgres
RLS does not apply to any of them, by design, in any Supabase project. That part of the promise
is operational (who gets the service-role key and dashboard access, and how tightly that's
held), not something a migration can enforce. Do not let marketing or sales copy collapse this
into "we cannot technically see your data" — say "no application code path" and be accurate
about what's a database-engineering guarantee versus an operational commitment.

### What this is not
- Not an AMG operational system. The pilot's clients are not AMG clients.
- Not the crew-facing surface of AMG Connect, which exists so a crew member can transact
  **with AMG**.
- Not a marketplace, job board, or crew-sourcing product. That model was evaluated and
  rejected — do not reintroduce it through a side door.
- Nothing here changes AMG's Part 91 coordination boundary.

---

## Decisions locked (Tony, this session)

| # | Decision | Answer |
|---|---|---|
| 1 | Data custody | **New Supabase "master" project**, separate from AMG's `vsynqnqlouvphiniqaiy`. Hosts multiple future SaaS products, one Postgres schema per product, no cross-product links. |
| 2 | Isolation | **One schema per product** (`pilot`). All tenants live in that one schema, isolated by RLS on a tenant key. A new customer is a row insert — never a schema build. |
| 3 | Codebase | **New repo, new Vercel project.** Not a route inside AMG's existing app. |
| 4 | Branding | Own product identity. **"Powered by AMG Aviation"** is the only AMG reference. Not AMG-branded chrome. |
| 5 | Name | **LOCKED — "v1".** Lockup: **v1 — powered by AMG Aviation**. Final, not a codename. Set lowercase `v` + `1` per the wordmark rule below. All brand strings still live in `lib/brand.ts`. |
| 6 | Signup | **Free trial, card required.** Stripe trial; the webhook is the only thing that provisions a tenant. |
| 7 | Provisioning | **Fully self-serve.** Access the moment they subscribe. No manual step by AMG, ever. |
| 8 | Pilot payments | **Stripe Connect (Standard).** Pilot is merchant of record. We never see their keys, never touch their funds, take no application fee. |
| 9 | Account model | Tenant is an **account**, which may be a solo pilot or a business. |
| 10 | Pricing | **Solo flat rate; business per-seat.** |
| 11 | v1 scope | **All seven sections** — Overview, Trips, Invoices, Expenses, Logbook, Clients, Documents. |
| 12 | Logbook input | **Manual entry + trip-derived + CSV import.** |
| 13 | Import formats | **ForeFlight, LogTen Pro, and a generic column mapper.** |
| 14 | Trip → logbook | **A draft the pilot confirms.** Never a silent trigger write. |
| 15 | Currency | **Build behind a feature flag, ship dark.** Enable only after Tony reviews the written spec. |
| 16 | Invoice delivery | **Both** — send from the platform, or download and send manually. Pilot chooses. |
| 17 | Design system | **Radix Themes** (`@radix-ui/themes`). Chosen 2026-08-06 after three attempts at a hand-authored system each drifted from its own spec. There is no token file and no design document: the entire visual system is the six `<Theme>` props in `app/layout.tsx` plus the small component-defaults layer in `components/ui/index.tsx` (Card's variant, TextField/Select's size, etc.). Restyling the product is changing those. |
| 18 | Brand placement | AMG appears **only** as the words "Powered by AMG Aviation" in the footer and about page. Nowhere else. |
| 19 | Palette and wordmark | Radix's `blue` accent with `grayColor="auto"`, which resolves to the `slate` grey scale for a blue accent — the nearest scale to the logo's Signal Blue `#036BFC`. `"auto"` rather than a hardcoded `"slate"` couples the grey to the accent, so a future accent change moves the grey with it instead of leaving it frozen. The mark itself is **not** wired to the accent — the wordmark is literal black and the bug literal `#036BFC` on every ground, brand-identity constants rather than UI tokens, so a future accent change can never retint trademark artwork. |
| 20 | Design longevity | The problem this decision existed to solve is now solved by construction rather than by discipline. A component cannot drift from the token layer when there is no token layer to drift from. `npm run tokens:verify` remains, with a narrower job: stop components reaching *around* the theme with a literal the theme can never reach. |

### Standing gates (unchanged)
- Aviation counsel reviews the currency disclaimer wording before the flag is enabled.
- Counsel review before the product takes revenue. Contractor classification is directly on
  point; a tool helping pilots run independent businesses arguably *supports* that
  characterization, but that is counsel's call, not ours.
- **No live pilot data as fixtures or test data at any point** — no real credentials,
  applications, resumes, medical data, client records, or mission details.

---

## Verified ground truth

Checked directly against AMG's existing schema and its live Supabase project on 2026-08-02.
These correct the planning brief:

- **The logbook is schema-only.** All six `logbook_*` tables exist with **0 rows**. No app code
  (`find app components lib -ipath "*logbook*"` → nothing), no Postgres functions matching
  `%logbook%` or `%currency%`. Treat the schema as a spec someone wrote, not tested code.
- **RLS today is admin-only.** `logbook_entries`, `logbook_currency_snapshots`,
  `logbook_source_files`, and `vendor_invoices` each carry exactly **one** policy — an
  `is_approved_admin()` SELECT. The owning pilot has **no** read policy on their own logbook.
  The app therefore leans on service-role access. Do not carry this pattern over.
- **`logbook_entries.import_batch_id` and `source_file_id` are `NOT NULL`.** A manual or
  trip-derived entry has neither. Must be fixed in the new schema.
- **Night currency cannot be computed from the existing schema.** It records `night_landings`
  but has no full-stop flag and no night takeoff count. FAR 61.57(b) requires night takeoffs
  and landings **to a full stop**. Fix in the new schema.
- **No existing table represents a customer of a pilot.** That is the central gap.
- `03-AMG-CONNECT-PRODUCT-CONTEXT.md`, cited by the brief, **does not exist in the repo.**
- Existing string vocabularies worth reusing verbatim where they fit:
  - `expenses.category` → `airline, hotel, rental_car, rideshare, fuel, meals, parking, other`
  - `logbook_currency_snapshots.currency_type` → `passenger_day, passenger_night, instrument,
    flight_review, medical`
  - `logbook_currency_snapshots.status` → `estimated_current, estimated_not_current,
    insufficient_data` (deliberately hedged — keep it)
  - `logbook_audit_findings.severity` → `hard_error, review_warning`

## Architecture

### Tenancy
Single schema `pilot`. Every table carries `account_id uuid not null references pilot.accounts(id)`.
RLS on **every table from the first migration** — never retrofitted.

Use one helper, and use it everywhere:

```sql
create or replace function pilot.current_account_ids()
returns setof uuid language sql stable security definer set search_path = pilot, public as $$
  select account_id from pilot.account_members where user_id = auth.uid();
$$;
```

Every policy is then `account_id in (select pilot.current_account_ids())`, with writes further
restricted by member role where it matters. **There is no admin-bypass RLS policy and no
AMG-facing read path in application code.** That absence is the product's trust story — do not
add one. See the correction above §0: this does not mean no one can technically read tenant
data (the service-role key and Supabase dashboard access both can, as they can in any Supabase
project) — it means no *policy* and no *application code path* does. Support tooling, if ever
needed, gets its own explicit, audited, per-request mechanism — never a broadened RLS policy.

### Two separate Stripe integrations — do not entangle them
1. **Platform billing** (we bill the pilot). Subscription with a trial, card required at signup.
   Solo = flat price; business = per-seat quantity synced on seat change.
2. **Stripe Connect Standard** (pilot bills their client). OAuth connect from settings. Pilot is
   merchant of record. Store only `connect_account_id`. **No application fee, no funds routed
   through us, no keys stored.**

Non-negotiables on both: signature verification, event-ID recording for idempotency, retry and
out-of-order safety, test/live mode separation, Price IDs from env config, reconciliation,
no duplicate receipts.

---

## Data model — the Trip is the parent record

```
trip  (the job the pilot flew)
 ├── trip_legs          1:many          (drives logbook derivation)
 ├── logbook_entry(s)   via draft       (pilot confirms; never auto-written)
 ├── invoice_line(s)    via invoice     (day rate + rebilled expenses)
 └── expense(s)         1:many          (rebilled or deducted)
```

Core tables in `pilot`:

- **accounts** — `kind ('solo'|'business')`, legal name, address, logo, plan, seat count,
  `stripe_customer_id`, `stripe_subscription_id`, `trial_ends_at`, `status`,
  `connect_account_id`, invoice numbering prefix.
- **account_members** — `account_id`, `user_id`, `role ('owner'|'member'|'bookkeeper')`.
  Solo accounts have exactly one. Seat count syncs to Stripe quantity.
- **clients** — the pilot's own customers. Contacts, billing address, default day rate,
  payment terms, **W-9 status and sent date** (surfaced in the mockup's attention queue).
- **trips** — `client_id`, status, date range, aircraft ident/type, day rate, day count,
  `trip_kind` (reuse: `owner_trip, ferry, maintenance_flight, repositioning, contract_pilot,
  delivery_flight, other`), billing state.
- **trip_legs** — date, from/to ICAO, out/in times, night/instrument time, landings.
- **expenses** — `trip_id` **nullable**, category (reuse the eight above), amount, receipt file,
  and `treatment ('rebill'|'deduct'|'unassigned')`. The **unassigned queue is a first-class
  surface** — those receipts are neither billed nor deducted, and that is the point.
- **invoices** / **invoice_lines** — lines reference `trip_id` or `expense_id`. Sequential
  per-account numbering via a sequence table (mirror `billing_document_sequences`).
- **logbook_entries** — see below.
- **logbook_source_files / logbook_import_batches** — import lineage, **nullable** on entries.
- **currency_snapshots** — reuse `currency_type` and `status` vocabularies verbatim. Keep
  `limitations` NOT NULL: it forces the disclaimer to travel with the data.
- **documents** — scoped to account, client, or trip. Expiry tracking feeds the currency board
  (medical, flight review, passport, certificates, W-9).

### `logbook_entries` — required changes from the AMG schema
- Add `source text not null check (source in ('trip','import','manual'))`.
- Make `import_batch_id`, `source_file_id`, `source_row_number`, `row_fingerprint`, `source_row`
  **nullable**; require them only when `source = 'import'` (enforce with a CHECK).
- Add `trip_id uuid null references pilot.trips(id)`.
- **Add `night_takeoffs integer` and split night landings into full-stop vs touch-and-go.**
  Without this, FAR 61.57(b) cannot be computed. Same for day landings where tailwheel
  full-stop rules apply.
- Add `flight_instructor_time`, `simulator_time` / FTD / ATD, and approach detail
  (count is required by 61.57(c); record type where the source provides it).
- Keep `row_fingerprint` dedup for imports only. Trip-derived and manual entries do **not**
  participate in fingerprinting.

### Trip → logbook is a confirmed draft
Completing a trip proposes entries from its legs. The pilot reviews and accepts. Nothing reaches
the logbook without an explicit confirmation. **This is a deliberate departure from the house
"derived state is a trigger" convention** — a logbook is a personal legal record and must be
defensible if produced in an enforcement action or insurance dispute. Do not "fix" it into a trigger.

### Currency
Recompute on entry write and on relevant document-expiry change; snapshot the result.
`pg_cron` is available for a nightly reconcile. **Entire feature ships behind a flag, default off.**

---

## Build order

Each phase must be independently demonstrable.

**There is no design phase.** Radix Themes supplies the component set and the visual system; screens are built by composing it. What used to be a design pass is now a `<Theme>` prop.

**Phase 0 — Foundations.**
Create the new Supabase project and the new repo/Vercel project. Establish the `pilot` schema
and migration naming. Write `lib/brand.ts` first so brand strings never leak into components. Mount `<Theme>` in `app/layout.tsx`; self-host the type via `next/font`.
Port nothing else yet.

**Phase 1 — Tenancy and identity.** Accounts, members, RLS on empty tables.
**Gate: a two-tenant isolation test must pass before anything else is built on top.**

**Phase 2 — Platform billing and self-serve provisioning.** Stripe subscription with
card-required trial; webhook is the only tenant-creation path; seat quantity sync. Moved early
because "access the moment they subscribe" is a hard requirement, not a finishing touch.

**Phase 3 — Clients and Trips.** The pilot's own client records, rate agreements, trip and legs.
No billing yet. This is where the parent-record model gets proven.

**Phase 4 — Expenses.** Receipt capture, trip assignment, rebill-vs-deduct, unassigned queue.

**Phase 5 — Invoices.** Draft from trip, line items, PDF via `@react-pdf/renderer`, sequential
numbering, Stripe Connect payment link, and both delivery paths (platform send + manual download).

**Phase 6 — Logbook.** Manual entry, trip-derived drafts, then CSV import (ForeFlight, LogTen,
generic mapper) with dedup and an error-review surface. Import is the largest single piece here —
budget it accordingly.

**Phase 7 — Currency (dark).** Engine behind a flag, plus **a written spec document** covering
FAR 61.57 day and night passenger currency, instrument currency and the 6-month look-back,
flight review, and medical class and duration. **Tony reviews the spec; counsel reviews the
disclaimer; only then is the flag enabled.**

**Phase 8 — Documents and year-end export.** Credential and document expiries feeding the
currency board; accountant packet.

---

## Verification

Follow the house pattern — executable scripts, not a checklist:

- `npm run tenancy:verify` — **two-tenant isolation.** Seed two accounts with synthetic data,
  authenticate as each, assert every table returns only that tenant's rows, and assert no
  service-role path is reachable from app code. This is the gate on Phase 1.
- `npm run billing:verify` — trial creation, webhook idempotency (replay the same event ID),
  out-of-order events, seat quantity sync, test/live mode separation.
- `npm run connect:verify` — Connect onboarding, and assert no Stripe secret key is ever
  persisted for a tenant.
- `npm run trip:verify` — a trip produces an invoice line, an expense association, and a logbook
  **draft**; assert nothing lands in `logbook_entries` without explicit confirmation.
- `npm run logbook:verify` — round-trip a ForeFlight, a LogTen, and a generic CSV; assert dedup
  by fingerprint, assert rejected rows surface, assert trip/manual entries bypass fingerprinting.
- `npm run currency:verify` — table-driven fixtures per currency type, including the
  full-stop night landing rule, the 6-month instrument look-back, and `insufficient_data`.
- `npm run tokens:verify` — **keeps components from reaching around Radix Themes.** Scans `app/`, `components/` and `lib/` and fails on a hardcoded colour, a camelCase style property carrying a literal, an `@mui`/`@emotion` import, a raw `@radix-ui/themes` import outside `components/ui/index.tsx`, or a literal brand string outside `lib/brand.ts`. Four files may spell a value out and each documents why; the import-ban rules apply to all four regardless. Runs in CI.
- Manual: run the app, sign up with a Stripe test card, confirm the account is usable
  immediately with no manual step.

All fixtures synthetic. No live pilot data, ever.

---

## Risks

- **Assumed reuse.** The strongest failure mode is treating AMG's crew tables as a starting
  point. They encode AMG as the counterparty. Port *patterns*; never inherit the schema.
- **Logbook underestimation.** Zero rows, zero code, zero functions today, and three import
  formats. This is the biggest piece of work in the build.
- **Currency liability.** A tool telling a pilot they are legal to fly is a real exposure surface.
  Framing stays "planning aid, you remain responsible" — never a compliance determination.
- **Silent logbook writes.** Guard the draft-confirm boundary in review.
- **Product-boundary drift.** No path may surface pilot clients, rates, or revenue to AMG.
- **Enum drift.** Port the exact string vocabularies listed above, or define new ones
  deliberately. Do not half-copy.
- **Identity model drift.** AMG's existing app already carries `users` vs `profiles` duplication. This
  product gets exactly one identity model: `auth.users` → `pilot.account_members` → `pilot.accounts`.

---

## Open items

Nothing blocks the build. The name is locked and the design system is Radix Themes, so there
is no design work sitting in front of any screen.

**Non-blocking:**
- Price points and trial length — env/config, not code.
- Domain. "v1" is short and generic, so the exact-match domain is unlikely to be available;
  expect a compound (`v1pilot`, `flyv1`, `v1.aero`). A naming decision, not a build blocker.
- A future design overhaul. Cheap by construction now rather than by discipline: it is a change
  to the six `<Theme>` props in `app/layout.tsx` (plus `components/ui/index.tsx`'s component
  defaults). If it ever needs to go further than those props allow, that is the moment to drop
  to Radix Primitives for the screens that need it —
  Themes is built on them, so it is a supported path rather than a rewrite.
- AMG's own portal restyle is **out of scope entirely.** The two products no longer share a
  design system, so there is nothing to converge.

---


---

# Phase 9 — Make it theirs (tenant customisation)

Tony's direction: a pilot should be able to customise their platform "however they want, user
friendly." The trap is reading that as a page builder. It isn't. A contract pilot is a
one-person business who wants the software to match **their contracts and their vocabulary** —
not to spend an evening arranging widgets.

`references/contract-pilot-business.md` §4 is where the real variability sits: travel days
"commonly paid at half to full day rate (varies — contract term to capture, not assume)",
minimums and guarantees, standby days "sometimes at reduced rate", per diem "common instead of
meal receipts", cancellation fees "50–100% inside 24–48 h". Every one is negotiated, every
pilot's differ, and **none could be expressed in the product before this phase.**

## The governing principle

> **Taxonomy is the tenant's. State machines are ours.**

A pilot may invent, rename, reorder and retire the *categories* they file things under. They
may not redefine the *states* that money and compliance logic branch on. This is not a hedge —
`invoices_protect_issued`, `invoice_lines_validate_trip` and `invoices_sync_trip_billing_state`
all branch on `invoices.status` / `trips.billing_state` / `invoice_lines.line_type`, and Phase
7's currency engine will branch on logbook values. Tenant-defined strings inside those would
make billing and compliance unverifiable.

| Vocabulary | Tenant-owned? | Why |
|---|---|---|
| `expenses.category`, `trips.trip_kind`, `documents.kind` | **Yes — full control** | Pure filing taxonomy. Nothing computes on them. |
| Day types (new) | **Yes — full control** | This is the contract, and the contract is theirs. |
| `expenses.treatment`, `invoices.status`, `trips.billing_state`, `invoice_lines.line_type` | **Label only** | Triggers and generated columns branch on these. |
| `logbook_entries.source`, `role`, landing/approach fields | **No** | Legal record + Phase 7 inputs. FAR-defined. |

## Layer 1 — Day types and rate cards  *(built: `20260807000000_phase9_day_types_and_trip_days.sql`)*

**The gap it closed.** `pilot.trips` carried exactly two scalar pairs — `day_rate_cents`/
`day_count` and `travel_day_rate_cents`/`travel_day_count`. No standby day, no per-diem count,
no minimum, no cancellation term. `pilot.invoice_lines.line_type` therefore already declared
`per_diem` and `cancellation_fee` values **nothing in the product could produce.**

- **`pilot.day_types`** — per account, seeded at account creation with flight / travel /
  standby / off (`accounts_seed_day_types`, mirroring `accounts_seed_invoice_sequence`).
  `key`, `label`, `billable`, `counts_for_per_diem`, `default_rate_cents`, `sort_order`,
  `archived_at`, `is_builtin`, and **`invoice_line_type`** — the boundary above, made a column:
  the tenant names the day type and chooses which of Phase 5's fixed line types it bills as.
  Seeded rates are NULL, never 0 — a seeded rate is a number the product invented turning up
  on a real invoice.
- **`pilot.trip_days`** — one row per calendar day. `rate_cents` is **snapshotted at capture**
  (`references/product-translation.md` §2: "snapshot the terms at confirmation — rates
  renegotiate; invoices must reflect the agreed ones"). Resolution order runs once, in the app,
  at capture: client override → day type default. Never re-resolved at render.
- **`pilot.client_rates`** — per client × day type override.
- **`pilot.clients`** gains `per_diem_mode`, `minimum_days`, `cancellation_policy_note`.
  Cancellation stays a **note**, not a computed rule: the percentages are convention, not law,
  and computing an unenforceable fee is worse than recording the agreement.

**Deliberate departure from the plan as written: there is no backfill.** The plan said to
backfill `trip_days` from `day_count` / `travel_day_count`. It must not, and the reason is
arithmetic: `day_count` is `numeric(5,1)` so a 2.5-day trip cannot become whole calendar rows
without changing what it bills; the counts have no fixed relationship to the number of dates in
the range; and nothing ever recorded *which* dates were flight versus travel. Any backfill
would be inventing data, and would fail this phase's own gate — "not one issued invoice changed
value" — silently, since totals only move the next time a draft is generated.

Instead: a trip with no day rows bills exactly as it does today, through the scalar path
`createInvoiceDraft` keeps. The trip screen's day grid seeds its **unsaved** state from the
scalar counts, the pilot corrects it, and saving is what writes `trip_days`. Same
draft-confirm boundary the logbook uses, for the same reason — a machine may propose a record
with financial weight; a human confirms it.

Two triggers keep day rows and trip dates honest in both directions
(`trip_days_validate_within_trip`, `trips_protect_day_range`), and `trip_days_protect_billed`
freezes a trip's days once it is invoiced or paid — mirroring `invoices_protect_issued`.

## Layers 2–4 (not yet built)

- **Their words.** `pilot.custom_options` (`expense_category` | `trip_kind` | `document_kind`),
  seeded with today's built-ins so a pilot starts from the aviation-correct set. Those three
  columns move from a hardcoded `CHECK` to a composite FK. Archive, never delete.
- **Their look.** `pilot.account_preferences` — `account_id` PK plus a `jsonb` blob.
  Radix Themes already does most of this: `appearance`, `accentColor`, `grayColor`, `radius`
  and `scaling` are props, so a per-tenant look is a stored set of prop values rather than a
  theming engine to build. The work is persisting them per account and reading them in
  `app/layout.tsx` — not localStorage, so a pilot's setup follows them from their phone in the
  FBO to their laptop at home.
  Accent must stay a choice from Radix's own scales rather than a free hex field. That is not
  a restriction we are imposing for tidiness: Radix's scales are built so step 9 fills, step 11
  reads as text and step 12 is high-contrast ink, and an arbitrary hex has no such guarantees —
  it eventually fails contrast against badge text, and a pilot cannot be expected to debug that.
- **Their layout.** Nav order, hidden sections, Overview panel order. Hiding a section hides the
  **nav entry only** — the route still resolves, so a bookmark or a deep link from an invoice
  never 404s. `/settings` can never be hidden, or a pilot locks themselves out of the screen
  that unhides things.

## Verification

- `npm run customisation:verify` — two tenants; seeded zero state; cross-tenant composite-FK
  attach; `is_builtin` and `key` unwritable; archive preserves historical rendering; day rows
  bounded by trip dates at both ends; the freeze on an invoiced trip. Negative cases assert the
  **specific SQLSTATE**, never merely "an error happened".
- **The money regression, the one this layer is gated on:** issue an invoice, snapshot its
  total, then force day rows onto the trip behind it and move every rate the resolution path
  would consult — assert the total does not change by one cent.

## Known limitations of Layer 1 — recorded, not hidden

Found by the security and QA reviews and deliberately left open. Each is a real gap; none is a
defect pretending to be a feature.

- **`billing_state = 'written_off'` has no writer.** The corrective migration revoked
  `billing_state` from every tenant grant, and `invoices_sync_trip_billing_state` only ever
  writes `unbilled` / `invoiced` / `paid`. Written-off is now an unreachable state that the
  trips list still renders a badge for. Fixing it means either a `SECURITY DEFINER` RPC with an
  in-body tenancy check (the `next_invoice_number` shape) or removing the state. It needs a
  write-off *feature*, not a grant, so it waits for one rather than getting an RPC nothing calls.
- **Per diem is a property of the day *type*, not of the day.** Standby at home base earns no
  per diem; standby on the road does. `day_types.counts_for_per_diem` cannot express that, so a
  pilot has to keep two day types to get it right, and nothing tells them so. The fix is an
  `away` flag on `trip_days`, or derivation from a home base the product does not yet record.
- **No first/last-day per-diem proration.** The draft bills full per diem × N days. The
  convention a pilot's client will name — GSA/IRS M&IE — pays 75% on the first and last day of
  travel. Convention, not law, but it is *the* convention, so billing 100% on both ends
  over-bills two days on every trip. Belongs as a client-level option.
- **A day type's `billable`, `invoice_line_type` and label are re-resolved at draft time.** Only
  `rate_cents` is snapshotted onto `trip_days`. Toggling "Billable" in settings therefore
  changes what already-captured, not-yet-invoiced days will bill — the same class of
  retroactive re-pricing the rate snapshot exists to prevent, at lower stakes because committed
  trips are frozen. Mitigated for now by warning at the point of the toggle; the real fix is to
  snapshot those three alongside the rate.
- **`trip_days.rate_cents` is `NOT NULL DEFAULT 0`,** so "no rate agreed" and "$0 agreed" are
  the same value — the exact distinction `day_types.default_rate_cents` stays nullable to
  preserve. A genuinely comped billable day cannot be recorded without a warning on every draft.
- **A trip's date span is unbounded.** `check (ends_on >= starts_on)` is the only constraint, so
  a year typo renders ~370 grid rows. Worth a cap; 60 days is generous for one assignment.
- **`saveTripDays` is not transactional.** Delete, then insert, then per-date updates, across
  separate PostgREST calls. A failure part-way leaves the grid half-applied. Every row is
  reconstructible from the form the pilot is still looking at, so the failure mode is "save
  again", but a single RPC would remove the window.

## Deliberately not offered

Free-text hex colours (contrast), arbitrary CSS/JS injection (XSS into their own invoices),
renaming the *state* vocabularies, custom fields on the logbook (legal record; Phase 7 inputs),
and a drag-and-drop page builder — which is not what a working pilot wants from software they
use between legs.

## What the reviews caught, and the two lessons worth carrying forward

Layer 1 shipped a critical regression and a critical omission, both found by testing against
live Postgres rather than by reading:

1. **A guard whose negative case depends on a value being present passes when the value is
   absent.** `NULL in ('invoiced','paid')` is `NULL`, not `true`, so deleting a trip walked
   straight through the freeze on its day rows. Every `x in (...)` written as a barrier needs an
   explicit answer for `x is null` — chosen, not inherited from SQL's default.
2. **A trigger has no privilege of its own.** Revoking `pilot.trips.billing_state` from
   `authenticated` broke `invoices_sync_trip_billing_state`, which is `SECURITY INVOKER` and
   writes that column as whoever called it — so sending any invoice drafted from a trip failed
   with `42501`, and both freeze guards became correct code watching a value that could never
   change. Withdrawing a grant means auditing every trigger body that writes the column, not
   only the app code that doesn't.

A third, smaller one worth the same treatment: **a PostgREST `.upsert()` compiles to
`ON CONFLICT DO UPDATE SET <every payload column>`,** and Postgres checks UPDATE privilege on
every column in that SET list whether or not the value changes. On a table with column-scoped
grants — which is every table in this schema — an upsert therefore fails on the conflict path,
i.e. on every save after the first. Diff and issue targeted writes instead.
