# Tenancy & Auth

Five tables: `accounts` is the tenant itself; `account_members` is who belongs to it and with what role; `account_preferences` holds one tenant's UI settings; `custom_options` holds one tenant's renameable pickers; `connect_oauth_states` is a short-lived, unreadable proof used only mid-OAuth.

## accounts

The tenant row. One `accounts` row is one pilot's business — solo (one person) or business (multiple seats) — and every other table in the `pilot` schema hangs off it by `account_id`. A solo account has exactly one `account_members` row; a business account may have more. This table also carries the tenant's own business profile (legal name, address, airman certificate info, default billing rates) and everything about its relationship with this product's own billing (Stripe subscription, plan, hold/deactivation state) — those two concerns share a table because they're both one-per-tenant facts, but they're granted very differently, as the column list below shows.

### Columns

#### `id`
`uuid`, not null, defaults to `gen_random_uuid()`. The tenant's primary key. Every tenant-scoped table in this schema carries this value as `account_id`.

#### `kind`
`text`, not null. Either `'solo'` or `'business'` (enforced by CHECK). This is the billing-shape vocabulary: `'solo'` means flat-rate single-seat, `'business'` is the (currently unused) per-seat shape. Don't confuse this with `plan_tier` below — `kind` is about how billing is *shaped*, `plan_tier` is about what tier of *features* the tenant gets.

#### `legal_name`
`text`, not null. The pilot's (or their business's) legal name, used on invoices and documents.

#### `address_line1`, `address_line2`, `city`, `state`, `postal_code`, `country`
All `text`, all nullable. The tenant's mailing/business address, used on invoices.

#### `logo_url`
`text`, nullable. URL to the tenant's logo image, shown on invoices and in the app chrome.

#### `plan`
`text`, nullable. Either `'solo'` or `'business'` when set (CHECK allows NULL too). This is decision-level billing-shape vocabulary, distinct from `plan_tier` — see `kind` above for the same distinction.

#### `seat_count`
`integer`, not null, defaults to `1`. Must be `>= 1` (CHECK). How many seats this account is provisioned for.

#### `stripe_customer_id`
`text`, nullable, unique. The Stripe customer id for this tenant's own (platform) subscription — not to be confused with `connect_account_id` below, which is a completely separate Stripe integration (the pilot billing *their own* clients). NULL means the account is comped (no real Stripe subscription) — see `demo_cancel_at_period_end` below for what that unlocks.

#### `stripe_subscription_id`
`text`, nullable, unique. The Stripe subscription id backing this tenant's platform billing.

#### `trial_ends_at`
`timestamp with time zone`, nullable. When the tenant's free trial ends.

#### `status`
`text`, not null, defaults to `'trialing'`. One of `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused` (CHECK) — Stripe's own subscription status vocabulary, mirrored here so the app can gate on it without calling Stripe on every request. Written only by the Stripe webhook's service-role client (see Notable constraints).

#### `connect_account_id`
`text`, nullable, unique. Must match `^acct_[A-Za-z0-9]+$` or be NULL (CHECK). The Stripe Connect (Standard) account id for this pilot's *own* Stripe account — the one they use to bill their clients. The pilot is merchant of record for their own invoices; funds never route through this platform's Stripe balance. Because it's UNIQUE, if it were ever made client-writable a malicious INSERT/UPDATE attempt could leak whether a given `acct_...` id already belongs to some other tenant via a constraint-violation error — so it must stay service_role-only, and it is (see Notable constraints).

#### `invoice_prefix`
`text`, not null, defaults to `'INV'`. Prefix used when minting this tenant's invoice numbers.

#### `created_at`
`timestamp with time zone`, not null, defaults to `now()`.

#### `updated_at`
`timestamp with time zone`, not null, defaults to `now()`.

#### `estimate_prefix`
`text`, not null, defaults to `'EST'`. Prefix used when minting this tenant's estimate numbers.

#### `plan_tier`
`text`, not null, defaults to `'solo'`. One of `solo`, `pro`, `business` (CHECK). This is the entitlement ladder — what feature depth the app gates on (see `lib/entitlements.ts`). Written only by the Stripe webhook's service-role client, mapped from the subscription's Stripe price id (`lib/entitlements.ts`'s `tierForPriceId`, `lib/stripe/provisioning.ts`). Withheld from the tenant's UPDATE grant and enforced by the `protect_account_billing_columns` trigger.

#### `last_billing_event_at`
`timestamp with time zone`, not null, defaults to `-infinity`. A watermark: the Stripe `created` timestamp of the most recent billing event actually applied to this account. Written only by the webhook, in the same conditional `UPDATE ... WHERE last_billing_event_at < incoming` that applies `status`/`plan_tier` — this is what stops an out-of-order webhook delivery from clobbering a newer state with an older one. Also protected by the billing-columns trigger.

#### `onboarding_complete`
`boolean`, not null, defaults to `false`. Whether the tenant has finished the post-checkout onboarding wizard.

#### `dba_name`
`text`, nullable. "Doing business as" name, if different from `legal_name`.

#### `phone`
`text`, nullable.

#### `home_base`
`text`, nullable. The pilot's home airport/base.

#### `certificate_type`
`text`, nullable. One of `student`, `sport`, `recreational`, `private`, `commercial`, `atp`, or NULL (CHECK). The pilot's FAA airman certificate level.

#### `certificate_number`
`text`, nullable. The pilot's FAA certificate number.

#### `ratings`
`text`, nullable. Free-text description of the pilot's ratings.

#### `default_day_rate_cents`, `default_travel_day_rate_cents`, `default_per_diem_cents`
All `integer`, nullable, each must be `>= 0` when set (CHECK). Default billing rates in cents, used to prefill trip/invoice line items.

#### `default_payment_terms_days`
`integer`, nullable, must be `>= 0` when set (CHECK). Default number of days a client has to pay an invoice.

#### `reminders_last_run_at`
`timestamp with time zone`, nullable. When the due-reminder pass last completed for this account — scheduled or run by hand. NULL means it has never run. Unlike the columns above, this one is purely operational, not billing state — it's deliberately *not* in the billing-columns protect trigger, and it's shown in Settings so a scheduler that has quietly stopped firing is visible from the UI rather than only discoverable from logs.

#### `demo_cancel_at_period_end`
`boolean`, not null, defaults to `false`. A UI-only cancel/resume toggle that exists solely so a comped account (`stripe_customer_id IS NULL`) can demo the billing screen's cancel button without a real Stripe subscription behind it. It's never read by the Stripe webhook, by `lib/stripe/billing-facts.ts`, or by the read-only-account gate — it only flips a "Cancels"/"Resume" pill in the billing panel. A CHECK constraint (`accounts_demo_cancel_requires_comp`) makes it structurally impossible for this to be `true` on any account that has a real `stripe_customer_id`. Protected by the same billing-columns trigger as every other billing column.

#### `deactivated_at`
`timestamp with time zone`, nullable. Set when the account owner deliberately deactivates the account: the subscription is canceled and the tenant goes read-only, but every record is kept, and reactivation is a normal checkout. This is distinct from a Stripe-driven `status = 'canceled'` (which can also arrive from a simple failed card) — this column specifically records that a human chose it.

#### `hold_started_at`
`timestamp with time zone`, nullable. When the current monthly billing hold began. NULL when the account isn't on hold.

#### `hold_ends_at`
`timestamp with time zone`, nullable. When the current hold expires. At that point the account either resumes, or — absent a live `retention_paid_until` — its business records are purged by `pilot.purge_business_data`/`pilot.expire_hold`. The pilot's airman records (logbook, aircraft, documents, currency) are never touched by this.

#### `retention_paid_until`
`timestamp with time zone`, nullable. Paid data-retention date. While this is in the future, business records survive an expired hold. This is a storage fee, never a ransom on the logbook or documents — those are always kept whether or not this is paid.

#### `business_data_purged_at`
`timestamp with time zone`, nullable. Audit stamp of when `pilot.purge_business_data` last ran for this account, kept so a support question years later has a real answer instead of a guess.

### Notable constraints

RLS is enabled. `authenticated` gets a broad SELECT and INSERT across nearly the whole column list (see next paragraph for what's withheld), but the UPDATE grant is deliberately narrow — a short, explicit list of profile/business columns (`legal_name`, address fields, `dba_name`, certificate/rate defaults, prefixes, `onboarding_complete`, `reminders_last_run_at`, etc.). Billing and entitlement columns (`plan`, `plan_tier`, `status`, `seat_count`, `trial_ends_at`, `last_billing_event_at`, `stripe_customer_id`, `stripe_subscription_id`, `kind`, `demo_cancel_at_period_end`) are **not** in the tenant UPDATE grant at all, and are additionally enforced by the `protect_account_billing_columns` trigger, which raises an exception if any non-`service_role` session tries to change any of them. `connect_account_id` has its own separate write path gated by a `pilot.allow_connect_write` session setting, used only by the Connect-linking function.

Other CHECKs worth knowing: `kind`/`plan`/`plan_tier`/`status`/`certificate_type` are all closed enum-style vocabularies; `seat_count` and the rate/terms columns must be non-negative; `connect_account_id` must match Stripe's `acct_...` shape; a hold must have both `hold_started_at` and `hold_ends_at` or neither (`accounts_hold_window_complete`); and a hold can never run longer than 62 days from when it started (`accounts_hold_within_two_months`).

### Changing this table

Profile fields (name, address, rates, prefixes) are safely editable directly, matching what the tenant UPDATE grant already allows. Billing/entitlement columns are gated on purpose — the SQL Editor bypasses that gate the same as it bypasses everything else in this schema, per [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md), but changing them by hand means bypassing the very trigger designed to keep billing state consistent with Stripe, so treat it as a last resort, not a shortcut.

```sql
begin;
update pilot.accounts
set legal_name = 'New Name LLC', default_day_rate_cents = 65000
where id = '<account-uuid>';
select id, legal_name, default_day_rate_cents from pilot.accounts where id = '<account-uuid>';
rollback; -- or commit;
```

## account_members

Who belongs to an account, and their role within it. A solo account has exactly one row here (`role = 'owner'`); a business account may have several. This is the join between `auth.users` (Supabase Auth's own user table) and `accounts` (the tenant), and it's what every RLS policy in this schema ultimately checks against — a user can only see or touch a tenant's data because a matching `account_members` row says they belong to it.

### Columns

#### `id`
`uuid`, not null, defaults to `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. Foreign key to `pilot.accounts.id`.

#### `user_id`
`uuid`, not null. Foreign key to `auth.users.id`, with `ON DELETE RESTRICT` rather than cascade — deliberately, so that a live membership row is never silently dropped as a side effect of a user account being deleted (e.g. a data-deletion request). Handling that case is an explicit decision this schema currently defers, rather than something that happens for free.

#### `role`
`text`, not null. One of `owner`, `member`, `bookkeeper` (CHECK).

#### `created_at`
`timestamp with time zone`, not null, defaults to `now()`.

### Notable constraints

RLS is enabled. `authenticated` gets INSERT and SELECT on all five columns — but there is no UPDATE grant and no UPDATE policy on this table today, so no client path lets a signed-in user change a membership row's role, account, or user once it exists. `unique (account_id, user_id)` prevents the same person from having two membership rows on the same account. `pilot.current_account_ids()` (a SECURITY DEFINER function that reads this table as its own owning role, sidestepping RLS recursion) is what every other tenant-scoped table's RLS policy calls to determine "does this user belong to this account" — this table is the root of that whole chain.

### Changing this table

There's no product-level "change a member's role" flow yet; the INSERT/SELECT grants exist for account creation and membership listing. A direct edit is a plain UPDATE (bypassing RLS as usual in the SQL Editor, per [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md)):

```sql
begin;
update pilot.account_members
set role = 'bookkeeper'
where account_id = '<account-uuid>' and user_id = '<user-uuid>';
select * from pilot.account_members where account_id = '<account-uuid>';
rollback; -- or commit;
```

## account_preferences

One row per tenant, holding purely cosmetic and layout settings — accent color slot, density, dark mode, nav order, hidden sections. It exists as a single free-form JSON blob rather than one column per setting because nothing in the database ever computes on a preference: no trigger reads it, no view joins it, no total changes because of it. Its only consumer is the React app, which resolves it through a total function with built-in defaults (`lib/theme-slots.ts`), so a new UI switch is just a UI change, never a migration. The row is seeded lazily — the app inserts it the first time a tenant changes any preference — and an absent row is treated identically to one holding `{}`.

### Columns

#### `account_id`
`uuid`, not null. Primary key *and* foreign key to `pilot.accounts.id` — one row per tenant, no separate `id` column needed.

#### `prefs`
`jsonb`, not null, defaults to `'{}'`. Must be a JSON object, not an array/string/number (CHECK: `jsonb_typeof(prefs) = 'object'`), and must stay under 16 KB (a second CHECK on `length(prefs::text)`). The database only guarantees those two shape facts — everything about what keys are meaningful lives in the app's resolver, which is what makes an otherwise-schemaless column safe here.

#### `created_at`
`timestamp with time zone`, not null, defaults to `now()`.

#### `updated_at`
`timestamp with time zone`, not null, defaults to `now()`.

### Notable constraints

RLS is enabled. `authenticated` gets INSERT (on `account_id, prefs`), SELECT (all columns), and UPDATE — but the UPDATE grant covers only `prefs` itself, not `account_id`, `created_at`, or `updated_at`. That's deliberate: because `account_id` isn't UPDATE-grantable, the app can't use PostgREST's `.upsert()` (which compiles to an `ON CONFLICT DO UPDATE` naming `account_id`) — it has to do a plain lookup-then-insert-or-update instead. There is no DELETE grant and no DELETE policy at all: this row is written, but never removed.

### Changing this table

Editing `prefs` directly is safe and matches the app's own grant — just keep it a JSON object under 16 KB.

```sql
begin;
update pilot.account_preferences
set prefs = prefs || '{"density": "compact"}'::jsonb
where account_id = '<account-uuid>';
select * from pilot.account_preferences where account_id = '<account-uuid>';
rollback; -- or commit;
```

## custom_options

The tenant's own filing taxonomy: the label, sort order, and archived/active state of the values that populate the expense-category, trip-kind, and document-kind pickers. This table is taxonomy *only* — it's explicitly not where any state machine lives. Columns like `expenses.treatment`, `invoices.status`, `trips.billing_state`, `invoice_lines.line_type`, and every logbook column are governed by triggers that branch on their exact values, and none of that vocabulary is customizable here. Every tenant gets the same built-in set of options seeded automatically when their account is created (`pilot.seed_custom_options`, fired by an `AFTER INSERT` trigger on `accounts`); a tenant can rename a built-in's label and reorder it, but not delete it — options are archived, never deleted, so historical expenses/trips/documents filed under an old label keep rendering correctly.

### Columns

#### `id`
`uuid`, not null, defaults to `gen_random_uuid()`. Primary key.

#### `account_id`
`uuid`, not null. Foreign key to `pilot.accounts.id`.

#### `domain`
`text`, not null. One of `expense_category`, `trip_kind`, `document_kind` (CHECK). Which picker this option belongs to — this is the product's own vocabulary (each value names a real column elsewhere in the schema and a screen that renders it), not something a tenant can add a fourth value to without a code change.

#### `key`
`text`, not null. Must be non-blank and at most 60 characters (CHECK). The stable handle actually stored on the `expenses`/`trips`/`documents` row that uses this option. Withheld from the UPDATE grant and refused by the `custom_options_protect` trigger — a pilot renames the *label*, never the key, because moving a key would orphan every historical row already filed under it.

#### `label`
`text`, not null. Must be non-blank and at most 80 characters (CHECK). What the pilot actually sees and can freely rename, on any row including built-ins.

#### `sort_order`
`integer`, not null, defaults to `0`. Display order within the domain. Built-ins are seeded with gaps of ten so a tenant can insert a custom option between two of them without renumbering everything.

#### `is_builtin`
`boolean`, not null, defaults to `false`. The seeder's claim about provenance — was this row shipped by the product, or added by the tenant. Withheld from both INSERT and UPDATE grants and refused by the protect trigger: a tenant can neither assert nor retract this flag. It's what makes "this one can't be archived" actually true.

#### `archived_at`
`timestamp with time zone`, nullable. When set, the option is retired from new-record pickers but still renders correctly on historical rows that already used it. Built-in options can never be archived (enforced by the protect trigger) — archiving the last legal value of a picker whose target column still has a CHECK constraint on it would leave a form that can't be satisfied.

#### `created_at`
`timestamp with time zone`, not null, defaults to `now()`.

#### `updated_at`
`timestamp with time zone`, not null, defaults to `now()`.

### Notable constraints

RLS is enabled. `authenticated` gets INSERT on `account_id, domain, key, label, sort_order`; SELECT on everything; and UPDATE limited to `archived_at, label, sort_order` only — `key`, `domain`, and `is_builtin` are all excluded from every client-facing write path. `unique (account_id, domain, key)` is both the natural identity constraint and the `ON CONFLICT` target the seeder uses to be idempotent; `unique (account_id, id)` is a composite-key idiom used elsewhere in this schema so a future tenant-scoped child table can reference an option without being able to reach across tenants.

Beyond the grant, the `custom_options_protect` trigger (skipped only for `service_role`) enforces the same boundaries again at the row level: it refuses any change to `key` or `domain` on an existing row, refuses any change to `is_builtin`, and refuses archiving a row where `is_builtin = true`. Note today's practical limit, worth knowing before you go looking for a missing "add custom option" button: the underlying `expenses.category` / `trips.trip_kind` / `documents.kind` columns still carry their own separate CHECK constraints pinned to the current built-in vocabulary, so this table currently only supports renaming and reordering the built-ins — a brand-new tenant-invented key would be accepted here but rejected by the target column's CHECK the moment a row tried to use it.

### Changing this table

Renaming a label or reordering is a normal UPDATE, matching the app's own grant. Do not repurpose a `key` or flip `is_builtin` even in the SQL Editor — that bypasses the very invariant (`key` stability = historical rows keep resolving) the whole table exists to protect, per [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md).

```sql
begin;
update pilot.custom_options
set label = 'Uber & Lyft', sort_order = 45
where account_id = '<account-uuid>' and domain = 'expense_category' and key = 'rideshare';
select * from pilot.custom_options where account_id = '<account-uuid>' and domain = 'expense_category';
rollback; -- or commit;
```

## connect_oauth_states

A short-lived, single-use proof that a specific signed-in user actually started the Stripe Connect OAuth flow for a specific account. It exists to close a real hole: without it, the function that records a completed Connect linkage would have to trust whatever `acct_...` id and account it was handed, with nothing tying that call back to an actual OAuth round trip. A row here is minted by `pilot.connect_oauth_state_begin` when a pilot clicks "Connect Stripe," and consumed (deleted) by `pilot.connect_account_link` when Stripe's OAuth callback comes back — both are SECURITY DEFINER functions. RLS is enabled with zero policies, and the table-level SELECT that Postgres would otherwise hand `authenticated` by default is explicitly revoked, so nothing outside those two functions can read or write this table at all — that unreadability is exactly what makes the token unforgeable.

### Columns

#### `state`
`text`, not null. Primary key. Must match `^[A-Za-z0-9_-]{43}$` (CHECK) — 32 random bytes, base64url-encoded with padding stripped, generated inside the database from a CSPRNG. This is the value passed to Stripe as the OAuth `state` parameter and echoed back on the callback.

#### `account_id`
`uuid`, not null. Foreign key to `pilot.accounts.id`. The account the OAuth attempt is *for* — read off this proof by the consuming function rather than re-derived from the caller's session, which is what fixes a real bug an earlier design had (a user in two accounts could have the Connect grant attach to the wrong one).

#### `user_id`
`uuid`, not null. Foreign key to `auth.users.id`. The specific user who started the flow — narrower than just the account, so that one owner starting a flow can't have it completed by a different owner of the same account in a different browser tab.

#### `created_at`
`timestamp with time zone`, not null, defaults to `now()`. Rows are short-lived by construction: starting a new attempt deletes the same user's previous one, anything older than an hour is swept on every mint, and a successful consume deletes the row outright — there's no separate scheduled cleanup job for this table.

### Notable constraints

RLS is enabled with no policies at all (the deny-all case), and `authenticated`/`anon` both have every table-level privilege explicitly revoked — the JSON's `authenticated_grants` for this table is empty, confirming there is genuinely no grant of any kind. This is one of the tables this domain's own comment calls out by name: "nothing outside those two SECURITY DEFINER functions can read or write this table."

### Changing this table

This table is fully gated — there is no direct grant of any kind, and the only legitimate writers are `pilot.connect_oauth_state_begin` (mint) and `pilot.connect_account_link` (consume), both SECURITY DEFINER. Don't insert, select, or update it directly even for debugging; call those functions, or read the linked account's `connect_account_id` on `pilot.accounts` instead of poking at this table. The SQL Editor bypasses this gate the same as every other one in this schema — see [00-SQL-EDITOR-GUIDE.md](./00-SQL-EDITOR-GUIDE.md) — which is exactly why doing so here would defeat the one property this table exists to provide.
