# Plan gates — the per-route calls to add at integration

The three-tier plan system (solo / pro / business) shipped with this session:
`lib/entitlements.ts` (the single tier source), `pilot.accounts.plan_tier`
(migration `20260812300000_account_plan_tier.sql`, webhook-writable only),
price→tier mapping in the webhook, plan selection on `/welcome`, and
`/settings/billing` with upgrade/downgrade/portal.

**Enforcement is one helper**: `requireEntitlement(feature, path?)` in
`lib/supabase/entitlements.ts`. It wraps `requireAccount` — a gated page swaps
one line for one line — and sends an under-tier visit to the upgrade screen at
`/settings/billing/upgrade` (a real explanation page, never a 404, never a
crash). It was deliberately NOT wired into `lib/supabase/proxy.ts`: the
middleware runs before the router on every request and knows nothing but the
cookie, so a tier check there would cost two tenant queries per navigation and
could still only redirect, never render. The route→feature map already exists
in one place (`featureForPath` in `lib/entitlements.ts`) if a middleware seam
is ever wanted.

## The calls to add

The gated screens below are owned by other workstreams this session, so their
files were not edited here. At integration, in each file listed, replace the
existing `requireAccount(...)` call with `requireEntitlement(...)` (same return
shape — the call is a drop-in). Where a file uses `getSessionContext` or takes
no account at all, add the call after auth resolution.

Import: `import { requireEntitlement } from "@/lib/supabase/entitlements";`

### Pro tier

| Route / file | Call |
|---|---|
| `app/(app)/invoices/recurring/page.tsx` | `await requireEntitlement("recurring_invoices", "/invoices/recurring")` |
| `app/(app)/invoices/recurring/actions.ts` — every exported action | `await requireEntitlement("recurring_invoices")` |
| `app/(app)/estimates/page.tsx`, `estimates/new/page.tsx`, `estimates/[id]/page.tsx` | `await requireEntitlement("estimates", "/estimates")` |
| `app/(app)/estimates/actions.ts` — every exported action | `await requireEntitlement("estimates")` |
| `app/(app)/clients/[id]/statement/page.tsx` (and `statement/print/`) | `await requireEntitlement("client_statements")` |
| `app/(app)/expenses/import/**` page + actions | `await requireEntitlement("bank_import", "/expenses/import")` |
| `app/(app)/expenses/transactions/**` page + actions | `await requireEntitlement("bank_import", "/expenses/transactions")` |
| `app/(app)/reports/sales-tax/page.tsx` (+ its export route if any) | `await requireEntitlement("sales_tax_report", "/reports/sales-tax")` |
| `app/(app)/settings/export/page.tsx` and `settings/export/[entity]/route.ts` | `await requireEntitlement("account_export", "/settings/export")` |

### Business tier

| Route / file | Call |
|---|---|
| Every page under the accounting layer's route prefix `/accounting` (chart of accounts, ledger, reconciliation, balance sheet, cash flow) | `await requireEntitlement("accounting", "/accounting/...")` — or one call in that route group's own `layout.tsx`, which covers the whole subtree |
| Every server action in the accounting layer | `await requireEntitlement("accounting")` |

Notes for the integrator:

- **Server actions must be gated too**, not just pages — a form post is a
  route. For a route handler (e.g. `settings/export/[entity]/route.ts`) the
  redirect from `requireEntitlement` works the same as `requireAccount`'s.
- **Route handlers that stream files** (CSV exports): the redirect answer is
  fine — the browser follows it to the upgrade screen.
- The map in `featureForPath` (lib/entitlements.ts) already covers every path
  above; `tests/entitlements.test.mjs` pins it. If the accounting agent's
  routes land anywhere other than `/accounting`, update that ONE map entry.
- **Never** add a gate to `/logbook`, `/documents`, the currency surface,
  `/trips`, `/invoices` (top level), `/expenses` (top level), `/clients`
  (except the statement child), or the core reports — the never-gate-safety-
  records rule is pinned by the unit tests and will fail the suite.

## Env vars the deployment needs (names — values in Vercel/.env.local only)

`STRIPE_PRICE_ID_SOLO` (exists), `STRIPE_PRICE_ID_SOLO_ANNUAL`,
`STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_PRO_ANNUAL`,
`STRIPE_PRICE_ID_BUSINESS`, `STRIPE_PRICE_ID_BUSINESS_ANNUAL`.

Test-mode Prices for all six exist in the AMG Stripe account (products
"V1 — Contract Pilot (Solo/Pro/Business)"); the IDs were reported in the
session summary rather than written here, per docs/PRICING.md §7's rule that
no price ID value lives in the repo. Amounts used the placeholder ladder
($29/$49/$89 monthly, ×10 annual) because docs/PRICING.md still carries the
pre-three-tier proposal; a price change is a new Price object + env repoint,
no code change.

## What `billing:verify` now additionally asserts (section 7)

Recognised price moves `plan_tier` (upgrade AND downgrade); a stale event
never overwrites a newer one; an unmapped or missing price syncs status but
never re-tiers; the migration default is `solo`. Needs `STRIPE_PRICE_ID_SOLO`
+ `STRIPE_PRICE_ID_PRO` in the script's env (same values the server reads),
else it SKIPs by name per the script's skip discipline.
