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

## Convention

One file per module under test, named `<module>.test.mjs`. Each test's
name states the behaviour, not the function. Where a test exists because
something was once WRONG in a way that reached a user, say so in the test
— a regression test that doesn't explain itself gets deleted by the next
person who finds it inconvenient.
