# Wave ↔ v1 feature parity matrix

**Why this document exists.** The owner's standing instruction is that v1 must carry "most
to all" of Wave's functionality *for its user* — an independent contract pilot. This is the
evidence, feature by feature. Wave's side was read live from waveapps.com and
support.waveapps.com on **2026-08-11** (every claim carries its URL; pricing cross-checks
against `docs/PRICING.md`'s independent 2026-08-10 read, and the two agree). v1's side was
verified against **code on branch `claude/wave-parity` at commit `abcded3`** — every MATCHED
row names the route, action, library, or migration that proves it. `README.md`'s status
section was not consulted; it has been stale before (`docs/LAUNCH-GATES.md` G10 records a
gate row going stale in the other direction).

**The positioning this matrix is scored against.** v1 replaces Wave *for a contract pilot*
(`docs/PRICING.md` §2: it replaces the QuickBooks/Wave line in the pilot's stack). The owner's
locked decisions mean it must **never** build a chart of accounts, a double-entry ledger,
payroll, inventory, or bank reconciliation — those rows below are recorded as **deliberately
excluded**, not as gaps. One of them costs nothing: Wave's own site claims no inventory
feature either (it is a service-business product), so that exclusion has no Wave counterpart
to lose.

## Statuses

| Status | Meaning |
|---|---|
| **MATCHED** | v1 has it; the evidence column names the code. |
| **MATCHED-DIFFERENTLY** | v1 does the same job another way; the row says how and what the delta is. |
| **IN PROGRESS THIS SESSION** | Being built right now by other agents on this branch (account-wide data export; per-client statements). |
| **GAP** | Wave has it, v1 does not, and no locked decision excludes it. |
| **DELIBERATELY EXCLUDED** | Owner lock (PLAN.md / launch gates) or counsel-gated, with the one-line reason. |

**Totals across the 37 scored rows: 9 MATCHED · 10 MATCHED-DIFFERENTLY · 2 IN PROGRESS THIS
SESSION · 10 GAP · 6 DELIBERATELY EXCLUDED.** (Two cross-reference rows — 2.4 and 6.4 —
score with the gap they belong to rather than doubling it.) The full gap list, ordered by
how much it matters to this persona, is in §8.

---

## 1. Invoicing and estimates

| # | Wave feature (source, read 2026-08-11) | Status | v1 evidence / how it differs |
|---|---|---|---|
| 1.1 | Create and send unlimited invoices; email to customer; pay-enabled online copy (waveapps.com/invoicing, /pricing) | **MATCHED** | Draft from a trip or from scratch: `app/(app)/invoices/new/draft-form.tsx`, `app/(app)/invoices/actions.ts` (`createInvoiceDraft`, `sendInvoice`). PDF: `app/(app)/invoices/[id]/pdf/route.tsx` + `lib/invoice-document.tsx`. Email with PDF attached: `lib/email/send.ts` (Resend REST; the product's only mail path). Tokenized public copy for the client: `app/invoice/[token]/page.tsx` (migration `20260809060000_invoice_public_share.sql`). Schema: `20260805090000_phase5_invoices.sql`. No per-invoice cap anywhere. *Operational caveat, not a code gap:* sending from the current deployment is blocked until the Resend sending domain is DNS-verified (`docs/LAUNCH-GATES.md` G5); the UI degrades honestly ("Emailing isn't set up on this account yet" — `app/(app)/invoices/[id]/status-actions.tsx`). |
| 1.2 | Invoice customization: templates, drag-and-drop editing, logo, brand colors, remove-footer (Pro) (waveapps.com/invoicing, /pricing) | **MATCHED-DIFFERENTLY** | Pilot's logo and business identity render on the PDF: `app/(app)/settings/logo-panel.tsx`, `lib/invoice-document.tsx` (logo fetched as bytes, invoice still renders if it's unavailable). One professional layout, no template gallery or color picker — a deliberate scope choice, and per-tenant Radix theming is planned but unbuilt (`docs/PLAN.md` Phase 9 Layers 2–4). |
| 1.3 | Recurring invoices (waveapps.com/invoicing, /pricing) | **MATCHED-DIFFERENTLY** | Monthly/quarterly schedules with calendar-month arithmetic generate drafts into a due queue the pilot reviews and sends: `app/(app)/invoices/recurring/` (`schedule-form.tsx`, `due-queue.tsx`, `actions.ts`), migration `20260809030000_recurring_invoices.sql`. Wave auto-sends; v1 never sends money paperwork without a human confirming — the same draft-confirm boundary the logbook uses. |
| 1.4 | Automatic late-payment reminders (Pro) (waveapps.com/invoicing, /pricing: "Automate late payment reminders") | **MATCHED-DIFFERENTLY** | One-click emailed reminder on an overdue invoice: `sendInvoiceReminder` in `app/(app)/invoices/actions.ts`, `buildReminderMessage` in `lib/email/invoice-message.ts`; overdue is derived (never a stored flag) and past-due invoices surface in Overview's attention queue (`app/(app)/overview/page.tsx`). Delta: v1 has no scheduler — the pilot clicks; Wave sends on a schedule. |
| 1.5 | Estimates: create, send, convert to invoice; request deposits through estimates (waveapps.com/invoicing, /pricing: "unlimited estimates") | **GAP** (backend shipped, no UI) | The schema, per-account numbering, conversion guard, and a verify script all exist — `20260810060000_phase10_estimates.sql`, `20260810160000_estimate_convert_tenancy.sql`, `scripts/estimates-verify.mjs` — but **no route or action under `app/` reads or writes `pilot.estimates`**. A pilot cannot create a quote today, so deposits-via-estimates doesn't exist either. This is the cheapest large gap to close: the hard part is done and reviewed. |
| 1.6 | Customer statements: outstanding-invoices and account-activity views (support.waveapps.com "Create and send customer statements", read 2026-08-11) | **IN PROGRESS THIS SESSION** | Per-client statements are being built by another agent on this branch right now. Nothing in the tree yet (no statement code under `app/` as of `abcded3`). |
| 1.7 | Invoice status tracking + instant notifications: "Know when an invoice is viewed, becomes due, or gets paid" (waveapps.com/invoicing) | **GAP** (partial) | v1 tracks the lifecycle — `draft/sent/partial/paid/void` plus derived overdue (`20260805090000`), due/past-due surfaced on Overview — but the public share link records no view (`20260809060000` has no viewed column), and payment against a Stripe link is recorded by the pilot, not pushed as a notification (see 2.4). "Becomes due": matched. "Viewed"/"gets paid" alerts: gap. |
| 1.8 | Reusable message templates (Pro) (waveapps.com/pricing) | **GAP** (minor) | Invoice and reminder email copy is fixed, built per send in `lib/email/invoice-message.ts`; the send dialog (`status-actions.tsx`) offers no custom message and nothing stores templates. |
| 1.9 | Attach documents to invoices/estimates (Pro) (waveapps.com/pricing) | **GAP** (minor) | Receipts attach to *expenses* (`app/(app)/expenses/[id]/receipt-link.tsx`) and rebilled expenses become invoice lines, but the receipt images are not carried onto the invoice PDF or share page. A pilot rebilling a hotel bill cannot hand the client the receipt in the same document — a real norm in day-rate invoicing (reimbursables "with receipts attached"). |

## 2. Payments

| # | Wave feature (read 2026-08-11) | Status | v1 evidence / how it differs |
|---|---|---|---|
| 2.1 | Card payments: Visa/MC/Discover 2.9% + $0.60, Amex 3.4% + $0.60 (Pro: +$0 fee first 10/mo); "Pay now" button on invoices; PCI-DSS L1 (waveapps.com/payments, /pricing) | **MATCHED-DIFFERENTLY** | Stripe Connect **Standard** payment links per invoice: `app/(app)/invoices/payment-link-actions.ts`, `app/api/stripe/connect/callback/route.ts`, migrations `20260809040000_connect_payments.sql`, `20260810010000_connect_link_hardening.sql`, `20260811010000_invoice_public_link_amount.sql`. Structural difference: **the pilot is the merchant of record and v1 takes no application fee** (PLAN.md decision #8, asserted by `scripts/connect-verify.mjs`) — the pilot pays Stripe's published rates directly (2.9% + 30¢ domestic cards per stripe.com/pricing, read 2026-08-10 in `docs/PRICING.md`). Wallets (Apple Pay etc.) are whatever the pilot's Stripe checkout offers — not a v1 code claim. |
| 2.2 | Bank payments (ACH): 1% per transaction, $1.00 minimum (waveapps.com/payments) | **MATCHED-DIFFERENTLY** | Same Stripe links: ACH direct debit at Stripe's 0.8% **capped at $5.00** — a straight win over Wave's uncapped 1% on any four-figure day-rate invoice (`docs/PRICING.md` §2 does this arithmetic). Checks and manually-received ACH — how most operators actually pay (NET 15/30, check/ACH dominant) — are first-class via 2.3. |
| 2.3 | Record payments manually; partial payments | **MATCHED** | `app/(app)/invoices/[id]/payment-panel.tsx` (`recordPayment`, `correctPayment` in `invoices/actions.ts`), `partial` status, and audit-honest corrections that never delete a money record (`20260810120000_payment_reversals.sql`, `20260810170000_payment_reversal_partial_resync.sql`). |
| 2.4 | Payment auto-sync to books; payout in 1–2 business days (waveapps.com/payments) | **GAP** (partial, deliberate mechanism) | Payouts are Stripe's and land in the pilot's own account (not comparable — v1 never touches funds). But a payment made through a link is **not** auto-recorded on the invoice: the pilot confirms it in their own Stripe dashboard and records it (reasoning documented in `payment-panel.tsx` — Connect Standard means the platform doesn't own the pilot's payment events). Wave marks the invoice paid by itself. Counted inside 1.7's notification gap; listed here so the mechanism is on record. |
| 2.5 | Recurring billing: auto-charge a repeat customer's saved card (Pro) (waveapps.com/invoicing, /payments) | **GAP** | v1 stores no client payment methods anywhere and its recurring schedules stop at a draft (1.3). Auto-charging would live in the pilot's Stripe account; nothing wires it. |

## 3. Expenses, receipts, and banking

| # | Wave feature (read 2026-08-11) | Status | v1 evidence / how it differs |
|---|---|---|---|
| 3.1 | Receipt capture with OCR — paid add-on: $11/mo Starter, $8/mo Pro (waveapps.com/pricing, /receipts: "smart OCR technology extracts and organizes the data", unlimited, bulk 10) | **MATCHED** (and included in the base price) | `app/(app)/expenses/receipt-scan.tsx`; OCR engine `lib/receipt-ocr/engine.ts` — runs **in the pilot's browser**, so the receipt image is never a precondition of a server reading it (a privacy claim Wave cannot make); field extraction `lib/receipt-ocr/extract.ts`; automatic trip suggestion `lib/receipt-ocr/match-trip.ts`; private tenant-scoped storage `20260805210000_phase4_receipts_storage.sql`; `scripts/receipt-ocr-verify.mjs`. |
| 3.2 | Expense tracking and categorization (waveapps.com/pricing, /receipts) | **MATCHED** | `app/(app)/expenses/` (list, detail, new, unassigned queue); pilot-defined categories seeded with the aviation-correct set (`20260810070000_pilot_expense_categories.sql`); and a distinction Wave doesn't have: `treatment ('rebill'|'deduct'|'unassigned')` routes every expense to the client's invoice or the pilot's Schedule C, with the unassigned queue as a first-class surface (`20260805070000_phase3_clients_trips_expenses.sql`). |
| 3.3 | Bank connections: "Auto-import bank transactions", unlimited bank/credit-card connections (Pro) (waveapps.com/pricing, /accounting) | **MATCHED-DIFFERENTLY** | v1 imports **statements the pilot downloads** — CSV with a column mapper and OFX/QFX: `lib/bank-import/` (`csv.ts`, `ofx.ts`, `apply-mapping.ts`, `fingerprint.ts`), `app/(app)/expenses/import/`, review surface `app/(app)/expenses/transactions/`, migrations `20260809070000_bank_transactions.sql`, `20260810040000_bank_confirm_atomic.sql`. Delta: no live feeds — no Plaid-style connection, no automatic pull. The pilot uploads a file; Wave syncs nightly. |
| 3.4 | "Auto-merge and categorize bank transactions" (Pro) (waveapps.com/pricing) | **MATCHED-DIFFERENTLY** | Duplicate-safe re-import via row fingerprints (`lib/bank-import/fingerprint.ts`), remembered per-payee categorization (`20260810140000_bank_transaction_categories.sql`), and a confirm-to-expense flow (`app/(app)/expenses/transactions/transaction-row.tsx`). Delta: v1 proposes, the pilot confirms — nothing auto-posts into the books. |
| 3.5 | Bills / accounts payable: "unlimited … bills" (waveapps.com/pricing) | **MATCHED-DIFFERENTLY** | A one-pilot business's payables are its expenses; v1 models them there (3.2) with rebill/deduct doing the work Wave's bill coding does. Delta: no bill object with a vendor and a due date, so nothing tracks "this maintenance invoice is due Friday." Acceptable for the persona; recorded honestly. |

## 4. Accounting core

| # | Wave feature (read 2026-08-11) | Status | Reason / evidence |
|---|---|---|---|
| 4.1 | "Real, double-entry accounting software"; unlimited bookkeeping records (waveapps.com/accounting, /pricing) | **DELIBERATELY EXCLUDED** (owner lock) | v1 is cash-basis records for one Schedule C business; a general ledger would make it a worse QuickBooks instead of the only trip-native pilot tool (`docs/PRICING.md` §3: a $19-accounting comparison "we lose"). The trip is the parent record, not a journal entry (`docs/PLAN.md` data model). |
| 4.2 | Chart of accounts (support.waveapps.com, exported via Wave Connect) | **DELIBERATELY EXCLUDED** (owner lock) | A contract pilot's categories are expense categories and day types, and v1 makes *those* tenant-editable (`20260810070000`, `pilot.day_types`); account coding is the bookkeeping abstraction this product exists to spare them. |
| 4.3 | Bank reconciliation (implied by feeds + double-entry; waveapps.com/accounting) | **DELIBERATELY EXCLUDED** (owner lock) | Reconciliation exists to true a ledger against the bank; with no ledger there is nothing to reconcile — statement import (3.3) plus the confirm queue does the pilot-relevant half (nothing missed, nothing doubled). |
| 4.4 | Inventory | *(no row)* | Wave's site claims no inventory feature — the owner's exclusion has no Wave counterpart, so it costs no parity. |
| 4.5 | Multi-user / accountant and bookkeeper access (Pro: "Add users to your account") (waveapps.com/pricing, /accounting) | **GAP** (owner-deferred; schema ready) | `pilot.account_members` with roles `owner/member/bookkeeper` shipped in the first migration (`20260802190437_pilot_schema_tenancy.sql`) and RLS is built on it, but there is no invite UI and the per-seat business plan is deferred on purpose (`docs/LAUNCH-GATES.md` G10, no `STRIPE_PRICE_ID_BUSINESS_SEAT`). Until that lands, a pilot cannot give their CPA a login — the year-end export (§6) is the workaround. |
| 4.6 | Multi-currency: foreign-currency accounts with revaluation (support.waveapps.com "Download your data" / multi-currency articles, read 2026-08-11) | **GAP** | Every amount in v1 is integer **USD cents**; no table carries a currency column (verified across `supabase/migrations/`). Low priority for the persona — US contract pilots invoice US operators in USD, including for international trips — but it is a real absence for a pilot billing a foreign operator. |
| 4.7 | Sales tax on invoices (Wave: tax fields on invoices/estimates; waveapps.com/invoicing "tax calculations handled automatically") | **MATCHED** | Per-line `tax_rate_bps` (0–25%) on invoices, estimates schema, and recurring schedules (`20260805090000`, `20260810060000`, `20260809030000`) — per-line because a day rate and a per-diem reimbursement can answer taxability differently. The migration header states the aviation-critical rule: **never Federal Excise Tax** — FET attaches to the operator's sale of charter, not the pilot's services invoice. |
| 4.8 | Sales tax **report** (support.waveapps.com "View and understand your sales tax report", read 2026-08-11) | **GAP** (minor) | Nothing under `app/(app)/reports/` sums tax collected (no reference to `tax_rate_bps` in any report query). Most states don't tax a pilot's professional services — but a pilot in a state that does, and who uses 4.7, has no year-end tax-collected figure. Small, and it follows 4.7's existing data. |

## 5. Payroll

| # | Wave feature (read 2026-08-11) | Status | Reason |
|---|---|---|---|
| 5.1 | Payroll add-on: $40 USD base + $6/employee + $6/contractor paid; unlimited direct deposit; automatic state/IRS tax filing; W-2 and 1099 generation; employee self-service portal; leave tracking (waveapps.com/payroll, /pricing) | **DELIBERATELY EXCLUDED** (owner lock) | v1's user sits on the **other side** of payroll: a 1099 vendor who *receives* forms, not an employer who issues them. Building payroll would also wade into the worker-classification territory the product must stay out of (`docs/LAUNCH-GATES.md` G6). The mirror-image feature v1 does have: W-9 status per client (`pilot.clients.w9_status`) and reconciliation of the 1099-NECs the pilot's clients issue (`20260807080000_client_tax_forms.sql`, `/reports/year-end`). |
| 5.2 | Wave Advisors: human bookkeeping service from $149/mo (waveapps.com/pricing) | **DELIBERATELY EXCLUDED** | A staffed service line, not software; out of scope for a self-serve SaaS with no manual step (PLAN.md decision #7). The `bookkeeper` seat role (4.5) is the structural answer once seats ship. |

## 6. Reports

| # | Wave feature (read 2026-08-11) | Status | v1 evidence / how it differs |
|---|---|---|---|
| 6.1 | Profit & loss / income statement (waveapps.com/accounting "robust small business accounting reports"; support.waveapps.com Reports overview) | **MATCHED** (cash-basis) | `app/(app)/reports/profit-loss/` — income and expenses by year, quarter, or month with prior-period comparison, CSV export at `reports/profit-loss/export/route.ts`. Cash-basis by design, which is how this persona files. |
| 6.2 | Cash flow report: gross inflow, outflow, net change (waveapps.com/accounting) | **MATCHED-DIFFERENTLY** | On a cash-basis, ledger-free product the P&L *is* the operating cash view, and `/reports/quarterly` gives period cash profit for IRS estimated-tax planning (`app/(app)/reports/quarterly/`, disclaimer above every figure per G7). A formal statement of cash flows needs the excluded ledger (4.1), so the delta follows the lock rather than being an oversight. |
| 6.3 | Balance sheet (waveapps.com/accounting) | **DELIBERATELY EXCLUDED** (follows 4.1) | A balance sheet is a ledger artifact; no double-entry, no balance sheet. The pilot-relevant assets (unpaid invoices, unbilled work) are on the Overview KPIs instead. |
| 6.4 | Sales tax report | **GAP** — see 4.8. | |
| 6.5 | Dashboard: "Manage cash flow and customers in one dashboard" (waveapps.com/pricing) | **MATCHED** | `app/(app)/overview/page.tsx`: KPIs (Unbilled work / Awaiting payment / Paid this year / Deductible expenses), a needs-attention queue (past-due invoices, document and operator-qualification expiries, unassigned receipts, outstanding W-9s), and a first-run path. |
| 6.6 | Tax-time readiness ("Everything is organized and ready for tax prep", waveapps.com/receipts) | **MATCHED** (v1 goes further) | `/reports/year-end`: cash-basis income by client, deductible vs rebilled expenses, an explicit unassigned-receipts figure, and 1099-NEC reconciliation (`app/(app)/reports/year-end/`, export route included) — a report Wave doesn't have as a single artifact. Counsel-gated copy rules apply (G6/G7). |

## 7. Data, platform, and pricing

| # | Wave feature (read 2026-08-11) | Status | v1 evidence / how it differs |
|---|---|---|---|
| 7.1 | Full account data export: four XLS/CSV files from Business settings (support.waveapps.com "Download your account data") | **IN PROGRESS THIS SESSION** | Account-wide export is being built by another agent on this branch right now (nothing in the tree at `abcded3`). Already shipped and counted separately: logbook CSV export (`app/(app)/logbook/export/route.ts`, migration `20260807050000`) and all three report exports (7.2). `docs/LAUNCH-GATES.md` G3 already names the absence of a full export as a privacy-policy fact to fix — this closes it. |
| 7.2 | Export any report to CSV/PDF (support.waveapps.com "Export a report") | **MATCHED** | CSV export routes on all three reports: `reports/profit-loss/export/route.ts`, `reports/quarterly/export/route.ts`, `reports/year-end/export/route.ts`; invoices export as PDF (1.1). |
| 7.3 | Wave Connect Google Sheets add-on; third-party integrations (support.waveapps.com; waveapps.com/pricing) | **GAP** | v1 has no external integrations and no API surface beyond Stripe. Consistent with the eleven-runtime-dependency posture, but a real Wave feature v1 lacks. |
| 7.4 | Bulk data import: bank statements, customer lists, products (support.waveapps.com) | **MATCHED-DIFFERENTLY** | v1 imports the two files this persona actually has: bank statements (CSV + OFX, 3.3) and **logbooks** — ForeFlight, LogTen Pro, and a generic column mapper (`lib/logbook-import/`, `app/(app)/logbook/import/`, verified by `scripts/logbook-verify.mjs` and `scripts/foreflight-import-verify.mjs`). No client-list import; a contract pilot's client list is a dozen rows, typed once. |
| 7.5 | Native mobile apps (iOS/Android): invoice on-the-go, receipt capture (waveapps.com/invoicing, /pricing, /receipts) | **GAP** | v1 is a responsive web app only — no native app, and no PWA manifest under `app/` or `public/`. The receipt scanner (3.1) works from a phone browser's camera, which softens but does not close this: receipt capture at the FBO is the single most phone-shaped moment in the persona's day. |
| 7.6 | Pricing: Starter $0; Pro $19/mo or $190/yr (promo $9.50 × 3 mo); Receipts $11/$8 add-on; Payroll and Advisors add-ons (waveapps.com/pricing, read 2026-08-11; identical to the 2026-08-10 read in `docs/PRICING.md`) | *(context row, not scored)* | v1: **$29/mo solo configured today**, card-required 7-day trial (`docs/BILLING.md`); $39 proposed and unsigned (`docs/PRICING.md`, gate G2). No free tier — an architecture decision, not an oversight: the Stripe webhook is the only provisioning path (PLAN.md #6/#7, PRICING.md Alternative C). v1 charges more than Wave Pro and must justify it on the aviation surface (§9), not on accounting parity. |

---

## 8. The gap list, ordered for the build decision

Every GAP row from above, with the cost/benefit signal the matrix supports. None is excluded
by a lock; all are owner-eligible work.

1. **Estimates/quotes UI** (1.5, includes deposit requests) — *backend is fully shipped and
   reviewed; only routes/forms are missing.* The highest-leverage remaining item: quotes are
   where day-rate negotiations start, and the migration's own header calls it "the clearest
   remaining gap against the products this one is measured against."
2. **Invoice viewed/paid notifications** (1.7, 2.4) — share-link view tracking is a column
   and a stamp; paid-notification is harder under Connect Standard (the platform doesn't own
   the pilot's payment events) and the manual-record mechanism was chosen deliberately.
3. **Multi-user / bookkeeper seat UI** (4.5) — schema and RLS ready since the first
   migration; blocked on the owner's deferred per-seat plan (G10), so this is an owner
   decision before it is engineering.
4. **Sales tax report** (4.8/6.4) — small; sums data that already exists per line.
5. **Attach receipts to invoices** (1.9) — small; strong fit with rebilled-expense norms.
6. **Reusable message templates** (1.8) — small.
7. **Saved-card recurring auto-charge** (2.5) — meaningful build; would live entirely in the
   pilot's Stripe account to preserve decision #8 (no funds custody, no fee).
8. **Native mobile apps / PWA** (7.5) — a PWA manifest + install prompt is cheap and gets
   most of the receipt-capture value; native apps are a product-line decision, not a parity
   patch.
9. **Multi-currency** (4.6) — low for the persona (US pilots bill US operators in USD,
   including on international trips); real for a pilot invoicing a foreign operator.
10. **Google Sheets / integrations** (7.3) — not persona-critical; conflicts with the
    dependency posture; park.

Deltas inside MATCHED-DIFFERENTLY rows, for completeness: no live bank feeds — statement
upload instead (3.3), and closing that is the largest engineering item on this page (Plaid
or similar, ongoing cost, credential-custody questions that cut against the product's trust
story); no scheduled (vs one-click) reminders (1.4); recurring invoices stop at a confirmed
draft (1.3); no auto-posting of bank transactions (3.4); no vendor-bill due dates (3.5); no
formal cash-flow statement (6.2, follows the ledger exclusion).

## 9. What v1 has that Wave does not

Parity cuts both ways. Wave's site claims none of the following; each is shipped code:

- **Trip-native billing** — the trip is the parent record: legs, day-by-day grid of
  tenant-defined day types (flight/travel/standby/off), rates snapshotted at capture,
  per-client rate cards, per-diem with away-day logic, minimum-day guarantees (per-trip or
  per-month), cancellation timing records (`app/(app)/trips/`, `pilot.day_types`,
  `pilot.trip_days`, `pilot.client_rates`, `pilot.guarantee_periods` — migrations
  `20260807000000`–`20260807070000`). An invoice drafts *from the trip*; nothing is typed
  twice.
- **A pilot logbook** — manual entry, trip-derived entries behind a draft-confirm boundary
  (never a silent write; it is a legal record), ForeFlight/LogTen/generic CSV import with
  fingerprint dedup, CSV export, aircraft fleet with tailwheel/gear and simulator device
  class, FAR-correct fields (night takeoffs, full-stop landings, approach conditions,
  61.57(c)(1)(iii) intercept/track) (`app/(app)/logbook/`, migrations `20260805220000`
  through `20260810150000`).
- **FAA currency engine, dark** — 61.57/61.56/61.23 computation implemented behind
  `CURRENCY_ENGINE_ENABLED`, default off, counsel- and owner-gated (`lib/currency/`,
  `docs/CURRENCY-SPEC.md`, G1). Credential-gated by design — recorded here as capability,
  claimed nowhere publicly.
- **Per-operator Part 135 qualification tracking** — 135.293 competency, 135.297 IPC (with
  rotation), 135.299 line check per client, calendar-month windows per 135.301, plus
  status-only Part 120 drug-program and PRD rows (`app/(app)/clients/[id]/operator-qualifications-panel.tsx`,
  migrations `20260807060000`, `20260807110000`, `20260811020000`).
- **Documents with expiry ladder and a credential packet** — medical, flight review,
  passport, certificates, W-9, each with expiry surfaced on Overview; a tokenized share link
  hands a new operator the vendor packet in one URL (`app/(app)/documents/`,
  `app/packet/[token]/`, `20260810100000_credential_packet_share.sql`).
- **W-9 / 1099-NEC posture** — W-9 status per client on the attention queue; 1099-NEC
  reconciliation against the pilot's own cash-basis records (`pilot.clients.w9_status`,
  `20260807080000`).
- **Mileage** — IRS standard-mileage tracking with pilot-entered per-year rates, never a
  hardcoded figure (`app/(app)/expenses/mileage/`, `lib/mileage.ts`, `20260809020000`).
- **Quarterly estimated-tax planner and the year-end accountant packet** (6.2, 6.6).
- **The payments posture itself** — pilot as merchant of record, zero platform fee, no funds
  custody (2.1): a trust position Wave, as the processor, structurally cannot take.

## 10. Verdict against the standing instruction

Counting the scored rows: **19 of 37 are MATCHED or MATCHED-DIFFERENTLY, 2 more land this
session, 6 are the owner's own exclusions, and 10 are gaps — of which one (estimates UI) is
the only gap a Wave-switching pilot would call core invoicing functionality, and its backend
is already shipped.** Everything else in the gap column is either automation polish (viewed
tracking, templates, auto-charge), owner-deferred (seats), or a deliberate trade documented
where it was made (live feeds, native apps). For the job a contract pilot hires Wave to do —
invoice, get paid, track expenses and receipts, be ready for taxes — v1 covers most of it
today, adds a trip/logbook/compliance layer Wave has nothing against, and the honest
remainder is the ten-item list in §8.
