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

| File | Module under test |
|---|---|
| `money.test.mjs` | `lib/bank-import/amount.ts`, `lib/format.ts` |
| `statement-parsing.test.mjs` | `lib/bank-import/{csv,apply-mapping,ofx,date}.ts` |
| `receipt-extract.test.mjs` | `lib/receipt-ocr/extract.ts` |
| `receipt-trip-match.test.mjs` | `lib/receipt-ocr/match-trip.ts` |
| `connect-auto-payment.test.mjs` | `lib/stripe/connect-payments.ts` |

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
