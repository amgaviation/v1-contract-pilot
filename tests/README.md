# Unit tests

`npm run test:unit` — Node's own built-in test runner (`node --test`, stable
since Node 20) over the pure-logic modules in `lib/`. No dependency was
added: `node:test` and `node:assert/strict` ship with the runtime this
project already targets, and the repo's existing extensionless-import
loader is reused so the real `.ts` sources are exercised directly rather
than a re-implementation that could drift.

## What belongs here, and what does not

This directory is for **pure functions with no I/O**: money parsing, date
arithmetic, CSV tokenising, fingerprints, formatting. Fast, deterministic,
runnable with nothing installed and no database.

It is **not** where this project's most important guarantees live, and
adding it does not change that. The rules that actually protect a pilot's
money and their logbook are enforced in Postgres — column grants, CHECK
constraints, RLS policies, SECURITY DEFINER functions — and are asserted
by the `*-verify.mjs` scripts against a real database inside a transaction
that rolls back, each one checking a specific SQLSTATE by name:

| Script | Asserts |
|---|---|
| `npm run tenancy:verify` | tenant isolation, grants, every schema invariant |
| `npm run bank-import:verify` | statement parsing + the bank schema's contract |
| `npm run connect:verify` | Stripe Connect's database-side contract |
| `npm run invoice-share-verify` | the unauthenticated share route's boundary |
| `npm run customisation:verify` | per-tenant vocabularies |
| `npm run trip:verify` / `billing:verify` | trip→invoice→logbook, Stripe billing |

A unit test cannot tell you that `revoke insert on <table>` silently
dropped five column grants and broke logbook import for every user. That
happened here, three times, and only a probe against the real schema
caught it. Keep the balance: pure logic here, everything that touches the
database there.

## What is here now

*Refreshed 2026-08-14 — 48 files, 608 `test(...)` cases via `npm run
test:unit`. Both numbers move often; re-run `grep -c '^test(' tests/*.test.mjs`
before trusting this table on anything but the file list and rough shape.*

| File | Tests | Module under test |
|---|--:|---|
| `account-export.test.mjs` | 22 | `lib/csv.ts`, `app/(app)/settings/export/entities.ts` row mappers |
| `accounting-lib.test.mjs` | 19 | `app/(app)/accounting/ledger-lib.ts`, `lib/accounting-export.ts` |
| `airman-certificates.test.mjs` | 1 | `lib/airman.ts` |
| `bank-fingerprint.test.mjs` | 7 | `lib/bank-import/fingerprint.ts`, `lib/logbook-import/fingerprint.ts` |
| `billing-seats-and-status.test.mjs` | 4 | `lib/entitlements.ts` (`seatsForTier`, writable statuses) |
| `billing-state.test.mjs` | 16 | `lib/billing-state.ts`, `lib/entitlements.ts` |
| `connect-auto-payment.test.mjs` | 51 | `lib/stripe/connect-payments.ts` |
| `cron-allowlist.test.mjs` | 3 | `lib/supabase/proxy.ts` (static read of the allow-list, not an import) |
| `csv-guard.test.mjs` | 5 | `lib/csv.ts` (the formula-injection guard) |
| `currency-ui.test.mjs` | 7 | `app/(app)/currency/presentation.ts` |
| `currency.test.mjs` | 92 | `lib/currency/*` — the whole currency/legality engine |
| `custom-options.test.mjs` | 5 | `lib/custom-options.ts` |
| `customer-statement.test.mjs` | 12 | `app/(app)/clients/[id]/statement/{statement-lib,statement-html}.ts` |
| `dashboard-path.test.mjs` | 1 | `lib/nav.ts`, `app/robots.ts` |
| `entitlements.test.mjs` | 9 | `lib/entitlements.ts` |
| `estimate-lib.test.mjs` | 6 | `app/(app)/estimates/estimate-lib.ts` |
| `estimate-message.test.mjs` | 10 | `lib/email/estimate-message.ts` |
| `flight-time.test.mjs` | 13 | `app/(app)/reports/flight-time/report-lib.ts` |
| `invoice-message.test.mjs` | 9 | `lib/email/{address,invoice-message}.ts`, `lib/message-templates.ts` |
| `invoice-receipts.test.mjs` | 3 | `lib/invoice-receipts.ts`, `lib/email/invoice-message.ts` |
| `logbook-draft.test.mjs` | 7 | `app/(app)/logbook/db.ts` |
| `logbook-import-logten.test.mjs` | 2 | `lib/logbook-import/logten.ts` |
| `logbook-import-time.test.mjs` | 5 | `lib/logbook-import/generic.ts` |
| `logbook-views.test.mjs` | 23 | `lib/logbook-views.ts` |
| `marketing-pricing-model.test.mjs` | 8 | `lib/entitlements.ts`, `lib/format.ts`, `lib/nav.ts` |
| `mileage.test.mjs` | 5 | `lib/mileage.ts` |
| `money.test.mjs` | 5 | `lib/bank-import/amount.ts`, `lib/format.ts` |
| `nav-layout.test.mjs` | 4 | `lib/nav.ts`, `app/robots.ts` |
| `password-policy.test.mjs` | 6 | `lib/password-policy.ts` |
| `payment-insight.test.mjs` | 9 | `app/(app)/clients/[id]/payment-insight.ts` |
| `payment-methods.test.mjs` | 11 | `lib/stripe/payment-methods.ts` |
| `pilot-history.test.mjs` | 36 | `app/(app)/reports/pilot-history/report-lib.ts` |
| `receipt-extract.test.mjs` | 20 | `lib/receipt-ocr/extract.ts` |
| `receipt-trip-match.test.mjs` | 4 | `lib/receipt-ocr/match-trip.ts` |
| `recurring-schedule.test.mjs` | 8 | `app/(app)/invoices/recurring/actions.ts` |
| `reminder-schedule.test.mjs` | 11 | `lib/reminders/policy.ts`, `lib/email/invoice-message.ts` |
| `reset-password-recovery-proof.test.mjs` | 4 | static read of the `/reset-password` route source (not an import) |
| `safe-next.test.mjs` | 1 | `lib/safe-next.ts` |
| `sales-tax.test.mjs` | 22 | `app/(app)/reports/sales-tax/report-lib.ts` |
| `statement-parsing.test.mjs` | 9 | `lib/bank-import/{csv,apply-mapping,ofx,date}.ts` |
| `stripe-webhook-decisions.test.mjs` | 3 | `lib/stripe/webhook-decisions.ts` |
| `theme-slots.test.mjs` | 3 | `lib/theme-slots.ts` |
| `travel-log.test.mjs` | 10 | `app/(app)/reports/year-end/travel-log.ts` |
| `trip-day-quantity.test.mjs` | 8 | `lib/trip-value.ts` |
| `trip-day-utils.test.mjs` | 6 | `app/(app)/trips/day-utils.ts` |
| `trip-pl.test.mjs` | 37 | `app/(app)/reports/trip-pl/report-lib.ts` |
| `trip-settlement.test.mjs` | 9 | `lib/trip-settlement.ts` |
| `unbilled-money.test.mjs` | 37 | `lib/trip-value.ts` |

`connect-auto-payment.test.mjs` is the clearest illustration of the split
above. It pins the DECISIONS that move money when a client pays an invoice
payment link — cross-tenant metadata forgery, event replay, a payment the
pilot already typed in by hand, a link that outlived its invoice — using
plain objects, with no Stripe and no database. The guarantees those
decisions lean on (that `source` and `stripe_payment_intent_id` are
ungrantable to a tenant, that the unique index really does refuse a second
row for one PaymentIntent, that the Connect events ledger is RLS-scoped to
one tenant and writable by them in one column) are asserted against real
Postgres by `npm run connect:verify`, ASSERTION 7. Neither file is
evidence for the other's half.

`lib/receipt-ocr/engine.ts` is deliberately **absent** from that list and
cannot be added to it: it decodes an image, draws to a canvas and drives a
WebAssembly worker, none of which exist in Node. It is exercised instead by
driving the real module in headless Chromium against a synthetic receipt
rendered in the page — which is how the leading-pipe artifact that
`receipt-extract.test.mjs` now pins was found, and how the claim that a
scan makes zero off-origin requests was checked rather than assumed. That
harness is not committed; it belongs to the same family as the
`*-verify.mjs` scripts below — a probe against a real runtime, not a unit
test — and if it earns a permanent home it should be written as one.

## Convention

One file per module under test, named `<module>.test.mjs`. Each test's
name states the behaviour, not the function. Where a test exists because
something was once WRONG in a way that reached a user, say so in the test
— a regression test that doesn't explain itself gets deleted by the next
person who finds it inconvenient.
