# PostgreSQL security verification report — YYYY-MM-DD

## Result

- Commit tested: `<commit>`
- Local migration/RLS suite: `PASS | FAIL | NOT RUN`
- Read-only hosted catalog audit: `PASS | FINDINGS | NOT AUTHORIZED`
- Dynamic two-tenant hosted test: `PASS | FINDINGS | NOT AUTHORIZED`
- Production changes made: `NONE` (verification must not modify production)

## Commands and evidence

| Command | Exit | Sanitized result |
|---|---:|---|
| `bash handoffs/claude-postgres-security/run-local-verification.sh` |  |  |
| `psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f handoffs/claude-postgres-security/production-catalog-audit.sql` |  |  |

Never paste a database URL, key, JWT, customer row, or raw hosted catalog dump
into this report.

## Findings

For every finding, include all fields. Do not promote expected inventory output
to a vulnerability without tracing the matching migration, grants, policies,
and call site.

### PG-XX — Title

- **Severity:** Critical / High / Medium / Low
- **Verified or assumed:**
- **Evidence:**
- **Affected migration/table/function/route:**
- **Impact:**
- **Reproduction:**
- **Recommended fix:**
- **Regression test:**

## Verified controls

- [ ] Clean replay of every migration on PostgreSQL 16.
- [ ] Every `pilot` table has RLS enabled.
- [ ] Every `pilot` view uses `security_invoker`; no materialized view exists.
- [ ] Tenant A cannot read or mutate Tenant B records.
- [ ] Anonymous roles reach only documented token-based functions.
- [ ] Security-definer functions pin `search_path` and enforce authorization.
- [ ] Billing/entitlement/webhook state is service-role-only.
- [ ] Storage tenant prefixes and private buckets are enforced.
- [ ] Verification data is synthetic and rolled back/removed.

## Not checked / remaining risk

- Hosted configuration not visible:
- Operations not dynamically exercised:
- Environment limitations:
- Required owner and next action:

