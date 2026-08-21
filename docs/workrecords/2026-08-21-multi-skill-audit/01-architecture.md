# Architecture review — V1 (powered by AMG Aviation)

| | |
| --- | --- |
| **Review date** | 2026-08-21 |
| **Review mode** | Mode A — codebase review (`/home/user/v1-contract-pilot`, 88 migrations, ~121.5k LOC) |
| **System stage** | Early production, pre-broad-launch (v0.1.0), solo + agent-assisted |
| **Overall score** | **68.1% — Grade D** |
| **Reviewer scope** | 7-dimension scored architecture review. Report only; no file in this repo was modified other than this one. |

---

## Summary

This is an unusually disciplined codebase for a solo pre-launch product: tenancy is enforced in
PostgreSQL rather than in application code, the double-entry ledger is *derived* from
`pilot.invoice_payments` by view rather than dual-written, the RLS-bypassing service-role client
carries a numbered entry-point list that CI now counts (`.github/workflows/ci.yml:79-96` — and I
verified the grep returns exactly the ten paths the header names), share tokens are 43-char
`unique`-indexed columns whose authorisation decision is made by SECURITY DEFINER functions, and
partial-failure paths tell the user the honest truth ("the invoice is now issued and numbered, but
the email didn't go out"). Both prior audits' remediations held: `next` is at ^16.3.1, the CSP is
still enforcing with `'unsafe-inline'` documented as accepted debt (SEC-03, unchanged, not a
regression), and no service-role call site has drifted unregistered since 2026-08-19. The failure
of this architecture is not in its correctness thinking, it is in its **fan-out arithmetic**: the
one place the product runs unattended over *every* tenant at once — the daily reminders + autopay
cron — selects accounts with no `.order()` and no `.limit()`, iterates them serially with a network
mail or Stripe call per invoice, and lives inside a single 300-second serverless invocation. That
one shape is a silent-starvation defect at the next 10x, and it sits on the money path. Second in
severity is that recording a payment and advancing the invoice's status are two separate,
non-transactional PostgREST round trips while `pilot.invoices_overdue` keys on *status* — a
combination whose exact failure (dunning a client who paid in full) has already happened once and
is documented in the code's own comment at `app/(app)/invoices/actions.ts:2336-2340`. Neither is
a tenancy or share-token hole; the two stated top priorities are the two strongest dimensions here.

---

## Severity mapping (for merging with the other agents' output)

This review uses the skill's native S1–S5 labels. Map them as follows:

| Native | Label | Merge as |
| --- | --- | --- |
| **S1** | Critical | `critical` |
| **S2** | High | `high` |
| **S3** | Medium | `medium` |
| **S4** | Low | `low` |
| **S5** | Informational | `info` |

No S1 finding was identified in this review.

---

## Scorecard

| # | Dimension | Score (1-5) | Weight | Weighted | Key finding |
| --- | --- | --- | --- | --- | --- |
| 1 | Structural Integrity & Design Principles | 3.5 | 20% | 0.700 | Clean boundaries and strong fault-tolerance contracts, undercut by a 617-code-line `createInvoiceDraft` and an implicit consistency model on the payment write |
| 2 | Scalability | 3.0 | 18% | 0.540 | Unbounded, unordered account fan-out inside a single 300s cron invocation (A-01) |
| 3 | Enterprise Readiness | 3.5 | 15% | 0.525 | DB-enforced multi-tenancy is well above "tenant-id filtering", but there is no audit trail of any kind on financial rows (A-06) |
| 4 | Performance | 3.0 | 17% | 0.510 | Auth context resolved up to three times per render with no `React.cache()` seam; no caching layer anywhere (A-05) |
| 5 | Security | 4.0 | 18% | 0.720 | Tenancy design is the strongest thing in the repo; the harness does not assert policy *predicates* (A-03) |
| 6 | Operational Excellence | 3.0 | 7% | 0.210 | `lib/alerts.ts` closes the "zero signal" gap, but nothing detects a cron that never fired (A-07) |
| 7 | Data Architecture | 4.0 | 5% | 0.200 | Ledger derived, not dual-written; column-enumerated grants; unique-indexed tokens. Deduction for non-atomic payment→status (A-02) |

### Score calculation verification

```
Structural Integrity   3.5 × 0.20 = 0.700
Scalability            3.0 × 0.18 = 0.540
Security               4.0 × 0.18 = 0.720
Performance            3.0 × 0.17 = 0.510
Enterprise Readiness   3.5 × 0.15 = 0.525
Operational Excellence 3.0 × 0.07 = 0.210
Data Architecture      4.0 × 0.05 = 0.200
                       ------------------
Weighted sum                      = 3.405
Overall% = 3.405 / 5 × 100        = 68.1%
Grade    = D  (A 90-100 | B 80-89 | C 70-79 | D 60-69 | F <60)
```

- [x] All scores on the 1-5 scale; half-scores justified in the Key Finding column and in the findings below.
- [x] Weights applied as 20/18/18/17/15/7/5.
- [x] Weighted contributions shown to 3 decimals.
- [x] Grade matches the percentage band.

**Read the grade honestly.** 68.1% is dominated by Scalability and Performance, the two heavy
dimensions where this product is *deliberately* unoptimised before launch. Security (18%) and
Data Architecture — the owner's stated priorities — both score 4. A D here means "will not survive
its own growth curve without three specific fixes", not "unsafe today".

---

## Prior-art reconciliation

Checked every finding in `docs/SECURITY-AUDIT-2026-08-16.md` and
`docs/POSTGRES-SECURITY-VERIFICATION-2026-08-16.md` against current code. **No regressions found.**

| Prior finding | Current state | Evidence |
| --- | --- | --- |
| SEC-01 (vulnerable `sharp`/`postcss` via Next) — *fixed* | Holds. `next` pinned `^16.3.1`; CI now runs `npm audit --omit=dev --audit-level=high` as a blocking step, which did not exist at audit time. | `package.json:38`; `.github/workflows/ci.yml:105` |
| SEC-02 (no repo-verifiable abuse control on public auth/email surfaces) — *open* | Still open, unchanged. No application-level limiter was added; the two new public surfaces since (`/api/autopay/start`, `/api/autopay/stop`) are token-gated but likewise unthrottled. | `app/api/autopay/start/route.ts`, `app/api/autopay/stop/route.ts` |
| SEC-03 (`script-src 'unsafe-inline'` globally) — *open, accepted debt* | Still open and still documented. Not a regression. The preview-only `vercel.live` widening added since is correctly gated on `VERCEL_ENV === "preview"`, so the production header is unchanged. | `next.config.ts:104-107`, `next.config.ts:88` |
| PG-01 (incomplete host `node_modules`) — *tooling* | N/A to source. CI runs `npm ci` in all three jobs. | `.github/workflows/ci.yml` |
| Service-role caller list "must return exactly ten paths" | **Verified true today.** I ran the header's own grep this run; it returns exactly the ten registered paths. The drift the header records has not recurred, and `.github/workflows/ci.yml:79-96` now fails the build on a count change. | `lib/supabase/service-role.ts:47-52` |
| Verification gap #1 (full `verify:all` replay) | Closed and kept closed: the `database` CI job replays all 88 migrations on `postgres:16` per PR. | `.github/workflows/ci.yml:236-263` |

Gaps #2–#6 of the security audit (hosted config, Supabase Auth limits, Stripe endpoint
registrations, live two-tenant dynamic test, DAST) remain open and remain out of scope for a
source review. They are not restated as findings here.

---

## Findings

### A-01 · [S2] The unattended money cron fans out over accounts with no bound and no order

**Dimensions:** Scalability (primary), Operational Excellence, Structural Integrity.

**Location:**
- `lib/reminders/run.ts:771-777`
- `lib/autopay/run.ts:143-148`
- `app/api/reminders/run/route.ts:50` (`export const maxDuration = 300`)
- `app/api/reminders/run/route.ts:105-127` (autopay rides the same invocation)

**Evidence.** Both unattended passes select their working set the same way:

```ts
// lib/reminders/run.ts:771-777
const { data, error } = await serviceClient
  .from("accounts")
  .select("id")
  .in("status", ["trialing", "active", "past_due"]);
```

```ts
// lib/autopay/run.ts:143-148
const { data, error } = await serviceClient
  .from("accounts")
  .select("id, status, plan_tier, deactivated_at, hold_started_at, connect_account_id")
  .in("status", ["trialing", "active"])
  .is("deactivated_at", null)
  .is("hold_started_at", null);
```

No `.order()`, no `.limit()`, no `.range()`, no cursor. Both then iterate the result strictly
serially (`for (const account of accounts)` at `lib/reminders/run.ts:790` and
`lib/autopay/run.ts:162`), and inside each account iterate invoices/schedules/periods serially
again, with a Resend send or a `stripe.paymentIntents.create` per item. The autopay pass runs
*after* the reminders pass in the same 300-second invocation, by explicit design
(`app/api/reminders/run/route.ts:105-121`).

Three compounding failures:

1. **Silent truncation past the PostgREST row cap.** Supabase's Data API caps an unpaginated
   `select` (commonly 1000 rows) and truncates *without an error*. This codebase already knows
   this — `app/(app)/overview/page.tsx:196-199` names the cap and sets an explicit
   `AGGREGATE_LIMIT = 1000` specifically so truncation is detectable — but the lesson was not
   applied to the one query that decides which tenants get billed. At >1000 eligible accounts,
   the tenants past the cap receive no reminders and have no autopay invoices generated or
   charged, forever, with no error and no alert.
2. **Silent truncation past the wall clock.** Per account the pass makes ~6 PostgREST round trips
   before any work; per due invoice it makes a mail send. At 300 accounts averaging 2 due
   invoices, a conservative 50 ms/query and 400 ms/send gives ≈ 300×6×0.05 + 600×0.4 ≈ 330 s —
   already over the 300 s ceiling, before the autopay pass has started.
3. **The truncation point is not random, it is sticky.** With no `.order()`, PostgreSQL returns
   rows in an unspecified but in practice stable physical order, and `RUN_COOLDOWN_MINUTES = 10`
   (`lib/reminders/run.ts:228`) means yesterday's already-processed accounts are re-claimed on
   today's run. The same tail of the list is starved every day. The file's own comment at
   `lib/reminders/run.ts:791-795` identifies exactly this hazard ("accounts iterate in a fixed
   order, so … every tenant after it in that order would silently receive nothing —
   indefinitely") and defends against it for *exceptions* only, not for timeouts or row caps.

**Impact.** Tenants beyond the cut receive no dunning and no autopay charges — revenue the pilot
is entitled to simply never gets billed — and nothing anywhere reports it. `alertOperator` fires
on query *errors*, not on a short result set or a killed invocation.

**Fix.** Make the working set explicit, ordered, and resumable, and split the two passes.

```ts
// lib/reminders/run.ts — page the account list, deterministically ordered.
const PAGE = 200;
const accounts: { id: string }[] = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await serviceClient
    .from("accounts")
    .select("id")
    .in("status", ["trialing", "active", "past_due"])
    .order("reminders_last_run_at", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true })          // total order, so paging is stable
    .range(from, from + PAGE - 1);
  if (error) { /* existing error branch, unchanged */ }
  const page = (data ?? []) as { id: string }[];
  accounts.push(...page);
  if (page.length < PAGE) break;
}
```

Ordering by `reminders_last_run_at ASC NULLS FIRST` converts sticky starvation into fair
round-robin: whoever was served longest ago goes first, so a timeout costs a tenant one day, not
every day. Then, separately:

- Give autopay its own `vercel.json` cron entry and its own route with its own `maxDuration`, so a
  long reminders pass cannot eat the charging budget. The current comment justifying the shared
  invocation ("they share an invocation budget either way") is precisely the problem, not the
  argument for it.
- Add a **completion sentinel**: have each pass write `accountsSeen` / `accountsTotal` and alert
  when `accountsSeen < accountsTotal`, so truncation of either kind becomes a signal.

---

### A-02 · [S2] Recording a payment and advancing invoice status are two non-transactional writes, and the overdue view keys on status

**Dimensions:** Data Architecture (primary), Structural Integrity, Enterprise Readiness.

**Location:**
- `app/(app)/invoices/actions.ts:2316-2398` (`recordPayment`)
- `supabase/migrations/20260805090000_phase5_invoices.sql:1168-1175` (`pilot.invoices_overdue`)
- `supabase/migrations/20260810120000_payment_reversals.sql:222-225` (the resync trigger is
  `after insert` but only walks status *backwards* from `paid`)

**Evidence.** `recordPayment` performs four independent PostgREST round trips with no enclosing
transaction: insert into `invoice_payments` (`:2316-2318`), read `invoices.status`
(`:2341-2343`), read `invoice_totals` (`:2361-2362`), update `invoices.status`
(`:2383-2386`). The overdue view that the daily cron drives from filters on status, not balance:

```sql
-- supabase/migrations/20260805090000_phase5_invoices.sql:1168-1175
create or replace view pilot.invoices_overdue
with (security_invoker = true) as
  select i.id as invoice_id, i.account_id, i.due_on,
         (current_date - i.due_on) as days_overdue
  from pilot.invoices i
  where i.status in ('sent', 'partial')
    and i.due_on is not null
    and i.due_on < current_date;
```

The existing `invoice_payments_resync_status` trigger fires `after insert` but returns early
unless `current_status = 'paid'` — it is a *reversal* mechanism only. Nothing in the database
advances `sent → partial/paid`; that transition exists solely in application code.

This is not hypothetical. The code's own comment records the incident:

> `app/(app)/invoices/actions.ts:2334-2340` — "`status` came back undefined, the whole advance
> block below was skipped, and the function still returned saved: true. The payment had landed, so
> the invoice stayed 'sent' — counted as awaiting payment and rendered red as overdue by
> pilot.invoices_overdue … for an invoice that was fully paid."

That bug was fixed by *reading the error*, not by removing the window. Any serverless timeout,
Supabase blip, or client disconnect between line 2318 and line 2386 reproduces it identically —
and now the daily reminder cron will email the pilot's client demanding payment for an invoice
they settled in full.

**Impact.** Billing-correctness harm visible to the pilot's own customer, with reputational cost
to the pilot, arising from a failure the pilot cannot see. It also leaves AR aging and the
`invoices_overdue`-derived KPIs wrong until someone opens the invoice by hand.

**Fix.** This repo's own stated convention — "complex multi-table writes live in SECURITY DEFINER
Postgres functions" — is the right answer and is simply not applied here. Either:

**(a) Preferred — move the whole sequence into one function** (proposed DDL, *not* written to
`supabase/migrations/`):

```sql
create or replace function pilot.invoice_payment_record(
  target_account uuid, p_invoice_id uuid, p_amount_cents integer,
  p_paid_on date, p_method text, p_reference text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_payment_id uuid; v_due integer; v_paid integer; v_status text;
begin
  if target_account not in (select pilot.current_account_ids()) then
    raise exception 'not your account' using errcode = 'P0001';
  end if;
  insert into pilot.invoice_payments
    (account_id, invoice_id, amount_cents, paid_on, method, reference)
  values (target_account, p_invoice_id, p_amount_cents, p_paid_on, p_method, p_reference)
  returning id into v_payment_id;

  select amount_paid_cents, balance_due_cents into v_paid, v_due
    from pilot.invoice_totals where invoice_id = p_invoice_id;
  select status into v_status from pilot.invoices
    where account_id = target_account and id = p_invoice_id;

  if v_status in ('sent', 'partial') then
    update pilot.invoices
       set status = case when coalesce(v_due, 0) <= 0 then 'paid' else 'partial' end
     where account_id = target_account and id = p_invoice_id;
  end if;
  return v_payment_id;                -- one transaction; all of it or none of it
end $$;
```

**(b) Belt-and-braces regardless of (a) — make the read side self-correcting.** Change
`pilot.invoices_overdue` to derive from the balance rather than trust the status column, so a
missed transition can never produce a wrong dunning email:

```sql
create or replace view pilot.invoices_overdue
with (security_invoker = true) as
  select i.id as invoice_id, i.account_id, i.due_on,
         (current_date - i.due_on) as days_overdue
  from pilot.invoices i
  join pilot.invoice_totals t on t.invoice_id = i.id
  where i.status in ('sent', 'partial')
    and coalesce(t.balance_due_cents, 0) > 0     -- <- the new, load-bearing line
    and i.due_on is not null
    and i.due_on < current_date;
```

Add an assertion to `scripts/reminders-verify.mjs`: insert a full payment, deliberately skip the
status update, and assert the invoice does **not** appear in `invoices_overdue`.

---

### A-03 · [S2] The tenancy harness asserts that policies *exist*, never that they are tenant-scoped

**Dimensions:** Security (primary), Enterprise Readiness.

**Location:**
- `scripts/tenancy-verify.mjs:178-217` (F1: every table has RLS enabled)
- `scripts/tenancy-verify.mjs:240-255` (F1b: every RLS-enabled table has ≥1 policy)
- `supabase/migrations/20260802190437_pilot_schema_tenancy.sql:370-372`
  (`alter default privileges in schema pilot grant select on tables to authenticated`)

**Evidence.** F1 is catalog-driven and genuinely load-bearing — it reads `pg_class.relrowsecurity`
for every table in `pilot`, so a new table that forgets `enable row level security` fails CI. That
is the right check and it is correctly identified in the script's own comment as the one standing
between the schema-wide default SELECT grant and a cross-tenant read. F1b then asserts each
RLS-enabled table has at least one policy. But I grepped the whole script for
`polqual` / `pg_policy.qual` / `current_account_ids` and the only hit is a bare
`select 1 from pg_policies p` existence probe at line 249. **Nothing in the suite inspects a
policy's USING or WITH CHECK expression.**

The consequence: a migration adding `create policy foo_select on pilot.foo for select to
authenticated using (true);` passes F1 (RLS on), passes F1b (a policy exists), receives the
schema-wide default SELECT grant automatically, and is fully readable across every tenant. The
per-tenant isolation probes that would catch it are hardcoded against a fixture set of tables, not
derived from the catalog, so a new table is not covered by them either.

No such policy exists today — I checked all 153 `create policy` statements for `using (true)` /
`with check (true)` and found none, and 40 of the 88 migration files reference
`pilot.current_account_ids()`. This is a **hole in the safety net**, not a live hole.

**Impact.** The product's #1 stated invariant is defended by code review and by author discipline,
not by the harness that is its primary safety net. Given the repo's own recorded history of
silent drift in exactly this class of control (the service-role list drifting four times), that is
the wrong place to depend on discipline.

**Fix.** Add one catalog-driven assertion to `scripts/tenancy-verify.mjs`, in the same shape as F1:

```sql
-- F1c: every policy on a pilot table that is granted to `authenticated`
-- must mention the tenant predicate in BOTH its USING and WITH CHECK sides
-- (whichever the command has). An allow-list handles the few deliberate
-- exceptions, exactly the way F1b already excepts stripe_events.
do $$
declare unscoped text[];
begin
  select array_agg(format('%s.%s', p.tablename, p.policyname) order by 1)
    into unscoped
    from pg_policies p
   where p.schemaname = 'pilot'
     and 'authenticated' = any (p.roles)
     and p.tablename not in ('accounts', 'account_members')   -- their own helpers
     and (
       (p.qual       is not null and p.qual       not like '%current_account_ids%')
       or
       (p.with_check is not null and p.with_check not like '%current_account_ids%')
     );
  if unscoped is not null then
    raise exception
      'F1c FAILURE: pilot policies granted to authenticated whose predicate does not reference pilot.current_account_ids(): %',
      unscoped;
  end if;
  raise notice 'PASS F1c: every authenticated-facing pilot policy is tenant-scoped';
end $$;
```

Pair it with a generic isolation probe that loops `pg_class` rather than a hardcoded fixture list,
so a new table joins the two-tenant test the day it is created.

---

### A-04 · [S3] `createInvoiceDraft` is a 617-code-line single function — the file size is fine, the function is not

**Dimensions:** Structural Integrity (primary).

**Location:** `app/(app)/invoices/actions.ts:359-1494`.

**Evidence.** The brief asks whether the 2629-line `invoices/actions.ts` and the 2146-line
`settings/export/entities.ts` are genuine structural problems. My answer is different for each,
and neither answer is "line count".

- **`settings/export/entities.ts` — acceptable, keep it.** Its 1778 non-comment lines are a flat
  catalogue: ~20 `Record<string, string>` label dictionaries (`INVOICE_STATUS_LABEL:115`,
  `TRIP_STATUS_LABEL:124`, … `RECURRING_CADENCE_LABEL:315`) and per-entity column mappers. Cyclomatic
  complexity per unit is near 1. Splitting it into twenty files buys navigation and costs the one
  property that matters for an export format — that a reviewer can see every column of every
  entity in one scroll and spot a missing or mislabelled one. This is correct colocation.
- **`app/(app)/invoices/actions.ts` — the file is fine; one function in it is not.** The file
  holds 15 exported server actions plus their shared parsers, and because it is `"use server"`
  every export is a public endpoint at a stable id, so cohesion here is a security property, not
  just taste. But `createInvoiceDraft` spans lines 359 to 1494 — **617 non-comment, non-blank code
  lines in one function**, with 37 top-level-ish branch points and 12 awaits threaded through
  them. That is a genuine structural defect: it cannot be unit-tested (the repo has 65 test files
  and none targets it), a reviewer cannot hold its branch space, and its failure modes cannot be
  enumerated.

**Impact.** The single most business-critical construction path in the product — turning trips,
day grids, rebilled expenses and manual lines into a draft invoice with correct totals — is
verifiable only by running it through the UI.

**Fix.** Do not split the file. Extract the *pure* interior of `createInvoiceDraft` into a
testable module and leave the action as a thin shell:

```ts
// lib/invoices/draft-plan.ts — no Supabase, no requireAccount, no FormData.
export type DraftPlan = {
  header: InvoiceInsert;
  lines: LineInsert[];
  warnings: string[];
};
export function planInvoiceDraft(input: DraftInput): DraftPlan | { error: string } { … }
```

```ts
// app/(app)/invoices/actions.ts — the action becomes ~60 lines.
export async function createInvoiceDraft(_prev, formData) {
  const { account } = await requireAccount("/invoices/new");
  const input = readDraftInput(formData);                 // existing parsers, unchanged
  const plan = planInvoiceDraft(input);
  if ("error" in plan) return { error: plan.error, values: echo(formData) };
  return persistDraft(await createClient(), account.id, plan);
}
```

Then add `tests/invoice-draft-plan.test.mjs` covering the day-grid, cancellation-timing, minimum-basis
and rebill branches — the four that currently have no coverage at all. This is the same seam the
repo already used successfully for `lib/entitlements.ts` (pulled out of
`lib/supabase/account.ts` so it could be unit-tested without `next/navigation`, per that file's
comment at `lib/supabase/account.ts:66-71`).

---

### A-05 · [S3] The auth context is resolved up to three times per request, with no `React.cache()` seam

**Dimensions:** Performance (primary), Scalability.

**Location:**
- `lib/supabase/proxy.ts:75` — `await supabase.auth.getUser()` on every matched request
- `lib/supabase/account.ts:105-113` — `getSessionContext()` calls `auth.getUser()` again
- `lib/supabase/account.ts:131-151` — then two further PostgREST queries (`account_members`, `accounts`)
- `app/(app)/layout.tsx:58` — the layout calls `requireAccount()`
- 130 further files call `requireAccount` / `requireEntitlement`, and page components call it again
  inside the layout's subtree

**Evidence.** I grepped `lib` and `app` for `cache(` from `react` and found **zero** call sites.
`getSessionContext` is a plain async function. So a typical authenticated page render costs, in
strict sequence before any page data is fetched:

1. proxy `auth.getUser()` — a network call to Supabase Auth (token revalidation, by design; the
   comment at `lib/supabase/account.ts:99-102` correctly notes `getUser()` is the right call for a
   gate)
2. layout `requireAccount()` → `getUser()` + `account_members` select + `accounts` select
3. page `requireAccount()` → `getUser()` + `account_members` select + `accounts` select

That is **7 sequential round trips** from a Vercel serverless region to hosted Supabase, three of
them the comparatively slow Auth revalidation, before the first byte of business data is requested.

I verified against this Next version's own documentation rather than from recall, per `CLAUDE.md`:
`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md:266-283`
documents React `cache()` as the supported mechanism for exactly this ("If you are not using
`fetch` … you can wrap your data access with the React `cache` function to deduplicate requests
within a single render pass"), and lines 293-300 of the same file document the
`server-only` + `cache()` preload pairing this module already half-implements (it imports
`server-only` at `lib/supabase/account.ts:1`, but not `cache`).

**Impact.** A fixed ~200-400 ms of avoidable latency on every authenticated page view, on a
mobile-first product whose own CSP comment names "ramp-grade LTE" as the target network. It also
multiplies Supabase Auth request volume by 3× for no benefit, which is the metered dimension that
bites first as accounts grow.

**Fix.** One wrapper, no call-site changes:

```ts
// lib/supabase/account.ts
import { cache } from "react";

// Per-render memoization only — NOT a cross-request cache. React clears this
// between requests, so a revoked session can never be served from it.
export const getSessionContext = cache(async function getSessionContext(): Promise<SessionContext | null> {
  …  // body unchanged
});
```

This collapses items (2) and (3) above into one, taking 7 round trips to 4. Leave the proxy's own
`getUser()` alone — it runs in a different runtime and is the cookie-refresh path.

---

### A-06 · [S3] No actor attribution on any financial record

**Dimensions:** Enterprise Readiness (primary), Data Architecture.

**Location:** `created_by uuid references auth.users(id)` appears on exactly four tables, all of
them share tables — `supabase/migrations/20260809060000_invoice_public_share.sql:101`,
`20260810100000_credential_packet_share.sql:56`, `20260814111000_estimate_share.sql:51`,
`20260814112000_client_vendor_page.sql:78`. I grepped all 88 migrations for
`created_by|updated_by|actor_user_id|recorded_by`: there are no other hits. None of
`pilot.invoices`, `pilot.invoice_payments`, `pilot.journal_entries`, `pilot.expenses`,
`pilot.trips` or `pilot.logbook_entries` carries one. There is also no audit-log table anywhere in
the 50-table schema.

**Evidence of why it matters here specifically.** `pilot.account_members` already carries
owner/member/bookkeeper roles, and `multi_seat` is a *sold* entitlement labelled "Additional seats
for a bookkeeper or second pilot" (`lib/entitlements.ts:383-390`). It is currently
`comingSoon: true`, gated only by the absence of an invite UI. The moment that UI ships, two
humans share write access to a set of tax-relevant financial records with irreversible operations
— `voidInvoice` (`app/(app)/invoices/actions.ts:1954`), `correctPayment` (`:2528`), account
deletion, hold-expiry purge — and the database will retain no record of which of them did any of
it.

**Impact.** For a single-seat account today: low. For the multi-seat launch: this is a blocker.
A pilot cannot answer "who voided invoice 2026-0142" and cannot demonstrate to an auditor or a
disputing client that a correction was authorised. Retrofitting attribution *after* rows exist
means every pre-existing row is permanently `null`.

**Fix.** Land the column before the invite UI, not after — the cost is only a nullable column now
and a full-table backfill impossibility later.

```sql
-- One migration, applied to the write-bearing financial tables.
alter table pilot.invoices          add column if not exists created_by uuid references auth.users(id);
alter table pilot.invoice_payments  add column if not exists created_by uuid references auth.users(id);
alter table pilot.journal_entries   add column if not exists created_by uuid references auth.users(id);
alter table pilot.expenses          add column if not exists created_by uuid references auth.users(id);

-- Default it in the database, not the app, so a forgotten call site cannot omit it.
create or replace function pilot.stamp_created_by() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;
-- + one `before insert` trigger per table.
```

Critically, **do not add `created_by` to any `authenticated` INSERT/UPDATE column grant** — the
trigger sets it, and a tenant that can write the column can forge the attribution. That is the
same reasoning the crew_members grant comment already applies to `account_id`
(`supabase/migrations/20260818210000_crew_members.sql:95-101`). Add a `tenancy-verify` assertion
that `created_by` is absent from every `authenticated` grant.

---

### A-07 · [S3] Nothing detects a cron that never ran

**Dimensions:** Operational Excellence (primary).

**Location:** `lib/alerts.ts:100-116` (in-process `Map` throttle), `app/api/reminders/run/route.ts:104`
(`console.log` of the pass summary), `vercel.json:3-12`.

**Evidence.** `lib/alerts.ts` is a genuine and well-argued improvement over the "zero signal"
state its own header describes, and it is wired into every failure branch of both webhooks and
both crons (26 call sites). Its limits are honestly documented in the file. But the alerting model
is strictly **error-triggered**, and every alert path requires the pass to *run and fail*. The
three failure modes it structurally cannot see:

1. **The cron never fires.** A `vercel.json` mistake, a paused project, a deploy that drops the
   entry — the daily reminders and autopay simply stop, and the absence of an email is
   indistinguishable from a quiet day.
2. **The invocation is killed at the ceiling.** A 300 s timeout kills the process; no `catch` runs,
   no alert is sent (see A-01).
3. **The pass truncates.** A short account list from the row cap is not an error.

The throttle's own limit compounds this: `const lastSentAt = new Map<string, number>()`
(`lib/alerts.ts:116`) is per-instance, so it neither dedupes reliably nor persists — there is no
durable record anywhere that an alert was ever raised.

**Impact.** The product's most consequential unattended work has no liveness signal. Given that
`accounts.reminders_last_run_at` already exists as a per-tenant watermark, this is a small gap to
close.

**Fix.** Two cheap additions, no new vendor:

- **Heartbeat.** Have each cron route write a `pilot.cron_runs(source, started_at, finished_at,
  accounts_seen, accounts_total)` row, and add a third, tiny daily cron that alerts if the newest
  `finished_at` for either source is older than 26 hours. This catches (1) and (2). Alternatively,
  point the existing routes at a free dead-man's-switch (Healthchecks.io / Better Stack) —
  a single outbound ping at the end of each pass, no dependency added.
- **Completion assertion.** Return and log `accountsSeen` vs `accountsTotal`, and
  `alertOperator` when they differ. This catches (3) and is the same fix A-01 needs.

---

### A-08 · [S4] `robots.ts` disallows two of the four tokenized share routes

**Dimensions:** Security.

**Location:** `app/robots.ts:66-70`.

**Evidence.** The disallow list names the token-addressed client-facing pages with an explicit
rationale — "a token in a crawled referrer is exactly how a private invoice ends up in an index" —
and lists `"/invoice/"` and `"/packet/"`. It does **not** list `"/estimate/"` or `"/vendor/"`, both
of which are token-addressed client-facing pages of exactly the same shape
(`app/estimate/[token]/page.tsx`, `app/vendor/[token]/page.tsx`, added by
`supabase/migrations/20260814111000_estimate_share.sql` and `…20260814112000_client_vendor_page.sql`
after `robots.ts` was written). The vendor page is the one where a client's AP desk saves a card.

**This is not an exposure** — `app/layout.tsx:42` sets `robots: { index: false, follow: false }`
product-wide and all four token routes inherit it, and `Referrer-Policy:
strict-origin-when-cross-origin` (`next.config.ts:139`) strips the token from cross-origin
referrers. It is a defense-in-depth layer that the file's own stated rule says should cover these
routes and does not. It is the same drift-by-omission failure that the same file's comment
(`app/robots.ts:50-58`) says derivation exists to prevent — and the derivation was applied to nav
sections but not to share routes.

**Fix.**

```ts
// app/robots.ts — two lines, and a comment pinning the rule to the route group.
"/invoice/",
"/estimate/",   // token-addressed, same rule as /invoice/
"/packet/",
"/vendor/",     // token-addressed, and the one where a card gets saved
```

Better: derive it. Every tokenized route is a directory matching `app/*/[token]/page.tsx`; add an
assertion to `tests/dashboard-path.test.mjs` (which already asserts the nav derivation holds) that
each such directory's segment appears in the disallow list.

---

### A-09 · [S4] The money path opts out of TypeScript at the Supabase boundary

**Dimensions:** Structural Integrity.

**Location:** `lib/autopay/charge.ts:50-66`, `lib/autopay/run.ts:134-135`,
`lib/reminders/run.ts:765-766`, and `as never` casts throughout
`app/(app)/invoices/actions.ts` (e.g. `:2318`, `:2385`).

**Evidence.** `issueAndChargeAutopayInvoice` — the one code path in the product that charges a
saved card off-session — declares its client parameter as `SupabaseLike | any` with an
`eslint-disable-next-line @typescript-eslint/no-explicit-any`, and its hand-written `SupabaseLike`
shape returns `any` from both `select` and `update`. `runAllDueAutopay` and `runAllDueReminders`
do the same for `serviceClient`. Row shapes are then recovered by unchecked assertion
(`const enrolled = clientData as { autopay_stripe_customer_id: string | null; … }`).

The repo has a real reason for this — `lib/supabase/account.ts:120-130` documents that recent
supabase-js resolves `.select()` against the hand-authored `database.types.ts` to `never` — and
`next.config.ts:157-159` deliberately fails the build on type errors, so the team clearly values
the check. But the workaround has spread to the code where a wrong column name means a charge
against the wrong amount, and the fix named in that same comment ("regenerating
`database.types.ts` with `supabase gen types` is the central fix if this recurs") has not been
applied. `database.types.ts` is 3081 hand-maintained lines.

**Impact.** A renamed or dropped column on `pilot.clients` or `pilot.invoice_totals` produces a
runtime `undefined` on the charging path rather than a build failure. `totalCents` reaching
Stripe as the wrong value is caught only by the `totalCents <= 0` guard at
`lib/autopay/charge.ts:150`.

**Fix.** Regenerate `lib/supabase/database.types.ts` from the live schema
(`supabase gen types typescript --schema pilot`) and wire it as a CI step that fails on drift, then
type these three signatures as `SupabaseClient<Database, "pilot">` and delete the `any` escapes.
Until that lands, at minimum replace the unchecked `as` assertions on the charging path with a
narrowing predicate that returns `not_issued` on shape mismatch rather than proceeding with
`undefined`.

---

### A-10 · [S4] `verify:all` and the CI `database` job have diverged

**Dimensions:** Operational Excellence.

**Location:** `package.json` (`verify:all`, the `adhoc-invoice:verify` entry) vs
`.github/workflows/ci.yml:266-286` (the "Schema-contract suites" step).

**Evidence.** `verify:all` runs, in order: tenancy, connect, invoice-share, packet-share,
account-lifecycle-db, autopay, bank-import, aircraft, payment-reversal, estimates, logbook,
currency, accounting, reminders, **adhoc-invoice**. The CI `database` job runs the same list
**minus `adhoc-invoice:verify`** — 37 assertions on the ad-hoc invoicing path that run when the
owner types `npm run verify:all` locally and never run on a pull request. `CLAUDE.md`'s verify gate
table names `adhoc-invoice:verify` as mandatory for any invoice action change.

The three genuinely-unwired scripts (`billing:verify`, `trip:verify`, `customisation:verify`) are
*not* a finding — `.github/workflows/ci.yml:31-64` explains precisely why each needs a live
GoTrue/PostgREST stack this repo has deliberately deferred, and that reasoning is sound.

**Impact.** A divergence between "the command the docs tell you to run" and "the command that
gates the merge" is the shape of gap that grows silently. Today it is one suite.

**Fix.** Delete the duplication. Have the CI job invoke `npm run verify:all` directly against the
service container (it already provides Postgres on 55432 with trust auth, which is exactly the
shape `verify:all`'s `pg_isready` preamble checks for), so the two can never drift again.

---

### A-11 · [S5] Strengths worth preserving explicitly

These are load-bearing and should survive any refactor:

- **Tenancy design.** The non-public `pilot` schema plus column-enumerated GRANTs is the right
  call, and the reasoning is correct: RLS has no column granularity, so the grant is the only
  place `account_id` and `id` can be withheld from a tenant's own write
  (`supabase/migrations/20260818210000_crew_members.sql:93-101`). The `alter default privileges …
  grant select … to authenticated` default is a fail-*open* posture, but F1
  (`scripts/tenancy-verify.mjs:178-217`) closes it catalog-wide and is checked on every PR. Verdict
  on the brief's question: **good design, correctly defended, with one gap (A-03).**
- **Business invariants in SECURITY DEFINER functions.** 59 across the schema. Verdict on the
  brief's question: **good call, not a liability** — because the harness executes them rather than
  reading them (`scripts/account-lifecycle-db-verify.mjs` "caught deactivate_account writing a
  column the protect trigger reserves for service_role on its very first run",
  `.github/workflows/ci.yml:247-255`). The observability cost is real but is answered: every
  caller distinguishes `42501` (grant broken) from `P0001` (business refusal) and alerts
  differently (`lib/autopay/run.ts:263-278`), which is the exact discrimination a naive
  `.rpc()` caller loses. The one place the convention *isn't* applied is the payment write (A-02).
- **The ledger derives, it does not dual-write.** `supabase/migrations/20260812100000_accounting_ledger.sql:67`
  — "pilot.invoice_payments; the ledger derives from it, never competes" — eliminates the entire
  class of AR-vs-GL drift bugs that a dual-write design would have created.
- **The `scripts/*-verify.mjs` harness.** Verdict on the brief's question: **it earns its place as
  the primary safety net for the database, and does not cover the application.** It replays all 88
  migrations per PR and asserts refusals by *performing* them inside rolled-back transactions —
  stronger evidence than most jest suites produce. Its honest limit is scope: 65 `tests/*.test.mjs`
  cover pure modules, the DB suites cover the schema, and the seam between them (server actions,
  route handlers, the Stripe SDK boundary) has no automated coverage at all, which is why A-04's
  617-line function is untested and why the CI comment at `.github/workflows/ci.yml:31-64` is
  correct that closing it is "one piece of infrastructure, not three".
- **Failure honesty at the Stripe/Supabase boundary.** Verdict on the brief's question about
  mid-write unavailability: **handled deliberately, one layer short of atomic.** `sendInvoice`
  (`app/(app)/invoices/actions.ts:1787-1793`) tells the pilot the exact truth and the exact next
  action when the DB write lands and the mail does not. `chargeAutopayInvoice` cannot double-charge
  across passes because generation is guarded by a unique index on
  `recurring_invoice_generations` and `23505` is treated as success
  (`lib/autopay/run.ts:253-257`); and although the code passes no explicit Stripe idempotency key,
  stripe-node auto-generates one per call for its own network retries
  (`node_modules/stripe/cjs/RequestSender.js:211-224`), so the SDK-retry double-charge is closed.
  The residual is A-02: the *database* side of a two-step write has no transaction.

---

## Cross-cutting analysis

**Multi-dimension issues.** A-01 (Scalability + Ops + Structural) and A-02 (Data + Structural +
Enterprise) are both instances of one root pattern: **work that spans more than one round trip has
no transaction and no completion proof.** The payment write assumes four sequential calls all
land; the cron assumes one invocation covers every tenant. Both are correct at today's size and
both fail silently rather than loudly when they stop being correct.

**Conflicting decisions.** The repo states a convention — complex multi-table writes belong in
SECURITY DEFINER functions — and applies it thoroughly (59 functions, including
`pilot.generate_autopay_invoice`, whose whole purpose is to make generation atomic and idempotent).
`recordPayment`, the single highest-consequence multi-table write in the product, does not follow
it. That is an inconsistency, not a considered exception; nothing in the code argues for it.

**Architectural coherence.** High. This is not an accidental architecture. The layering
(proxy → `requireAccount` → server action → RPC/PostgREST → RLS) is consistent across 382 app
files, the "no Tailwind, no CSS-in-JS, Radix Themes only" constraint holds, and decisions are
recorded at the point of the code rather than in a drifting doc. The unusual density of
justification comments is a genuine asset for a solo maintainer — with one caveat noted below.

**Requirements alignment.** Correctly scoped, not over-engineered. There is no queue, no Redis,
no microservice decomposition, and none is warranted at hundreds of accounts. The findings above
are not "you should have built a distributed system"; they are three bounded fixes (paging + order,
one RPC, one heartbeat) that buy the next 10x inside the existing shape.

**Pattern fitness.** The chosen pattern — serverless modular monolith on managed Postgres with
authorization pushed into the database — is the right one for this team size and this risk profile,
and I would not recommend changing it. The main thing serverless costs here is the transaction
boundary (A-02) and the invocation ceiling (A-01), and both are addressable within the pattern.

**Severity reconciliation.** A-01 and A-07 were each individually assessable as S3. I escalated
A-01 to S2 because the two compound: an unbounded pass and a system that cannot detect a truncated
pass mean the failure is not merely likely, it is *undetectable*. A-01's fix and A-07's fix are the
same completion-assertion work, which is why they should ship together.

**One observation on the comment density.** The justification comments are an asset, but
`lib/supabase/service-role.ts` is now ~230 lines of prose guarding a 15-line function, and its own
header concedes the list drifted four times while the prose asserted it had not. The CI count check
added since is the right correction. The general lesson — **a control asserted in prose is not a
control until something executes it** — is exactly what A-03 (policy predicates) and A-08
(robots list) are instances of.

**Systemic risk.** *A silent revenue and dunning outage at ~1000 accounts.* If one thing sinks this
product it is A-01: the daily pass stops covering every tenant, no signal is produced, and the
first evidence is a pilot asking why their recurring client was never billed for three months.
Blast radius: every tenant past the truncation point, unbounded in time, with financial harm
(uncollected revenue) and reputational harm (unsent reminders) accruing daily and no recovery path
that reconstructs the missed sends.

---

## Recommendations

### Quick wins (< 1 day each)

1. **A-05** — wrap `getSessionContext` in `React.cache()`. One import, one line, ~200-400 ms off
   every authenticated page view. `lib/supabase/account.ts:105`.
2. **A-08** — add `"/estimate/"` and `"/vendor/"` to the `robots.ts` disallow list.
   `app/robots.ts:66-70`.
3. **A-10** — replace CI's hand-copied suite list with `npm run verify:all`.
   `.github/workflows/ci.yml:266-286`.
4. **A-02(b)** — join `invoice_totals` into `pilot.invoices_overdue` and require
   `balance_due_cents > 0`. This alone stops the wrong-dunning outcome even before the atomicity
   fix lands.

### Medium-term (1-2 weeks)

5. **A-01** — page and order the account fan-out in both passes; give autopay its own cron entry,
   route and `maxDuration`; emit `accountsSeen`/`accountsTotal`.
6. **A-07** — add `pilot.cron_runs` plus a 26-hour staleness alert (or a dead-man's-switch ping).
   Ship with #5.
7. **A-03** — add the F1c policy-predicate assertion and a catalog-driven two-tenant isolation
   loop to `scripts/tenancy-verify.mjs`.
8. **A-02(a)** — move `recordPayment`'s four round trips into `pilot.invoice_payment_record`.

### Strategic (before the multi-seat launch)

9. **A-06** — land `created_by` + a `before insert` trigger on the four financial tables, kept out
   of every `authenticated` grant, *before* the invite UI ships. After it ships, the backfill is
   impossible.
10. **A-04** — extract `planInvoiceDraft` into `lib/invoices/draft-plan.ts` and cover its four
    uncovered branches. This is the largest untested surface in the product.
11. **A-09** — regenerate `database.types.ts` from the live schema, add a CI drift check, and
    delete the `any` escapes from `lib/autopay/*` and `lib/reminders/run.ts`.
12. **SEC-02 (carried forward, still open)** — an edge rate limit on the public mutation surfaces,
    now including `/api/autopay/start` and `/api/autopay/stop`, which did not exist when that
    finding was written.

---

## What I did not cover

Stated plainly, because a padded scope claim is worse than a short one.

- **The hosted environment.** No live Supabase catalog, no Vercel project settings, no Stripe
  dashboard, no Resend config, no DNS, no branch-protection rules. I cannot confirm the deployed
  schema matches these migrations, that `HOLD_EXPIRY_PURGE_ENABLED` is unset in production, that
  the `database` CI job is a *required* check, or that Supabase PITR/backups are enabled. Gaps
  #2-#6 of the prior security audit remain exactly as open as that document left them.
- **I ran nothing.** No `npm run verify:all`, no `npm test`, no build, no `npm audit`. Every
  statement about CI behaviour is read from `.github/workflows/ci.yml` and `package.json`, not
  observed. My latency arithmetic in A-01 and A-05 is a first-principles estimate, not a
  measurement — the fix priority stands, but confirm the numbers with a real timed pass before
  sizing the work.
- **Frontend architecture.** I did not review the 279 `.tsx` components for rendering
  architecture, client/server boundary correctness, bundle size, Suspense/streaming usage,
  accessibility, or the Radix Themes/Ledger design-system layer. `app/(app)/overview/page.tsx`
  (1966 lines) was read only for its query fan-out, not as a component.
- **Domain correctness.** I made no judgement on FAA currency rules
  (`lib/currency/`, `CURRENCY_ENGINE_ENABLED`), logbook import semantics, sales-tax logic,
  per-diem/minimum-basis billing rules, or whether the double-entry chart of accounts is
  accountancy-correct. The `currency:verify` suite's 605 checks were counted, not read.
- **Two areas I sampled but did not audit.** The Stripe **platform** webhook
  (`app/api/stripe/webhook/route.ts`, 1448-line Connect sibling) — I confirmed idempotency,
  livemode gating and alerting exist and read the decision comments, but did not trace every event
  branch. And **receipt OCR / bank import / logbook import** parsing — I confirmed they have verify
  harnesses and CI wiring; I did not review the parsers.
- **`docs/MARKETING.md` §5 claim compliance.** Out of scope for this dimension set and covered by
  another agent in this audit. I read no public-facing marketing string for claim accuracy.
- **Deliberately not re-reported.** Everything the two prior audit documents already found and
  that I verified still stands as they described it — SEC-02 and SEC-03 appear above only for
  status confirmation and forward-carry, not as new findings.
