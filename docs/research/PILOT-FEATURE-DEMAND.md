# Pilot feature demand — ranked build list

**Date: 2026-08-11.** Research for the full-overhaul session: what contract pilots demonstrably
need next from V1, ranked by value-per-build-hour. Grounded in the aviation-expert corpus
(`contract-pilot-business.md`, `product-translation.md`), the current gap list
(`docs/WAVE-PARITY.md` §8–9), the shipped schema (38 `pilot.*` tables as of migration
`20260810130000`), and live web research (all URLs read 2026-08-11; listed at bottom).

**Claim labeling** per the aviation-expert accuracy protocol:
- **[REG]** regulatory requirement — CFR area cited; implementers MUST verify current text at
  ecfr.gov before encoding (the pattern `docs/CURRENCY-SPEC.md` already follows).
- **[CONV]** industry convention — common practice, varies by operator; never present as law.
- **[ASSUME]** assumption — flagged, with what would verify it.

**No fabricated statistics.** Where a vendor claims a number it is labeled as that vendor's
claim. Every legality-adjacent feature ships with the standing framing: *the tool advises;
the PIC/operator decides* — and anything computing currency or duty limits inherits the G1
counsel gate posture from `docs/LAUNCH-GATES.md` / `docs/CURRENCY-SPEC.md`.

**Tiers**: `entry` / `mid` / `top` = the three coming plan tiers.
**[NO-SCHEMA]** = buildable with zero new migrations. **[REG-SENSITIVE]** = compliance logic;
exact CFR area given.

---

## Ranked list (value per build hour, highest first)

### 1. Qualification & Document Due Radar (S, mid) [NO-SCHEMA] [REG-SENSITIVE]
One Overview panel (plus a `/reports` page) that merges every date-gated item the schema
already holds into a single due list sorted by due month: document expiries
(`pilot.documents` ladder — medical, flight review, passport, W-9, COI), per-client
135.293/.297/.299 check due months and drug-program/PRD status
(`pilot.operator_qualifications`), and W-9 status per client (`pilot.clients.w9_status`).
Each row shows the item, the client it belongs to (quals are per-certificate, never global),
the due month, and days remaining — rendered as "valid through end of AUG 2026", never a
fake day-precision date. Today these live on three screens; a working freelancer's whole
calendar is driven by this ladder. **Aviation reason**: [REG] checks and medicals run on
calendar-month semantics (14 CFR 61.23, 61.56, 61.57, 61.58; 135.293/135.297/135.299 with
135.301 early/late-month grace — verify text before encoding); [CONV] a lapsed item means
un-bookable days and a lost trip, and today pilots track this in spreadsheets and
training-center emails (corpus §13; LogTen/ForeFlight sell currency reminders as a headline
feature — logten.com/why-logten, foreflight.com/enhancements/jet-currency-in-logbook, read
2026-08-11). Pure read-model over existing tables: the best value/hour on this list.

### 2. CPA travel-log & per-diem export in the year-end packet (S, mid) [NO-SCHEMA]
A new export in `/reports/year-end`: a contemporaneous business-travel log (date,
origin/destination ICAO, client, trip purpose, day type) generated straight from
`pilot.trips` + `pilot.trip_legs` + `pilot.trip_days`, plus a per-diem day count (away days
already computed by the per-diem away-day logic) with a **pilot-entered** M&IE rate per
year — exactly the `pilot.mileage_rates` precedent: never hardcode an IRS/GSA figure, let
the pilot or their CPA enter the current one. Output: CSV + PDF alongside the existing
accountant packet. **Aviation reason**: 1099 pilots deduct per diem on Schedule C, and CPAs
serving flight crews specifically ask for per-diem documentation and detailed travel logs
with dates and destinations; the IRS rarely accepts estimates — records must be
contemporaneous (unclekam.com pilot/flight-crew playbook; aviationcpafirm.com flight-crew
per-diem practice; both read 2026-08-11). [CONV] on the workflow; the tax treatment itself
is CPA territory — the export carries the standing "consult your CPA" framing, and V1 never
computes the deduction, only the substantiation. The data is already captured once per trip;
this is the "one capture, many outputs" thesis paying out at tax time.

### 3. Scheduled invoice reminders + aging escalation (S, entry)
Upgrade the existing one-click reminder (WAVE-PARITY gap 1.4) to a per-invoice schedule:
pilot picks a cadence (e.g. on due date, +7, +14, escalating tone), reminders send from the
existing invoice share/email path, each send stamped on the invoice activity. Needs at most
a `reminder_policy`/`last_reminded_at` addition to `pilot.invoices` — one small migration,
flag it for the owner-gate. **Aviation reason**: [CONV] chasing payment is a top-three
contract-pilot pain; NET 15/30 is the norm and 60–90 day slippage happens (corpus §10;
crewblast.co pay-structure guide, read 2026-08-11, describes 15–30 day expectations and
operators building late-payer reputations). The pilot is mid-trip when an invoice ages —
automation that nags without them is worth more per hour than almost anything else in the
billing surface.

### 4. Receipts attached to invoices — rebillables done right (S, entry)
Ship WAVE-PARITY gap #3: expenses already carry receipts (`pilot.expenses` + receipts
storage, phase 4) and can belong to a trip; when an invoice drafts from a trip, rebillable
expense lines should carry their receipt images into the invoice PDF and the share-link
view. Possibly one linking column (expense → invoice line) if the draft path doesn't
already record it — otherwise no schema. **Aviation reason**: [CONV] the standard pilot
invoice is day rate + per diem + reimbursables *with receipts attached* (corpus §4, §10;
crewblast.co pay guide, read 2026-08-11 — hotel and positioning reimbursements are invoice
norms). Operators' accounting departments bounce reimbursable claims without documentation;
attaching at source kills a whole email round-trip per invoice.

### 5. Insurance dossier / pilot history export (M, mid) [NO-SCHEMA]
A generated, underwriter-ready PDF from data V1 already holds: hours totals by
category/class and by type (`pilot.logbook_totals` + `pilot.logbook_entries` +
`pilot.aircraft`), certificates/medical/flight-review dates (`pilot.documents`), recurrent
school dates (documents or operator quals), incident disclosure as pilot-entered free text.
Delivered as a download and as an addition to the existing tokenized credential packet
(`app/packet/[token]`, `20260810100000`). **Aviation reason**: [CONV] every named-pilot
insurance approval requires a pilot history form; the forms are unstandardized — "every
insurance broker and every underwriter seems to have their own slightly different version"
so pilots re-fill redundant paperwork per client, and slow approval cycles kill pop-up
trips (blog.flyingcompany.com/pilot-history-forms-faa-verification, read 2026-08-11; corpus
§8: a pilot profile is partly an insurance-approval dossier). V1 cannot fill every
carrier's form, but a complete, current dossier makes any form a transcription job instead
of a research job. High value, low glamour, zero schema.

### 6. Client payment-behavior insight (S, entry) [NO-SCHEMA]
On each client page and the client list: median days-to-pay, current aging balance, count
of late invoices — computed live from `pilot.invoices` + `pilot.invoice_payments`. No new
tables, no external data, no cross-tenant sharing (that would be a legal/product minefield;
this is the pilot's own ledger only). **Aviation reason**: [CONV] contract pilots choose
which operators to fly for partly on pay reliability, and share that intelligence by phone
today (corpus §2, §10; crewblast.co pay guide, read 2026-08-11, on operators building payer
reputations). Turning the pilot's own receivables history into "this client pays in 19
days, that one in 61" directly informs which pop-up trip to accept.

### 7. PWA install + offline-tolerant receipt capture (S/M, entry) [NO-SCHEMA]
WAVE-PARITY gap 7.5's cheap half: a web app manifest, service worker, install prompt, and
an offline queue for the receipt scanner so a photo taken on a bad-LTE ramp uploads when
signal returns. No native apps this session. **Aviation reason**: [CONV] receipt capture at
the FBO is the most phone-shaped moment of the persona's day (WAVE-PARITY 7.5), and the
corpus design center is mobile-first, offline-tolerant — pilots live in FBOs and hotels and
ramps have bad LTE (product-translation §4). Every receipt captured at the counter instead
of reconstructed from a shoebox is a direct feed into features #2 and #4.

### 8. Cancellation-fee invoicing automation (S, entry) [NO-SCHEMA]
The schema already records cancellation timing (`trip_day_units_away_cancel`,
`20260807070000`); when a trip or day flips to cancelled inside the client's agreed window,
auto-draft the cancellation-fee line on the next invoice using the snapshotted rate terms,
with the timing math shown ("cancelled 18h before show — inside 48h window — 50% day
rate"). Terms live per client (`pilot.client_rates` snapshot pattern). **Aviation reason**:
[CONV] short-notice cancellation fees (commonly 50–100% inside 24–48h) are standard in
written day-rate agreements and notoriously hard to collect without paper (corpus §4;
crewblast.co pay guide, read 2026-08-11, lists cancellation terms among standard pay
components). The fee that isn't invoiced the same day is the fee that gets waived.

### 9. Light up the currency engine, per-trip context (S/M eng + G1 gate, mid) [NO-SCHEMA] [REG-SENSITIVE]
The 61.57/61.56/61.23 engine is already implemented dark (`lib/currency/`,
`CURRENCY_ENGINE_ENABLED`, `docs/CURRENCY-SPEC.md`, `pilot.currency_snapshots`). The build
work is the surface: a currency panel on Overview and — the differentiator — a per-trip
answer ("for THIS trip, under THIS operating rule, day/night, pax") using the trip's
`operating_rule` and leg times, with every verdict carrying its reg cite, the limiting item
and date, and the advisory framing. Engineering is small; the *gate* is counsel review (G1)
— an owner decision this list can only queue, which is why it ranks 9th despite top-3
value. **Aviation reason**: [REG] 14 CFR 61.57 (a)/(b)/(c), 61.56, 61.23, with the
61.57(e)(3)/135.247 interaction already specced in CURRENCY-SPEC §2.5 — implement exactly
per the fetched text, never approximate. [CONV] no mainstream tool answers "am I legal for
this trip, this operator, this part" as one question (corpus §13); LogTen and ForeFlight
prove pilots pay for currency math (logten.com/why-logten; foreflight.com Logbook 61.58 jet
currency and custom currencies pages, read 2026-08-11) but neither is trip/business-aware.

### 10. Cross-operator flight-time totals — the 135.267 report (M, top) [NO-SCHEMA] [REG-SENSITIVE]
A report aggregating commercial flight time across **all** clients from data V1 already
holds — `pilot.trip_legs` (out/in UTC timestamps, block hours) plus `pilot.logbook_entries`
for flying done outside V1 trips — into the buckets 135.267 limits: any 24-consecutive-hour
window, calendar quarter, two consecutive quarters, calendar year. Advisory-only, with the
honest-degradation rule from product-translation §3: "missing data after 12 JUL — totals
incomplete", and an explicit note that legs store block, not 14 CFR 1.1 flight time
[ASSUME: block ≈ flight time is conservative in the counting direction, but state it, don't
hide it]. Same G1-style counsel gate before any "legal/not legal" wording; v1 ships
*totals*, not verdicts. **Aviation reason**: [REG] 14 CFR 135.267(b): assigned flight time
plus "any other commercial flying" may not exceed the limits — the reg itself makes the
multi-operator pilot the only person who can aggregate, and forum threads show operators
interpret and track this inconsistently (ecfr.gov 135.267, read 2026-08-11;
flightinfo.com thread "135.267 — how does your operator view it???";
getfileflo.com/blog/part-135-flight-time-duty-rest-records on the records inspectors ask
for, read 2026-08-11). [CONV] operators must ask contractors for other-flying totals before
assignment; a pilot who can hand over a clean cross-client total is easier to book (corpus
§6, §11). Nothing mainstream does this well — it is the moat feature's first brick.

### 11. Availability calendar feed per client (M, mid) [NO-SCHEMA]
A tokenized read-only ICS feed per client (token pattern already shipped twice:
`pilot.invoice_shares`, `pilot.document_shares`) exposing busy/free derived from
`pilot.trips` (confirmed and hold statuses) and `pilot.trip_days` — free/busy only by
default, never other clients' trip details (pilot controls visibility;
product-translation §4 share-model rule). Subscribes into the scheduler's
Google/Outlook/Apple calendar. **Aviation reason**: [CONV] multiple operators book the same
pilot with no shared view of the pilot's calendar — today solved by texts; holds that
harden into double-bookings are the classic conflict (corpus §11). A trusted availability
layer is the corpus-named wedge, and ICS-first matches the pragmatic-integration guidance
(product-translation §5) — no marketplace build required. Marketplace platforms are
emerging (crewblast.co claims 15,000+ crew and 39-second response times — **vendor's own
marketing claims**, read 2026-08-11, not independently verified), which validates demand
while V1's angle stays pilot-owned data, not a staffing exchange.

### 12. Recurrent training planner (M, mid) [REG-SENSITIVE]
A view joining the due radar (#1) to the calendar: for each type/client, the due month for
61.58 or 135.297/135.293, a pilot-entered school booking (center, course, dates) that
blocks availability (#11) and links to its expense record for deduction capture. Needs one
small table (`training_events`) or a document-type convention — small migration,
owner-gated. **Aviation reason**: [REG] 61.58 runs 12/24 calendar months; 135.297 IPC every
6 calendar months per operator (verify text; the operator-quals schema already models the
135 side). [CONV] school slots book months out, recurrent week kills availability, and
cancellation is expensive — FlightSafety's published policy charges $5,000 for
cancellations 30 to 1 days before training (flightsafety.com/scheduling-policy and
/61-58-course-details, read 2026-08-11); recurrent is one of a freelancer's biggest
self-funded costs (corpus §7). The calendar object the corpus says should exist.

### 13. International trip readiness check (S/M, mid) [NO-SCHEMA]
When a trip's legs include a non-US ICAO (first letter ≠ K, plus the PHNL/PANC edge cases),
surface a readiness strip on the trip page: passport expiry vs trip dates (six-month
validity rules by destination are [CONV]/country-specific — link, don't compute), FCC
Restricted Radiotelephone permit on file, visa documents, SIC type rating note for
international SIC work (61.55(d) [REG — verify]). All checks read `pilot.documents` and
`pilot.trip_legs`; zero new tables if document types stay free-form. **Aviation reason**:
[CONV] international trips pay a premium and get scrubbed for paperwork the pilot forgot
(corpus §4, §12 — go-bags, current passports, visas); the documents ladder already knows
the expiry, this just points it at a trip.

### 14. Full duty/rest ledger — show/release times (L, top) [REG-SENSITIVE]
The completion of #10: add `duty_show_at` / `duty_release_at` (timestamptz, UTC) to
`pilot.trip_days` (schema change, owner-gated) so duty periods and rest windows become
computable, enabling 135.267(d) rest math and the assigned-rest checks. Append-only edit
history on these rows (product-translation §3 auditability — duty records are evidence in
FAA inspections and disputes). Ships behind the same counsel-gate family as G1;
per-24h-window math is clock-exact on timestamps, never dates. **Aviation reason**: [REG]
14 CFR 135.267(d) (rest), 135.263; deadhead/positioning legs still count toward
flight/duty limits (corpus §12). [CONV] the pilot has no access to any operator's duty
system and keeps this on paper or nowhere (corpus §13 — pilot-owned duty record across all
clients is a named gap; getfileflo.com blog, read 2026-08-11, on 135.267 records
inspectors request). L-sized because correctness here is the product's credibility; do not
compress it into this session unless a builder is free late.

### 15. Deposit requests on estimates (M, mid)
WAVE-PARITY gap #4, unchanged: estimates shipped this session; deposit requests need new
schema (owner-gated migration) plus a share-link pay flow inside the existing
Connect-Standard posture (pilot's own Stripe, no platform custody). **Aviation reason**:
[CONV] deposits/prepay for new or shaky clients are established pilot practice (corpus
§10) — and a natural counterpart to the cancellation-fee terms in #8. Ranked here because
the schema gate and payment-flow testing make it slower per unit value than everything
above it.

### 16. Rate-card completeness: premiums and standby (S, mid)
Extend `pilot.client_rates`/day-type resolution with the pay dimensions written agreements
actually carry: pop-up premium, international premium, standby/hold day rate, instructing
premium — all snapshotted at capture like existing rates. Small migration (owner-gated) or
representable as additional tenant-defined day types today, in which case [NO-SCHEMA] via
seed + docs. **Aviation reason**: [CONV] corpus §4 lists exactly these structures (pop-up
premium, international premium, standby at reduced rate, travel day at half-to-full);
travel-day fractions vary by contract so they must be per-client terms, never global
defaults (airlinepilotforums.com deadhead-pay threads show 50/75/100% variance, read
2026-08-11 — airline data, [ASSUME] directionally similar variance in bizav contract
terms, verify with users).

### 17. Trip-sheet quick capture (M/L, top) [NO-SCHEMA]
A paste-in parser: pilot pastes the operator's emailed trip sheet text; V1 extracts dates,
legs (ICAO pairs, ETD/ETA), tail, and drafts the trip for confirmation — parser-assisted,
never silent-write (the logbook draft-confirm boundary is the precedent). Start with
paste-parse (no email ingestion infrastructure). **Aviation reason**: [CONV] trip data
arrives as emailed trip sheets from operator ops systems; the pragmatic v1 integration
path is ICS + email-parsing, not partner APIs (product-translation §5). Every field parsed
is one not retyped — the compound "same trip entered five times" pain (corpus §13).

### 18. Multi-currency invoicing (M, top)
WAVE-PARITY gap 4.6: currency on invoice + lines, pilot-entered FX note, USD reporting
unchanged. **Aviation reason**: [CONV] US pilots bill US operators in USD even on
international trips (corpus-consistent, WAVE-PARITY 4.6), so this is top-tier polish for
the minority invoicing foreign operators/owners directly. Real but narrow; schema-gated.

### 19. Bookkeeper seat UI (M, top) [NO-SCHEMA]
WAVE-PARITY gap 4.5: `pilot.account_members` and RLS have been ready since the first
migration; the build is invite flow + role-scoped UI. Blocked on the owner's per-seat plan
decision (G10) — queue it, don't build it first. **Aviation reason**: [CONV] the persona's
CPA/bookkeeper is the second user of this data (corpus §10 — quarterly estimates, S-corp
payroll conversations; wcginc.com pilot-CPA practice pages, read 2026-08-11, show a real
professional segment serving these clients). Read-only accountant access is how the
year-end packet stops being an export.

### 20. Tail-based leg autofill (L, top)
ADS-B-derived leg detection by tail number (FlightAware AeroAPI-class source) pre-filling
`trip_legs` OOOI times for confirmation. **Aviation reason**: [CONV] auto leg detection is
the logbook-app table-stakes bar V1 will eventually be judged against
(product-translation §5). Ranked last: external dependency, ongoing API cost, and conflicts
with the low-dependency posture — a deliberate later bet, not a this-session build.

---

## Explicitly not proposed
- **Rate benchmarking / "market day rates" content**: published rate tables exist
  (theprofessionalpilotnetwork.com 2026 day-rates page, crewblast.co pay guide, both read
  2026-08-11) but figures are volatile and self-reported; baking them into product UI
  invites fabricated-statistic risk. If ever done, it is live-fetched editorial content
  with source + date, never a feature default.
- **Open crew marketplace**: discovery is relationship-shaped (corpus §2); #11's
  trusted-feed approach fits reality and the session budget; a marketplace does not.
- **1099/W-2 classification guidance**: support both worlds, opine on neither (corpus §9);
  any copy touching it carries the counsel/CPA flag.
- **FET on pilot invoices**: out — FET attaches to the operator's charter sale, not the
  pilot's services invoice (corpus §4); noted so no builder "helpfully" adds it.

## Sources (all read 2026-08-11)
- 14 CFR 135.267, eCFR current text: https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-135/subpart-F/section-135.267
- 14 CFR Part 135 Subpart F overview: https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-135/subpart-F
- FileFlo, "Part 135 Flight Time Limits, Duty & Rest: §135.267 Rules and the Records That Prove Compliance": https://www.getfileflo.com/blog/part-135-flight-time-duty-rest-records
- Flightinfo forum, "135.267 How does your operator view it???": https://flightinfo.com/threads/135-267-how-does-your-operator-view-it.39304/
- LogTen feature pages (duty/rest limits, Time Loupe, FAR 117/EASA): https://logten.com/why-logten/
- ForeFlight Logbook — jet currency (61.58) and custom currencies: https://foreflight.com/enhancements/jet-currency-in-logbook , https://foreflight.com/enhancements/logbook-custom-currencies
- CrewBlast, "How Do Contract Pilots Get Paid in Business Aviation": https://www.crewblast.co/blog/how-do-contract-pilots-get-paid-in-business-aviation-daily-rates-expenses-and-pay-structure-explained
- CrewBlast marketplace/vendor claims: https://www.crewblast.co/
- Flying Company blog, "Pilot History Forms & FAA Verification": https://blog.flyingcompany.com/pilot-history-forms-faa-verification/
- FlightSafety scheduling/cancellation policy: https://www.flightsafety.com/scheduling-policy/ ; 61.58 course: https://www.flightsafety.com/61-58-course-details/
- Uncle Kam, "Pilot & Flight Crew Tax Playbook 2026": https://unclekam.com/taxprofessional/playbooks/pilot-flight-crew/
- Aviation CPA firm flight-crew per-diem practice: https://www.aviationcpafirm.com/flight-crew-tax-preparation.htm
- WCG CPAs pilot practice: https://wcginc.com/industries-served/pilots/
- Pilots of America, 1099 contract pilot thread: https://www.pilotsofamerica.com/community/threads/ok-so-for-you-1099-contract-guys.83296/
- ProPilotWorld contract pilot pay archive: https://forums.propilotworld.com/archive/index.php/f-183.html
- The Professional Pilot Network, 2026 day-rates page (volatile; editorial use only): https://www.theprofessionalpilotnetwork.com/contract-pilot-aircraft-day-rates
- Airline Pilot Forums deadhead-pay threads (variance evidence): https://www.airlinepilotforums.com/major/41692-what-deadhead-pay-your-airline.html
