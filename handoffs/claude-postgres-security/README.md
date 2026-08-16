# Claude Code handoff — PostgreSQL security verification

## Objective

Close the PostgreSQL verification gaps recorded in
`docs/SECURITY-AUDIT-2026-08-16.md` without using production customer data and
without changing a hosted Supabase project directly.

This folder is deliberately self-contained. It gives Claude Code:

1. a reproducible local PostgreSQL 16 runner for the repository's complete
   migration/RLS verification suite;
2. a read-only catalog audit for a hosted or production-shaped database; and
3. a report template that separates verified results from assumptions.

## Safety boundary

- **Do not** paste, print, commit, or send a database URL, JWT, API key, or
  service-role secret.
- **Do not** run the local harness against a hosted database. It drops and
  creates scratch databases by design.
- **Do not** modify production, repair migration history, disable RLS, change
  grants, or apply migrations as part of verification.
- The catalog audit starts a `READ ONLY` transaction and reads PostgreSQL
  metadata only. Still obtain the normal authorization before connecting to a
  hosted project.
- If a defect is found, implement the correction as a new, forward-only SQL
  migration plus a regression assertion. Review and deploy that change through
  the normal process; never patch the hosted schema by hand.
- Never use real customer records as fixtures. The repository's verification
  scripts create synthetic `.invalid` users and roll back their test data.

## Repository facts to preserve

- Branch and commit must be re-checked at handoff time with `git status
  --short --branch` and `git log -1 --oneline`.
- Runtime is Node 22 (`.nvmrc`).
- PostgreSQL verification is orchestrated by `npm run verify:all`.
- Migrations are replayed in filename order from `supabase/migrations/*.sql`.
- `scripts/lib/verify-bootstrap.sql` is a local Supabase-shaped scaffold, **not
  a migration** and never something to apply to a hosted project.
- Hosted migration version identifiers may not match filenames because prior
  changes were applied with the Supabase migration tool. Read
  `supabase/migrations/README.md` before comparing or applying history.

## Phase 1 — run the isolated local suite

Prerequisites: Docker with Linux host networking support and enough space for
the `postgres:16` and `node:22-bookworm` images.

From the repository root:

```bash
bash handoffs/claude-postgres-security/run-local-verification.sh
```

The runner:

- refuses a dirty tree unless `ALLOW_DIRTY=1` is explicitly set;
- creates a uniquely named local PostgreSQL 16 container and Node dependency
  volume;
- exposes only the repository-standard local port `55432`;
- installs `psql` inside the disposable Node container;
- runs `npm ci` and the unchanged `npm run verify:all`; and
- removes its containers and dependency volume on exit.

Do not weaken an assertion merely to make this pass. A failure should be
classified as one of:

1. **Harness/environment:** Docker, networking, image download, disk, or tool
   availability.
2. **Scaffold drift:** a migration now depends on a Supabase primitive absent
   from `verify-bootstrap.sql`. Add only the minimum accurate stub and explain
   why it is required.
3. **Migration incompatibility:** clean replay fails. Fix with a new migration
   unless the failing migration has never shipped anywhere.
4. **Security/data-integrity regression:** an RLS, grant, constraint, replay,
   tenant-isolation, or accounting assertion fails. Treat this as a release
   blocker.

Record the exact failing command and sanitized error in `REPORT-TEMPLATE.md`.

## Phase 2 — optional read-only hosted catalog audit

This phase requires explicit access authorization and a **read-only direct
PostgreSQL connection**. It is not a substitute for the local behavioral suite:
catalog state can show that a policy exists, but not prove that every operation
has the intended behavior.

Keep the URL only in the process environment. Disable shell tracing first:

```bash
set +x
read -rsp "Read-only database URL: " DATABASE_URL; echo
export DATABASE_URL
psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" \
  -f handoffs/claude-postgres-security/production-catalog-audit.sql \
  > /tmp/amg-postgres-catalog-audit.txt
unset DATABASE_URL
```

Review `/tmp/amg-postgres-catalog-audit.txt` locally. Do not commit raw output:
object names are generally safe, but extension/configuration details can still
be operationally sensitive. Put only conclusions and sanitized object names in
the report.

The SQL checks:

- RLS enablement for every ordinary/partitioned `pilot` table;
- materialized views and non-`security_invoker` views;
- policy inventory and permissive/restrictive mode;
- direct table privileges granted to `anon`, `authenticated`, or `public`;
- `SECURITY DEFINER` functions without a pinned `search_path`;
- effective anonymous/authenticated execution rights on `pilot` functions
  (including rights inherited from PostgreSQL's `PUBLIC` pseudo-role); and
- storage bucket visibility and limits without reading object/customer rows.

Some rows are expected. For example, authenticated table grants are safe only
when the corresponding RLS and policies are correct, and intentionally
anonymous share RPCs may have `anon`/`public` execution. Investigate each row
against migrations and call sites; do not label the inventory itself a
vulnerability.

## Phase 3 — required adversarial follow-up

After the local suite passes, add or confirm tests for all of these boundaries:

1. Tenant A cannot select, insert, update, delete, call an RPC against, or mint
   a storage URL for Tenant B identifiers.
2. `anon` cannot reach ordinary `pilot` tables and can access only documented
   token-based invoice, estimate, packet, and vendor functions.
3. Every `pilot` table has RLS enabled; every view is `security_invoker`; no
   materialized view exists in the tenant schema.
4. Service-role-only billing, webhook ledger, and entitlement columns remain
   unwriteable to `authenticated`.
5. Security-definer functions pin `search_path`, validate account membership or
   share tokens internally, and expose EXECUTE only to intended roles.
6. Storage policies enforce tenant prefixes for receipts, documents, and logos;
   share-page receipt access cannot be redirected to another account path.
7. Migration replay succeeds from a clean PostgreSQL 16 database and the full
   suite leaves no synthetic data behind.

Prefer extending an existing `scripts/*-verify.mjs` suite over creating a
second test framework. Every verified defect needs a regression assertion that
fails before the fix and passes after it.

## Deliverables back to the primary agent

1. Completed `REPORT-TEMPLATE.md` renamed to a dated report under `docs/`.
2. Exact commands run and their exit status.
3. Any new forward-only migration and its focused verification assertion.
4. Explicit statement of what was not checked (especially hosted configuration
   or dynamic two-user/storage testing).
5. No secrets, connection strings, raw hosted catalog dumps, or customer data.
