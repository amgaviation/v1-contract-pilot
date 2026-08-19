# Trips & Invoicing

The financial core of the app: `clients` (who you bill), `trips` (the work), `trip_legs` (the flying, for logbook purposes), `day_types` and `trip_days` (what a day of work is called and what it pays), `client_rates` (per-client rate overrides), `guarantee_periods` (monthly minimum-day guarantees), `invoice_number_sequences` (invoice numbering), `invoices` and `invoice_lines` (the billing document), `invoice_payments` (the payment ledger), and `client_tax_forms` (1099 reconciliation).

## clients

A client is a company or operator the pilot bills for contract flying — or, if `you_invoice` is false, a counterparty the pilot flies for without ever billing (an operator whose competency checks and IPCs they hold). This table has no table-level comment in the schema; what follows is drawn from its column comments. It's also the anchor for billing preferences (payment terms, reminder cadence, late fees), Stripe autopay consent, and W-9 tracking.

### Columns

#### `id`
`uuid`, primary key, defaults to `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. The owning tenant. Every table in this schema is scoped by `account_id`, and RLS enforces it.

#### `name`
`text`, not null. The client's display name.

#### `contact_name`, `contact_email`, `contact_phone`
`text`, all nullable. The day-to-day relationship contact — not necessarily who pays the bill (see `billing_email`).

#### `address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`
`text`, all nullable. Mailing address, used on invoices.

#### `default_day_rate_cents`
`bigint`, nullable, must be `>= 0` if set. The client's default per-day flight rate in cents, used to prefill trip creation.

#### `default_per_diem_cents`
`bigint`, nullable, must be `>= 0` if set. Default per-diem rate in cents.

#### `payment_terms_days`
`integer`, not null, default `30`, must be `>= 0`. Days from issue to due date, used to compute an invoice's `due_on`.

#### `default_expense_treatment`
`text`, not null, default `'unassigned'`. One of `rebill`, `deduct`, `unassigned` — the default answer to "does an expense on this client's trips get rebilled to them or deducted from the pilot's own pay," prefilled at expense capture.

#### `w9_status`
`text`, not null, default `'not_requested'`. One of `not_requested`, `requested`, `on_file` — where the client's W-9 stands.

#### `w9_sent_at`, `w9_received_at`
`timestamptz`, both nullable. When the W-9 request was sent and when the completed form came back.

#### `notes`
`text`, nullable. Free-form pilot notes.

#### `archived_at`
`timestamptz`, nullable. Soft-archive marker; a non-null value hides the client from active pickers without deleting its history.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

#### `default_travel_day_rate_cents`
`bigint`, nullable, must be `>= 0` if set. Default rate for travel/positioning days, distinct from flight days.

#### `per_diem_mode`
`text`, not null, default `'receipts'`. One of `per_diem`, `receipts` — whether this client's per-diem is a flat daily rate or itemized receipts.

#### `minimum_days`
`numeric`, nullable, must be between 0 and 999 if set. A contractual floor on billable days.

#### `cancellation_policy_note`
`text`, nullable. A free-text note, not a computed rule — the same posture as `late_fee_note_on_reminders` below: it's the pilot's own record, never something the system enforces or calculates from.

#### `minimum_basis`
`text`, not null, default `'per_trip'`. One of `per_trip`, `per_month`. Determines what `minimum_days` is a floor on: `per_trip` (the pre-existing behavior — every trip gets independently topped up to the minimum) or `per_month` — the floor applies once per calendar month across all of this client's trips, settled through `guarantee_periods` so two invoices can never both top up the same month. Defaults to `per_trip` because that's what every existing `minimum_days` value already meant; changing the default would silently reinterpret a live contract.

#### `operating_rule`
`text`, not null, default `'unspecified'`. One of `part_91`, `part_135`, `both`, `unspecified`. Which 14 CFR part(s) this client's work is flown under. Gates the operator-qualifications panel and seeds (without fixing) `trips.operating_rule` at trip creation — a trip can independently diverge, because a contract pilot may fly the same airframe under both parts for one client on different days.

#### `reminder_before_due`
`integer[]`, not null, default `'{}'`, must be a subset of `{3,7,14}` with at most 3 entries. Days before `due_on` a courtesy reminder is scheduled. Empty means no before-due reminders.

#### `reminder_on_due`
`boolean`, not null, default `false`. Whether a reminder fires on the due date itself.

#### `reminder_after_due`
`integer[]`, not null, default `'{}'`, must be a subset of `{3,7,14,30}` with at most 4 entries. The chase ladder after the due date passes. At most one reminder is ever sent per invoice per scheduled run — if several rungs are due at once (e.g. reminders were just switched on for an already-overdue invoice), only the most advanced one sends; the rest are recorded as skipped/superseded in `invoice_reminder_sends`.

#### `late_fee_flat_cents`
`bigint`, nullable. A flat late fee this client agreed to, in cents. Mutually exclusive with `late_fee_bps_per_month` by CHECK. Never applied automatically — a fee only becomes real as a separate draft invoice the pilot reviews and sends.

#### `late_fee_bps_per_month`
`integer`, nullable, capped at 500 (5%) to catch an order-of-magnitude typo — the same reasoning behind `invoices.tax_rate_bps`'s cap. An agreed late fee as basis points of the outstanding balance per complete calendar month past the grace period. Mutually exclusive with `late_fee_flat_cents`.

#### `late_fee_grace_days`
`integer`, not null, default `0`. Days past `due_on` before an agreed fee starts accruing. Inert unless one of the two fee columns above is set.

#### `late_fee_note_on_reminders`
`boolean`, not null, default `false`. Whether a reminder to this client may state the agreed fee in its text. Off by default, independently of the fee itself being configured — recording a term and putting it in a chasing email are separate decisions. CHECK-bound to require a configured fee, so the copy can never claim a consequence with no agreed figure behind it.

#### `billing_email`
`text`, nullable. An AP/accounting inbox, distinct from `contact_email`. Where set, invoice and reminder mail goes here instead; where null, `contact_email` is used exactly as before this column existed.

#### `you_invoice`
`boolean`, not null, default `true`. False marks a counterparty the pilot flies for but never bills — such a client is excluded from invoice/estimate pickers and, by construction, from A/R aging and the unbilled queue, while keeping its trips, documents, and qualifications. See **Notable constraints** below for the two triggers that keep this flag consistent with actual billing history.

#### `autopay_stripe_customer_id`
`text`, nullable. The Stripe Customer id on the pilot's connected account, created when the client sets up autopay. Withheld from every authenticated write grant — this is a consent record, written only by the Stripe Connect webhook (on save) and by service-role clears (on disable/disconnect), never by the app on the pilot's or client's direct say-so.

#### `autopay_stripe_payment_method_id`
`text`, nullable. The saved PaymentMethod used for off-session autopay charges.

#### `autopay_method_label`
`text`, nullable. Human-readable label ("Visa •••• 4242"), captured at save time so screens don't need to call Stripe to display it.

#### `autopay_consented_at`
`timestamptz`, nullable. When the client completed the Checkout setup session. Null means autopay is off for this client.

#### `autopay_livemode`
`boolean`, nullable. Which Stripe mode (live/test) the saved autopay ids belong to; the charge path refuses a mode mismatch outright.

### Notable constraints

RLS is enabled. CHECK constraints enforce non-negative rate/cents columns, the `default_expense_treatment`/`w9_status`/`per_diem_mode`/`minimum_basis`/`operating_rule` enums, the `reminder_before_due`/`reminder_after_due` subset-and-length rules, and mutual exclusivity of the two late-fee shapes (`clients_late_fee_shape`, requiring `late_fee_note_on_reminders` to have a fee behind it).

Two triggers keep `you_invoice` honest in both directions: `pilot.clients_refuse_stop_invoicing` refuses flipping `you_invoice` from true to false while the client has any invoice, estimate, or recurring schedule; `pilot.refuse_billing_a_non_invoiced_client` refuses creating a new invoice, estimate, or schedule pointed at a client that already has `you_invoice = false`. Together they make "every billing document belongs to a client with `you_invoice = true`" an invariant — the second trigger reads the client row `FOR SHARE` specifically to close a race where an invoice insert and a `you_invoice` flip happen concurrently.

`clients_autopay_consistent` requires all five `autopay_*` columns to be null or non-null together — a half-saved autopay mandate is unstorable, not just discouraged by convention.

### Changing this table

Most columns take normal `authenticated` INSERT/UPDATE. The five `autopay_*` columns are withheld from every authenticated grant — they're a consent record written only by the Stripe Connect webhook and service-role. Do not write them from the app; see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) if you're editing them by hand in the SQL Editor, since that bypasses the grant entirely.

```sql
begin;
update pilot.clients
set payment_terms_days = 15, minimum_basis = 'per_month'
where account_id = '<account-uuid>' and id = '<client-uuid>';
select * from pilot.clients where id = '<client-uuid>';
rollback; -- or commit;
```

## trips

A trip is a single engagement of contract flying for a client (or an owner/ferry/maintenance/repositioning/delivery flight not billed to anyone). It's the top-level unit the rest of the billing chain hangs off: `trip_days` for daily billing, `trip_legs` for the actual flying, `invoice_lines` for what got billed. No table-level comment is present in the schema.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null. Owning tenant.

#### `client_id`
`uuid`, nullable. The client this trip bills to; null for owner/ferry/maintenance trips with no billing relationship.

#### `trip_kind`
`text`, not null, default `'contract_pilot'`. One of `owner_trip`, `ferry`, `maintenance_flight`, `repositioning`, `contract_pilot`, `delivery_flight`, `other`.

#### `status`
`text`, not null, default `'scheduled'`. One of `scheduled`, `in_progress`, `completed`, `canceled`, `hold`. `hold` (added 2026-08-14) is a tentative, unconfirmed calendar block — it deliberately behaves like `canceled` to every revenue path (the unbilled-money view, the invoice trip picker, and the committed-invoice check all require `completed`) without being conflated with an actual cancellation. The Overview reminder panels allow-list `scheduled`/`in_progress` explicitly.

#### `starts_on`, `ends_on`
`date`, not null. The trip's date span.

#### `aircraft_ident`, `aircraft_type`
`text`, both nullable. Free-text tail number and aircraft type.

#### `day_rate_cents`
`bigint`, not null, default `0`, must be `>= 0`. The flight-day rate for this trip, prefilled from the client's `default_day_rate_cents` but independently editable per trip.

#### `day_count`
`numeric`, not null, default `0`, must be `>= 0`. Total billable days for the trip (half-days representable — see `trip_days.quantity` for why).

#### `billing_state`
`text`, not null, default `'unbilled'`. One of `unbilled`, `invoiced`, `paid`, `written_off`.

#### `notes`
`text`, nullable.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

#### `travel_day_count`
`integer`, not null, default `0`, must be `>= 0`. Number of travel/positioning days on this trip.

#### `travel_day_rate_cents`
`bigint`, nullable, must be `>= 0` if set. The travel-day rate for this trip.

#### `canceled_at`
`timestamptz`, nullable. When this trip most recently transitioned into `status='canceled'`, set only by the `pilot.trips_set_canceled_at()` trigger — never by the app directly (withheld from every grant, same pattern as `billing_state`/`updated_at`). Null for a trip canceled before this column existed (there's genuinely no way to know when) or one never canceled. Deliberately has no CHECK requiring it be set when `status='canceled'` — that would have failed the migration outright on every pre-existing canceled trip; the invoice-draft flow's warning says "unknown" rather than fabricating a timestamp.

#### `cancellation_notice_from`
`text`, nullable. One of `client`, `pilot`, `weather`, `maintenance`, `other`. Freely pilot-editable, unlike `canceled_at` — this is the pilot's own record of the circumstance, not a system fact, at the same trust level as `clients.cancellation_policy_note`.

#### `operating_rule`
`text`, not null, default `'part_91'`. One of `part_91`, `part_135` — always exactly one for a given trip, unlike `clients.operating_rule` which can be `both`. Defaults from the client's `operating_rule` at trip creation (app-layer) and is independently editable per trip, since a contract pilot can fly the same airframe under both parts for the same client on different days.

### Notable constraints

RLS is enabled. CHECK constraints enforce the `trip_kind`/`status`/`operating_rule` enums and non-negative rate/count columns. A trigger (`pilot.trips_set_canceled_at`) sets `canceled_at` automatically on any transition into `status='canceled'` — that column is withheld from the authenticated grant entirely, so it can't be typed in after the fact to make a cancellation look better-documented than it was.

### Changing this table

Normal edits go through the authenticated grants; `canceled_at` is system-set only.

```sql
begin;
update pilot.trips
set status = 'completed', day_count = 3.5
where account_id = '<account-uuid>' and id = '<trip-uuid>';
select * from pilot.trips where id = '<trip-uuid>';
rollback; -- or commit;
```

## trip_legs

One row per flight leg of a trip, holding the flight-time and logbook-relevant data (block hours, night/instrument splits, landings, approaches). This is what feeds `logbook_entries` — see the crew/documents domain file for that side. No table-level comment is present in the schema.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `trip_id`
`uuid`, not null. The parent trip.

#### `leg_date`
`date`, not null.

#### `from_icao`, `to_icao`
`text`, both nullable, each must match `^[A-Z0-9]{3,4}$` if set. Departure and arrival identifiers.

#### `out_at`, `in_at`
`timestamptz`, both nullable. Block-out and block-in times.

#### `block_hours`
`numeric`, nullable, must be `>= 0` if set.

#### `night_hours`
`numeric`, nullable, must be `>= 0` if set.

#### `instrument_hours`
`numeric`, nullable, must be `>= 0` if set. **Legacy total**, kept only for rows written before the actual/simulated split existed below. New capture should use `instrument_actual_hours` / `instrument_simulated_hours` instead — this column is not their sum and must not be treated as authoritative when either is present.

#### `day_landings`
`integer`, not null, default `0`, must be `>= 0`.

#### `night_takeoffs`
`integer`, not null, default `0`, must be `>= 0`.

#### `night_landings_full_stop`
`integer`, not null, default `0`, must be `>= 0`.

#### `night_landings_touch_go`
`integer`, not null, default `0`, must be `>= 0`.

#### `approaches`
`integer`, not null, default `0`, must be `>= 0`.

#### `holds`
`integer`, not null, default `0`, must be `>= 0`.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

#### `day_takeoffs`
`integer`, not null, default `0`, must be `>= 0`. Counted separately from `day_landings` per 61.57(a)(1), which requires takeoffs and landings tracked independently — a leg can be flown by one pilot and landed by another.

#### `day_landings_full_stop`
`integer`, not null, default `0`, must be `>= 0`. How many of `day_landings` were to a full stop; a subset, since 61.57(a)(1) only requires full-stop landings for tailwheel aircraft.

#### `cross_country_hours`
`numeric`, nullable, must be `>= 0` if set. Industry convention and rating/insurance evidence — not required by 61.51(b), which does not name cross-country among the per-flight entries.

#### `instrument_actual_hours`
`numeric`, nullable, must be `>= 0` if set. 61.51(b)(3)(ii). Deliberately never backfilled from the legacy `instrument_hours` total — a row that only holds a total doesn't know the actual/simulated split, and inventing one would put a fabricated number in a legal record.

#### `instrument_simulated_hours`
`numeric`, nullable, must be `>= 0` if set. 61.51(b)(3)(iii). Same no-backfill rule as `instrument_actual_hours`.

### Notable constraints

RLS is enabled. CHECK constraints enforce ICAO-code format and non-negative hours/counts.

### Changing this table

Straightforward authenticated edits.

```sql
begin;
update pilot.trip_legs
set block_hours = 2.3, night_hours = 0.5
where account_id = '<account-uuid>' and id = '<leg-uuid>';
select * from pilot.trip_legs where id = '<leg-uuid>';
rollback; -- or commit;
```

## day_types

A tenant-owned taxonomy of what a day of work is called and what it pays — "flight day", "travel day", "standby", whatever the pilot names them. `invoice_line_type` is the boundary: the tenant can name a day type freely, but it must bill as one of a fixed set of invoice line types, because downstream triggers branch on those fixed values.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `key`
`text`, not null, must match `^[a-z][a-z0-9_]{0,30}$`. A stable machine key for the day type.

#### `label`
`text`, not null, trimmed length between 1 and 60. The display name.

#### `billable`
`boolean`, not null, default `true`. Whether this day type is billable at all.

#### `counts_for_per_diem`
`boolean`, not null, default `true`. Whether days of this type count toward per-diem. Combined with the per-day `away` flag on `trip_days` — a day type alone can only say "the kind of day per diem is meant for," never "this specific day was away."

#### `default_rate_cents`
`bigint`, nullable, must be `>= 0` if set. Default rate for this day type, resolved into `trip_days.rate_cents` at capture time.

#### `invoice_line_type`
`text`, not null, default `'flight_day'`. One of `flight_day`, `travel_day`, `other` — which fixed invoice-line bucket this day type bills into.

#### `sort_order`
`integer`, not null, default `0`. Display order.

#### `is_builtin`
`boolean`, not null, default `false`. Marks a system-seeded day type; withheld from the authenticated UPDATE grant's ability to change it (not in the INSERT/UPDATE column lists at all — read-only to the app).

#### `archived_at`
`timestamptz`, nullable. Soft-archive marker.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

#### `default_units`
`numeric`, nullable, must be `> 0` and `<= 1` if set. The rate fraction a day of this type bills at by default (e.g. `0.5` for "travel pays half"). Resolved at `trip_days` capture, same as `default_rate_cents`, and snapshotted onto `trip_days.units` at that point — never re-resolved at invoice time. Null means no default fraction recorded; the app falls back to 1.00 (full rate), never a guess.

### Notable constraints

RLS is enabled. CHECK constraints enforce the `key` format, `label` length, the `invoice_line_type` enum, and the `default_units` fraction range.

### Changing this table

`is_builtin` is not writable by the app (absent from both INSERT and UPDATE grant lists) — a built-in day type's flag can only be changed via a migration or the SQL Editor. Everything else is normal authenticated territory.

```sql
begin;
insert into pilot.day_types (account_id, key, label, invoice_line_type, default_rate_cents)
values ('<account-uuid>', 'standby', 'Standby Day', 'other', 50000);
rollback; -- or commit;
```

## trip_days

One row per calendar day of a trip. `rate_cents` is snapshotted at capture — never re-resolved from `day_types`, because a later rate change on the day type must not restate work already flown.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `trip_id`
`uuid`, not null.

#### `day_on`
`date`, not null.

#### `day_type_id`
`uuid`, not null. Which `day_types` row this day was captured as.

#### `rate_cents`
`bigint`, not null, default `0`, must be `>= 0`. The dollar rate this day bills at, copied from `day_types.default_rate_cents` (or overridden) at capture time and never re-derived afterward.

#### `notes`
`text`, nullable.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

#### `quantity`
`numeric`, not null, default `1`, must be `> 0` and `<= 1`. Fraction of the day actually worked, 0.1 to 1.0. Exists so the half-days that `trips.day_count` always allowed remain representable at the per-day level — without it, converting a 2.5-day trip into day rows would silently drop half a day of billing.

#### `units`
`numeric`, not null, default `1.00`, must be `> 0` and `<= 1`. The rate fraction this day bills at, snapshotted at capture like `rate_cents` — never re-resolved from `day_types.default_units`, for the same reason. **Distinct from `quantity`**: `quantity` is *time worked* (a half day worked bills half); `units` is *money* (a full day worked can still bill at a fraction of the day rate, e.g. a travel day paying half). The invoice-draft builder multiplies `units` into a row's contribution to its billing group's summed quantity. Default `1.00` is what every row written before this column existed already meant.

#### `away`
`boolean`, not null, default `false`. Whether this day was away from home base. Per-diem counting requires both `day_types.counts_for_per_diem` *and* this flag — a day type alone can't say "away", only "the kind of day per diem is meant for." Defaults false because the app records no home base anywhere, so "away" can never be inferred, only entered by hand; false is the under-count direction (a missed per-diem line is visible and correctable), unlike a default of `true`, which would risk silently over-billing. Rows written before this column existed also read false, since there was no away/home-base distinction for them to express.

### Notable constraints

RLS is enabled. CHECK constraints enforce non-negative `rate_cents` and the `(0, 1]` ranges on `quantity` and `units`.

### Changing this table

`rate_cents` and `units` are both snapshots — see the warning above. If you're fixing a genuinely wrong captured value (not trying to reflect a rate change), edit it directly and understand it will not automatically propagate anywhere; already-generated invoice lines are their own separate snapshot.

```sql
begin;
update pilot.trip_days
set rate_cents = 55000, units = 1.00
where account_id = '<account-uuid>' and id = '<trip-day-uuid>';
select * from pilot.trip_days where id = '<trip-day-uuid>';
rollback; -- or commit;
```

## client_rates

A per-client × day-type rate override. Consulted **only** at day capture, to fill `trip_days.rate_cents` — it is never read at invoice time, so editing a rate here has no retroactive effect on days already captured or invoices already drafted.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `client_id`
`uuid`, not null. Which client this override applies to.

#### `day_type_id`
`uuid`, not null. Which day type this override applies to.

#### `rate_cents`
`bigint`, not null, must be `>= 0`. The overriding rate.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled. `rate_cents >= 0` by CHECK.

### Changing this table

Normal authenticated INSERT/UPDATE, but `rate_cents` is the only UPDATE-able column — `client_id` and `day_type_id` are fixed at insert (rewrite the row instead of retargeting an existing override).

```sql
begin;
insert into pilot.client_rates (account_id, client_id, day_type_id, rate_cents)
values ('<account-uuid>', '<client-uuid>', '<day-type-uuid>', 60000);
rollback; -- or commit;
```

## guarantee_periods

One row per (client, calendar month) that a monthly-guarantee client (`clients.minimum_basis = 'per_month'`) has been drafted against. `settled_invoice_id`, once set, is what stops the invoice-draft builder from emitting a second top-up line for a month that's already been settled on another invoice — the same unrepeatable-write role `invoice_number_sequences` plays for invoice numbers.

**Known gap**, stated plainly in the table's own comment: voiding the settling invoice does not clear `settled_invoice_id` (the `ON DELETE SET NULL` foreign key only fires on invoice *deletion*, and this schema voids invoices rather than deleting them). That leaves a period reading as "settled" with no live document behind it. This is not resolved in the schema today — a pilot in that situation has to fix it by hand.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `client_id`
`uuid`, not null.

#### `period_month`
`date`, not null, must equal `date_trunc('month', period_month)` — i.e. always the first of the month.

#### `guaranteed_days`
`numeric`, not null, must be `> 0`. The guaranteed minimum for this month; can move if a contract's guarantee changes mid-month (recorded going forward, not retroactively recomputed).

#### `settled_invoice_id`
`uuid`, nullable. The invoice that topped up this month's guarantee, once one has. See the known-gap note above for what "nullable" and "set" actually guarantee.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled. `period_month` is CHECK-constrained to a month boundary; `guaranteed_days > 0` by CHECK. A foreign key ties `settled_invoice_id` to `pilot.invoices` with `ON DELETE SET NULL` (which — see above — doesn't help once invoices are voided rather than deleted).

### Changing this table

Ordinary edits are authenticated-writable. Manually clearing `settled_invoice_id` is the documented workaround for the known gap above (a period settled against a void invoice).

```sql
begin;
update pilot.guarantee_periods
set settled_invoice_id = null
where account_id = '<account-uuid>' and id = '<period-uuid>';
select * from pilot.guarantee_periods where id = '<period-uuid>';
rollback; -- or commit;
```

## invoice_number_sequences

One row per account, created automatically by the `accounts_seed_invoice_sequence` trigger on account creation so numbering can never be skipped for a new tenant. Advanced only by `pilot.next_invoice_number()`, which increments and returns the next number in one atomic `UPDATE`.

### Columns

#### `account_id`
`uuid`, primary key, not null. One row per tenant.

#### `next_number`
`integer`, not null, default `1`, must be `> 0`. The next sequence integer to hand out. Combined with the account's `invoice_prefix` and the current year to build a number like `ACME-2026-0004`.

### Notable constraints

RLS is enabled, but `authenticated` holds only SELECT on this table — there is no INSERT or UPDATE grant at all. The only writer is `pilot.next_invoice_number(target_account_id uuid)`, a `SECURITY DEFINER` function with an explicit tenancy check in its body (it verifies the caller is a member of `target_account_id` before touching any row, since `SECURITY DEFINER` bypasses RLS entirely and that check *is* the tenancy boundary). It increments `next_number` and returns the pre-increment value in one atomic statement, so two concurrent invoice issues can never collide on the same number.

### Changing this table

This table is not directly writable by the app at all — invoice numbering is issued exclusively through `pilot.next_invoice_number()`, called when an invoice transitions out of draft (see `invoices` below). There is no reason to write `next_number` by hand except to correct a genuinely corrupted sequence, and doing so in the SQL Editor bypasses both the grant and the tenancy check baked into the function — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

## invoices

The billing document itself, auto-drafted from a trip's facts and reviewed and sent by the pilot — never sent silently. **Immutable once issued**: a trigger locks down every column except `status`, `sent_at`, `delivery_method`, `notes`, `reminders_suppressed`, and the Stripe payment-link columns the moment an invoice leaves `draft`.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `client_id`
`uuid`, nullable since a later migration. Null means this invoice bills the typed `bill_to_*` columns instead of a `clients` row (a one-off client, or someone the pilot never added as a full client record). When set, every reader takes the client's *current* details — this pointer doesn't snapshot the client. Exactly one of `client_id` / `bill_to_name` is present, enforced by the `invoices_bill_to_or_client` CHECK.

#### `invoice_number`
`text`, nullable. Null while the invoice is a draft; assigned exactly once, atomically, via `pilot.next_invoice_number()` at the moment the invoice transitions out of draft. Never reassigned or editable afterward.

#### `status`
`text`, not null, default `'draft'`. One of `draft`, `sent`, `partial`, `paid`, `void`. A forward-only state machine (see **Notable constraints**) — `paid` and `void` are terminal.

#### `issued_on`
`date`, nullable. The invoice date.

#### `due_on`
`date`, nullable. Computed from `issued_on` + the client's `payment_terms_days` at issue time (app-layer), then independently editable.

#### `sent_at`
`timestamptz`, nullable. When the invoice was actually sent; writable even after issue.

#### `tax_rate_bps`
`integer`, not null, default `0`, must be between 0 and 2500 (0–25%) — capped to catch an order-of-magnitude typo.

#### `delivery_method`
`text`, nullable, one of `platform_email`, `manual_download` if set.

#### `notes`
`text`, nullable. Writable even after issue.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

#### `stripe_payment_link_id`
`text`, nullable. A Stripe Payment Link id, created as a **direct charge** on the pilot's own connected account (no application fee is ever taken). Cleared on Connect disconnect.

#### `stripe_payment_link_url`
`text`, nullable. The public URL for the id above — not a secret; it's the exact link Stripe already hands anyone who has it.

#### `stripe_payment_link_livemode`
`boolean`, nullable. Whether the link was created in live or test mode, so a test link can never render as payable on a live-keyed deployment or vice versa.

#### `stripe_payment_link_amount_cents`
`bigint`, nullable, must be `> 0` if set. The balance the stored link was created to collect — a Payment Link is a snapshot of a fixed price, so this is what lets the UI tell the pilot whether the live link still matches the current balance due.

#### `reminders_suppressed`
`boolean`, not null, default `false`. Per-invoice override: `true` means no scheduled reminder is ever sent for this invoice, regardless of the client's reminder policy. Deliberately not a full mirrored copy of the client's ladder — the one thing a pilot needs to say about a *specific* invoice is "leave this one alone." Writable even after the invoice is issued (it's in the immutability trigger's allow-list), because the moment a pilot wants to silence a chase is always after the invoice already went out.

#### `bill_to_name`
`text`, nullable. Present exactly when `client_id` is null; never read when `client_id` is set.

#### `bill_to_contact_name`, `bill_to_email`, `bill_to_address_line1`, `bill_to_address_line2`, `bill_to_city`, `bill_to_state`, `bill_to_postal_code`, `bill_to_country`
`text`, all nullable. Typed billing details for a clientless invoice, mirroring the corresponding `clients` columns. `bill_to_email` is also where a reminder for a clientless invoice would go — though no *scheduled* reminder run ever fires for one, since that schedule is per-client.

### Notable constraints

RLS is enabled. `invoices_bill_to_or_client` (CHECK) requires exactly one of `client_id` set / `bill_to_name` (and the rest of the `bill_to_*` block) set — never both, never neither.

Three triggers do the real work here:

- **`invoices_force_draft_on_insert`** refuses any non-`service_role` `INSERT` that tries to set `status`, `invoice_number`, or `sent_at` to anything but their defaults — every new invoice is forced to start as an unnumbered draft. (The column-scoped INSERT grant already makes this unreachable for `authenticated`, but the trigger closes the gap for any other privileged caller.)
- **`invoices_protect_issued`** is a forward-only state machine on `status`: `draft` → `sent`/`void`; `sent` → `partial`/`paid`/`void`; `partial` → `paid`/`void`. `paid` and `void` are terminal. Leaving `draft` for `sent` requires at least one line item to exist, and re-validates every existing line's trip against the invoice's final `client_id` (closing a gap where lines were attached under one client and the invoice's `client_id` was switched in the same update). Moving to `partial`/`paid` requires `pilot.invoice_totals.amount_paid_cents > 0`; moving to `paid` additionally requires `balance_due_cents <= 0` (overpayment is allowed to reach paid; a genuinely outstanding balance is not). Once an invoice leaves `draft`, every column *except* `status`, `sent_at`, `delivery_method`, `notes`, `reminders_suppressed`, and the four `stripe_payment_link_*` columns becomes structurally frozen — the check diffs the whole row rather than enumerating forbidden columns, so a future column added to this table is protected automatically.
- **`invoices_assign_number_on_issue`** calls `pilot.next_invoice_number()` at the moment `status` leaves `draft`, writing the result into `invoice_number`.

There is no stored subtotal, tax, or total on this table — those are always computed live by the `pilot.invoice_totals` view from `invoice_lines` and `invoice_payments`, specifically to avoid a second source of truth for numbers that must reconcile (a payments ledger and a stored total drifting apart is the classic failure mode this design avoids).

### Changing this table

A draft invoice (`status = 'draft'`) is freely editable through the authenticated grants. An issued invoice is not: only `status`, `sent_at`, `delivery_method`, `notes`, `reminders_suppressed`, and the Stripe payment-link fields can change after issue, and `status` itself can only move forward through the state machine above. `invoice_number` is never directly writable — it's assigned only by `pilot.next_invoice_number()` when the invoice leaves draft. Editing a supposedly-frozen column on an issued invoice, or hand-assigning a number, only "works" from the SQL Editor because it runs as the table owner and bypasses these triggers' RLS-adjacent assumptions — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md); doing so directly contradicts the immutability this table exists to guarantee and can desynchronize the numbering sequence.

```sql
-- Safe: editing a still-draft invoice
begin;
update pilot.invoices
set tax_rate_bps = 875, due_on = '2026-09-15'
where account_id = '<account-uuid>' and id = '<invoice-uuid>' and status = 'draft';
select * from pilot.invoices where id = '<invoice-uuid>';
rollback; -- or commit;
```

## invoice_lines

The individual line items on an invoice — flight days × rate, travel days × rate, per diem × days, reimbursable expenses, cancellation fees, or a free-text line. The expense-treatment tag (rebill vs. deduct) is set once, at expense capture (`expenses.treatment`), and this table only *consumes* that decision via `expense_id` — it never re-asks rebill-vs-deduct at billing time.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `invoice_id`
`uuid`, not null.

#### `line_type`
`text`, not null, one of `flight_day`, `travel_day`, `per_diem`, `reimbursable_expense`, `cancellation_fee`, `other`.

#### `description`
`text`, not null. The line's printed text.

#### `quantity`
`numeric`, not null, default `1`, must be `> 0`.

#### `unit_amount_cents`
`bigint`, not null, must be `>= 0`.

#### `amount_cents`
`bigint`, **generated column**, `round(quantity * unit_amount_cents)`, stored. Never entered directly — `quantity × unit_amount_cents` is the only source, so a line's total can never drift from its own inputs.

#### `taxable`
`boolean`, not null, default `true`. Per-line, not invoice-wide, because a day-rate line is typically taxable as a service while a straight expense reimbursement commonly isn't (state-dependent — the app is responsible for setting this correctly per the pilot's own state rules). `pilot.invoice_totals` computes `tax_cents` from taxable lines only.

#### `trip_id`
`uuid`, nullable. Which trip this line bills, when it's trip-derived.

#### `expense_id`
`uuid`, nullable. Which expense this line rebills, when it's expense-derived.

#### `expense_treatment`
`text`, nullable, must be `'rebill'` if set. Mirrors the treatment already recorded on the linked expense — a composite foreign key ties `(expense_id, expense_treatment)` back to `(expenses.id, expenses.treatment)`, so a line can never claim a rebill treatment the expense itself doesn't carry.

#### `sort_order`
`integer`, not null, default `0`. Display order on the invoice.

#### `created_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled. `line_type` enum, `quantity > 0`, `unit_amount_cents >= 0`, and `expense_treatment` restricted to `rebill` are all CHECK-enforced. `amount_cents` being generated means it cannot be inserted or updated directly — attempting to write it is rejected by Postgres itself, not an app-layer rule. Once a line's parent invoice is issued, `invoices_protect_issued`'s re-validation (see `invoices` above) revalidates every line's trip against the invoice's client at the moment of issue; there's a companion trigger (referenced in the invoices migration) that also refuses reparenting a line off an issued invoice by editing `invoice_id`.

### Changing this table

Lines on a draft invoice are freely authenticated-writable. Lines on an issued invoice are effectively frozen by the parent invoice's immutability (see `invoices` above) — the SQL Editor can still write them directly since it bypasses that protection; see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

```sql
begin;
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, taxable)
values ('<account-uuid>', '<invoice-uuid>', 'flight_day', 'Flight day 8/1–8/3', 3, 65000, true);
rollback; -- or commit;
```

## invoice_payments

One row per payment received against an invoice, dated. `pilot.invoice_totals` sums this table to derive `amount_paid_cents` and `last_paid_on` — those figures are never stored on `invoices` itself.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `invoice_id`
`uuid`, not null.

#### `paid_on`
`date`, not null, must be `<= current_date + 1`.

#### `amount_cents`
`bigint`, not null, must be `<> 0` (positive for a payment, negative for a reversal — see `reverses_payment_id`).

#### `method`
`text`, nullable, one of `ach`, `check`, `wire`, `card`, `cash`, `other` if set.

#### `notes`
`text`, nullable.

#### `created_at`
`timestamptz`, not null, default `now()`.

#### `reverses_payment_id`
`uuid`, nullable. Set on a correction row, naming the payment it cancels. A correction row carries exactly the negative of the reversed payment's amount and the same invoice. The reversed row itself is never edited or deleted — this ledger is append-only, so both what was recorded and what corrected it stay readable.

#### `reversal_reason`
`text`, nullable. Why the pilot corrected it, in their own words — shown beside the reversal so "typo, meant $450" reads as an explained correction rather than an unexplained discrepancy six months later.

#### `source`
`text`, not null, default `'manual'`, one of `manual`, `stripe_link`, `stripe_autopay`. `manual` — a pilot typed it. `stripe_link` — the Stripe Connect webhook recorded a payment against this invoice's Payment Link. `stripe_autopay` — the webhook recorded an off-session autopay charge. Withheld from the authenticated INSERT grant: `manual` is the only value a tenant can produce directly.

#### `stripe_payment_intent_id`
`text`, nullable. The Stripe PaymentIntent behind a `stripe_link` row, and the key that makes auto-recording idempotent/safe to retry. Withheld from the authenticated INSERT grant. Always null on a manual row, including a manual correction of an auto-recorded payment — the correction is the pilot's own act, not Stripe's.

### Notable constraints

RLS is enabled. `amount_cents <> 0` and the `method`/`source` enums are CHECK-enforced. This is an append-only ledger by convention: there is no UPDATE grant on this table at all for `authenticated` — the only way to correct a payment is to insert a new row with `reverses_payment_id` pointing at the one being corrected.

### Changing this table

INSERT-only for the app — there is no authenticated UPDATE grant, so a wrong payment is corrected by inserting a reversal row, never by editing the original. `source` and `stripe_payment_intent_id` are gated to service-role/webhook writes only; the SQL Editor bypasses that gate as it does everywhere else — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

```sql
-- Record a correction, not an edit
begin;
insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, method, reverses_payment_id, reversal_reason)
values ('<account-uuid>', '<invoice-uuid>', current_date, -45000, 'check', '<original-payment-uuid>', 'typo, meant $450 not $900');
rollback; -- or commit;
```

## client_tax_forms

The 1099 the client issued, as the client reported it — reconciled on the year-end report against `invoice_payments` (the pilot's own cash-basis ledger). A delta between the two is normal (December/January payment timing), not necessarily an error. This is not tax advice; the pilot's CPA is the authority on what to do with any delta.

### Columns

#### `id`
`uuid`, primary key, default `gen_random_uuid()`.

#### `account_id`
`uuid`, not null.

#### `client_id`
`uuid`, not null.

#### `tax_year`
`integer`, not null, must be between 2000 and 2100.

#### `form_type`
`text`, not null, default `'1099-NEC'`, one of `1099-NEC`, `1099-MISC`, `other`.

#### `reported_amount_cents`
`bigint`, not null, must be `>= 0`. The amount the client's 1099 reports — as reported, not recomputed.

#### `received_on`
`date`, nullable. When the form arrived.

#### `document_id`
`uuid`, nullable. Link to the stored copy of the form in `documents`.

#### `notes`
`text`, nullable.

#### `created_at`, `updated_at`
`timestamptz`, not null, default `now()`.

### Notable constraints

RLS is enabled. `tax_year` range and the `form_type` enum are CHECK-enforced.

### Changing this table

Ordinary authenticated INSERT/UPDATE — this table is a record of what the client reported, not a computed figure, so editing it is just correcting the record.

```sql
begin;
insert into pilot.client_tax_forms (account_id, client_id, tax_year, form_type, reported_amount_cents, received_on)
values ('<account-uuid>', '<client-uuid>', 2025, '1099-NEC', 4820000, '2026-01-28');
rollback; -- or commit;
```
