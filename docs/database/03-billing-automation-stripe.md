# Billing Automation & Stripe

Ten tables: `estimate_number_sequences` (per-account estimate numbering), `estimates` (client quotes), `estimate_lines` (quote line items), `recurring_invoice_schedules` (standing billing cadences), `recurring_invoice_generations` (recurring-invoice idempotency ledger), `invoice_reminder_sends` (reminder-email history), `invoice_late_fees` (late-fee invoice idempotency ledger), `stripe_events` (platform-billing webhook ledger), `stripe_connect_events` (Stripe Connect webhook ledger), `sample_connect_accounts` (the unrelated Connect V2 demo's account map).

## estimate_number_sequences

One row per account, holding the next sequential number that account's estimates (quotes) will be assigned. It exists so that "EST-2026-0001, EST-2026-0002, ..." numbering can never skip a number or collide for a new tenant — the row is created automatically the moment an account is created, by a trigger (`accounts_seed_estimate_sequence`, `after insert on pilot.accounts`), so there is never a window where an account exists but has nowhere to draw its next number from.

### Columns

#### `account_id`
`uuid`, not null, primary key, foreign key to `pilot.accounts(id)`. Identifies which account this sequence belongs to — one row per account, always.

#### `next_number`
`integer`, not null, default `1`, `check (next_number > 0)`. The next integer this account's estimate numbering will hand out. It is advanced only by the function `pilot.next_estimate_number()`, which increments and reads it back in a single atomic `UPDATE ... RETURNING`, so two estimates being sent at the same instant can never receive the same number.

### Notable constraints

RLS is enabled. There is a `SELECT` policy for `authenticated` (scoped to the caller's own accounts), but deliberately no `INSERT`/`UPDATE`/`DELETE` policy — the table is advanced exclusively through `pilot.next_estimate_number(uuid)`, a `SECURITY DEFINER` function that bypasses RLS and grants entirely, with its own explicit membership check inside the function body (`current_setting('role', true)` for the service-role case, `pilot.current_account_ids()` for everyone else). Granting any column privilege here would just invite a reader to think a direct client `UPDATE` is supported; it isn't.

### Changing this table

This table is not meant to be edited directly — the only legitimate write path is a call to `pilot.next_estimate_number(target_account_id uuid)`, and the `authenticated` role holds no `INSERT`/`UPDATE` grant on it at all. If a sequence value ever needs hand-correcting (e.g. after a data-repair operation), the SQL Editor bypasses RLS and grants — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) — and any such edit should be done inside a transaction you inspect before committing.

```sql
-- The only sanctioned way to advance a sequence, for a caller who is a
-- member of the account:
select pilot.next_estimate_number('<account-uuid>');
```

## estimates

A quote given to a client before the work is booked — "what would three days in the Citation cost me?" — captured as a real document instead of an email the pilot re-types into an invoice later. It is explicitly **not** a financial record: nothing in the tax reports reads this table, nothing sums it into revenue, and no payment can ever be recorded against it. An accepted estimate converts into a DRAFT invoice that the pilot still reviews and sends by hand — nothing here bills anyone automatically.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`, primary key. The estimate's identity.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts(id)`. The tenant this estimate belongs to.

#### `client_id`
`uuid`, not null, foreign key (composite, `account_id, client_id` → `pilot.clients(account_id, id)`). Which client is being quoted.

#### `trip_id`
`uuid`, nullable, foreign key (composite → `pilot.trips(account_id, id)`, `on delete set null`). Optionally ties the quote to a planned trip. Nullable because an estimate is often written before any trip record exists — that's the entire reason this document type exists — and when it is tied to a trip, the link is what lets the accepted quote and the eventual invoice line up against the same job.

#### `estimate_number`
`text`, nullable. Assigned only when the estimate moves out of `draft` into `sent` (by the trigger `estimates_assign_number_on_issue`, which calls `pilot.next_estimate_number()`). Left null on drafts deliberately — numbering a document that might still be discarded would burn sequence integers and turn "why was EST-2026-0004 never sent" into a support question instead of a non-event.

#### `status`
`text`, not null, default `'draft'`, `check (status = ANY (ARRAY['draft','sent','accepted','declined']))`. The quote's lifecycle stage. Unlike an invoice, a `sent` estimate can be revised and re-sent — see "Notable constraints" below for the exact transition rules.

#### `issued_on`
`date`, nullable. Stamped to today's date the moment the estimate is sent (if not already set).

#### `valid_until`
`date`, nullable. How long the quote stands. Snapshotted at send time; a quote with no expiry is a price the pilot is bound to forever, so most pilots will want one set.

#### `sent_at`
`timestamptz`, nullable. When the estimate was sent — stamped automatically on the draft→sent transition.

#### `tax_rate_bps`
`integer`, not null, default `0`, `check (tax_rate_bps >= 0 AND tax_rate_bps <= 2500)`. Tax rate in basis points (825 = 8.25%). The 25% ceiling exists to catch an order-of-magnitude fat-finger, not to express a real-world tax-rate limit.

#### `terms`
`text`, nullable. Free text: cancellation terms, per-diem basis, what's excluded. Deliberately unstructured — late-fee and cancellation percentages are negotiated convention rather than law, and recording the agreement in prose beats computing an unenforceable figure.

#### `notes`
`text`, nullable. Free-form notes on the quote.

#### `converted_invoice_id`
`uuid`, nullable, foreign key (composite → `pilot.invoices(account_id, id)`, `on delete set null`). Set when the estimate becomes an invoice. This column doubles as the idempotency key for conversion — once non-null, `pilot.estimate_convert_to_invoice()` refuses to convert the same estimate a second time.

#### `converted_at`
`timestamptz`, nullable. When conversion happened; always null exactly when `converted_invoice_id` is null (enforced by CHECK).

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`. Standard audit timestamps; `updated_at` is maintained by a `BEFORE UPDATE` trigger, ticking forward on every edit to give each estimate an at-a-glance "last touched" timestamp independent of `created_at`.

### Notable constraints

RLS is enabled, scoped to `account_id in (select pilot.current_account_ids())` for select/insert/update, plus a narrower delete policy (below). `check ((converted_invoice_id is null) = (converted_at is null))` keeps those two columns moving together. `unique (account_id, estimate_number)` makes numbering per-tenant, never global — and because Postgres treats each `NULL` as distinct, many draft (unnumbered) estimates can coexist without tripping this constraint.

A trigger (`estimates_force_draft_on_insert`) rejects any client-side attempt to insert a row with `status`, `estimate_number`, `sent_at`, or `converted_invoice_id` already set — every estimate is born a plain, unnumbered draft. A second trigger (`estimates_protect`) enforces the legal status transitions: `draft→sent`, `sent→{accepted, declined, draft}`, `declined→{sent, accepted}`. Notably `accepted→declined` is not offered — an accepted quote may already have produced an invoice, and reversing it would leave that invoice's provenance dangling. That same trigger also freezes `estimate_number` once assigned, and freezes `converted_invoice_id`/`tax_rate_bps`/`client_id`/`status` once the estimate has actually converted — an estimate that already produced an invoice can't be silently re-priced out from under it.

DELETE is allowed (unlike invoices), but only for an estimate that is still an unsent, unconverted draft (`status = 'draft' and estimate_number is null and converted_invoice_id is null`) — an abandoned draft quote isn't a financial record, but a numbered one is a document a client has already seen.

### Changing this table

Normal tenant edits go through ordinary grants: `authenticated` can `INSERT` (`account_id, client_id, notes, tax_rate_bps, terms, trip_id, valid_until`), `UPDATE` (`client_id, notes, status, tax_rate_bps, terms, trip_id, valid_until`), and `DELETE` subject to the draft-only policy above. Note that `status` is directly updatable — the pilot drives the whole send/accept/decline lifecycle from the UI, and `estimates_protect` is what constrains which transitions are legal, not the grant. Conversion to an invoice always goes through the function, never a manual write:

```sql
-- Convert an accepted estimate into a draft invoice (atomic; refuses a
-- second conversion; SECURITY DEFINER with its own tenancy check)
select pilot.estimate_convert_to_invoice('<estimate-uuid>');
```

```sql
begin;
update pilot.estimates
set status = 'sent'
where id = '<estimate-uuid>' and account_id = '<account-uuid>';
select id, estimate_number, status, sent_at from pilot.estimates where id = '<estimate-uuid>';
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) for the general safety rules — remember the SQL Editor runs as an admin role and isn't bound by any of the triggers above.

## estimate_lines

One row per priced line item on an estimate — the flight days, travel days, per-diems, reimbursable expenses, and cancellation fees that add up to the quoted total. Deliberately the same shape and vocabulary as `pilot.invoice_lines`, so converting an estimate to an invoice is a straight copy rather than a translation.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`, primary key.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts(id)`.

#### `estimate_id`
`uuid`, not null, foreign key (composite → `pilot.estimates(account_id, id)`, `on delete cascade`). The estimate this line belongs to.

#### `line_type`
`text`, not null, `check (line_type = ANY (ARRAY['flight_day','travel_day','per_diem','reimbursable_expense','cancellation_fee','other']))`. What kind of charge this is. Deliberately identical vocabulary to `pilot.invoice_lines.line_type` — if the two lists ever diverge, conversion starts silently dropping or remapping line types.

#### `description`
`text`, not null. What the line says on the document.

#### `quantity`
`numeric`, not null, default `1`, `check (quantity > 0)`. How many units (days, expenses, etc).

#### `unit_amount_cents`
`bigint`, not null, `check (unit_amount_cents >= 0)`. Price per unit, in integer cents.

#### `amount_cents`
`bigint`, generated, nullable in the type system but always computed, default expression `round(quantity * unit_amount_cents)::bigint`. A `GENERATED ALWAYS` column — the line total can never drift from its own inputs because it's computed by Postgres, not entered.

#### `taxable`
`boolean`, not null, default `true`. Whether this line counts toward the taxable subtotal. Per-line rather than per-document, because a quote mixing a taxable day rate with a (commonly non-taxable) per-diem reimbursement needs two different answers, and one estimate-wide flag would make the tax figure wrong the moment both appear.

#### `sort_order`
`integer`, not null, default `0`. Display order on the document.

#### `created_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled, standard `account_id in (select pilot.current_account_ids())` scoping on all four operations. A trigger (`estimate_lines_protect_converted`) blocks any insert, update, or delete on a line once its parent estimate has been converted to an invoice (`converted_invoice_id is not null`) — the figures an invoice was generated from can't be rewritten after the fact.

### Changing this table

Ordinary tenant edits: `authenticated` holds `INSERT` (`account_id, description, estimate_id, line_type, quantity, sort_order, taxable, unit_amount_cents`), `UPDATE` on the same editable set (minus `estimate_id`), and `DELETE`, all gated by the conversion-lock trigger above.

```sql
begin;
insert into pilot.estimate_lines
  (account_id, estimate_id, line_type, description, quantity, unit_amount_cents, taxable, sort_order)
values
  ('<account-uuid>', '<estimate-uuid>', 'flight_day', 'Flight day — KTEB to KVNY', 1, 250000, true, 0);
select * from pilot.estimate_lines where estimate_id = '<estimate-uuid>' order by sort_order;
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## recurring_invoice_schedules

A standing billing arrangement — a fixed description and amount, billed monthly or quarterly to one client — that lets the recurring-invoices page tell the pilot "this is due, create it" instead of the pilot re-typing the same retainer invoice from scratch every month. This table is inert data by design: nothing reads it except that page computing what's currently due, because this product has no background job (no `pg_cron`, no external cron) that would silently fire an invoice unattended. For schedules with `autopay = true`, generating a due invoice can also issue it and charge the client's saved payment method off-session — see the `autopay` column below.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`, primary key.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts(id)`.

#### `client_id`
`uuid`, not null, foreign key (composite → `pilot.clients(account_id, id)`).

#### `cadence`
`text`, not null, `check (cadence = ANY (ARRAY['monthly','quarterly']))`. How often this schedule bills. No `weekly` option exists on purpose — every documented recurring-billing shape in this product's domain (monthly minimum-guarantee billing, standby/on-call retainers) is calendar-month-based, and adding a cadence with no contract shape behind it would just be an unused dropdown entry.

#### `anchor_date`
`date`, not null. The calendar date this schedule was set up to bill on; its day-of-month (clamped per period — the 31st in a 30-day month clamps to that month's last day, never rolling into the next month) decides which day of every future period the invoice becomes due to create. Not itself a period start — a schedule created mid-month bills going forward from its own anchor, never retroactively.

#### `end_date`
`date`, nullable. Once past this date, no further periods are offered — for a fixed-term retainer rather than one running forever. `NULL` means indefinite.

#### `description`
`text`, not null, `check (length(trim(description)) > 0)`. The line text that appears on every invoice this schedule generates.

#### `amount_cents`
`bigint`, not null, `check (amount_cents > 0)`. The fixed amount billed each period. Snapshotted onto every generated invoice — changing this later only affects future generations, never invoices already produced. Fixed-amount billing only: this schedule deliberately does not (yet) bill a monthly minimum-guarantee shape (`pilot.clients.minimum_basis`/`pilot.guarantee_periods`) — the table comment explains that closing the double-billing race safely for that shape needs either teaching the existing guarantee-settlement logic to consult this table, or moving that settlement check into a database constraint, and neither was judged safe to build in this pass.

#### `tax_rate_bps`
`integer`, not null, default `0`, `check (tax_rate_bps >= 0 AND tax_rate_bps <= 2500)`. Snapshotted onto each generated invoice's own `tax_rate_bps` at creation time.

#### `active`
`boolean`, not null, default `true`. A paused schedule (`active = false`) offers no due periods and generates nothing. Distinct from `end_date` — pausing is reversible ("skip this while the contract's on hold"), an end date is a decided stopping point.

#### `created_at` / `updated_at`
`timestamptz`, not null, default `now()`. `updated_at` is maintained by a `BEFORE UPDATE` trigger and ticks forward whenever the schedule itself is edited (e.g. `amount_cents`, `active`), not when it merely generates another invoice.

#### `autopay`
`boolean`, not null, default `false`. When true **and** the schedule's client has autopay enrolled (`pilot.clients.autopay_*` columns set, with matching Stripe livemode), generating this schedule's due invoice also issues it immediately and charges the client's saved payment method off-session, as a direct charge on the pilot's connected Stripe account — no application fee, same posture as every payment link. False (the default, and every row created before this feature shipped) leaves generated invoices as drafts, same as always. The flag is per-schedule, not per-client, because the same client can hold a monthly retainer the pilot wants auto-charged alongside one-off invoices that should keep arriving as payment links.

### Notable constraints

RLS is enabled, standard tenant scoping. `check (end_date is null or end_date >= anchor_date)`. Generation is governed entirely by the uniqueness constraint on the sibling table `recurring_invoice_generations` (below) — a schedule row itself carries no per-period lock.

### Changing this table

`authenticated` holds ordinary `SELECT`, `INSERT` (`account_id, active, amount_cents, anchor_date, autopay, cadence, client_id, description, end_date, tax_rate_bps`) and `UPDATE` on a narrower set (`active, amount_cents, autopay, description, end_date, tax_rate_bps`). Notably `client_id`, `cadence`, and `anchor_date` are **not** updatable — together they decide every period this schedule has ever offered, and re-pointing any of them after generations already exist would silently reinterpret history. Correcting one of those three is delete-and-recreate, not an edit.

```sql
begin;
update pilot.recurring_invoice_schedules
set amount_cents = 550000, active = true
where id = '<schedule-uuid>' and account_id = '<account-uuid>';
select * from pilot.recurring_invoice_schedules where id = '<schedule-uuid>';
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## recurring_invoice_generations

The idempotency ledger for recurring invoices: one row proves that a given schedule's given calendar-month period has already produced an invoice. This is the mechanism that actually makes "at most one invoice per (schedule, period), ever" true — not merely likely — because the app-level "check, then insert" logic can race (two browser tabs open on the due-queue page, a double-clicked "create all"), and only a database-enforced unique constraint closes that race for good.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`, primary key.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts(id)`.

#### `schedule_id`
`uuid`, not null, foreign key (composite → `pilot.recurring_invoice_schedules(account_id, id)`).

#### `period_start`
`date`, not null, `check (period_start = date_trunc('month', period_start)::date)`. Always the first of a calendar month — the period's own identity. Period arithmetic in this schema is always calendar arithmetic, never a fixed day-count, so "August's period" is unambiguous regardless of how many days it contains.

#### `invoice_id`
`uuid`, not null, foreign key (composite → `pilot.invoices(account_id, id)`, `on delete cascade`). The invoice this generation actually produced. Kept `NOT NULL` deliberately — a generation row is never a bare reservation of a period, always proof that a real invoice exists.

#### `created_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled with `SELECT`/`INSERT` policies for `authenticated`, but **no `UPDATE` or `DELETE` policy** — once written, a generation record identifies an immutable fact, and a pilot deleting a row to "free up" a period and regenerate it is exactly the double-bill this table exists to prevent.

The load-bearing constraint is `unique (account_id, schedule_id, period_start)` — at most one generation row per schedule per calendar-month period, ever. This table is written exclusively (in normal operation) by `pilot.generate_recurring_invoice(p_schedule_id, p_period_start)`, a `SECURITY DEFINER` function that writes the invoice, its line item, and this ledger row as the effects of one single top-level statement. If any of the three inserts fails — including this table's unique-constraint violation on a losing concurrent call — Postgres rolls back all three together, so a caller never observes a stray invoice with no ledger row, or vice versa. This closes a real, previously-shipped defect where three separate app-layer inserts could leave an orphaned invoice behind on partial failure.

### Changing this table

Gated in practice: while `authenticated` technically holds a column-scoped `INSERT` grant (`account_id, invoice_id, period_start, schedule_id`) and `SELECT`, the intended and safe write path is exclusively the function call below — a direct `INSERT` bypasses the invoice-and-line-writing half of the atomic operation and would leave a ledger row with no matching invoice content.

```sql
-- Generate the draft invoice for one due (schedule, period) pair
select pilot.generate_recurring_invoice('<schedule-uuid>', '2026-08-01');
```

The SQL Editor runs as an admin role and isn't bound by the RLS/grant posture above — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md). A separate, forward-looking scheduled path — `pilot.generate_autopay_invoice`, referenced in `recurring_invoice_schedules`' own table comment as the function that will generate and immediately charge `autopay = true` schedules — is named in that comment but its implementing migration was not found in this repository's `supabase/migrations/`; treat it as not yet shipped rather than guessing at its behavior.

## invoice_reminder_sends

A complete history of every payment-reminder email this product has attempted to send for an invoice — scheduled or pressed by hand — recorded with its *true* outcome, never an assumed one. It exists because, before this table, nothing recorded that a reminder was ever sent at all: the invoice's own `sent_at`/`delivery_method` describe only the first send, so the manual "send a reminder" button could be pressed twice in a row with nothing to notice. That was tolerable while a human was pressing the button; it is not tolerable for an unattended daily job.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`, primary key.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts(id)`.

#### `invoice_id`
`uuid`, not null, foreign key (composite → `pilot.invoices(account_id, id)`, `on delete cascade`).

#### `rule_key`
`text`, not null, `check (rule_key ~ '^(before_[0-9]{1,3}|on_due|after_[0-9]{1,3}|manual)$')`. Which rung of the chase ladder this attempt was for — e.g. `before_7`, `on_due`, `after_30` — or `manual` for a pilot-pressed send. This check only validates the *shape* of the key; the actual offered set of rungs (`{3,7,14}` before due, `{3,7,14,30}` after) is owned and enforced by `pilot.clients`' own CHECK constraints and by `lib/reminders/policy.ts`, not repeated here.

#### `outcome`
`text`, not null, `check (outcome = ANY (ARRAY['sent','failed','unknown','skipped']))`. What actually happened, precisely distinguished:
- `sent` — the mail service accepted it and returned a provider message id.
- `failed` — it **definitely did not send** (a refusal, a bad address, no mail configuration). This is the one outcome that may be retried, up to a capped number of attempts (`lib/reminders/policy.ts`'s `MAX_REMINDER_ATTEMPTS`) — the failed rows themselves are never deleted, just superseded by a later attempt.
- `unknown` — it **may have sent**: the mail service stopped answering mid-request and that endpoint carries no idempotency key, so a retry risks landing a second copy of the same chase in a client's inbox. `unknown` rungs are never retried by anything, ever — a missed reminder is judged less costly than a duplicate one. Every row written before the outcome distinction shipped was relabelled from `failed` to `unknown`, because that is what was actually true of them.
- `skipped` — deliberately not attempted: `'superseded'` (a later rung came due in the same run and only the most-advanced one is ever sent) or `'stale'` (a before-due or on-due note whose moment has already passed).

#### `detail`
`text`, nullable. The mail service's own words on a failure, or the skip reason — shown to the pilot verbatim (never to the client), because a specific error string is the difference between a five-minute DNS fix and a guessing afternoon.

#### `provider_message_id`
`text`, nullable. The mail provider's (Resend's) returned id, present exactly when `outcome = 'sent'` — enforced by CHECK. This is the storage-level twin of the app's own refusal to treat an unconfirmed response as a successful send: no row can claim `sent` without evidence, and no row can claim `sent` while also carrying a failure detail.

#### `created_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled with `SELECT`/`INSERT` policies only — no `UPDATE`, no `DELETE`. A send record states something that already happened to somebody else's inbox; there's no honest way to edit one, and deleting a row to "free up" a rung for re-sending is precisely the double-chase this table exists to prevent.

The load-bearing object is the partial unique index `invoice_reminder_sends_rung_once`, on `(account_id, invoice_id, rule_key) where rule_key <> 'manual' and outcome <> 'failed'`. In plain terms: for any rung other than `manual`, once a row with outcome `sent`, `unknown`, or `skipped` exists, that rung is permanently consumed and a second attempt collides rather than duplicating — `failed` rows are the sole exception, deliberately excluded from the index so a genuinely-failed attempt can be retried. `manual` sends are the one repeatable kind, tracked so the scheduler can tell a human already chased this invoice today and skip its own automated rung.

A related CHECK ties `outcome` to `provider_message_id`/`detail`: `(outcome = 'sent') = (provider_message_id is not null) and (outcome = 'sent' or detail is not null)`.

### Changing this table

`authenticated` holds `SELECT` and a column-scoped `INSERT` (`account_id, detail, invoice_id, outcome, provider_message_id, rule_key`) — no `UPDATE`/`DELETE` grant exists, matching the RLS posture above. In normal operation this table is written by the reminders pipeline (`lib/reminders/run.ts`, invoked from `app/api/reminders/run/route.ts`'s daily cron and from the Settings "run now" button), not by hand. A manual repair should stay inside a transaction:

```sql
begin;
insert into pilot.invoice_reminder_sends
  (account_id, invoice_id, rule_key, outcome, detail)
values
  ('<account-uuid>', '<invoice-uuid>', 'manual', 'sent', 'Chased by phone, logged manually');
select * from pilot.invoice_reminder_sends where invoice_id = '<invoice-uuid>' order by created_at desc;
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## invoice_late_fees

Proof that a late fee has already been drafted for a given overdue invoice and accrual period, plus a snapshot of exactly how that fee was computed. A late fee is always issued as a brand-new, **separate** draft invoice, never as a line appended to the original overdue one — the overdue invoice is frozen the moment it's issued (`invoice_lines_protect_issued`), and rewriting it through the service-role exemption would put the client's copy, the share page, and any Stripe payment-link amount out of sync with the pilot's own record. Nothing here is ever sent to a client automatically; the fee invoice is a draft the pilot reviews and sends by hand, same as every other invoice.

### Columns

#### `id`
`uuid`, not null, default `gen_random_uuid()`, primary key.

#### `account_id`
`uuid`, not null, foreign key to `pilot.accounts(id)`.

#### `source_invoice_id`
`uuid`, not null, foreign key (composite → `pilot.invoices(account_id, id)`, `on delete restrict`). The invoice that was late. `RESTRICT` rather than `CASCADE` — losing the record of what a fee was *for* would leave an unexplained bill in the pilot's books, and this schema voids rather than deletes invoices anyway.

#### `fee_invoice_id`
`uuid`, not null, foreign key (composite → `pilot.invoices(account_id, id)`, `on delete cascade`). The fee invoice itself. `CASCADE` here (unlike the source FK) so that if a service-role cleanup ever removes the fee invoice, the accrual period becomes billable again instead of permanently spent with nothing to show for it.

#### `period_start`
`date`, not null, `check (period_start = date_trunc('month', period_start)::date)`. Which accrual month this fee covers, canonically the first of that calendar month — same shape as the recurring-invoice ledger's `period_start`.

#### `amount_cents`
`bigint`, not null, `check (amount_cents > 0)`. The fee amount, snapshotted at creation — a later change to the client's `late_fee_*` settings never restates a fee already billed.

#### `basis`
`text`, not null, `check (basis = ANY (ARRAY['flat','bps_per_month']))`. Whether this was a one-time flat fee or an accruing percentage-per-month fee.

#### `basis_bps`
`integer`, nullable, `check (basis_bps IS NULL OR basis_bps > 0 AND basis_bps <= 500)`. The rate in basis points at the time the fee was computed — null for a flat fee, required for a `bps_per_month` fee.

#### `months_accrued`
`integer`, nullable, `check (months_accrued IS NULL OR months_accrued > 0)`. How many complete months had accrued when a `bps_per_month` fee was raised — null for a flat fee.

#### `created_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled with `SELECT`/`INSERT` only, same reasoning as `invoice_reminder_sends` — a fee-generation record is an immutable fact about a period being billed, and deleting one to bill it twice is exactly what this table prevents.

Two overlapping uniqueness guards, both modeled on `recurring_invoice_generations`'s pattern:
- `unique (account_id, source_invoice_id, period_start)` — at most one fee per overdue invoice per accrual month. The table's own comment names one documented gap: two fee-raising requests that straddle a UTC month boundary within the same second can key to different `period_start` values and both succeed, double-billing that one accrual — a narrow, seconds-wide window, and both resulting documents are still drafts a human reads before either reaches the client.
- `invoice_late_fees_flat_once`, a partial unique index on `(account_id, source_invoice_id) where basis = 'flat'` — a flat fee for a given overdue invoice can happen at most once, ever, with no month-boundary caveat at all, since a flat fee doesn't accrue by period.

Also enforced by CHECK: `basis = 'bps_per_month'` if and only if both `basis_bps` and `months_accrued` are set.

### Changing this table

`authenticated` holds `SELECT` and a column-scoped `INSERT` (`account_id, amount_cents, basis, basis_bps, fee_invoice_id, months_accrued, period_start, source_invoice_id`) — no `UPDATE`/`DELETE`, matching RLS. In normal operation the app computes the fee, creates the draft fee invoice, and inserts this ledger row together (mirroring the invoice-plus-line-plus-ledger atomicity pattern used elsewhere in this domain); there is no single database function wrapping all three steps for this table the way `pilot.generate_recurring_invoice` does for recurring invoices.

```sql
begin;
insert into pilot.invoice_late_fees
  (account_id, source_invoice_id, fee_invoice_id, period_start, amount_cents, basis)
values
  ('<account-uuid>', '<overdue-invoice-uuid>', '<new-fee-invoice-uuid>', '2026-08-01', 15000, 'flat');
select * from pilot.invoice_late_fees where source_invoice_id = '<overdue-invoice-uuid>';
rollback; -- or commit;
```

See [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## stripe_events

The webhook idempotency and ordering ledger for **platform billing** — the Stripe integration where pilots pay V1 for their own subscription. It answers "have I already applied this event?" durably, because the webhook route runs as stateless serverless functions with no shared memory between invocations, and Stripe retries a failed delivery for up to three days. This is a strictly separate integration and a strictly separate table from `stripe_connect_events` below — do not conflate the two. See `docs/DEV-GUIDE.md`'s "Billing, disambiguated" section for the full picture of the two integrations.

### Columns

#### `id`
`text`, not null, primary key. Stripe's own event id (`evt_...`). Using it as the primary key makes the idempotency check itself just "does this insert collide" — no read-then-write race is possible.

#### `type`
`text`, not null. The Stripe event type (e.g. `customer.subscription.updated`).

#### `stripe_created_at`
`timestamptz`, not null. Stripe's own event creation time, not this database's receipt time. This is what makes out-of-order delivery safe: a handler can compare this to the last-applied event for the same object and refuse to apply an older state on top of a newer one.

#### `object_id`
`text`, nullable. Which Stripe object (customer, subscription, etc.) this event concerned, so a handler can find the most recently applied event for that object without re-parsing payloads.

#### `processed_at`
`timestamptz`, nullable. Set only when the handler finished successfully. A row that exists with a null `processed_at` means "seen, but not completed" — Stripe's retry is meant to be allowed to run again in that case; only a non-null value means "done, skip this delivery."

#### `livemode`
`boolean`, not null. Guards against a test-mode event ever being applied to production data (or vice versa) — the handler records what Stripe said and refuses a mismatch against its own key's mode.

#### `received_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled with **no policy at all for `authenticated`** — this is a deliberate, absolute lock: `authenticated` holds no grant on this table whatsoever, so even if a grant were accidentally added later, RLS with zero permissive policies would still return zero rows to any tenant. This table sits entirely outside the tenant model — it has no `account_id`, because a `checkout.session.completed` event (the tenant-creation event) necessarily arrives *before* the account it provisions exists, so there is nothing to scope the row to at insert time. Only `service_role` (which holds `BYPASSRLS`) can read or write it, and only the platform-billing webhook does so in practice.

### Changing this table

This table is entirely gated — no direct `authenticated` access exists by design, and none should be added; a tenant who could enumerate billing events could enumerate other tenants' billing activity. Reads/writes happen exclusively through `app/api/stripe/webhook/route.ts` using the service-role client. The SQL Editor bypasses RLS and grants entirely and can read or write this table directly — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) — but doing so is an admin operation, not a supported app pathway.

## stripe_connect_events

The delivery ledger for the **Stripe Connect** integration — the separate flow where a pilot's own clients pay the pilot, and Stripe reports the outcome to `app/api/stripe/connect-webhook/route.ts`. This is a sibling to `stripe_events` above, not a reuse of it: Connect event ids are minted inside each connected account's own namespace, so the safe delivery key here is *(connected account, event id)*, a composite, rather than the bare event id `stripe_events` uses. Unlike platform billing's ledger, this one is meaningful only once tied to an existing tenant and one of their invoices, and — critically — it is readable by the tenant it resolves to, because a payment the handler declined to record is exactly the thing a pilot needs to see on their own invoice screen.

### Columns

#### `id`
`text`, not null. Stripe's event id (`evt_...`), part of the composite primary key.

#### `connected_account_id`
`text`, not null, part of the composite primary key. Stripe's `event.account` — the one authenticated fact about whose payment this is. A Payment Link's *metadata* is typed by whoever owns the connected account and is treated as untrusted input everywhere in the handler; `connected_account_id` is what Stripe itself asserts, not what the payload claims.

#### `type`
`text`, not null. The Stripe event type.

#### `stripe_created_at`
`timestamptz`, not null.

#### `object_id`
`text`, nullable. The Checkout Session id (`cs_...`) this event carried, for tracing back to Stripe's dashboard.

#### `payment_intent_id`
`text`, nullable. The PaymentIntent id, denormalized here so support can answer "did this payment ever reach us?" from one table, next to the decision it drove.

#### `livemode`
`boolean`, not null.

#### `account_id`
`uuid`, nullable, foreign key to `pilot.accounts(id)`. Resolved from `connected_account_id`, never trusted from metadata. Null when the connected account couldn't be attributed to any tenant at all — and because the RLS policies below match on this column and `null in (...)` is never true in SQL, an unattributed row is invisible to every tenant, which is the correct posture: an unresolvable event is the platform's problem, not any one pilot's.

#### `invoice_id`
`uuid`, nullable. The invoice this event was about, once proven to belong to `account_id`. Deliberately **not** a foreign key — the invoice-payments FK to invoices is `ON DELETE RESTRICT`, and this ledger must never become a reason an invoice can't be deleted, nor lose its own audit row when one is.

#### `outcome`
`text`, nullable, `check (outcome IS NULL OR outcome = ANY (ARRAY['recorded','duplicate','needs_review','refused','ignored','payment_pending','payment_failed']))`. What the webhook handler did. Null until decided. Four values are shown directly to the pilot on the invoice screen whenever the row resolves to one of their invoices:
- `needs_review` / `refused` — money arrived and this product did **not** record it; a human must look. (`needs_review` means the amount looks like it may already have been recorded manually within the race window; `refused` means the event failed the tenancy/state checks or carried money this ledger can't express.)
- `payment_pending` — an asynchronous (ACH) debit was authorized by the client and hasn't settled yet. No money has arrived, the invoice's balance is untouched, and this clears itself automatically when the matching success/failure event lands. **Never** interpret `payment_pending` as money received.
- `payment_failed` — that debit failed at the bank. Nothing to reverse (no money ever existed), but the payment link needs replacing, since the original was single-use and was already consumed at mandate acceptance.

The remaining values (`recorded`, `duplicate`, `ignored`) describe successful, deduped, or irrelevant deliveries and are platform-facing only.

#### `detail`
`text`, nullable. One human-readable sentence explaining the outcome, safe to show a pilot (a version that might leak cross-tenant information — e.g. "that invoice exists but isn't yours" — stays in the platform's own logs instead).

#### `reviewed_at`
`timestamptz`, nullable. Set by the pilot from the invoice screen once they've looked at a surfaced event. This is the **only** column `authenticated` may write on this table — it dismisses a prompt and changes nothing about the money itself.

#### `processed_at`
`timestamptz`, nullable. Same contract as `stripe_events.processed_at`: non-null means the handler finished, so a redelivery is skipped; null means Stripe's retry is allowed to run again, which is safe only because of a separate money-level dedupe index on `pilot.invoice_payments.stripe_payment_intent_id`.

#### `received_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled with `SELECT` and a one-column `UPDATE` (`reviewed_at`) policy for `authenticated`, both scoped to `account_id in (select pilot.current_account_ids())`. There is deliberately **no `INSERT` or `DELETE` policy** — every row is written by the connect-webhook's service-role client; a tenant able to insert a row could fabricate a "Stripe says this was paid" prompt on their own invoice screen.

Primary key is `(connected_account_id, id)`, not just `id` — Connect event ids are namespaced per connected account. The genuine money-level idempotency guard lives on a different table: a unique index on `pilot.invoice_payments.stripe_payment_intent_id` (`invoice_payments_one_row_per_payment_intent`). This table is the *delivery* dedupe; that other index is the *money* dedupe, and a retryable null `processed_at` here is only safe because that separate index exists.

### Changing this table

Gated for everything except dismissing a review prompt: `authenticated` holds `SELECT` and `UPDATE (reviewed_at)` only. Writing a row at all — recording a payment outcome — happens exclusively inside `app/api/stripe/connect-webhook/route.ts` via the service-role client, re-implementing (in application code) every rule the manual payment-entry path gets from triggers for free, since `service_role` deliberately bypasses those triggers. The SQL Editor bypasses RLS and grants and can insert or edit rows directly if genuinely needed for data repair — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) — but that is an admin operation outside the app's normal flow.

```sql
-- The one thing a pilot legitimately does here through the app: dismiss a
-- surfaced prompt.
begin;
update pilot.stripe_connect_events
set reviewed_at = now()
where id = '<evt-id>' and connected_account_id = '<acct-id>' and account_id = '<account-uuid>';
rollback; -- or commit;
```

## sample_connect_accounts

**A separate demo integration, unrelated to real customer data.** This table belongs to the standalone "sample Connect" demo (`lib/sample-connect/`, `app/sample-connect/`, `app/store/`) — a self-contained showcase of Stripe Connect V2, built to demonstrate the pattern rather than to serve pilots' actual businesses. It maps one signed-in auth user to the V2 Stripe account created for them by the demo. It has **no relationship** to the production Stripe Connect integration a pilot actually uses to bill their real clients — that one stores its OAuth-granted Standard account id on `pilot.accounts.connect_account_id` and is governed entirely differently (revocable OAuth grant, no application fee, `lib/stripe/connect.ts`). Nothing else in the product reads or depends on this table; it is safe to drop entirely along with the demo's own directories if the demo is ever removed.

### Columns

#### `user_id`
`uuid`, not null, part of the composite primary key, foreign key to `auth.users(id)`, `on delete cascade`. The signed-in user this V2 demo account belongs to — keyed to the raw auth user, not `pilot.accounts.id`, because the demo is a per-person showcase and doesn't model the multi-seat account structure the real product does.

#### `stripe_account_id`
`text`, not null, unique, `check (stripe_account_id ~~ 'acct\_%')`. The Stripe V2 account id (`acct_...`) the demo created for this user.

#### `livemode`
`boolean`, not null, default `false`, part of the composite primary key. Which Stripe mode minted the account. It's deliberately part of the primary key rather than just a recorded fact — keying on `user_id` alone would mean the first mode a user used "wins" the row permanently (since there's no update policy — see below), and a deployment switching from test keys to live keys would silently brick the demo for anyone whose only row was test-mode. Keying on `(user_id, livemode)` lets the same person hold one account per mode, which also matches normal development practice: a test merchant and a live merchant are genuinely different merchants.

#### `created_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled with `SELECT` and `INSERT` policies scoped to `user_id = auth.uid()` — a user may read and create their own mapping and nothing else. There is deliberately **no `UPDATE` or `DELETE` policy**: repointing a user at a different Stripe account isn't meant to be an edit made casually from the browser — the account this platform created for someone is the account it must keep talking to, and starting over is meant to be a deliberate, service-role-mediated act rather than a stray `PATCH`. `unique (stripe_account_id)` keeps one Stripe account mapped to at most one user.

### Changing this table

`authenticated` holds `SELECT` and `INSERT` (`created_at, livemode, stripe_account_id, user_id`) scoped to the caller's own `user_id` by RLS — no `UPDATE`/`DELETE` grant exists at all. Deleting or replacing a mapping row requires the service-role client (used by the demo's own account-creation/reset flow), or the SQL Editor, which bypasses RLS and the missing grants entirely — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

```sql
begin;
delete from pilot.sample_connect_accounts
where user_id = '<user-uuid>' and livemode = false;
rollback; -- or commit;
```
