# Adversarial security review — 2026-08-21

## Summary

I replayed all 88 migrations onto a scratch PostgreSQL 16 instance and audited the
live catalog rather than the SQL text, then drove a two-tenant adversarial script
against every `authenticated`-executable SECURITY DEFINER function that takes an
account, client, estimate or invoice identifier. **I found no cross-tenant read or
write.** Every one of the 146 policies in `pilot` is shaped
`account_id in (select pilot.current_account_ids())` or stricter, every INSERT
policy carries a `WITH CHECK`, all ten views are `security_invoker=true`, `anon`
holds no table grant anywhere in the schema, and the two policy-less tables
(`stripe_events`, `connect_oauth_states`) correspondingly hold no `authenticated`
grant. Cross-tenant calls to `place_hold`, `delete_account`, `purge_business_data`,
`reset_account_data`, `deactivate_account`, `resume_from_hold`, `next_invoice_number`,
`ledger_sync`, `journal_entry_create`, `client_vendor_link_create/revoke`,
`document_share_create` and `client_autopay_disable` were all refused, and
`expire_hold` / `generate_autopay_invoice` are not executable by `authenticated`
at all. Both Stripe webhooks verify signatures over the raw body, derive tenancy
only from signed fields, and are idempotent at the money layer rather than only at
the delivery layer. Prior findings hold: SEC-01 is fixed (`npm audit --omit=dev`
→ 0 vulnerabilities on `next@^16.3.1`), SEC-03 remains open as documented
(`next.config.ts:103`), and nothing from either prior document has regressed.

The real finding of this pass is governance, not a bug: **the service-role
allow-list drifted again, in a way the file's own prescribed CI check cannot
detect**, and the widened entry point now charges saved cards. After that, the
significant items are all in the share-token surface — two of the four token types
have no expiry at all, and one of the four is not on the proxy allow-list, so its
token gets bounced into a `/login?next=…` query string.

---

## SEC-2026-08-21-01 — The reminders cron's service-role client now issues invoices and charges saved cards; the allow-list's own CI check is blind to it

**Severity: High** (control failure on the product's only off-session
money-movement path)

**Location:** `app/api/reminders/run/route.ts:90`, `app/api/reminders/run/route.ts:124`,
`lib/autopay/run.ts:244`, `lib/autopay/charge.ts:161`, against
`lib/supabase/service-role.ts:71` (entry point 3) and `lib/supabase/service-role.ts:40`
(the prescribed check).

**Evidence.** `lib/supabase/service-role.ts:71` defines entry point 3 as the daily
reminder pass and bounds it explicitly:

> "it performs one fixed operation — decide whether a reminder is due, send it,
> record the outcome"… "A future change wanting this client for a report, a
> backfill or a support lookup is a NEW decision, not an extension of this one."
> (`lib/supabase/service-role.ts:87`, `:96`)

That is no longer what the client does. The same client object built at
`app/api/reminders/run/route.ts:90` is passed at line 124 to `runAllDueAutopay`,
which sweeps **every account in the database** (`lib/autopay/run.ts:143-148` — a
`.from("accounts").select(...)` with no tenant predicate), calls
`generate_autopay_invoice` (`lib/autopay/run.ts:244`), then flips the invoice to
`sent` and charges a stored card off-session (`lib/autopay/charge.ts:123`,
`lib/autopay/charge.ts:161`). `lib/supabase/service-role.ts:204` still says the
client must "never [be] used to read or write tenant business data on a pilot's
behalf outside the narrow, fixed operations described in entry points 3 through 8".
No paragraph in that file describes generation or charging.

**Why the designed control missed it.** `lib/supabase/service-role.ts:43` prescribes
the enforcement mechanism as a grep for *files that call* `createServiceClient(`.
I ran it verbatim this pass: it returns exactly the ten documented paths, so the
check is green. `lib/autopay/run.ts` and `lib/autopay/charge.ts` take the
privileged client as a **parameter**, so they can never appear in that grep no
matter how far their authority grows. The file's entire premise — "that list IS
the control" — is defeated by parameter passing, which is precisely the pattern
`lib/reminders/run.ts:43` established and documented as a virtue.

**Attack scenario.** `CRON_SECRET` is now a single credential that, presented to
one route, causes real card charges across every tenant on the platform. It is the
same secret as the holds route (`app/api/holds/run/route.ts:97`) and is checked with
a weaker comparison there (see SEC-…-05). The charging pass has no equivalent of
the holds pass's `HOLD_EXPIRY_PURGE_ENABLED` dry-run flag
(`lib/holds/gate.ts:28`) and no per-run blast-radius cap
(`lib/holds/gate.ts:44`), even though `lib/supabase/service-role.ts:114` argues at
length that an unattended destructive pass needs both. A holder of `CRON_SECRET`
(or a bug in `computeDuePeriods`, imported from a `"use server"` module at
`lib/autopay/run.ts:5`) causes charges bounded only by the
`recurring_invoice_generations` unique index — i.e. it cannot double-bill a period,
but it can pull every not-yet-due-tomorrow period forward the moment the date math
says yes.

**What is genuinely sound and should not be undone:** `pilot.generate_autopay_invoice`
re-derives all five preconditions server-side
(`supabase/migrations/20260819100000_autopay_unattended_generation.sql`), and I
verified it is granted to `service_role` only and refuses a mismatched
`(target_account, schedule)` pair.

**Fix.**

1. Write entry point 3's paragraph honestly — it is now *two* operations, one of
   which moves money — or split the autopay pass onto its own route and its own
   secret so the reminder client's authority stops where its paragraph says.
2. Make the CI check catch parameter passing. Type the privileged client as a
   branded type and fail the build on any module outside the allow-list that
   accepts it:

   ```ts
   // lib/supabase/service-role.ts
   declare const RLS_BYPASS: unique symbol;
   export type ServiceClient = ReturnType<typeof createSupabaseClient<Database, "pilot">>
     & { readonly [RLS_BYPASS]: true };
   ```

   then extend the check to the transitive set:

   ```sh
   # every file that CALLS it, plus every file that ACCEPTS it
   grep -rln 'createServiceClient(\|: ServiceClient' --include='*.ts' --include='*.tsx' app lib \
     | grep -v '^lib/supabase/service-role\.ts$' | sort
   ```
3. Give the charging pass the two guards the deleting pass already has: an
   `AUTOPAY_UNATTENDED_ENABLED` flag with a dry-run report, and a per-run cap on
   invoices charged.

---

## SEC-2026-08-21-02 — Invoice and estimate share tokens never expire

**Severity: Medium**

**Location:** `supabase/migrations/20260809060000_invoice_public_share.sql` (table
`pilot.invoice_shares`), `supabase/migrations/20260814111000_estimate_share.sql`
(table `pilot.estimate_shares`).

**Evidence.** Read from the replayed catalog:

```
client_vendor_links | id, account_id, client_id, token, expires_at, ...
document_shares     | id, account_id, client_id, token, expires_at, ...
estimate_shares     | id, account_id, estimate_id, token, created_at, created_by, revoked_at, ...
invoice_shares      | id, account_id, invoice_id, token, created_at, created_by, revoked_at, ...
```

Two of the four share types carry `expires_at` and enforce it inside the
anon-executable function (`supabase/migrations/20260814112000_client_vendor_page.sql:277`
— `and s.expires_at > now()`, with its own comment "Expiry enforced HERE, in the
only path anon can reach — not by a sweep job"). The other two have no such column
and no such clause: `pilot.estimate_public` filters on `revoked_at is null` and
`status <> 'draft'` only
(`supabase/migrations/20260814111000_estimate_share.sql:196-199`). Neither
migration file contains the string "expir" anywhere. This is an omission, not a
recorded trade-off.

**Attack scenario.** An invoice share URL is a 256-bit bearer credential emailed to
a client's AP inbox. It stays valid forever unless the pilot remembers to press
revoke on that specific invoice. Three years later the same URL — sitting in a
forwarded mail thread, an ex-employee's archived mailbox, a shared AP folder, or a
compromised inbox — still renders the invoice, the bill-to block, and, through
`lib/invoice-share-receipts.ts`, **private receipt-image bytes downloaded with the
service-role key from a bucket no session client can read**
(`lib/invoice-share-receipts.ts:261`). The vendor page and the credential packet —
the two surfaces whose designers thought about lifetime — both self-close. The two
that expose per-transaction financial documents and rebilled receipt photographs do
not.

**Fix.** Add `expires_at` to both tables with the same default the packet uses,
enforce it in the two anon functions, and backfill existing rows to a bounded
horizon:

```sql
alter table pilot.invoice_shares  add column expires_at timestamptz;
alter table pilot.estimate_shares add column expires_at timestamptz;
update pilot.invoice_shares  set expires_at = created_at + interval '180 days' where expires_at is null;
update pilot.estimate_shares set expires_at = created_at + interval '90 days'  where expires_at is null;
alter table pilot.invoice_shares  alter column expires_at set not null;
alter table pilot.estimate_shares alter column expires_at set not null;
-- then, inside pilot.invoice_public / pilot.estimate_public /
-- pilot.invoice_share_receipts / the two *_mark_viewed functions:
--   and s.expires_at > now()
```

`invoice_share_create` already rotates a token in place, so "the link expired,
send me a new one" is a one-press recovery the UI can already do.

---

## SEC-2026-08-21-03 — `/estimate/[token]` is missing from the proxy allow-list, so the share token is bounced into a `/login?next=…` query string

**Severity: Medium**

**Location:** `lib/supabase/proxy.ts:116-247` (the `isAuthSurface` list),
`lib/supabase/proxy.ts:305` (the redirect), `app/(app)/estimates/[id]/share-panel.tsx:70`
(the URL the pilot is told to send).

**Evidence.** The allow-list names `/invoice/` (`:223`), `/packet/` (`:234`),
`/vendor/` (`:243`) and `/store/` (`:262`). `grep -n "estimate" lib/supabase/proxy.ts`
returns **nothing**. The top-level matcher (`proxy.ts:26`) excludes only
`_next/static`, `_next/image`, `favicon.ico`, `ocr/` and image extensions, so
`/estimate/<token>` is matched. An anonymous request therefore falls to
`lib/supabase/proxy.ts:305`:

```ts
const nextTarget = path + request.nextUrl.search;
loginUrl.searchParams.set("next", nextTarget);
```

`app/(app)/estimates/[id]/share-panel.tsx:70` builds `${origin}/estimate/${liveToken}`
and hands it to the pilot to send to a client who, by construction, has no account.

**Attack scenario / impact.** The 256-bit estimate token is copied into the query
string of `/login`, where it lands in Vercel access logs, the browser history and
address bar of a machine that is not the pilot's, any corporate proxy log on the
client's side, and the `Referer` of anything the login page loads. Meanwhile the
feature silently does not work for its only intended audience — the exact failure
`/packet/`'s own comment (`lib/supabase/proxy.ts:230-236`) and `/vendor/`'s
(`:244-247`, "This line was MISSING when the feature shipped") both warn about,
happening a third time. Signed-in users pass the proxy, so the defect is invisible
to anyone testing with a session.

**Fix.**

```ts
    // The client-facing estimate share (app/estimate/[token]/page.tsx). Same
    // shape and same reasoning as /invoice/, /packet/ and /vendor/ above.
    path.startsWith("/estimate/") ||
    normalizedPath === "/estimate" ||
```

Then extend `tests/cron-allowlist.test.mjs`'s sibling coverage: assert that every
`app/*/[token]/page.tsx` route directory has a matching allow-list prefix, so the
fourth omission fails the build instead of shipping.

---

## SEC-2026-08-21-04 — `robots.ts` disallows two of the four token routes

**Severity: Low**

**Location:** `app/robots.ts:69-70`.

**Evidence.** The disallow list carries `/invoice/` and `/packet/` under the comment
"Token-addressed client-facing pages. Nothing links to them, but a token in a
crawled referrer is exactly how a private invoice ends up in an index." `/estimate/`
and `/vendor/` — both token-addressed, both client-facing, both added after that
comment was written — are absent. The root layout's `robots: { index: false,
follow: false }` (`app/layout.tsx:42`) still covers them with a meta tag, which is
why this is Low rather than Medium; robots.txt is the second layer, and the second
layer is now inconsistent with the first.

**Fix.** Add `"/estimate/"` and `"/vendor/"` to the array at `app/robots.ts:69`. As
with SEC-…-03, derive the list from the token route directories rather than
retyping it — `app/robots.ts:41` already makes exactly this argument for nav
sections.

---

## SEC-2026-08-21-05 — The holds cron's secret comparison leaks the secret's length

**Severity: Low**

**Location:** `app/api/holds/run/route.ts:74-79`.

**Evidence.**

```ts
function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;      // ← early return on length
  return nodeTimingSafeEqual(ab, bb);
}
```

The sibling route hardened exactly this and documented why
(`app/api/reminders/run/route.ts:186-205`: "the hand-rolled version this replaces
was constant-time in content but ran for max(a.length, b.length) iterations, which
still correlated with the secret's length"). The holds route kept the weaker form.
Both routes guard the same `CRON_SECRET`, and per SEC-…-01 that secret now gates
card charges as well as record deletion, so its length should not be measurable
from the public internet.

**Fix.** Hash both sides first, exactly as the reminders route does:

```ts
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

function timingSafeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return nodeTimingSafeEqual(da, db);
}
```

Better still: export the hardened one from a shared module so the two cron routes
cannot drift again.

---

## SEC-2026-08-21-06 — `pilot.generate_recurring_invoice` is the one SECURITY DEFINER function without `search_path = ''`

**Severity: Low**

**Location:** `supabase/migrations/20260809030000_recurring_invoices.sql`
(the `generate_recurring_invoice` definition).

**Evidence.** Queried from the replayed catalog:

```
proname                    | prosecdef | proconfig
generate_recurring_invoice | t         | {"search_path=pilot, pg_catalog"}
```

All 94 other functions in `pilot` carry `search_path=""`. This is the single
outlier, and it is on the interactive half of the money-generation pair whose
unattended sibling (`generate_autopay_invoice`) *does* use `search_path = ''`.

**Exploitability today: none.** I confirmed `authenticated` holds only `USAGE` on
schema `pilot` (`nspacl = {postgres=UC/postgres, authenticated=U/postgres,
service_role=UC/postgres, anon=U/postgres}`), so no tenant can create a shadowing
object in a schema this function resolves through. The finding is that the
invariant every other function relies on — "a definer function resolves nothing
implicitly" — has one documented-nowhere exception, and the day someone grants
`CREATE` on `pilot` (service_role already has it) that exception becomes the hole.

**Fix.**

```sql
alter function pilot.generate_recurring_invoice(uuid, date) set search_path = '';
```

…and schema-qualify anything in its body that currently relies on the `pilot`
entry. Then add the assertion to `scripts/tenancy-verify.mjs`, which today does not
check `proconfig`:

```sql
-- every SECURITY DEFINER function in pilot must pin an empty search_path
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'pilot' and p.prosecdef
  and coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=""';
```

---

## SEC-2026-08-21-07 — The off-session autopay charge carries no Stripe idempotency key

**Severity: Low**

**Location:** `lib/stripe/connect.ts:602`.

**Evidence.** `stripe.paymentIntents.create({... off_session: true, confirm: true},
{ stripeAccount })` is called with no `idempotencyKey` in the options object, and
`grep -rn "idempotencyKey" lib app` returns nothing anywhere in the codebase. The
stripe-node SDK auto-generates a key only for its own in-process network retries
(`node_modules/stripe/cjs/RequestSender.js:212`), which does not survive a
serverless invocation dying mid-flight.

**Why this is Low and not High.** I traced the double-charge paths and the
`recurring_invoice_generations` unique index closes them: a retried pass that finds
the period already generated hits 23505 and `continue`s before reaching the charge
(`lib/autopay/run.ts:256-259`), and the interactive and unattended doors contend on
that same row. The residual is the reverse — a `create` that reaches Stripe and
succeeds, whose response is lost, leaves an issued-and-actually-paid invoice
recorded as `issued_not_charged` (`lib/autopay/charge.ts:170-177`) and never
retried. That is a reconciliation defect, not a double charge, but a deterministic
key makes both directions safe for free.

**Fix.**

```ts
const intent = await stripe.paymentIntents.create(
  { /* unchanged */ },
  {
    stripeAccount: params.connectAccountId,
    // Deterministic in the invoice, so a lost response can be retried and a
    // second attempt returns the FIRST PaymentIntent instead of creating one.
    idempotencyKey: `autopay:${params.accountId}:${params.invoiceId}`,
  }
);
```

---

## SEC-2026-08-21-08 — Sample-connect storefront: the code does not do what its security comment claims

**Severity: Low**

**Location:** `app/store/[accountId]/actions.ts:30-35`, and its comment at `:20-22`.

**Evidence.** The comment asserts the action "takes no destination for the money
beyond the account id already in the public URL, so it cannot be pointed at a
different merchant's balance than the page it was posted from." The code reads the
account from the **form body**, not the URL segment, and validates only a prefix:

```ts
const accountId = String(formData.get("accountId") ?? "");
const productId = String(formData.get("productId") ?? "");
if (!accountId.startsWith("acct_") || !productId.startsWith("prod_")) { ... }
```

Anyone on the internet can therefore POST arbitrary `acct_…`/`prod_…` pairs and
mint Checkout Sessions against any connected account on the platform's Stripe
account. This route is reachable in production — `lib/supabase/proxy.ts:262`
allow-lists `/store/` unconditionally, with no `NODE_ENV` gate (unlike the layout
harness at `:271`). The material impact is unpaid Checkout Sessions and Stripe API
consumption, not misdirected funds; the price is re-read server-side.

**Fix.** Take the account from the route segment the page already has, and drop it
from the form:

```ts
export async function buyProductAction(accountId: string, formData: FormData) {
  const productId = String(formData.get("productId") ?? "");
  ...
}
// page.tsx: <form action={buyProductAction.bind(null, params.accountId)}>
```

Or, if the sample is meant to be illustrative rather than deployed, gate `/store/`
and `/sample-connect` on `process.env.NODE_ENV === "development"` in the proxy, the
same way the two harnesses at `lib/supabase/proxy.ts:277` are.

---

## SEC-2026-08-21-09 — `pilot.expiration_coverage_gaps` is EXECUTE-able by PUBLIC

**Severity: Info**

**Location:** `supabase/migrations/20260807060000_operator_qualifications.sql`
(the `expiration_coverage_gaps` definition and its grants).

**Evidence.** Catalog read of `proacl` shows grantee `0` (PUBLIC) alongside
`authenticated` and `postgres`; every other reader function in the schema is
revoked from PUBLIC first and granted explicitly. The function is SECURITY INVOKER
(`prosecdef = f`), so an `anon` caller reaching it gets a permission error on the
underlying tables rather than data — which is why this is Info. It is nevertheless
the only function in `pilot` that does not follow the schema's own
`revoke all … from public` convention.

**Fix.**

```sql
revoke all on function pilot.expiration_coverage_gaps() from public;
grant execute on function pilot.expiration_coverage_gaps() to authenticated;
```

---

## Prior-audit regression check

| Prior finding | Status now | Evidence from this run |
|---|---|---|
| SEC-01 vulnerable image/CSS toolchain | **Fixed, holding** | `npm audit --omit=dev` → `found 0 vulnerabilities`; `next@^16.3.1` in `package.json` |
| SEC-02 no repo-verifiable abuse control on public auth/email surfaces | **Still open, unchanged** | No application-level limiter exists; still deployment-gated. I add that `app/api/autopay/start` and `/stop` (`app/api/autopay/start/route.ts:35`) are new unauthenticated POST surfaces since that audit and inherit the same gap — each valid token can mint unbounded Stripe SetupIntents |
| SEC-03 CSP permits inline script globally | **Still open, unchanged** | `next.config.ts:103` — `script-src` still includes `'unsafe-inline'`; no nonce threading in `proxy.ts` |
| PG-01 incomplete host `node_modules` | Environment-only, N/A | — |
| "Every `pilot` table has RLS enabled" | **Holds** | All 51 tables `relrowsecurity = t` in the replayed catalog |
| "Every `pilot` view uses `security_invoker`; no matviews" | **Holds** | All 10 views `{security_invoker=true}`; `relkind='m'` count = 0 |
| "Anonymous roles reach only documented token-based functions" | **Holds** | Zero rows in `information_schema.role_table_grants` for grantee `anon` in schema `pilot`; anon EXECUTE limited to the six `*_public` / `*_mark_viewed` / `autopay_public_state` functions |
| "Billing/entitlement/webhook state is service-role-only" | **Holds** | `stripe_events` and `connect_oauth_states` have 0 policies **and** 0 `authenticated` grants; `accounts` UPDATE is column-enumerated to 22 non-billing columns, excluding `plan_tier`, `status`, `stripe_customer_id`, `connect_account_id`, `hold_*` |

No regression found.

---

## What I did not cover

- **The hosted Supabase project.** Everything above is a clean replay of the
  repository's migrations, not the live schema. `supabase/migrations/README.md`
  warns the hosted version identifiers may differ; a hosted catalog diff still needs
  a read-only `DATABASE_URL` and is still gap #2 from the 2026-08-16 audit.
- **Anything requiring live credentials:** Stripe webhook endpoint registrations,
  event allow-lists, live/test secret separation, Supabase Auth rate limits,
  leaked-password protection, redirect allow-list, Vercel environment scoping.
  SEC-02's verification remains untestable from source.
- **Dynamic testing.** No DAST, no browser probe of the CSP, no upload-polyglot
  testing, no real webhook replay or concurrency race against a preview
  deployment, no signed-URL or storage-object substitution with live JWTs. My
  two-tenant testing was SQL-level against the scratch database, not HTTP-level
  through PostgREST.
- **Storage RLS as deployed.** The `receipts` and documents bucket policies are
  applied to a `storage.objects` *stub* in `scripts/lib/verify-bootstrap.sql`, so I
  verified the tenant-prefix checks in application code
  (`lib/invoice-share-receipts.ts:255`, `lib/invoice-document.tsx:245`,
  `lib/invoice-document.tsx:314`) but not the bucket policies against real Supabase
  Storage.
- **The FAA currency engine and the accounting ledger's arithmetic.** I checked
  their grants and policies, not their correctness — `currency:verify` (605 checks)
  and `accounting:verify` are the right instruments and I did not re-derive them.
- **Receipt OCR internals.** I confirmed the size/type/magic-byte gates
  (`app/(app)/documents/actions.ts:175-186`), the filename sanitisation at `:193`,
  and the row caps on both importers (`MAX_ROWS_PER_CONFIRM = 5000`), but did not
  fuzz the tesseract WASM path or the OFX parser.
- **`npm run verify:all` end to end.** I replayed all 88 migrations and ran my own
  catalog and two-tenant queries against the result; I did not run the full suite,
  so I am not reporting a pass/fail for it.
- **Marketing copy** against `docs/MARKETING.md` §5 — out of scope for this pass.
