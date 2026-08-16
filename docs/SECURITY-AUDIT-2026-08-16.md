# Security audit — 2026-08-16

## Executive summary

This review found **one high-severity dependency finding**, which is fixed in
this branch, and **two medium-severity hardening findings** that require either
deployment-level evidence or a wider architectural change. No verified
critical vulnerability, cross-tenant data path, authentication bypass, payment
signature bypass, committed credential, or direct injection sink was found.

The strongest controls observed are tenant isolation enforced in PostgreSQL
RLS, server-side `auth.getUser()` checks, a deliberately small service-role
client caller set, raw-body Stripe signature verification, webhook idempotency,
constant-time cron authentication, private storage paths, public-share tokens
with strict syntax and database-side authorization, safe redirect handling,
and an enforcing baseline CSP.

This was a source and local-verification audit, not a penetration test. The
production Supabase, Stripe, Resend, Vercel, DNS, and logging configurations
were not available to inspect. Database integration verification also could
not run because this environment has neither `pg_isready` nor the required
local PostgreSQL service.

## Scope and method

Reviewed:

- Next.js middleware/proxy allow-list and authenticated app layout.
- Supabase browser, server, service-role, account, and reauthentication clients.
- SQL migrations, RLS policies, grants, security-definer functions, storage
  policies, and tenant verification scripts.
- Authentication, signup, confirmation, password recovery, and redirect flows.
- Public invoice, estimate, packet, vendor, and sample-store routes.
- Stripe platform billing, Connect OAuth, Checkout, and webhook handlers.
- Scheduled reminders, email dispatch, uploads, OCR, CSV exports/imports, and
  server actions.
- Security headers, CSP, environment-variable boundaries, logs, tracked files,
  dependency advisories, unit tests, type checking, and production build.

Commands used included `rg`/`find` source review, `git ls-files`, `npm audit
--omit=dev`, `npm test`, `npm run build`, `npm run verify:all`, and targeted
security tests. Secret searches were limited to tracked filenames and common
credential patterns; no secret value is reproduced in this report.

## Findings

### SEC-01 — Vulnerable production image/CSS toolchain (High, fixed)

**Status:** Fixed in this branch.

**Affected surface:** `next` and its transitive `sharp` and `postcss`
dependencies in `package.json` / `package-lock.json`.

**Evidence:** Before remediation, `npm audit --omit=dev` reported three high
severity dependency entries: vulnerable `sharp`/libvips image parsers and
multiple `postcss` arbitrary source-map file disclosure/path traversal and CSS
serialization advisories through Next 16.2.12. The application accepts image
uploads and processes/render images, which makes keeping the production image
stack patched important even where exploitability of each transitive code path
was not established.

**Impact:** A reachable vulnerable parser or build-time CSS transformation
could cause information disclosure, XSS output, or unsafe native image parsing.

**Reproduction:** On the original lockfile, run `npm audit --omit=dev` and
inspect the `next`, `sharp`, and `postcss` entries.

**Remediation:** Next is upgraded to 16.3.1, resolving the dependency graph to
patched `sharp` and `postcss` versions. A post-change audit reports zero known
vulnerabilities. Keep automated dependency auditing enabled and treat image
parser advisories as production-sensitive.

### SEC-02 — No repository-verifiable abuse control for public email/auth actions (Medium)

**Status:** Open; deployment control must be verified before launch.

**Affected routes/actions:** signup, forgot-password, confirmation resend, and
public estimate response actions.

**Evidence:** These surfaces are intentionally reachable without an authenticated
session. The source validates inputs and avoids account enumeration, but contains
no application-level per-IP/per-identity limiter. Supabase Auth normally applies
provider-side rate limits, but dashboard configuration is external to this
repository and was not available during this review. The estimate response RPCs
are protected by high-entropy share tokens and state transitions, but repeated
invalid submissions can still consume application/database capacity.

**Impact:** If provider/platform limits are absent or permissive, an attacker
could generate unwanted auth email, consume email/provider quotas, create noisy
logs, or impose avoidable database/serverless load. The review did not verify
an account takeover path through this condition.

**Verification:** In a production-like environment, measure responses and
provider events for repeated requests from one IP and repeated requests for one
identity. Confirm limits for signup, password recovery, OTP verification, and
resend independently, including the behavior behind any CDN/proxy.

**Recommendation:** Record the production Supabase Auth rate-limit settings as
a launch gate and alert on bursts. Add an edge/platform rate limit for public
mutation surfaces if the provider limits do not cover source IP and global
resource exhaustion. Preserve the existing generic responses to avoid user
enumeration.

### SEC-03 — CSP permits inline script globally (Medium)

**Status:** Open; documented architectural debt.

**Affected surface:** All HTML responses configured in `next.config.ts`.

**Evidence:** The enforcing policy restricts remote script origins, objects,
frames, workers, forms, and base URLs, but `script-src` includes
`'unsafe-inline'` to support Next.js App Router hydration without request
nonces. No `dangerouslySetInnerHTML`, `eval`, or `new Function` application sink
was found in the reviewed source, and production does not add
`'unsafe-eval'`; these reduce present exploitability but do not eliminate the
weakness.

**Impact:** A future HTML/script injection flaw would have fewer CSP barriers
because inline script is authorized globally. The CSP still blocks remote
attacker script hosts and remains materially better than no CSP.

**Verification:** Inspect the production `Content-Security-Policy` response
header and use a CSP evaluator. Add an automated browser probe that confirms an
unapproved external script and inline test payload are blocked after nonce work.

**Recommendation:** Move to per-request nonces (or hashes where stable), thread
the nonce through the proxy and root layout, and remove `'unsafe-inline'` from
`script-src`. Keep `style-src` migration separate because React inline style
attributes have different compatibility requirements.

## Verified controls and negative findings

- Authenticated application routes are gated by both the proxy and server-side
  account checks; the public allow-list is explicit rather than a broad static
  prefix for app functionality.
- Server Supabase access uses authenticated cookies and `auth.getUser()`;
  privileged access is isolated in a `server-only` module and its call sites are
  enumerated and narrowly justified.
- Stripe routes reject missing webhook secrets, verify signatures over raw
  request bodies, separate live/test mode, and use persistent event IDs and
  ordering guards before privileged writes.
- Connect OAuth uses stored, expiring, single-use state and binds callbacks to
  the initiating account. Caller-supplied Stripe account identifiers are not
  trusted as authorization.
- The reminder cron fails closed when its secret is absent, hashes both bearer
  values before constant-time comparison, and accepts no tenant selector.
- Public invoice, estimate, and packet access uses 256-bit URL tokens; token
  format checks and database-side functions avoid exposing ordinary tenant
  tables to anonymous callers.
- Redirect destinations use the shared `safeNextPath` rule or fixed internal
  paths. No verified open redirect was found.
- Upload paths enforce type/size constraints and private storage policies.
  Spreadsheet exports use formula-injection guards.
- No tracked `.env` containing values, private key file, or common credential
  filename was found. `.env.example` contains names/placeholders only.
- No application use of `dangerouslySetInnerHTML`, dynamic code evaluation,
  shell execution, or user-built SQL was found.
- Security headers include HSTS, nosniff, frame protection, permissions policy,
  referrer policy, and an enforcing CSP.

These are code-level observations, not proof that deployment configuration or
all future database state preserves the same controls.

## Remaining verification gaps

1. Run the complete migration and tenancy suite against an isolated PostgreSQL
   instance (`npm run verify:all`). This is required before treating RLS and
   grants as fully regression-tested for this commit.
2. Confirm production environment scoping and key separation. In particular,
   the Supabase service-role key, Stripe secrets, cron secret, and email token
   must exist only in server-side production/preview scopes appropriate to each
   environment.
3. Inspect Supabase Auth rate limits, leaked-password protection, MFA posture,
   redirect URL allow-list, email templates, and session duration in the live
   project.
4. Inspect Stripe webhook endpoint registrations and ensure each environment
   has the correct secret, event allow-list, livemode, and Connect endpoint.
5. Perform a two-tenant dynamic test with real auth JWTs and storage objects,
   including ID substitution across every detail, export, RPC, signed URL, and
   mutation route.
6. Run DAST against a preview deployment, including cache behavior for tokenized
   share URLs, header inspection, CSRF/origin rejection, upload polyglots,
   request-size limits, and webhook replay/concurrency tests.

