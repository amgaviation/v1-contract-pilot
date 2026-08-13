# V1 Ranked Roadmap — Next Build Iterations
*Synthesized 2026-08-13 from 4 competitor research tracks (Wave/FreshBooks, QB/Zoho, Square/Bonsai/HoneyBook/Harvest, pilot-tools cluster). All items pass the filters: buildable in Next.js + Supabase + Stripe by coding agents; no counsel-gated content; funds never touch the platform; no marketplace/operator-scheduling; currency & duty-limit computing stays dark.*

---

## Top 12 (ranked)

### 1. Reimbursables Engine: unbilled trip expenses → invoice, plus per-trip receipts packet
- **Build:** Add `billable` + `trip_id` + `invoiced_line_id` columns to `expenses`. In the trip→invoice draft flow, auto-pull all unbilled expenses for that trip as invoice lines with receipt images referenced. New "Reimbursables Packet" PDF renderer (summary page + itemized-by-category detail + appended receipt images/folios) generated alongside the invoice PDF, attachable to the invoice share link. New query surface: unbilled reimbursables per client.
- **Proves demand:** CrewRoo (its Pro tier headline), FreshBooks billable-expense rebilling ("I stopped eating hotel costs"), Harvest one-step invoice.
- **Why #1:** Reimbursables are half a contract pilot's invoice; operator accounting departments reject claims without receipts in an acceptable shape. Deepest aviation-specific pain, all data already in V1.
- **Effort:** Medium

### 2. Payment Reminders + Automatic Late Fees (view-aware)
- **Build:** `invoice_reminder_policies` table (per-client defaults, per-invoice override): fixed checkbox cadence 3/7/14 days before + on-due + 3/7/14 after, options auto-disable when past. pg_cron/scheduled Edge Function scans due invoices and sends via existing invoice-email infra. Message templates with merge fields (client, amount, days overdue) in a `message_templates` table. Smart suppression/escalation using existing share-link view tracking ("viewed 3x, unpaid" vs "never opened"). Late fee config per client (flat or %/month) auto-applied as an invoice line on overdue.
- **Proves demand:** Wave (top "get-paid-faster" lever), Zoho Invoice, Square, FreshBooks late fees. All four research tracks flagged it.
- **Why #2:** Chasing payment is a documented top-three pilot pain (NET 15/30 invoiced, 60–90 day reality); cheapest possible attack; the view-tracking integration is a differentiator no competitor has.
- **Effort:** Small

### 3. Unbilled-Money Dashboard ("money left on the table")
- **Build:** Home-screen lead module: "6 unbilled trip days and $840 in unbilled reimbursables across 3 clients," one tap → draft invoices. Pure read queries over existing trips/day-grid/expenses; add a Postgres view `unbilled_by_client`. Pair with YTD days-flown/day-rate stats V1 already computes.
- **Proves demand:** Harvest (its 4.6-star core loop), APDL's "never miss a cent" positioning.
- **Effort:** Small

### 4. Tail Numbers as First-Class Objects
- **Build:** `aircraft` table (tail_number, type designator, marketing name, optional serial/notes), FK from trips, legs, expenses, and logbook entries; link aircraft ↔ clients (an operator manages N tails; the same tail can appear under 91 and 135 clients). Tail picker in trip/leg/expense forms; filter every list and report by tail. (FAA registry autofill is a later nice-to-have — keep manual entry now to avoid external dependencies.)
- **Proves demand:** CrewRoo (closest direct competitor organizes everything by operator + tail), LogTen Smart Groups ("all time in N123AB").
- **Why #4:** Foundational data model that items 1, 8, and 11 pivot on; pilots think in clients and tails, not "customers." Small schema change, large compounding payoff.
- **Effort:** Small

### 5. Per Diem + Travel-Day Line Types + Trip Settlement Audit
- **Build:** Add `per_diem_rate` and `travel_day_rate` to client rate records (snapshot onto the trip at confirmation). Invoice draft generator emits typed lines: flight-duty days × day rate, travel days × travel rate, per diem × eligible days (auto-counted RON nights from the day grid). New per-trip "expected vs invoiced vs paid" panel (computed from day grid + rates vs invoice lines vs payments).
- **Proves demand:** APDL per-diem/rig tracking ("the logbook as a money document"), Airline Pilot Central billing thread (standard invoice = day rate × trip days + travel days + per diem + reimbursables).
- **Effort:** Small

### 6. ACH-First Pay Page (cheap-rail steering)
- **Build:** Enable `us_bank_account` on V1's Stripe Connect payment intents; render bank payment as the primary button, card as fallback; show the pilot (not the payer) the fee delta per method on the invoice detail page. Config toggle per invoice for accepted methods.
- **Proves demand:** Wave 1% ACH rail (explicitly cited by users), Square ACH; aviation reality: operators pay five-figure invoices by check/ACH and refuse 3% card fees.
- **Effort:** Small

### 7. Deposits on Estimates/Invoices + Partial Payments
- **Build:** Deposit toggle in estimate/invoice creation (flat $ or %), separate balance due date; `invoice_payments` becomes many-per-invoice with `remaining_balance` computed; new statuses `partial`; the same share link accepts remainder payments; deposit from an accepted estimate carries into the resulting invoice. Ledger entries via existing double-entry system.
- **Proves demand:** Square deposit + milestone schedules, Wave estimate deposits, FreshBooks partial payments.
- **Why here:** Directly maps to industry convention — deposits/prepay for new or shaky clients, and cancellation-fee protection (50–100% inside 24–48h) that is uncollectable without money up front. Note: enforce via money mechanics only — do not ship contract-clause language (counsel-gated).
- **Effort:** Medium

### 8. Underwriter-Ready Pilot History Export
- **Build:** One-click PDF/CSV from existing logbook + documents data: total time, PIC/SIC, hours by category/class/type, time in type per tail/type, retract/turbine, last-12-months, plus recorded school/recurrent dates and medical exam date pulled from the documents module. Rendered as a clean "pilot history" form a client's insurer accepts. Pure arithmetic over logged hours and recorded dates — **no currency or legality verdicts, no "you are legal" output** (stays clear of the dark-gated engine). Add per-client/per-tail saved logbook filter views with live totals (LogTen Smart Groups pattern) as the interactive counterpart.
- **Proves demand:** MyFlightbook 8710/insurance reports (praised on Pilots of America), ForeFlight custom trackers marketed for "insurance requirements."
- **Why #8:** The strongest "finally, someone gets it" feature in the research — every new client's underwriter wants this form, and slow turnaround kills pop-up trips.
- **Effort:** Medium

### 9. Bank Import Triage Inbox (business/personal + inline rules)
- **Build:** On CSV/OFX import, transactions land in a triage queue with one-gesture business/personal decision and %-split for mixed-use; personal excluded from P&L. `categorization_rules` table (payee-contains, amount range, account → category + biz/personal); rule creation offered inline at the moment of manual categorization ("Always categorize FlightSafety as Training?"). Ship seeded suggestions for repetitive pilot vendors (ForeFlight, FSI/CAE, FBO fuel, hotels, rideshare).
- **Proves demand:** QB Solopreneur swipe triage (cited as why categorization actually happens), Zoho Books rules (70–80% manual-work reduction claims).
- **Effort:** Medium

### 10. Receipt ↔ Bank-Transaction Matching
- **Build:** Scoring heuristic (amount ± tolerance, date window, vendor string similarity) between existing receipt scans and imported bank transactions; quick-match suggestion cards with one-tap merge so the transaction carries its receipt as audit evidence. Runs as an Edge Function job post-import; surfaces in the triage inbox from item 9.
- **Proves demand:** QB + Zoho Books (widely praised in 2026 reviews as what makes tax season painless).
- **Why after 9:** Both halves already exist in V1 (receipt scan AND bank import) — this is connective tissue, and it feeds item 1's packets with matched evidence.
- **Effort:** Medium

### 11. Per-Trip and Per-Client P&L (trip as the reporting dimension)
- **Build:** Extend existing reports module: trip-level P&L (invoice revenue − trip-linked expenses, margin per day), client/operator-level rollup, filterable by tail (item 4). No generic tag UI — the trip IS the dimension. Marketing wedge: QBO force-killed Tags in May 2025; target migrating users.
- **Proves demand:** Zoho reporting tags, QBO tags (and the backlash at their sunset); forum-validated "templates can't roll up expenses by category for the year."
- **Effort:** Small

### 12. Operator Vendor Page (per-client rollup share link)
- **Build:** Extend existing share-link infra to a per-client magic-link page (no login): all open invoices + total outstanding + payment history + the existing document share packet (W-9, certificates, COI) in one persistent URL. View tracking per section. This is the "vendor page" a 135 operator's accounting department wants; kills the constant re-sending of the vendor packet.
- **Proves demand:** FreshBooks client portal (all plans), Zoho portal, HoneyBook branded portal; aviation-specific fit from the credential-packet re-sending pain.
- **Effort:** Medium (scoped as share-link extension, not an authed portal)

**Close behind (13–15):** client credit balances on the ledger (FreshBooks, small); CPA read-only collaborator seat (QB/Zoho — table stakes for some buyers, but RLS/role rework makes it a standalone iteration); canned trip automations ("trip completed → draft invoice + logbook drafts", HoneyBook/Zoho pattern — build after items 1/2/5 exist to automate). **Deliberately excluded:** contract templates & e-sign (counsel-gated language), estimated-tax computation (tax advice — a user-set "set aside X%" tile is the safe later version), GPS mileage (native app), trip-sheet email parsing (inbound-email service contract + heterogeneous parsing risk), availability sharing (adjacent to operator crew scheduling boundary), any duty/currency legality surface (gated dark).

---

## Next Two Workflows — Build These 5

| # | Item | Workflow | Territory (file/module ownership — no overlap) |
|---|------|----------|-----------------------------------------------|
| 1 | Payment reminders + late fees (rank 2) | **A — "Get Paid"** | Owns: new `invoice_reminder_policies` + `message_templates` migrations, scheduler Edge Function/pg_cron, email templates, invoice *settings* UI. Does not touch invoice draft generation. |
| 2 | ACH-first pay page + fee delta (rank 6) | **A — "Get Paid"** | Owns: Stripe payment-intent/checkout code and public pay-page components only. |
| 3 | Unbilled-money dashboard (rank 3) | **A — "Get Paid"** | Owns: new dashboard route/components + read-only SQL views; links out to (not into) invoice creation. |
| 4 | Tail numbers first-class (rank 4) | **B — "Trip Money Model"** | Owns: `aircraft` migration + FKs on trips/legs/expenses/logbook, tail pickers in trip/expense/logbook forms. |
| 5 | Per diem/travel-day lines + reimbursables auto-pull (ranks 5 + 1 core) | **B — "Trip Money Model"** | Owns: client rate schema additions, the trip→invoice **draft generator**, expense `billable`/`trip_id` linkage, reimbursables packet PDF renderer. |

**Territory rule in one line:** Workflow A owns everything *after* an invoice exists (settings, sending, reminders, pay page, dashboards over read-only views); Workflow B owns everything that *creates* invoice content (trip/aircraft/rate schema and the draft generator + PDF renderers). The only shared surface is the invoices table itself — A adds settings-side columns, B adds line-generation logic; neither edits the other's migrations or components.