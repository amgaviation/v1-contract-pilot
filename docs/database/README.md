# Database guide

A plain-English reference for every table and column in the `pilot` schema —
what each one is, what each column means, and how to change it safely from
the Supabase SQL Editor. This is the database-layer companion to
`docs/DEV-GUIDE.md`; that file explains where things live in the codebase,
this one explains what's actually stored.

51 tables, 634 columns, covered in full.

## Read this first

**[`00-SQL-EDITOR-GUIDE.md`](./00-SQL-EDITOR-GUIDE.md)** — the safety rules
every other file in this folder assumes you've read: why the SQL Editor
doesn't run as the app's own roles (so none of the app's guardrails protect
you there), the `pilot`-not-`public` schema gotcha, how to look at a table
before touching it, transaction-wrapped testing, generic query templates,
`ALTER TABLE` patterns, and when a change belongs in a migration file
instead of an ad-hoc edit.

## The domain files

| File | Tables |
|---|---|
| [`01-tenancy-auth.md`](./01-tenancy-auth.md) | `accounts`, `account_members`, `account_preferences`, `custom_options`, `connect_oauth_states` |
| [`02-trips-invoicing.md`](./02-trips-invoicing.md) | `clients`, `trips`, `trip_legs`, `day_types`, `trip_days`, `client_rates`, `guarantee_periods`, `invoice_number_sequences`, `invoices`, `invoice_lines`, `invoice_payments`, `client_tax_forms` |
| [`03-billing-automation-stripe.md`](./03-billing-automation-stripe.md) | `estimate_number_sequences`, `estimates`, `estimate_lines`, `recurring_invoice_schedules`, `recurring_invoice_generations`, `invoice_reminder_sends`, `invoice_late_fees`, `stripe_events`, `stripe_connect_events`, `sample_connect_accounts` |
| [`04-expenses-imports.md`](./04-expenses-imports.md) | `expenses`, `mileage_rates`, `mileage_entries`, `bank_accounts`, `bank_import_batches`, `bank_source_files`, `bank_transactions` |
| [`05-logbook-currency-fleet.md`](./05-logbook-currency-fleet.md) | `logbook_import_batches`, `logbook_source_files`, `logbook_entries`, `operator_qualifications`, `aircraft`, `currency_snapshots` |
| [`06-accounting-ledger.md`](./06-accounting-ledger.md) | `accounts_chart`, `journal_entries`, `journal_lines`, `bank_statement_matches` |
| [`07-documents-sharing-crew.md`](./07-documents-sharing-crew.md) | `documents`, `invoice_shares`, `document_shares`, `document_share_items`, `estimate_shares`, `client_vendor_links`, `crew_members` |

## Find a table by name

All 51 tables, alphabetical, pointing at the file that covers them.

| Table | File |
|---|---|
| `account_members` | [01](./01-tenancy-auth.md) |
| `account_preferences` | [01](./01-tenancy-auth.md) |
| `accounts` | [01](./01-tenancy-auth.md) |
| `accounts_chart` | [06](./06-accounting-ledger.md) |
| `aircraft` | [05](./05-logbook-currency-fleet.md) |
| `bank_accounts` | [04](./04-expenses-imports.md) |
| `bank_import_batches` | [04](./04-expenses-imports.md) |
| `bank_source_files` | [04](./04-expenses-imports.md) |
| `bank_statement_matches` | [06](./06-accounting-ledger.md) |
| `bank_transactions` | [04](./04-expenses-imports.md) |
| `client_rates` | [02](./02-trips-invoicing.md) |
| `client_tax_forms` | [02](./02-trips-invoicing.md) |
| `client_vendor_links` | [07](./07-documents-sharing-crew.md) |
| `clients` | [02](./02-trips-invoicing.md) |
| `connect_oauth_states` | [01](./01-tenancy-auth.md) |
| `crew_members` | [07](./07-documents-sharing-crew.md) |
| `currency_snapshots` | [05](./05-logbook-currency-fleet.md) |
| `custom_options` | [01](./01-tenancy-auth.md) |
| `day_types` | [02](./02-trips-invoicing.md) |
| `document_share_items` | [07](./07-documents-sharing-crew.md) |
| `document_shares` | [07](./07-documents-sharing-crew.md) |
| `documents` | [07](./07-documents-sharing-crew.md) |
| `estimate_lines` | [03](./03-billing-automation-stripe.md) |
| `estimate_number_sequences` | [03](./03-billing-automation-stripe.md) |
| `estimate_shares` | [07](./07-documents-sharing-crew.md) |
| `estimates` | [03](./03-billing-automation-stripe.md) |
| `expenses` | [04](./04-expenses-imports.md) |
| `guarantee_periods` | [02](./02-trips-invoicing.md) |
| `invoice_late_fees` | [03](./03-billing-automation-stripe.md) |
| `invoice_lines` | [02](./02-trips-invoicing.md) |
| `invoice_number_sequences` | [02](./02-trips-invoicing.md) |
| `invoice_payments` | [02](./02-trips-invoicing.md) |
| `invoice_reminder_sends` | [03](./03-billing-automation-stripe.md) |
| `invoice_shares` | [07](./07-documents-sharing-crew.md) |
| `invoices` | [02](./02-trips-invoicing.md) |
| `journal_entries` | [06](./06-accounting-ledger.md) |
| `journal_lines` | [06](./06-accounting-ledger.md) |
| `logbook_entries` | [05](./05-logbook-currency-fleet.md) |
| `logbook_import_batches` | [05](./05-logbook-currency-fleet.md) |
| `logbook_source_files` | [05](./05-logbook-currency-fleet.md) |
| `mileage_entries` | [04](./04-expenses-imports.md) |
| `mileage_rates` | [04](./04-expenses-imports.md) |
| `operator_qualifications` | [05](./05-logbook-currency-fleet.md) |
| `recurring_invoice_generations` | [03](./03-billing-automation-stripe.md) |
| `recurring_invoice_schedules` | [03](./03-billing-automation-stripe.md) |
| `sample_connect_accounts` | [03](./03-billing-automation-stripe.md) |
| `stripe_connect_events` | [03](./03-billing-automation-stripe.md) |
| `stripe_events` | [03](./03-billing-automation-stripe.md) |
| `trip_days` | [02](./02-trips-invoicing.md) |
| `trip_legs` | [02](./02-trips-invoicing.md) |
| `trips` | [02](./02-trips-invoicing.md) |

## A gap found while writing this

`recurring_invoice_schedules`' own table comment (added in migration
`20260819100000`) cites `pilot.generate_autopay_invoice` as the function
that generates autopay-enabled invoices. That function does not exist
anywhere in `supabase/migrations/`. Noted in
[`03-billing-automation-stripe.md`](./03-billing-automation-stripe.md)
rather than silently assumed or invented — same posture as
`docs/DEV-GUIDE.md`'s note on the missing `docs/PLAN.md`.

## Keeping this accurate

This was built from the live schema (`list_tables`, verbose) plus a live
grants query, cross-checked against migration file headers — not from
memory or from table comments alone (a couple of those are already stale,
noted inline where found). If a migration changes a table's columns,
grants, or constraints, the corresponding section here needs a matching
update, the same rule `docs/DEV-GUIDE.md` states for itself.
