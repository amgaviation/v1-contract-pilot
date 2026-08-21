# Multi-skill audit — 2026-08-21

14 agents: 1 recon, 11 skill-scoped auditors, 2 adversarial verifiers.

**The audit itself was report-only** — no agent modified anything outside this directory,
and the working tree was confirmed clean apart from these reports before any fix was
written. The remediation below was implemented afterwards, as a separate, reviewed pass.

**Verification posture.** Only the security and data lanes were adversarially verified.
The other nine reports are unverified single-agent output — treat their severities as
claims, not verdicts, and confirm before acting. Where a verifier corrected an auditor,
the verifier's severity is the one used below.

| Lane | Report | Verified |
| --- | --- | --- |
| Architecture | [01-architecture.md](01-architecture.md) | no |
| Security | [02-security.md](02-security.md) | [90-verify-security.md](90-verify-security.md) |
| Code simplification | [03-code-refiner.md](03-code-refiner.md) | no |
| Schema & indexes | [04-database-optimizer.md](04-database-optimizer.md) | [91-verify-data.md](91-verify-data.md) |
| Query performance | [05-sql-optimizer.md](05-sql-optimizer.md) | [91-verify-data.md](91-verify-data.md) |
| Agent prompt surface | [06-prompt-engineer.md](06-prompt-engineer.md) | no |
| Programmatic SEO | [07-programmatic-seo.md](07-programmatic-seo.md) | no |
| Positioning | [08-marketing-council.md](08-marketing-council.md) | no |
| Aviation domain | [09-aviation-marketing.md](09-aviation-marketing.md) | no |
| Launch readiness | [10-launch.md](10-launch.md) | no |
| Visual design | [11-high-end-visual-design.md](11-high-end-visual-design.md) | no |

Verifier tallies — security: 3 confirmed, 6 adjusted, 0 refuted. Data: 13 confirmed,
8 adjusted, 0 refuted, 1 sub-claim refuted outright. Both verifiers also produced a
finding their auditor missed, and one of those is the most serious item in this audit.

---

## Remediation status

**Fixed on this branch before these reports were published**, with `verify:all` and
`npm test` green:

- Bug 1, `pilot.documents` half — `on delete set null (client_id)`
  (`supabase/migrations/20260821091000_documents_client_purge_safe.sql`).
- Bug 2 in full — all six bare composite SET NULL FKs given explicit column lists
  (`20260821090000_purge_boundary_set_null_column_scope.sql`).
- `/estimate/[token]` added to the proxy allow-list (`lib/supabase/proxy.ts`).
- The durable guard — a catalog assertion in `scripts/account-lifecycle-db-verify.mjs`
  that fails any retained→purged FK which is not `set null (<col>)` with an explicit column
  list. It reads the delete list out of `pg_proc.prosrc` rather than restating it, refuses a
  zero-delete parse so it cannot pass vacuously, and was proved to FAIL against the pre-fix
  schema. Fixtures now link across the boundary, which they did not before — the reason
  neither bug was caught.

**Still open**, needing a product decision, not a patch:

- **Bug 1, `pilot.operator_qualifications` half.** `client_id` is `NOT NULL` and its comment
  says an operator qualification with no operator is a contradiction in terms, so `SET NULL`
  is unavailable. A purge still destroys retained Part 135 qualification history. Three
  routes: denormalize the operator name onto the row so the record survives standalone;
  exclude clients holding qualifications from the purge; or accept the cascade and correct
  the three comments that promise otherwise. Now a *named exemption* in the new assertion
  that prints `STILL OPEN` on every passing run, so the boundary is enforced everywhere
  else without this going quiet.
- `pilot.document_shares.client_id` — also `cascade` over `not null` on the retain side,
  surfaced by the catalog sweep, not by the audit. Judged correct as-is (a live bearer token
  must not outlive the client it was minted for) and exempted by name. Revisit only if that
  judgement is wrong.

Everything else below is unremediated.

---

## The two things to fix first

Both were found by the data lane, both were reproduced against a real Postgres, and both
have the same root cause. **They are the only items here that can put an account into an
unrecoverable state.**

### 1. A lapsed hold destroys the airman records three migrations promise it keeps

`DB-01`, confirmed critical. `pilot.documents` and `pilot.operator_qualifications` both
carry `foreign key (account_id, client_id) references pilot.clients … on delete cascade`
(`supabase/migrations/20260805070000_phase3_clients_trips_expenses.sql:192`,
`20260807060000_operator_qualifications.sql:85`). `purge_business_data_rows` deletes
`pilot.clients` (`20260818200000:130`) while its own comment at `:140-146` names
"documents, operator qualifications" as deliberately spared — repeated in prose at
`:306-309` — and `20260818090000:105-106` states "The airman records are never purged
here". They are cascade-deleted.

### 2. …and the same purge then aborts forever on any account that used the logbook

The data verifier's missed-finding, reproduced live on Postgres 16. A bare composite
`on delete set null` with no column list nulls *every* column in the key, `account_id`
included — and `pilot.logbook_entries.account_id` is `not null`
(`supabase/migrations/20260805220000_phase6_logbook.sql:124`, `:100`). So
`delete from pilot.trips` raises a not-null violation, `pilot.expire_hold` aborts, nothing
is purged, and the scheduled pass retries forever. This affects every account that has
used the confirm-from-leg flow. It also breaks interactive trip deletion.

This is the fourth occurrence of a bug class this repo has already diagnosed and fixed
three times — `bank_transactions` (`20260810030000`, whose header is literally titled
"A COMPOSITE `on delete set null` NULLS EVERY COLUMN IN THE KEY"), `expenses`
(`20260815130000:207`), `aircraft` (`20260818230000:45`). Six bare composite SET NULL FKs
were never revisited: `logbook_entries.trip_id` and `.trip_leg_id`,
`mileage_entries.trip_id` / `.client_id`, `operator_qualifications.document_id`,
`client_tax_forms.document_id`.

**One fix pass, one durable guard.** The purge's retain/delete split is enforced only by
prose. The fix is a `verify:all` catalog assertion: no table on the retain list may hold a
FK to a table on the delete list unless it is `set null (<col>)` with an explicit column
list. `scripts/account-lifecycle-db-verify.mjs` could not see either bug at the time of the
audit — its fixtures set no `client_id` and no `trip_id`, so nothing linked across the
boundary it was meant to be testing. Both the assertion and the linked fixtures have since
been added; see **Remediation status** above.

---

## Cross-cutting themes

**The unattended cron is the systemic weak point, and three lanes found it independently.**
Architecture: both money passes select accounts with no `.order()` and no `.limit()` inside
a 300s invocation, so past roughly a thousand accounts a fixed tail of tenants silently
stops being dunned or charged, with nothing detecting a cron that was killed at the ceiling
(`lib/reminders/run.ts:771`, `lib/alerts.ts:116`). Security: the reminders cron's
service-role client now generates, issues and charges invoices off-session, which entry
point 3 of the allow-list does not describe, and the file's own prescribed grep cannot
catch because the autopay modules receive the client as a parameter
(`app/api/reminders/run/route.ts:124`). SQL: the same pass is a three-level N+1
(`lib/autopay/run.ts:181`). The money path itself is sound — the verifier confirmed
`generate_autopay_invoice` is service-role-only, re-derives five preconditions, and is
idempotent on a unique index. **What is broken is the control around it, not the arithmetic.**

**Verify harnesses assert the shape of a control, not its substance.** `tenancy-verify`
asserts policies exist but never that their predicates are tenant-scoped
(`scripts/tenancy-verify.mjs:240`). `account-lifecycle-db-verify` never links a fixture
across the retain/delete boundary. The service-role allow-list's grep returns exactly the
ten documented paths and is blind to a client passed as an argument. Three separate
controls that pass while the thing they guard has moved.

**`app/robots.ts` omits `/estimate/` and `/vendor/`** — found independently by security,
architecture and programmatic SEO. Low severity only because the root layout's
`robots:{index:false,follow:false}` still covers them.

**`/estimate/[token]` was missing from the proxy allow-list** (`lib/supabase/proxy.ts`; the
entry now sits at `:240`),
and the verifier surfaced a consequence the auditor understated: the token lands in a
`/login?next=` query string, but more immediately **the estimate share feature is inert in
production**, not merely leaky. Accept/decline posts to the same blocked path.

**`BRAND.tagline` is the highest-severity marketing finding, and two lanes reached it
independently.** `lib/brand.ts:32` reads "V1, we make the decision simple" — rendered in six
places including the auth column one screen from a card. Both the marketing council and the
aviation-domain agent scored it critical: in an audience where V1 *is* the go/no-go decision
speed, it inverts the meaning of the name and reads as exactly the legality claim
`docs/MARKETING.md` §5 rule 4 forbids. Unverified, but the convergence is worth weighing.

**Documentation has drifted from code in four places at once.** `docs/MARKETING.md` §4
still specifies the retired hero under a heading that says "verbatim"; `docs/PRICING.md`
still specifies a 14-day card-required trial as policy; `.claude/README.md` names five
skills absent from disk and `skills-lock.json` tracks 73 of 110 on-disk skill directories;
`lib/supabase/service-role.ts`'s entry point 3 no longer describes what that client does.
Each was written as a control. Each is now prose that outlived its subject — which is the
same failure `docs/MARKETING.md` itself names: *"a comment guarding a line is not a check,
and it will outlive the line it guards."*

---

## Ranked remediation

### Do first — correctness, unrecoverable state

| # | Item | Where | Status |
| --- | --- | --- | --- |
| 1 | Purge cascade-deletes airman records | `20260805070000:192`, `20260807060000:85` | **`documents` FIXED**; `operator_qualifications` still open |
| 2 | Bare composite SET NULL aborts purge permanently | `20260805220000:124`, `:132` + 4 more FKs | **FIXED — all six** |
| 3 | Catalog assertion in `verify:all` for the retain/delete boundary | `scripts/account-lifecycle-db-verify.mjs` | **ADDED**, proved to fail on the pre-fix schema |
| 4 | `/estimate/[token]` proxy allow-list — feature was inert in prod | `lib/supabase/proxy.ts:240` | **FIXED** |

### Do next — controls that no longer control anything

| # | Item | Where | Status |
| --- | --- | --- | --- |
| 5 | Rewrite service-role entry point 3; brand the client type so parameter passing is greppable | `lib/supabase/service-role.ts:71` | adjusted high→medium |
| 6 | Bound and order the cron account fan-out; alert on a cron that never ran | `lib/reminders/run.ts:771`, `lib/alerts.ts:116` | unverified high |
| 7 | Assert predicate scoping, not policy existence, in `tenancy-verify` | `scripts/tenancy-verify.mjs:240` | unverified high |
| 8 | Payment insert and status advance are non-transactional | `app/(app)/invoices/actions.ts:2316` | unverified high |

### Quick wins — small, local, provably safe

| # | Item | Where |
| --- | --- | --- |
| 9 | Add `account_id` to eight anti-joins in `ledger_sync` — one line each, provably cannot change the result set (the composite FK guarantees equality) | `20260812100000:441,468,545,590,632,670,708,742` |
| 10 | Drop `ledger_sync` from the four export routes — writes-on-GET, zero schema change | `accounting/journal/export`, `reports/cash-flow/export`, `reports/balance-sheet/export` |
| 11 | Stripe idempotency key on the off-session PaymentIntent — one line | `lib/stripe/connect.ts:602` |
| 12 | Hash both sides of the holds cron secret compare; share one implementation with the reminders route | `app/api/holds/run/route.ts:74` |
| 13 | Add `/estimate/` and `/vendor/` to robots.ts, derived from the route directories | `app/robots.ts:69` |
| 14 | `revoke all … from public` on `expiration_coverage_gaps` | `20260805070000:384` |
| 15 | Drop eleven exactly-redundant indexes | see `04` DB-03 for the list |

### Structural — worth a decision, not a patch

Share-token expiry (adjusted down to low; the verifier notes a naive backfill would kill
links a pilot mailed six months ago, so it needs mint-time UI). Actor attribution on
financial records before multi-seat ships. The app-wide "RLS scopes this, no `account_id`
filter needed" convention, which strips the leading column off every composite index —
`EXPLAIN` confirms the policy lands as a hashed SubPlan filter, not an index condition.
`createInvoiceDraft` at 617 code lines with no test coverage. Trigram indexing for command
search. The `retirePaymentLink` duplication between `invoices/actions.ts:2445` and the
Connect webhook.

### Launch gates — human decisions, not code

Broad launch is blocked by four unsigned gates plus two gaps, none of which an agent can
close: no Terms of Service, no Privacy Policy and no consent capture at signup; Stripe
still in test mode; pricing an unsigned proposal while every live price string prints $29;
no way to contact a human anywhere in the product; zero funnel analytics. The currency
engine must stay fully dark — six adversarial review rounds, findings still open, and §5
rule 3 makes its absence from public copy absolute.

---

## Caveats on this audit

- **Nine of eleven reports are unverified.** The two that were verified had 8 of 21
  findings adjusted and three cited the wrong file or line — `02`'s SEC-06 and SEC-09, and
  `04`'s DB-10. Assume a comparable error rate in the unverified nine. Check the citation
  before acting on any finding.
- **Two further citation errors sat in the top-ranked finding itself**, caught during the
  pre-push review and corrected above: `delete from pilot.clients` is at
  `20260818200000:130` (`:129` is `client_rates`), and the spared-list comment is at
  `:140-146`, not `:270-276` (which is unrelated `expire_hold` prose). `04` and `91` still
  carry the original wrong line numbers in their own text. **The finding itself is
  unaffected — only the line numbers moved**; it was independently re-confirmed against the
  migrations during review.
- **No timings anywhere are real.** Every database reachable from this session is empty by
  construction, so `EXPLAIN ANALYZE` was unavailable. All performance findings are
  structural — plan shape, round-trip counts, index coverage. The data verifier was
  instructed to refute any timing claim and found none to refute.
- **Nothing was executed against a hosted environment.** No Supabase catalog, Vercel
  settings, Stripe dashboard or DNS was visible, so no report can confirm the deployed
  schema matches these migrations.
- **Programmatic SEO returned a "do not build" verdict**, which was the honest answer given
  no customers and §5's ban on invented data. Its useful output was the robots.ts finding.
- **The visual-design agent found little to change**, which is a real result: the existing
  Ledger/INSTRUMENT token system already implements most of what a generic
  "expensive design" skill would ask for. Its rejected-ideas catalogue (what
  `tokens:verify` would refuse) is in `11`.
