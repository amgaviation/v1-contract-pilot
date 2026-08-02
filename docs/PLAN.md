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

### What this is not
- Not an AMG operational system. The pilot's clients are not AMG clients.
- Not the crew-facing surface of AMG Connect (`app/portal/crew/*` in `amgaviation/amg1`),
  which exists so a crew member can transact **with AMG**.
- Not a marketplace, job board, or crew-sourcing product. That model was evaluated and
  rejected — do not reintroduce it through a side door.
- Nothing here changes AMG's Part 91 coordination boundary.

---

## Decisions locked (Tony, this session)

| # | Decision | Answer |
|---|---|---|
| 1 | Data custody | **New Supabase "master" project**, separate from AMG's `vsynqnqlouvphiniqaiy`. Hosts multiple future SaaS products, one Postgres schema per product, no cross-product links. |
| 2 | Isolation | **One schema per product** (`pilot`). All tenants live in that one schema, isolated by RLS on a tenant key. A new customer is a row insert — never a schema build. |
| 3 | Codebase | **New repo, new Vercel project.** Not a route inside `amg1`. |
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
| 17 | Design system | **Entirely new, from scratch.** No AMG colors, type, or tokens. The v2 mockup is a content inventory only — layout, hierarchy, and interaction patterns are designed fresh. |
| 18 | Brand placement | AMG appears **only** as the words "Powered by AMG Aviation" in the footer and about page. Nowhere else. |
| 19 | Palette and wordmark | **LOCKED — "Approach Plate".** Instrument-chart aesthetic: chart ink `#0E1215`, plate teal `#0E5F68`, zero radius, fixed dark left rail, 28px rows, borders not shadows. Roboto Condensed / Roboto / Roboto Mono. Full token set in Design system below. |
| 20 | Design longevity | Tony **intends to overhaul the design later.** Therefore every visual value lives in `lib/brand.ts` + `app/tokens.css` only. A hex code, radius, or font in any component is a defect. |

### Standing gates (unchanged)
- Aviation counsel reviews the currency disclaimer wording before the flag is enabled.
- Counsel review before the product takes revenue. Contractor classification is directly on
  point; a tool helping pilots run independent businesses arguably *supports* that
  characterization, but that is counsel's call, not ours.
- **No live pilot data as fixtures or test data at any point** — no real credentials,
  applications, resumes, medical data, client records, or mission details.

---

## Verified ground truth

Checked directly against `amgaviation/amg1` @ `63823c2` and live Supabase `vsynqnqlouvphiniqaiy`
on 2026-08-02. These correct the planning brief:

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

### Stack to mirror (from `amg1/package.json`)
Next.js `^16.2.11` · React `^19.2.4` · **Tailwind v4 CSS-first** (no `tailwind.config`, uses
`@tailwindcss/postcss`) · `@supabase/ssr ^0.12.0` + `@supabase/supabase-js ^2.108.1` ·
Radix UI + shadcn-style (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`,
`sonner`) · `@react-pdf/renderer ^4.5.1` (invoice PDFs) · `stripe ^22.3.0` · SheetJS `xlsx`
(logbook import) · TypeScript `^5.7.2`.

**No test framework exists.** The house convention is executable verify scripts:
`scripts/verify-*.mjs|ts` wired to `npm run <thing>:verify`. Follow it.
Migrations: `supabase/migrations/YYYYMMDDHHMMSS_name.sql` (78 exist). Never DDL against production.
Supabase clients: `lib/supabase/{client,server,middleware}.ts` + generated `database.types.ts`.

---

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
restricted by member role where it matters. **There is no admin bypass policy and no AMG-facing
read path into tenant data.** That absence is the product's trust story — do not add one.
Support tooling, if ever needed, gets its own explicit, audited, per-request mechanism.

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

## Design system — built from scratch

**This product gets an entirely new design system and brand identity.** No AMG values appear
anywhere in the visual language. AMG appears in exactly one place: the words
**"Powered by AMG Aviation"** in the footer and about page.

Specifically forbidden as design inputs:
- AMG's Manifest/Horizon system (`.amg-portal` in `amg1/app/globals.css` — Barlow Condensed,
  999px pills, `--radius: 0.75rem`). Do not port it, do not reference it.
- AMG Navy `#050B14` and AMG Blue `#1D4ED8`. These are AMG's brand colors and appear in the
  v2 mockup — **they do not carry over.**
- The `--deck-*` token namespace. This product defines its own.

### The mockup is a content inventory, not a design reference
`pilotportalmockupv2.pdf` is authoritative for **what exists and what data it holds**, and for
nothing else. Layout, hierarchy, typography, color, density, and interaction patterns are all
designed fresh.

What it establishes:

Nav — **Overview · Trips · Invoices · Expenses · Logbook · Clients · Documents**

Overview holds: four KPI figures (Unbilled Work, Awaiting Payment, Paid This Year,
Deductible Expenses); a **Currency & Expirations** board with six rows (day passenger, night
passenger, instrument, medical, flight review, passport); a **Ready to Invoice** list carrying
route, tail number, day count, dates, and a rate-plus-expenses split; and a **Needs Attention**
queue covering past-due invoices, unassigned receipts, and outstanding W-9s.

### LOCKED DIRECTION — "Approach Plate"

Chosen by Tony. Built from the instrument approach chart: hard rules, boxed panels, zero radius,
a fixed dark left rail, and high information density. Nothing decorative — every rule separates
something.

**Tony intends to overhaul this later.** That makes centralisation a hard requirement, not a nicety:
every value below lives in exactly two files — `lib/brand.ts` (brand strings, wordmark) and
`app/tokens.css` (the custom properties). **No component may hardcode a colour, radius, font, or
spacing value.** A future overhaul must be a change to those two files and nothing else. Treat any
hex code appearing in a component as a defect.

```css
/* app/tokens.css — the entire visual system */
:root{
  --v1-ink:      #0E1215;  /* chart ink: text, rail, 2px section rules */
  --v1-paper:    #FFFFFF;  /* panel surface */
  --v1-bg:       #EDEFF0;  /* app ground */
  --v1-field:    #F5F7F7;  /* table headers, inset blocks, disclaimer ground */
  --v1-line:     #B9C0C4;  /* panel border, 1px */
  --v1-hair:     #DFE3E5;  /* row divider, 1px */
  --v1-mute:     #5A646B;  /* secondary text */
  --v1-accent:   #0E5F68;  /* plate teal: primary action, active nav */
  --v1-ok:       #1C6F45;  /* current */
  --v1-bad:      #A32B18;  /* not current, past due */
  --v1-warn:     #8A5A00;  /* needs attention, expiring, draft */
  --v1-radius:   0;        /* everywhere, no exceptions */
  --v1-row:      28px;     /* table row height */
  --v1-rail:     172px;    /* left nav width */
}
```

**Type.** Display and UI: **Roboto Condensed**, uppercase, `.12em` tracking, 700 weight for labels.
Body: **Roboto**, 12.5px base, 1.4 line-height. Data: **Roboto Mono**, `font-variant-numeric:
tabular-nums` on every figure without exception. All three are free and must be **self-hosted**
(`next/font/local`) — no CDN link, no silent fallback.

**Component rules.**
- **Left rail** — fixed, 172px, `--v1-ink` ground. Nav items 11.5px uppercase `.12em`. Active item
  gets a 3px `--v1-accent` left border and a lighter ground. Account name pinned at the bottom.
- **Panel** — 1px `--v1-line` border on `--v1-paper`. Header bar is `--v1-ink` ground, white text,
  9.5px uppercase `.14em`, with optional muted right-aligned context text. No shadow, ever.
- **Table** — header row on `--v1-field` with a 1px `--v1-line` bottom; body rows divided by 1px
  `--v1-hair`; last row no divider. Totals sit below a **2px `--v1-ink`** rule.
- **Status tag** — 10px uppercase `.08em`, 700, with a 1px border in `currentColor`. Colour comes
  from `--v1-ok` / `--v1-bad` / `--v1-warn` / `--v1-mute`. Never a filled pill.
- **Buttons** — 1px `--v1-ink` border on `--v1-paper`, 10.5px uppercase `.10em` 700. Primary fills
  with `--v1-accent` and goes white.
- **Disclaimer** — `--v1-field` ground, 1px `--v1-hair` top border, 10.5px `--v1-mute`.
- **Elevation** — none. Structure is carried entirely by borders and rules.
- **Wordmark** — `V1` set in Roboto Condensed 700, **uppercase V, numeral 1**, `.20em` tracking,
  white on the `--v1-ink` rail. Directly beneath it, `CONTRACT PILOT` at 9.5px uppercase `.13em`
  in `--v1-mute`. No symbol, no logotype, no icon — the name is the mark.
  **Why uppercase:** V1 is the takeoff decision speed — the point on the roll where the pilot is
  committed. Uppercase renders it as the aviation callout every pilot already knows; lowercase
  `v1` reads as a software version string, which is the one meaning the brand should not carry.
  If Tony prefers lowercase, it is a one-line change in `lib/brand.ts`.
- **AMG lockup** — the string `powered by AMG Aviation` appears **only** in the application footer
  and on the marketing about page. Never in the rail, never in the header, never on an invoice PDF,
  never in transactional email. It is set in `--v1-mute` at body size with no logo and no link
  styling beyond a standard text link.

**Brand strings — `lib/brand.ts` is the only source:**
```ts
export const BRAND = {
  name:        'V1',
  wordmark:    'V1',
  descriptor:  'Contract Pilot',
  lockup:      'V1 — powered by AMG Aviation',
  attribution: 'powered by AMG Aviation',
} as const
```
Nothing may render a literal `'V1'` or `'AMG'` string outside this file.

**Reference:** https://claude.ai/code/artifact/85f5aefa-30e2-40da-852d-944b3d4d2976 (Direction One).
Four screens are already designed — Overview, Trips, Invoice, Logbook. Match them.

**Disclaimer copy — verbatim, subject to counsel:**
> Currency is calculated from the entries you logged and is a planning aid, not a determination
> of regulatory compliance. You remain responsible for your own currency and airworthiness decisions.

---

## Build order

Each phase must be independently demonstrable.

**Phase D is done.** Approach Plate is locked (see Design system above), and Overview, Trips,
Invoice, and Logbook are already designed. Nothing is blocked on design. The three remaining
screens — **Expenses, Clients, Documents** — plus signup, settings, and the CSV import flow get
built by applying the locked component rules; they do not need a separate design pass.

**Phase 0 — Foundations.**
Create the new Supabase project and the new repo/Vercel project. Establish the `pilot` schema
and migration naming. Write `lib/brand.ts` and `app/tokens.css` with the locked values **first**,
before any component exists, so there is never a moment where hardcoding is the path of least
resistance. Self-host Roboto Condensed, Roboto, and Roboto Mono via `next/font/local`.
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
- `npm run tokens:verify` — **design-overhaul insurance.** Scan `app/` and `components/` and fail
  on any hex colour, `rgb()`/`hsl()` literal, hardcoded `border-radius`, or `font-family` outside
  `app/tokens.css` and `lib/brand.ts`. Also fail if a numeric figure renders without
  `tabular-nums`. Wire into CI from the first commit — the whole point of the token discipline is
  that Tony's later overhaul stays a two-file change.
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
- **Identity model drift.** `amg1` already carries `users` vs `profiles` duplication. This
  product gets exactly one identity model: `auth.users` → `pilot.account_members` → `pilot.accounts`.

---

## Open items

Nothing blocks the build. Name and design are locked and four screens are drawn.

**Non-blocking:**
- Price points and trial length — env/config, not code.
- Domain. "v1" is short and generic, so the exact-match domain is unlikely to be available;
  expect a compound (`v1pilot`, `flyv1`, `v1.aero`). A naming decision, not a build blocker.
- A future design overhaul. Deliberately deferred by Tony; the token discipline above is what
  keeps it cheap.
- AMG's own portal restyle is **out of scope entirely.** The two products no longer share a
  design system, so there is nothing to converge.

---

## Additional risk

**Token discipline erodes under deadline.** Tony plans to overhaul the design later, and that
only stays cheap if no component ever hardcodes a value. The failure mode is ordinary and
predictable: a developer needs a slightly darker border at 2am and types a hex. Fifty of those
turn a one-file overhaul into a two-week refactor. `npm run tokens:verify` exists to make that
mechanically impossible rather than a matter of discipline — it must run in CI from the first
commit, not be added once the problem appears.
