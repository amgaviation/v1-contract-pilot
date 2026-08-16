# PostgreSQL security verification report — 2026-08-16

Closes remaining verification gap #1 in `docs/SECURITY-AUDIT-2026-08-16.md`:
the complete migration and tenancy suite (`npm run verify:all`) run against an
isolated PostgreSQL 16 instance for this commit.

## Result

- Commit tested: `bb1bd1c` (`Merge pull request #74 from amgaviation/codex/integrate-codex-security-plugin`)
- Branch: `claude/file-instructions-ck5lrb`
- Local migration/RLS suite: **PASS**
- Read-only hosted catalog audit: **NOT AUTHORIZED** (no read-only URL provided; Phase 2 not run)
- Dynamic two-tenant hosted test: **NOT AUTHORIZED** (Phase 2/DAST not run)
- Production changes made: **NONE** (verification did not touch any hosted project)

## Environment note

The disposable Docker runner (`handoffs/claude-postgres-security/run-local-verification.sh`)
was attempted first. The `postgres:16` and `node:22-bookworm` images pulled
successfully, but `npm ci` inside the throwaway `node:22-bookworm` container
aborted with npm's internal `Exit handler never called!` fault — a
harness/environment failure (handoff failure class 1), not a schema or security
defect.

Because PostgreSQL 16 (`postgresql-16` 16.13) and Node 22 (`v22.22.2`, matching
`.nvmrc` 22.6's major) are both installed on the host, the identical
`npm run verify:all` was run directly against a locally initialised,
trust-auth PostgreSQL 16 cluster on the repository-standard port `55432`. The
verification command itself was **not modified**; only the Postgres provider
changed (host cluster instead of container), which is behaviourally equivalent
to the container the runner would have created and to CI's Postgres service.
The cluster was a fresh `initdb` scratch instance in `/tmp` owned by the
unprivileged `postgres` user; it holds no customer data.

## Commands and evidence

| Command | Exit | Sanitized result |
|---|---:|---|
| `bash handoffs/claude-postgres-security/run-local-verification.sh` | 1 | Images pulled; `npm ci` crashed in the node container (`Exit handler never called!`) — environment fault, no assertion reached |
| `initdb -A trust` + `pg_ctl start` (local PG16 on 127.0.0.1:55432, as `postgres` user) | 0 | Cluster ready (`pg_isready` → accepting connections) |
| `npm ci` (host) | 0 | Clean dependency tree; `found 0 vulnerabilities` |
| `npm run verify:all` (host, PG16 on 55432) | 0 | `verify:all passed.` — 78 migrations replayed cleanly; every suite green |

Per-suite summary from the passing run:

| Suite | Result |
|---|---|
| Migration replay | 78 migrations replayed onto a clean scratch database |
| `tenancy-verify` | PASS (RLS F1, view `security_invoker`/no-matview MEDIUM-7, tenant isolation, service-role-only columns) |
| `connect-verify` | PASS (single-use OAuth state, payment visibility) |
| `invoice-share-verify` / `packet-share-verify` | PASS (token-based anon access) |
| `bank-import-verify` | PASS |
| `aircraft:verify` | 29 checks passed |
| `payment-reversal:verify` | 20 checks passed |
| `estimates:verify` | 27 checks passed |
| `logbook:verify` | PASS |
| `currency:verify` | 605 checks passed (Half A 578, Half B 23) |
| `accounting:verify` | 45 passed, 0 failed |
| `reminders:verify` | 48 passed, 0 failed |
| `adhoc-invoice:verify` | 37 passed, 0 failed |

No database URL, key, JWT, customer row, or hosted catalog dump appears in this
report.

## Findings

No new defect was found. The suite passed on the first complete run once the
host dependency tree was made whole (see below); no assertion was weakened,
skipped, or modified.

One transient, non-security failure was observed and resolved before the
recorded PASS:

### PG-01 — Pre-existing host `node_modules` was incomplete (not a schema defect)

- **Severity:** Low (tooling/environment; no product impact)
- **Verified or assumed:** Verified.
- **Evidence:** The first host run of `currency:verify` "Half A" (a pure-TS,
  no-database module test) aborted with `ERR_MODULE_NOT_FOUND: Cannot find
  package 'server-only'`. `server-only` is a declared dependency
  (`package.json`), but the pre-existing checked-out `node_modules` did not
  contain it (`npm ls server-only` → empty).
- **Affected migration/table/function/route:** None. This is a workspace
  dependency-install gap, not a migration, RLS, or schema issue. The database
  "Half B" of the same suite passed (23 checks) in that same run.
- **Impact:** None on the product or schema. It would only cause a false suite
  failure on a machine with a partial `node_modules`.
- **Reproduction:** Run `npm run verify:all` against a checkout whose
  `node_modules` predates the current lockfile / is missing `server-only`.
- **Recommended fix:** Run `npm ci` before verification (exactly what the
  handoff's Docker runner does). After `npm ci` (`found 0 vulnerabilities`),
  the full suite passed with exit 0.
- **Regression test:** Covered by existing tooling — a complete `npm ci`
  install plus the unchanged `currency:verify` Half A (578 pure-module checks)
  fails on a missing dependency and passes once installed.

## Verified controls

- [x] Clean replay of every migration on PostgreSQL 16 — 78 migrations replayed
      onto a fresh scratch database on each suite, all green.
- [x] Every `pilot` table has RLS enabled — `tenancy-verify` F1 asserts this
      from `pg_catalog` (`relrowsecurity`), including partitioned parents; PASS.
- [x] Every `pilot` view uses `security_invoker`; no materialized view exists —
      `tenancy-verify` MEDIUM-7 asserts this from `reloptions`/`relkind`; PASS.
- [x] Tenant A cannot read or mutate Tenant B records — cross-tenant SELECT/
      write isolation asserted (e.g. currency S-12a/S-12b, S-16; tenancy
      per-tenant read isolation); PASS.
- [x] Anonymous roles reach only documented token-based functions — invoice/
      estimate/packet/vendor share paths verified via `invoice-share-verify`,
      `packet-share-verify`, and share-token assertions; anon has no ordinary
      `pilot` table reach; PASS.
- [x] Security-definer functions and grants enforce authorization — service-
      role-only writes and grant boundaries asserted throughout `tenancy-verify`
      (F1b, HIGH-5 grant checks, C1 service_role bypass path); PASS.
- [x] Billing/entitlement/webhook state is service-role-only — `stripe_events`
      and `connect_oauth_states` deliberately policy-excepted and written only
      through `service_role`; asserted; PASS.
- [x] Storage tenant prefixes and private buckets are enforced — receipts/
      storage phase-4 policies exercised in the suite; PASS.
- [x] Verification data is synthetic and rolled back/removed — all fixtures run
      inside rolled-back transactions or the throwaway `v1verify` scratch
      database, which `verify:all` drops and recreates on every run. The host
      Postgres cluster was a fresh `initdb` instance in `/tmp` with no customer
      data.

## Not checked / remaining risk

- **Hosted configuration not visible (Phase 2):** RLS/policy/grant catalog state
  of the live Supabase project was not audited. No read-only `DATABASE_URL` was
  provided and none was requested; `production-catalog-audit.sql` was **not**
  run. The local suite proves behaviour on a clean replay of the migrations in
  the repo, not that the hosted schema is byte-identical to them (hosted
  migration version identifiers may differ from filenames — see
  `supabase/migrations/README.md`).
- **Operations not dynamically exercised (Phase 2/DAST):** No two live-JWT
  tenants, real signed storage URLs, ID-substitution across every export/RPC/
  mutation route, webhook replay/concurrency, CSP nonce probe, or upload-polyglot
  testing against a preview deployment. These remain gaps #2–#6 in
  `docs/SECURITY-AUDIT-2026-08-16.md` (SEC-02 abuse controls, SEC-03 CSP nonce,
  Supabase Auth limits, Stripe endpoint registrations).
- **Environment limitations:** The handoff's Docker runner could not complete
  `npm ci` inside its `node:22-bookworm` container in this environment; the
  equivalent host run was used instead. On a machine where Docker's container
  networking and npm behave, the runner is the preferred, fully-isolated path.
- **Required owner and next action:** With owner authorization and a read-only
  connection string, run Phase 2 (`production-catalog-audit.sql`) and a Phase 3
  dynamic two-tenant test against a preview environment to close gaps #2–#6.
  Production changes, if any defect is later found, must ship as forward-only
  migrations through the normal review/deploy process — never by hand-patching
  the hosted schema.
