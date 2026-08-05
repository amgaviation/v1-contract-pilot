# FlightDeptPro — full product audit

**Audited:** 2026-08-05, live demo at `app.flightdeptpro.com` (public "View the live demo" entry
→ read-only seeded account "Sample Aviation", `demo@flightdeptpro.com`, 3 aircraft, 35 trips,
6 crew, ~14 months of seeded history).
**Method:** four parallel automated browser sessions (headless Chromium/Playwright) crawled every
route in the app plus the marketing site; every page's text, forms, links, exports, console
errors, and failed network requests were captured. Direct API/PDF endpoints were probed where
the UI linked them. Screenshots archived in the session scratchpad. The Money and
Compliance/Platform crawls ran to completion; the Trips/Calendar and Aircraft/Crew crawls were
cut short on request — sections 1.1 and 1.2 are marked partial and drawn from what those crawls
captured plus cross-references from the two complete ones.
**Scope note per Tony:** this is a **functionality and business audit only**. Zero commentary on
visual design or brand anywhere in this document, by instruction.

**What FlightDeptPro is:** ops + money + compliance software for a **flight department /
aircraft-management company** (the tenant manages aircraft it flies for owner-clients called
"Operators"). Money in = charter invoices + owner monthly statements; money out = auto-generated
contract-pilot bills + crew reimbursements. The trip is the joining record. It is the exact
*mirror image* of V1's user: FlightDeptPro's tenant is the company that *hires* contract pilots
and *receives* the CP-numbered invoices; V1's user is the contract pilot who *sends* them.

---

## Executive summary

- **The product's spine is genuinely good.** One trip record links crew, legs, readiness gates,
  expenses (with a payer/re-bill/reimbursable classification), the customer invoice, the pilots'
  bills, and the flight log that rolls up into aircraft times, utilization, cost-per-hour, and
  owner statements. Log once, everything posts — the same thesis as V1, executed on the
  flight-department side.
- **The money module is a bookkeeping mirror, not a money system.** Nothing moves: no payment
  rails in or out, no accounting sync (no QuickBooks/Xero, CSV only), no tax anywhere — including
  no FET in a product with an explicit Part 135 charter billing mode. Every dollar is executed
  elsewhere and re-typed here.
- **The demo sabotages its own sales pitch.** Invoicing — the A/R heart of the product — is
  feature-flagged **off** in the demo with a dead "Enable it in Settings" CTA; the P&L therefore
  renders a profitable seeded operation as a **-$50,540 YTD loss** while the Payments ledger
  shows ~$580k collected. Projects are walled off, inbox actions are stripped, and there is no
  reachable expense-entry form. A buyer cannot evaluate the thing the dashboard advertises
  ("A/R outstanding $66,330").
- **Trust-degrading defects exist at the worst spots:** writes fail silently with HTTP 200 (form
  reverts, no message) on the most labor-intensive form in the app (the flight log); crew flight
  hours read 0.0 forever because ops logs never populate pilot logbooks; "Seen -4 days ago" on a
  readiness check (negative relative-time); a trip header says "0 passengers" while its legs say
  "3 pax"; the owner statement is branded with a third company name ("FlightLine") that matches
  neither the account nor the operator.
- **You cannot actually buy it.** Private beta, application-only signup ("no account is created
  until we do"), Pro tier "coming soon," and Terms/Privacy pages that are labeled unreviewed
  drafts *and* fail to load their assets — for a system holding passenger PII and passport
  numbers. Every paid differentiator (roles, SMS, statements, the agentic AI, approvals,
  checklist templates) is admin-gated or empty in the demo, so the funnel dead-ends exactly at
  the features being sold.
- **The flagship AI is confidently wrong about the app's own data.** Asked about expired
  compliance items, "Dispatch AI" reported none — while the same screen flags two expired
  federal programs (Drug & Alcohol, TSA Twelve-Five). It calls an aircraft with two overdue
  maintenance items and an overdue registration "ok." In an ops/compliance product, one answer
  like that ends AI usage permanently.
- **Biggest single lesson for V1:** their strongest mechanics (trip-centric margin, payer flags
  driving six downstream behaviors, config-once per-diem spreads, auto-drafted pilot bills,
  client monthly statements, provenance-marked derived hours) are exactly the features V1 should
  adapt to the pilot's side — and their fatal gaps (no payment execution, no tax, no accounting
  egress, broken pilot-hour pipeline) are exactly the lanes V1 already owns in its plan (Stripe
  Connect client billing, pilot-owned logbook fed by trips, accountant-ready exports).

---

## 1. Feature inventory (what exists)

### 1.1 Core ops — Dashboard, Calendar, Trips

*(Partial crawl — cut short on request; everything below was directly observed.)*

**Dashboard.** Date/base context line ("Wednesday, August 5 · Base KORD"), greeting, and a
customizable widget layout ("Customize"). Widgets: **next-trip card** with three readiness chips
(`Crew assigned READY · Release / FRAT complete REVIEW · W&B complete REVIEW`); financials
snapshot (`This month spend`, `A/R outstanding`, `Reimbursable owed`); expense breakdown;
monthly block hours (trailing-12 by tail); cost-per-flight-hour vs `Target $960`; **Action
items** ("10 need attention - 4 urgent, 6 soon") with typed tags (COMPLIANCE / MAINTENANCE /
DOCUMENT / READINESS), each row deep-linked; fleet status (READY per tail + "no due items ·
30d" + "not seen in 7 days" watchdog); KPI tiles (Trips 35 / Aircraft 3 / Open audit items 1);
next-7-days strip. Header: ⌘K command palette, notification bell, Dispatch AI.

**Trip detail (the core record).** Status + tags (`UPCOMING/COMPLETED/CANCELLED`,
`OWNER`/`MANAGED`, `WATCHDOG`), `#D-` numbering, counters (`10 AUDIT OPEN`, `0/2 RELEASED`,
`0/0 FIT DUTY`). **Trip readiness audit "3 of 13 ready"** in two groups: an ops/aircraft group
(Crew current & qualified · Aircraft status reviewed with maintenance · Weight & balance ·
Weather reviewed · Airspace / TFRs · Fuel plan · Release, FRAT & fit duty · Passenger manifest),
each `OPEN/REVIEW/READY`, plus a free-form "YOUR CHECKLIST" group (Crew assigned, Aircraft
readiness, Catering confirmed, Ground transport, Owner itinerary sent). **Per-leg cards**: dep/arr
in airport-local + Zulu, FBO on each end, distance + estimated time, pax count, plan-vs-actual
block and fuel, per-leg `FRAT`, `W&B`, and `PIC release` chips, crew/pax notes, hotel/catering/
ground-transport annotations. Trip totals line (legs · nm · est hrs · est fuel lb · est fuel $).
Route map (Leaflet/OpenStreetMap). Additional cards, re-orderable via a per-trip **"Customize
layout"** drag mode: Shopping list, Documents, International / eAPIS, Send & share (itinerary ·
briefing · status), Route map, Financials, Expenses & receipts, Charter billing. Exports/actions:
View itinerary, Crew briefing, **Add to calendar (.ics)**, **Export to ForeFlight (.fpl)**,
Flight log. An AI prompt card ("Things to consider") is embedded per trip, labeled "AI
suggestions — verify independently." **Cancellation is a first-class model**: reason category
(e.g. Weather) + note, feeding the dispatch-reliability and controllable-completion analytics.
Operator trip-sheet notes are injected from the client record. Bad trip ids return a proper 404
page with recovery links.

**Calendar.** Partially crawled; one confirmed defect — **maintenance events on the calendar
404 when clicked** (see §3). The Send & share card exposed no working actions in the demo
(empty internals).

### 1.2 Aircraft & Crew — fleet, maintenance, availability, GSE, fuel, crew, currency, duty

*(Partial crawl — cut short on request; everything below was directly observed.)*

**Aircraft list.** Columns `TAIL | TYPE | OPERATOR | STATUS | HOURS | CYCLES | BASE | SERIAL |
YEAR | SEATS`, with status rollups as chips (`Attention — 1 SOON`, `Action required — 2
OVERDUE`) and a `?attention=1` needs-attention filter. Aircraft detail (via crossings from the
other crawls): current times/cycles, qualified-crew table, maintenance due items tracked by
date/hours/cycles, readiness "Seen X ago · alert after 7 days" check-ins with named inspector
notes ("Oil, tires, oxygen, database currency checked"), aircraft-level expenses with recurring
monthly costs, per-tail W&B calculator, and contract-fuel visibility gated per tail membership.

**Crew.** Framing worth noting: "Everyone in your operation — pilots, schedulers, maintenance,
attendants. **Some are app users; some are records here only to be scheduled** and have their
trip logs completed" — people records are decoupled from logins (`ACCOUNT: No account`).
Import CSV / Export CSV / Add crew member; filters Active/Deactivated, App users only, Needs
attention, Condensed view; columns `NAME | ROLES | CONTACT | ACCOUNT` with per-person document
badges (`DOCS`, `DOCS 1 DUE SOON`).

**Currency.** Per-item day-count chips (`4D`, `8D`, `13D` in a pending state; `124D`, `134D`,
`504D` in a good state) — i.e., a computed days-remaining countdown per item, not just a date.
Items observed: medical certificate, 61.58 proficiency **per type** ("61.58 proficiency —
CL-350"), company recurrent training, aircraft registration. The same items feed the
notification ladder (below) and the dashboard action items. Required medical class derives from
the operator's Part 91/135 election (marketing: "a 135 on-demand PIC tracks to 2nd class, a 91
owner-pilot to 3rd, automatically").

**Notifications (the expiry engine).** All 12 seeded notifications are `EXPIRY REMINDER`s from
an escalation ladder at **T-30 / T-14 / T-7 / T-1 / OVERDUE** per item (verified sequences for
N882RE registration, a medical, 61.58, recurrent training), each deep-linked, with per-item
dismiss, Mark all read, and a full `/app/notifications` page. The only user preference is a
single "Email me expiration & currency alerts" checkbox.

**Duty.** Not fully crawled. Observed: "Crew duty & rest (advisory)" is an admin toggle with an
operation-type setting; trips carry a `0/0 FIT DUTY` gate counter; marketing sells duty/rest as
advisory tracking.

### 1.3 Money — Operators, Expenses, Inbox, Invoices, Bills, Statements, Reimbursements, P&L, Cost reports, Logbook, Tools

**Operators (the client record).** Name, home airport, phone/email/address, trip-sheet/itinerary
recipient emails, special notes, logo, contacts, favorite airports, documents. Two decisions live
on the client record and flow downstream: **operating rule** (Part 91 / Part 135, with a Part 135
PIC medical class option — "drives crew medical requirements"), and **crew per diem** as a pair:
`billed $/person/day` (what the owner pays) vs `paid $/person/day` (what crew receives) — "the
difference is your margin." Three paperwork-note fields flow onto passenger itineraries,
trip sheets, and flight logs. CSV import (with a downloadable commented template; example rows
ignored on import; US phone formats auto-normalized) and CSV export.

**Expenses.** Month-scoped ledger with KPI tiles (month total / operating-re-billable /
owner-paid), sort/filter/group-by-trip, and CSV export. Data model per the CSV:
`Date, Source, Aircraft, Category, Report line, Vendor, Amount, Currency, Note, Paid by,
Reimbursable, Reimbursed` — a two-level classification (category → report line) plus a
three-way payer classification (company card / operator's card / crew personal card) expressed
in the UI as `RE-BILL`, `REIMBURSABLE`, and an operator-name badge. Auto-generated **per-trip
expense reports** render in four modes: Internal, Client copy, Print, Owner copy (verified PDFs).
Aircraft-level expenses exist separately with a **recurring monthly** concept (hangar, insurance,
subscriptions) that feeds cost reporting. **No expense-entry form is reachable anywhere in the
demo** — the capture moment of their cost engine is invisible. "Bank feed" page is a single
sentence: "Connected card feeds are managed by account managers."

**Financials Inbox (email-in ingestion).** One forwarding address ingests three artifact types
with a Needs Review → Processed lifecycle: receipts (parsed to
"Vendor: Air Culinaire; Amount: USD 468.25; Date: 2026-07-19; Category: catering"), printed
flight plans (→ attach planned block/fuel to a leg), and contract-fuel CSVs (→ rate tables).
In the demo every action cell is the literal text "Read only", no item is clickable, and no
attachment exists, so the conversion workflow is unauditable.

**Invoices (A/R).** Feature-flagged **off** for the demo persona: every invoice URL renders
"Invoicing is turned off — Enable it in Settings," and Settings contains no such toggle. The
model is only visible by inference: dashboard `A/R outstanding $66,330.00`, trip-linked
`Invoice #INV-0028 $21,135.00`, a Payments ledger applying receipts to INV-0001…0027, audit-log
tables `Charter invoice` / `Charter invoice line`, and help articles listing billing modes
(Part 135 charter operator / charter broker / flight club / owner statements / require expense
approval / default per diem).

**Bills (A/P).** Auto-generated **contract-pilot pay bills** keyed to trips: number
`CP-{trip}-{seq}`, auto-written description ("2 contract pilot days for D-0003"), per-pilot day
rate ($1,200 or $1,600/day in seed), net-15 terms, `OVERDUE nD` badges, Unpaid/Overdue/Drafts/
Paid tabs. ~40 bills materialize from crew assignments with zero data entry. Bill detail is a
stub: payee, trip link, dates, balance — no line items, no record-payment action, no document.

**Owner statements.** Aircraft × month → "Owner Monthly Statement": flight activity (hours,
legs/trips, landings, trip days, auto per-diem `4 @ $95.00 = $380.00`, airports), per-trip
totals, budget-vs-actual by category, management fee line, owner-paid items excluded from
amount due, maintenance status + coming-due items, notes. Print/PDF, CSV, and email-to-recipients
(gated on the operator's report recipients, with a helpful blocker message). This is the
signature client-facing artifact of the product.

**Reimbursements (crew payables).** Total outstanding, grouped rows, and — the good part —
**pay-run instructions**: "PAY-OUT TO CREW · 2026-07 $680.00 — Pay Danny Ortiz $340.00 / Pay
Karen Whitfield $340.00" for a selected month/quarter/YTD, exportable. Schema carries an
`Approved` flag and help documents a "require expense approval" mode, but no approval UI exists
anywhere. Payout view is scoped "Unpaid **USD** trip expenses" — non-USD rows would silently
fall out.

**Payments.** Read-only ledger: date, direction, party, method (CHECK/ACH/WIRE), **account
(Operating vs Client trust account)** — charter escrow reality is modeled — applied-to invoice,
memo. All 27 seeded payments are inbound; no record-payment control exists.

**P&L.** Self P&L (invoice-issue basis) vs **"Managed costs — costs you track for others, not
part of your P&L"** with per-entity and per-aircraft splits. Clean separation of own economics
from pass-through client costs.

**Cost reports.** Blended and per-tail **cost per flight hour** over calendar/rolling windows:
(trip expenses + aircraft direct costs incl. recurring) ÷ logged flight hours, category %
breakdown, CSV splits direct vs trip cost. Dashboard tile compares to a configured
`Target $960/hr`.

**Aircraft logbook + flight-log capture.** One line per logged leg (date, tail, trip, route,
flight/block hrs, landings, fuel, engine cycles, PIC/SIC, approach type), totals row, date/tail
filters, CSV + print/PDF. Capture form per leg shows live carry-forward math ("Airframe 4864.0 →
4866.5"), a Before / +This log / After table for airframe/engine times against a settable
baseline, `Scan printed flight plan` and `Import from FMS photo` (OCR intake) buttons, and
operator flight-log notes injected from the client record. A completeness alert ("9 flown legs
not logged yet") deep-links each unlogged trip's form. Explicitly disclaimed: "informational,
not a maintenance system of record."

**Reports & Tools.** Utilization trend (12 months, "est" markers where logs are missing),
dispatch reliability (97%), controllable completion (100%) with cancellation-reason table,
on-time departures (D15 methodology footnote, late reasons with avg delay), aircraft utilization
CSV, crew activity CSV (assignments/days from rosters; hours from pilot logbooks — all 0.0, see
§3), audit log ("account activity captured from database changes" — table + insert/update/delete
filters). Tools: E6B calculators (density altitude, TAS, wind components, TSD, fuel), unit
conversions incl. Jet-A/100LL fuel weight, W&B per tail, FAA resource links — all disclaimed
"advisory — verify against your AFM/POH."

### 1.4 Directory, Compliance, Platform — Passengers, Vendors, Documents, Compliance, SMS, Checklists, Review, Settings, Dispatch AI, pricing/packaging

**Passengers.** Traveler profiles "saved for future trips": name/email/phone/notes quick-add,
full profile with **date of birth (intl manifests)**, **weight with lb/kg unit (W&B planning)**,
eAPIS-ready travel-document fields (gender, nationality, passport #/country/expiry, residence
country), split **catering preferences** (drinks / snacks / meals / preferred vendor / dietary-
allergies / notes), a per-passenger expiring-documents tracker ("Passport, visas, KTN/Global
Entry — flagged red when expired, amber within 30 days"), and trip back-links. Deletes require
typing DELETE. CSV export. (No demo passenger has weights or docs filled — the W&B story is
undemonstrated.)

**Vendors.** Directory with category taxonomy (FBO, Fuel, Catering, Maintenance/MRO, Parts,
Charter/Lift, Insurance, Cleaning, Ground transport, Training, Other), account #, preferred
flag, notes, CSV export. Ships completely empty in the demo — never linked to anything
observable.

**Documents & Contracts.** Attach a link or uploaded file (signed-link storage) to any entity
(aircraft, crew, trip, operator) with optional expiry; filters by type + "expiring only"; CSV
export includes computed Status. Separate insurance-policies section. **Contracts** tab: typed
agreements (Lease, Management Agreement, NDA, Non-compete, Employment, Insurance, Vendor) with
effective/expiration/signed dates and a template flag. Both tabs ship empty; no e-signature
exists anywhere despite the pricing page selling "Contracts & e-signature."

**Compliance.** A register, not a workflow: items with `Scope (Department or per-tail),
Category, Status (Compliant / Pending review / Action needed [+ derived Expired]), Responsible
(free-text role), Effective, Expiration, CFR reference + link, Description, Notes`. Seed covers
OpSpecs, RVSM, SMS (Part 5), Drug & Alcohol (Part 120, expired), TSA Twelve-Five (49 CFR 1544,
expired), eAPIS/CBP account, insurance certificate, RNP/RNAV (AC 90-105). Header disclaimer
"Advisory only — not legal advice… Every item is editable" — but **no add/edit control exists
anywhere on the page**.

**Safety (SMS).** A stub: two empty lists ("Safety reports", "Hazard register") with no
submission form, no risk matrix, no FRAT configuration. FRAT exists only as a trip-readiness
checkbox.

**Checklists.** Recurring department chores: blank checklists, templates with recurrence
(every N days/weeks/months, day-of-month), starter-template loader. All empty in demo.

**Review.** "Only the account administrator can review submissions." — the approval queue
(expenses etc.) is fully invisible to the demo persona.

**Help & support.** 8 genuinely procedural articles written against exact field labels, live
search that filters by field label. Admin-only settings are documented here rather than visible:
trip numbering (per tail / per operator / global), daily-briefing recipients, duty/rest toggle,
and the billing modes list. Notably: "**No time-zone setting is needed** — FlightDeptPro shows
each time in the local zone of that airport automatically from the airport code." No support
email/chat anywhere; the only channel is a Bug/Idea feedback widget with screenshot attach.

**Settings (as the demo persona).** One page: profile name, a single "Email me expiration &
currency alerts" checkbox, and 2FA enrollment. "Access is invite-only. Your administrator
manages who has access." No user list, roles UI, billing, integrations, API keys, or import —
and `/app/settings/{account,billing,users,team,integrations,api}` all 404. The 2FA button
**actually works on the shared read-only demo account** (mints a real TOTP secret).

**Dispatch AI — two different surfaces.** (a) An assistant *page* doing grounded Q&A over
department data: fast (~2–5s), states its date-range assumptions, admits missing data (invoice
rates); "Demo questions are limited" is claimed but unenforced (11 straight answers). (b) A
*side panel* agent ("Asks before it acts · reads your data") with propose-confirm write actions
(draft a trip from plain English, log a squawk, add a passenger), attachments, and voice — fully
refused in the demo ("Ask your administrator to use Dispatch."), i.e. AI write access is
role-gated. Accuracy problems are documented in §3.

**Search / command palette (⌘K).** Navigation quick-jumps plus typed entity search hitting
`/api/search` — covers crew, passengers, aircraft with deep links; does **not** index trips,
invoices, vendors, documents, or airports.

**Packaging & marketing (flightdeptpro.com).** Positioning "Built for Part 91 & 135 flight
departments… 1–10 aircraft," private beta, application-only signup ("no account is created
until we do"). **Per-aircraft pricing:** Basic $99 first tail + $69/additional (scheduling,
maintenance, crew/currency/duty, readiness+FRAT+W&B, compliance, documents, fuel tracking,
owner-ready reporting, weather); Standard $149 + $99 (**adds multi-user logins/roles**, charter
billing & owner statements, reimbursements & cost reports, SMS, dispatch-reliability analytics,
eAPIS, contracts & e-signature, shareable trip links/calendar feeds); Pro $199 + $139 "coming
soon" (the AI layer: ask anything, draft trips by voice, FMS-photo flight logging, proactive
watch, live contract fuel, premium weather). Security page claims tenant isolation "proven" by
an automated test suite, nightly encrypted backups with verified restores, role/tail-scoped
access, full export, no data selling. Legal footer disclaims operational control (14 CFR 1.1).
**Privacy and Terms pages are labeled "working draft… pending review by legal counsel" and are
also physically broken** (CSS/JS assets 404, pages render unstyled).

**Signup.** Not a signup — a beta application form (company, name, email, "What do you fly?").

**PWA / mobile.** Manifest-only "PWA": `display: standalone`, SVG-only icons, **no service
worker** → zero offline capability. At 390×844 the app is genuinely usable (off-canvas nav,
hamburger works, list pages have no horizontal overflow) except the dashboard, which overflows
horizontally (fleet tile at x=423 on a 390px viewport).

---

## 2. What it does RIGHT (mechanics worth respecting)

*(Consolidated across all four crawls; the V1-applicable subset is extracted into the companion
document `FLIGHTDEPTPRO-INSPIRATION.md`.)*

1. **Trip as the financial atom.** Every trip computes `MONEY IN − MONEY OUT = MARGIN` and
   hyperlinks the artifacts behind each number (customer invoice, each pilot's bill, each
   reimbursable, pass-through costs "not in your margin"). One glance answers "did this flight
   make money," and every figure is one click from its source document.
2. **One expense classification driving six behaviors.** The payer/treatment flags decide margin
   inclusion, which of four report renderings a line appears in, the reimbursement queue, owner
   statement lines, and Self-P&L vs managed-cost separation. One tag at capture, six downstream
   consequences — the cleanest idea in the product.
3. **Config-once rate spreads on the client record.** Per-diem billed vs paid ("the difference is
   your margin") set on the operator, auto-multiplied into trips, statements, and reimbursements.
   Rates are never re-entered per trip.
4. **Auto-drafted counterparty paperwork.** Crew assignment on a trip materializes the pilot's
   bill (`CP-0030-1`, "1 contract pilot day for D-0030", day rate, net-15, overdue badges) with
   zero data entry.
5. **The owner monthly statement** as a one-click, client-facing artifact aggregating activity,
   money, and maintenance status — print/PDF/CSV/email — with recipient management delegated to
   the client record.
6. **Pay-run instructions instead of raw lists.** Reimbursements resolve into "Pay X $340.00"
   per person per period — output shaped like the action the user takes outside the system.
7. **Ops-derived hours with carry-forward math and a completeness loop.** Leg logs update
   aircraft times live, show Before/+/After, and a "9 flown legs not logged yet" alert deep-links
   the exact forms to finish. Low-friction bookkeeping enforced by the product, not discipline.
8. **Email-in ingestion with field extraction** (receipts → parsed vendor/amount/date/category;
   flight plans → leg plan data; fuel CSVs → rate tables) behind one forwarding address and a
   review queue.
9. **Honest data provenance everywhere.** "est" markers with the fallback rule spelled out;
   "informational, not a maintenance system of record"; P&L basis notes; on-time methodology
   footnotes; "AI suggestions — verify independently"; the login-page liability line
   ("FlightDeptPro organizes and flags. Operational control and all go / no-go decisions remain
   with the operator, PIC, and mechanic.").
10. **Trust-account awareness** in the payments ledger (Operating vs Client trust account).
11. **CSV in/out on every list** with commented import templates that ignore example rows and
    auto-format phone numbers.
12. **Regulatory config on the client record** (Part 91/135 election driving crew medical
    requirements) — client setup feeding compliance logic, not just billing.
13. **Escalating expiry notifications** with a sane ladder (30d → 14d → 7d → 1d → OVERDUE per
    item, seen in the notification feed for registrations, medicals, 61.58, recurrent training).

14. **A single "expiring thing" engine across modules.** Crew credentials, aircraft documents,
    passenger travel docs, department compliance items, and generic documents all reduce to
    "item + expiry + responsible entity," feeding the same ladder, dashboard triage, and red/
    amber flags. One model, product-wide.
15. **Trip readiness as a gate system.** A 13-point per-trip audit split between an ops group
    (crew currency, maintenance review, W&B, weather, TFRs, fuel, release/FRAT/fit-duty,
    manifest) and a customizable "your checklist" group, plus per-leg FRAT / W&B / PIC-release
    chips and release/fit-duty counters in the header. Readiness is countable, not vibes.
16. **Cancellations as data.** Reason category + note per cancelled trip, rolling up into
    dispatch reliability (97%) and "controllable completion" (excludes weather) — turning a
    dead trip into an analytics input.
17. **Airport-code-derived timezones.** "No time-zone setting is needed" — every time shown in
    the airport's local zone automatically, killing an entire onboarding/scheduling error class.
18. **Passenger profiles built for reuse** — split catering preferences, weight with unit for
    W&B, eAPIS fields, per-passenger doc expiries, trip back-links.
19. **Dashboard action-items triage**: one prioritized cross-module to-do ("4 urgent, 6 soon"),
    typed tags, every row a deep link. The retention hook of the product.
20. **Type-DELETE confirmation** on destructive deletes (button disabled until typed).
21. **Two-tier AI architecture**: a cheap grounded Q&A surface, and a separate role-gated agent
    that "asks before it acts" (propose-confirm writes). The permissioning is right even where
    the grounding is wrong.
22. **Command palette** mixing navigation with typed entity search and deep links.
23. **Help written against exact field labels** and searchable by them; a read-only seeded demo
    reachable from every marketing CTA with no signup.

---

## 3. What's WRONG or broken (verified)

1. **Invoicing dead end while the app advertises A/R.** The invoices module renders "Invoicing is
   turned off — Enable it in Settings" on every URL including detail/print; the Settings CTA
   leads to a page with no such toggle; meanwhile the dashboard links `A/R outstanding
   $66,330.00`, trips link their invoices, and Payments applies receipts to 27 invoices.
   Probed: invoice `/pdf` endpoints 404.
2. **P&L contradicts the rest of the app.** YTD Self P&L: Money in $0.00, Collected $0.00, Margin
   **-$50,540.00** — while the Payments ledger shows ~$580k of invoice-applied receipts and the
   dashboard claims $66,330 A/R. Revenue basis = the module that's switched off; a cross-module
   invariant is silently violated and the demo presents a profitable operation as a loss.
3. **Silent write failures with HTTP 200.** Submitting the flight-log form (the most
   labor-intensive form in the app) returns 200, shows no toast or error, and reverts on reload.
   Same for "+ Add operator." The only signal is the static header banner. As a pattern, this is
   how users lose an evening of leg data with zero feedback.
4. **The pilot-hours pipeline is broken end-to-end.** Crew activity reports show 0.0 hours for
   all six pilots against 167.3 aircraft-logbook hours with PIC/SIC recorded on every line —
   ops logs never populate "each crew member's logbook," and nothing else does either.
5. **Pilot-flying dropdowns don't match the trip's crew.** The leg-log "Flying — takeoff/landing"
   options come from the tail's qualified-crew list, not the assigned crew (offers "John / Pat"
   while the leg crew is Mark Sullivan / Karen Whitfield).
6. **Current-month-by-default renders money surfaces empty.** On the 5th of a month with July
   fully seeded: expenses "$0.00 / No expenses recorded", cost dashboard "No expenses recorded
   yet", dashboard tiles `This month spend $0.00` and `Cost per flight hour —` against
   `Target $960`. The product looks dead until the user finds the range controls.
7. **Data-integrity smells in a 35-trip seed:** trip header "0 passengers" vs legs "3 pax";
   readiness "Seen **-4 days ago** · alert after 7 days" (negative relative time, and plausibly
   why the not-seen alert didn't fire); owner statement branded "**FlightLine**" while the
   account is "Sample Aviation" and notes reference "Meridian Flight Group" (three company names,
   statement brand likely hardcoded); inbox says a contract-fuel CSV was "Processed" while the
   fuel page shows 0 rows / 0 airports; monthly block hours "167.3h" tile annotated "Trailing 12
   months" next to an axis reading "12h/0h"; reimbursements grouped by "SIC card" in one view and
   by person in another.
8. **Owner statements include unflown trips** (a CONFIRMED future trip renders on the July
   statement with 0.0 hours / $0.00) — noise on a client-facing bill.
9. **Stub pages behind polished ones.** Bill detail: no lines, no payment recording, no history,
   no document. Payments: no write affordance at all. "Custom reports: use 'New report' above" —
   no such button exists on the page.
10. **Dead anchor:** cost-report tail rows link to `/app/aircraft/{id}#aircraft-financials`;
    no such element id exists on the aircraft page.
11. **Demo gating strips exactly the workflows a buyer needs to see:** inbox actions replaced by
    the literal text "Read only", Projects "available to account managers", card feeds "managed
    by account managers", no expense form, no invoice module, no approval UI despite an
    `Approved` flag in the reimbursements CSV and a documented approval mode.

12. **Dispatch AI contradicts the app's own data.** "Which compliance items are expired?" →
    "I don't have information on any expired compliance items… not yet past their due date" —
    while the compliance page and dashboard flag Drug & Alcohol (expired 2026-07-15) and TSA
    Twelve-Five (expired 2026-07-10). "What is the status of N882RE?" → "ok" — against two
    overdue maintenance items, a not-seen-in-7-days readiness flag, and an overdue registration.
    It also renders raw Markdown (`**Invoice Draft**` shown literally).
13. **The app contradicts itself without AI help.** Fleet status says all three tails "READY ·
    no due items · 30d" while Action items lists overdue maintenance on N882RE and its
    registration is overdue — the readiness rollup and the alert engine disagree.
14. **Calendar maintenance events 404** when clicked.
15. **Phantom aircraft in seed data**: compliance items reference N703BT and N4518Y; the AI
    panel's canned prompts reference N604KT — none exist in the 3-tail fleet.
16. **"Every item is editable" is false** — the compliance page has zero interactive elements
    on item rows.
17. **Legal pages broken and draft.** /privacy and /terms load a shell whose CSS/JS chunks 404
    (unstyled, unhydrated) and open with "working draft… pending review by legal counsel."
18. **2FA enrollment executes on the shared demo account**, minting a real TOTP secret — any
    visitor could theoretically enroll 2FA on the shared demo login.
19. **"Demo questions are limited" is unenforced** (11 consecutive AI answers).
20. **Global search gaps**: trips, invoices, vendors, documents, airports all return nothing.
21. **Mobile dashboard overflows horizontally** at 390px (fleet tile at x=423) — the primary
    mobile screen scrolls sideways; other checked pages are clean.
22. Polish rot in visible places: "1 items" pluralization on scope headers; raw enum labels
    "Nda" / "Non Compete" in the contracts type select; manifest description says "Part 91"
    while everything else says 91 & 135; a dangling `?` on the documents CSV export URL;
    marketing nav mixes `.html` files with extensionless app routes.

*Technical health note: within the app itself, page loads were clean — no JavaScript console
errors, no unexpected failed XHRs, no notably slow pages (server-rendered, server-action forms)
— apart from the specific 404s called out above. The defects here are product, data-integrity,
and workflow defects, not client-side crashes. The broken asset 404s are on the marketing
site's legal pages.*

---

## 4. What's MISSING (looked for, not found)

1. **Payment rails, both directions.** No card/ACH acceptance, no pay-now links on invoices or
   statements, no payout execution to pilots/crew (reimbursements stop at "instructions").
   Method values (CHECK/ACH/WIRE) are labels for money that moved outside the system.
2. **Accounting integration.** No QuickBooks/Xero/GL export anywhere; the only egress is
   per-page CSV. No chart of accounts, no account coding.
3. **Tax.** No tax fields or lines anywhere — including **no FET** (7.5% + segment fees) in a
   product with an explicit "We are a Part 135 charter operator" billing mode, and no 1099
   concept for the contract pilots it pays via CP bills.
4. **Multi-currency as workflow.** A `Currency` column exists (always USD); the pay-run is
   hard-scoped to USD; no FX, no currency selector.
5. **Receipts in practice.** Receipt columns and "PDF with receipts" everywhere, but zero receipt
   files in the seed and no reachable upload UI; no mobile-capture story.
6. **A/R & A/P aging, dunning, client statements-of-account** beyond per-bill overdue badges.
7. **Budgets as workflow.** Statement has a budget column ($0.00 on every line except the
   management fee) and no budget-entry UI is discoverable.
8. **Pilot (personal) logbook.** The logbook is aircraft-centric: no per-pilot time splits, no
   endorsements/signatures, no ForeFlight/LogTen import, and per §3.4 no feed from ops.

9. **User management, invisibly.** No user list, invite flow, or role editor anywhere a
   non-admin can see — while pricing sells "roles & permissions down to specific tail numbers."
10. **No API, webhooks, or integrations page of any kind**; no calendar feed in-app despite the
    Standard-tier claim; no accounting integration despite invoices/bills/statements existing.
11. **No data import** beyond operators/crew CSV (passengers, vendors, documents are
    export-only) — migration from spreadsheets is manual.
12. **SMS is a stub** (no report form, no report types, no risk matrix, no investigation
    workflow) — sold on the Standard tier.
13. **Compliance has no lifecycle**: no add/edit/renew, no evidence attachment linking an item
    to a document, no responsible-role → user mapping — and the two *expired* federal programs
    generated zero notifications while routine 30-day reminders fired (the ladder isn't wired
    to compliance items).
14. **Notification preferences**: one global email checkbox; no per-category, push, SMS, or
    digest options.
15. **No e-signature** despite "Contracts & e-signature" on the pricing page; no versioning,
    preview, bulk upload, or multi-entity attachment in documents.
16. **No self-serve purchase path at all** (application-only beta), no billing portal, no plan
    display; **no offline capability** (manifest-only PWA, no service worker) for a user base
    that lives on ramps with bad LTE.

---

## 5. Business-killer candidates

1. **The revenue side is un-demo-able.** The A/R module is off with a dead settings CTA, the P&L
   shows a fake $50k loss, there's no expense capture, no payment recording, and inbox actions
   are stripped — the demo defeats the exact evaluation its own dashboard invites
   ("A/R outstanding $66,330"). Top-of-funnel killer.
2. **Record-only money = permanent double entry.** Every dollar is executed elsewhere and
   re-typed here, with no sync either way. Departments living in QuickBooks will treat it as a
   second books system to reconcile — the classic abandonment path for ops+billing tools.
3. **No FET/tax in a product with a Part 135 charter mode.** A charter operator legally cannot
   produce customer invoices without FET; billing work therefore leaves the product.
4. **Silent write failure as a pattern.** POST 200 + revert + no feedback on the app's most
   labor-intensive form. If any production permission/validation path shares the pattern, it
   means unexplained data loss — the fastest way to lose an ops team.
5. **The pilot-hour black hole.** Hour/duty/currency reporting reads 0.0 forever out of the box;
   a department buying "one system" discovers a second manual logbook hiding inside it.

6. **You cannot buy it, and diligence bounces.** Application-only private beta, "no account is
   created until we do," Pro tier "coming soon," launch pricing framed as future — and legal
   Terms/Privacy that are explicit unreviewed drafts on physically broken pages, for a product
   holding passenger PII and passport numbers. A prospect with budget today has no path to pay;
   a diligence-minded one walks at the ToS.
7. **The demo dead-ends at every paid differentiator.** Roles/users, billing modes, the Review
   approval queue, the agentic AI (refuses even reads: "Ask your administrator to use
   Dispatch."), checklist templates, SMS, and invoicing are admin-gated, empty, or off. The
   demo *is* the funnel (application-only otherwise), and it can't demonstrate the Standard and
   Pro tiers it sells.
8. **AI trust failure in a compliance product.** The flagship differentiator ("an AI co-worker
   that watches for problems before they become problems") denies expired federal programs the
   dashboard is flagging and calls an aircraft with overdue items "ok." In aviation ops one
   wrong "you're fine" ends AI usage permanently — and it's the top CTA on the dashboard.
9. **Per-aircraft pricing paywalls the team.** Basic has no multi-user login — a "flight
   department" tool with one shared password unless you pay $149+/tail, against a marketing
   promise of "one paid account, your whole team." Meanwhile 10 tails on Standard ≈ $1,040+/mo
   for partly-stub functionality. Wrong axis: the collaboration is what should be free-flowing,
   the assets are what scale.
10. **Claims-vs-product gap wide enough to burn early adopters**: e-signature (absent), SMS
    reporting (stub), tail-scoped roles (invisible), "every item is editable" (not editable),
    "demo questions limited" (unenforced). In a small word-of-mouth market (NBAA circles), that
    compounds.
11. **No data entry or exit paths for a records product** — no import for most entities, no
    API, partial CSV export. Buyers in this segment explicitly ask "how do I get my records
    out"; a Part 135 records audit won't accept per-page CSVs of some tables.

---

*Companion document: [`FLIGHTDEPTPRO-INSPIRATION.md`](./FLIGHTDEPTPRO-INSPIRATION.md) — the
subset of mechanics V1 adapts, filtered to the contract-pilot use case (functionality only).*
