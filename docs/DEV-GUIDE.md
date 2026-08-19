# Developer guide

A plain-language map of this codebase: where things are stored, and where to
look for what. `README.md` is the tighter, denser version of some of this —
read that one once you have the mental model below. Everything in `docs/` is
deep on one topic; this file is the index and the orientation.

## What this is

V1 is a SaaS for independent contract pilots to run their own business:
clients, trips, invoices, expenses, logbook, documents. One Next.js app, one
Supabase project, deployed to Vercel. It bills the pilot (platform Stripe
subscription) and lets the pilot bill their own clients (a separate Stripe
Connect integration). It is a different product, different brand, different
Supabase project and different codebase from AMG's own operational site.

## The mental model — three things that unlock everything else

1. **One gate covers the whole authenticated product.** Every screen a
   signed-in pilot sees lives under the `app/(app)/` route group, and
   `app/(app)/layout.tsx` calls `requireAccount()`
   (`lib/supabase/account.ts`) once, at the top. Nothing inside that group
   re-checks auth.

2. **The database schema is `pilot`, not `public`.** `public` exists (Supabase
   needs it to exist) but this product stores nothing in it. If you're
   looking for a table and it's not where you expect, you're probably
   querying the wrong schema. `supabase/config.toml` lists `public` first in
   `[api].schemas`, which matters because PostgREST treats the first entry
   as its default — an `.from(...)` call that doesn't explicitly set
   `db.schema` would silently target `public` instead of `pilot`. Every
   client in `lib/supabase/` (`client.ts`, `server.ts`, `proxy.ts`,
   `service-role.ts`) pins `db: { schema: "pilot" }` explicitly so that
   ordering is never the thing actually protecting you.

3. **Two Stripe integrations exist and they never touch.** One bills the
   pilot for their V1 subscription (platform billing). The other lets the
   pilot bill *their own* clients (Stripe Connect). A pilot's client's money
   never enters V1's Stripe balance. See "Billing, disambiguated" below —
   getting this backwards is the single easiest way to misread the code.

## A note before you go further

Several files in this repo (`.env.example`, `supabase/config.toml`,
`lib/supabase/service-role.ts`, `README.md`) point to **`docs/PLAN.md`** as
the authoritative decision record — "Tony's decision record," in README's
words. **That file does not currently exist in this repo.** This isn't a
typo to quietly fix by removing the references; it's a real gap between what
the codebase says is the source of truth and what's actually checked in.
Flagging it here rather than working around it.

## Where the code lives — routing map

Next.js App Router, no `src/` directory, root is `app/`.

| Path | What's there | Gate |
|---|---|---|
| `app/(app)/` | The authenticated product — overview, trips, invoices, estimates, expenses, receipts, clients, crew, aircraft, logbook, documents, accounting, currency, reports, help, settings | `requireAccount()` in `app/(app)/layout.tsx` |
| `app/(auth)/` | login, signup, forgot/reset password, check-email, link-expired, welcome (post-checkout) | none — this *is* the auth flow |
| `app/(marketing)/` | pricing, terms, privacy — the public site | none |
| `app/(onboarding)/onboarding` | the post-checkout wizard | signed-in, pre-account-setup |
| `app/(dev)/` | internal dev/QA harnesses (`marketing-shots`, `seam-harness`, `layout-harness`) — not a shipped feature, exists for visual QA | none, not linked from product nav |
| `app/api/*` | route handlers (see table below) | per-route |
| `app/invoice/`, `app/estimate/`, `app/packet/`, `app/vendor/` | public, token-authenticated share pages a pilot's client opens without an account | share token in the URL |
| `app/sample-connect/`, `app/store/` | the standalone Stripe Connect V2 demo — see "Billing, disambiguated" | none |

`app/api/*/route.ts` handlers:

| Route | Purpose |
|---|---|
| `stripe/webhook` | Platform billing webhook — provisions a tenant on checkout, syncs subscription status |
| `stripe/connect/callback` | OAuth return leg for a pilot connecting their own Stripe account |
| `stripe/connect-webhook` | Records a client's payment onto an invoice when Stripe confirms it moved |
| `stripe/sample-connect/webhook`, `stripe/sample-connect/webhook-thin` | Webhooks for the separate sample-connect demo, not production traffic |
| `reminders/run` | Daily cron: sends due invoice reminders (`vercel.json`, 14:00 UTC) |
| `holds/run` | Daily cron: purges commercial data for accounts past their payment-hold window (`vercel.json`, 03:00 UTC) |
| `autopay/start`, `autopay/stop` | Anonymous, token-authenticated — a pilot's client turning autopay on/off from the vendor page |
| `command-search` | Backs the command palette (`cmdk`) — searches clients/invoices/trips/etc. |

## Where the data lives

- **Supabase project, schema `pilot`.** Everything the product reads and
  writes lives there.
- **`supabase/migrations/`** — every schema change, one timestamped `.sql`
  file per change, applied in order. Read a file's header before touching
  the table it creates; the headers carry the reasoning, including the
  mistakes that produced later corrective migrations. Two things worth
  knowing before you touch this folder yourself, from
  `supabase/migrations/README.md`:
  - The version recorded in the live database's migration table does **not**
    match the filename timestamp — migrations here are applied through the
    Supabase MCP `apply_migration` tool, which stamps its own version from
    the server clock. Relative order is preserved, so this isn't damage, but
    it means a `supabase db push` from this repo will try to re-apply
    everything — safe only for the migrations written as `create or
    replace`, which is most of them, deliberately.
  - **The revoke trap:** `revoke <priv> on <table>` drops *every*
    column-level grant on that table, not just the one you named, and the
    `grant` that follows only restores what it explicitly lists. New grants
    are always additive; nothing is ever re-granted after a revoke by habit.
    This has broken the repo more than once.
- **No seed files, no Supabase Edge Functions.** This project deliberately
  has no `supabase/functions/` directory — the daily cron jobs run as
  ordinary Next.js API routes instead (see `app/api/reminders/run/route.ts`
  for the reasoning).
- **`lib/supabase/database.types.ts`** — the generated (well, currently
  *hand-authored*) TypeScript types for the schema. It's hand-authored right
  now because schema `pilot` isn't yet exposed in the hosted project's API
  schemas config. Once it is, regenerate with:
  ```
  supabase gen types typescript --project-id igbeahtixmbanjdyqgwo --schema pilot
  ```
- **File storage: one private bucket, `receipts`.** Created in
  `supabase/migrations/20260805210000_phase4_receipts_storage.sql`. Every
  later feature that needs to store or serve a file — invoice-share
  receipts, credential packets — reuses this same bucket rather than
  creating a new one. There is no S3, no Vercel Blob; Supabase Storage is
  the only file store in this product.

## Where the UI lives

**Read this section instead of `README.md`'s "Stack" and "The design system
is six props" sections — those describe a prior design system (Radix Themes,
a `<Theme>` element, `components/ui/`) that no longer exists in the code.**
`@radix-ui/themes` isn't even in `package.json` anymore, and there is no
`components/ui/` directory in this repo. The product finished migrating to a
new design system, "LEDGER," on 2026-08-16 (see the `Migrate ... from
INSTRUMENT to LEDGER` commit series and `docs/design/LEDGER.md`), and
`README.md` wasn't updated for it. Take this as the current state:

- **`app/design/ledger.css`** is the entire visual system — every colour,
  type size, radius and shadow, wired into Tailwind's theme layer and
  consumed everywhere as a Tailwind utility class (`bg-canvas`,
  `text-ink-2`, `rounded-card`, …). No CSS-in-JS, no component-level theme
  object. `app/layout.tsx` imports it directly alongside `globals.css`.
- **`components/ledger/`** — the design system's primitives: `index.tsx`
  (includes the empty-state and skeleton-style components once found under
  a since-removed `components/ui/`), plus `dialog.tsx`, `forms.tsx`,
  `page-shell.tsx`, `segmented.tsx`, `tabs.tsx`. `lib/ledger/cn.ts` is the
  class-name combiner they're built on.
- **`components/logo.tsx`, `components/tail-number-field.tsx`,
  `components/charts/`** — other shared components living directly under
  `components/`, not nested in a `ui/` subfolder.
- **Feature-specific UI is colocated inside its route folder**, not under
  `components/` — e.g. `app/(app)/invoices/[id]/payment-panel.tsx`,
  `header-form.tsx`, `status-actions.tsx` live next to the page that uses
  them.
- **`npm run tokens:verify`** (`scripts/verify-tokens.mjs`) is what actually
  enforces all of this today: no hardcoded colour/radius/shadow/font value
  outside a short exempt list, no `@radix-ui/themes` import anywhere (a
  regression fence — the package is uninstalled), and no `var(--x)`
  reference to a custom property nothing declares. The files currently
  exempt from the value rules (because they can't reach a compiled
  stylesheet — PDF renderers, a pre-auth email interstitial, platform email
  HTML) are listed in that script's own `EXEMPT_FILES`; read the script's
  header comment rather than trusting a copy of the list here, since this is
  exactly the kind of list that drifts.
- The one shared loading-state pattern is `app/(app)/loading-panel.tsx`,
  re-exported by every `loading.tsx` in that route group.

## Where shared logic lives

Everything reusable lives under `lib/`. No `utils/`, no `services/`, no
`hooks/` directory — logic is organized by subsystem instead.

| Folder / file | What's in it |
|---|---|
| `lib/supabase/` | `client.ts` (browser), `server.ts` (request-scoped), `service-role.ts` (privileged, RLS-bypassing), `proxy.ts` (session refresh + route gating), `account.ts` (`requireAccount`), `entitlements.ts` (plan-tier gate `requireEntitlement`), `reauth.ts` (throwaway client for password re-verification), `rows.ts` (empty-vs-failed query result helper) |
| `lib/stripe/` | `provisioning.ts`, `connect.ts`, `connect-payments.ts`, `prices.ts`, `billing-facts.ts`, `hold.ts`, `payment-methods.ts`, `price-drift.ts` |
| `lib/auth/` | `confirmation.ts`, `signup-outcome.ts` |
| `lib/currency/` | The FAA currency/recency engine — `part135.ts`, `night.ts`, `medical.ts`, `instrument.ts`, `flight-review.ts`, `simulator.ts`, and more; see `docs/CURRENCY-SPEC.md` |
| `lib/bank-import/`, `lib/logbook-import/` | CSV/OFX parsing, column-mapping, and de-dupe fingerprinting for bank-statement and logbook imports (ForeFlight, LogTen, generic CSV) |
| `lib/receipt-ocr/` | Tesseract-based receipt OCR — `engine.ts`, `extract.ts`, `match-trip.ts` |
| `lib/reminders/` | `run.ts` (the due-reminder pass, shared by the cron route and the Settings "run now" button), `policy.ts` |
| `lib/email/` | `send.ts` and per-message builders (`invoice-message.ts`, `estimate-message.ts`, `payment-receipt.ts`) — the only path product mail goes out through |
| `lib/ledger/`, `lib/holds/`, `lib/help/`, `lib/sample-connect/` | Small, single-purpose folders — respectively: LEDGER's `cn()` helper, the hold-expiry-purge feature flag gate, the in-app help content, and the sample-connect demo's own client/store/checkout logic |
| `lib/entitlements.ts` | The one tier/feature source — every plan comparison and every gate reads this table |
| `lib/billing-state.ts` | Subscription-lifecycle logic (status meanings, trial/renewal arithmetic) — pure, unit-tested |
| `lib/preferences.ts` | The one place account preferences are read, defaulted, validated, written |
| `lib/theme-slots.ts`, `lib/custom-options.ts` | The only origin for a runtime-injected visual value / a renameable category list, respectively |
| `lib/nav.ts` | The navigation rail's structure |
| `lib/csv.ts` | The one CSV encoder both exports share (RFC 4180 quoting, formula-injection guard) |
| `lib/format.ts`, `lib/db-errors.ts` | Formatting helpers; Postgres-error-to-user-message mapping |

## Auth & sessions

Supabase Auth only — no NextAuth, no Clerk. Session refresh and route-level
gating happen in `lib/supabase/proxy.ts`, called from the root `proxy.ts`
(Next 16's replacement for `middleware.ts`/`middleware()`, which are
deprecated in this version — see the Next.js version warning in
`CLAUDE.md`).

The service-role client (`lib/supabase/service-role.ts`, exported as
`createServiceClient`) bypasses Row Level Security entirely and is
restricted, by convention and by a very long comment in that file, to
exactly five call sites:

1. The Stripe webhook that provisions a new tenant on checkout completion
   (`app/api/stripe/webhook/route.ts`, `lib/stripe/provisioning.ts`) — no
   user session exists yet.
2. Downloading receipt bytes for a shared invoice
   (`lib/invoice-share-receipts.ts`) — the caller is the pilot's client,
   who has no account at all.
3. The daily due-reminder pass (`app/api/reminders/run/route.ts`,
   `lib/reminders/run.ts`) — a scheduled run has no session.
4. The Stripe Connect webhook (`app/api/stripe/connect-webhook/route.ts`) —
   the person paying is the pilot's client, not a user of this product.
5. The hold-expiry purge pass (`app/api/holds/run/route.ts`) — a pilot past
   their hold window is, by definition, not present to authenticate as.
   This is the most dangerous of the five: it deletes commercial records,
   gated behind `HOLD_EXPIRY_PURGE_ENABLED` (unset by default) and a
   per-run cap, with the database independently re-deriving due-ness before
   deleting anything.

Adding a sixth call site is meant to be a deliberate security decision, not
a refactor — read the file's header comment before reaching for it. Almost
every other use case is better served by the session-scoped clients
(`lib/supabase/client.ts`, `server.ts`).

`lib/supabase/reauth.ts` is a separate, smaller thing: a throwaway,
cookie-less client used only to verify a password without rotating the
session being verified — not privileged, just isolated.

## Billing, disambiguated

Three distinct things use the word "Stripe" in this codebase. Mixing them up
is the easiest way to misread a diff here.

| | What it is | Whose money | Config |
|---|---|---|---|
| **Platform billing** | Pilots paying V1 for their subscription | Pilots → you | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_*` |
| **Stripe Connect (Standard)** | A pilot's own clients paying the pilot | Clients → the pilot, directly | `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_WEBHOOK_SECRET` |
| **sample-connect** | A self-contained demo of Stripe Connect V2, unrelated to production Connect above (different account model, different tables, `lib/sample-connect/`, `app/sample-connect/`, `app/store/`) | N/A — demo only | `SAMPLE_CONNECT_*` |

Connect charges are created *as the connected account* — a pilot's client's
money never enters V1's own Stripe balance. Full walkthrough, including
webhook event subscriptions and why each one is needed, is in
`docs/SETUP.md`.

## Config & environment

| File | What it does |
|---|---|
| `next.config.ts` | Builds a dynamic Content-Security-Policy from the Supabase origin |
| `proxy.ts` (root) | Next 16's replacement for middleware — session refresh, route gating |
| `tsconfig.json` | Strict mode, `noUnusedLocals`, `noUncheckedIndexedAccess`, `@/*` path alias |
| `postcss.config.mjs` | Tailwind v4, scoped only to `app/design/ledger.css` — nowhere else in the app uses Tailwind |
| `vercel.json` | The two cron jobs: `reminders/run` daily at 14:00 UTC, `holds/run` daily at 03:00 UTC |
| `.env.example` | The full reference for every environment variable — heavily commented, read it before asking what a var does |

Environment variable groups (names only — see `.env.example` for what each
does and `docs/SETUP.md` for the setup walkthrough):

- **Supabase:** `NEXT_SUPABASE_URL`, `NEXT_SUPABASE_PUBLISHABLE_KEY`,
  `NEXT_SUPABASE_SECRET_KEY`
- **Platform billing:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_ID_SOLO[_ANNUAL]`, `STRIPE_PRICE_ID_PRO[_ANNUAL]`,
  `STRIPE_PRICE_ID_BUSINESS[_ANNUAL]`
- **Stripe Connect:** `STRIPE_CONNECT_CLIENT_ID`,
  `STRIPE_CONNECT_WEBHOOK_SECRET`
- **sample-connect demo:** `SAMPLE_CONNECT_PLATFORM_PRICE_ID`,
  `SAMPLE_CONNECT_WEBHOOK_SECRET`, `SAMPLE_CONNECT_THIN_WEBHOOK_SECRET`
- **Email:** `RESEND_API_KEY`, `INVOICE_FROM_EMAIL`
- **Cron auth:** `CRON_SECRET`
- **Misc:** `NEXT_PUBLIC_APP_URL`, `ONBOARDING_TEST_PIN` (test-only signup
  bypass, must stay unset in production), `HOLD_EXPIRY_PURGE_ENABLED`
  (must stay unset until dry runs have been reviewed)

## Verification / testing

There's no traditional test framework — `scripts/` plus `npm run` targets
are the house convention.

```
npm run test                  typecheck + tokens:verify + the unit suite
npm run test:unit             node --test over tests/*.test.mjs
npm run tokens:verify         no visual value hardcoded outside the four allowed files
npm run tenancy:verify        two-tenant isolation, including an RLS sweep
npm run billing:verify        trial, webhook idempotency, out-of-order events
npm run trip:verify           trip → invoice line, expense, logbook draft
npm run reminders:verify      the scheduler's database guarantees
```

Plus ~15 more `*:verify` scripts, one per feature area — check
`package.json`'s `scripts` block for the full list.

These scripts deliberately drive real, authenticated Supabase clients rather
than the service-role client: every guarantee they test is a guarantee of
Row Level Security plus column-scoped grants, and the service role holds
BYPASSRLS — testing through it would prove nothing. They refuse to run
against a non-local host without an explicit opt-in, because they create
real auth users. All fixtures are synthetic; no live pilot data is ever used.

## Map of `docs/`

No index file existed for this folder before now. One line per file, from
actually reading each — not guessed from the filename.

| File | What's in it |
|---|---|
| `database/` | Plain-English reference for every table and column in the `pilot` schema, plus how to change one safely from the SQL Editor — see `database/README.md` |
| `SETUP.md` | Step-by-step setup for Resend (email) and Stripe Connect — the two integrations that need outside accounts |
| `BILLING.md` | The three-tier subscription model, signup-to-checkout flow, entitlements as the tier source |
| `PRICING.md` | A pricing *proposal* (not yet signed off) with competitor research backing it |
| `CURRENCY-SPEC.md` | The FAA currency/recency engine spec — exact regulatory math, hedged output states |
| `RESPONSIVE-CONTRACT.md` | The responsive layout rules every screen must satisfy, and the verify script enforcing them |
| `SAMPLE-CONNECT.md` | The standalone Stripe Connect V2 demo — what it is, how to remove it |
| `WAVE-PARITY.md` | A scored, cited feature-by-feature comparison against Wave |
| `LAUNCH-GATES.md` | The list of human (owner/counsel) sign-offs still blocking launch |
| `PLAN-GATES.md` | Checklist of `requireEntitlement` calls still to wire into gated screens |
| `USER-GUIDE.md` | The end-user (pilot-facing) walkthrough of the product — not this file's audience |
| `MARKETING.md` | Signed-off positioning/messaging and public-copy claim rules |
| `SECURITY-AUDIT-2026-08-16.md` | Code security audit: one fixed high-severity finding, two medium hardening findings |
| `POSTGRES-SECURITY-VERIFICATION-2026-08-16.md` | Confirms `npm run verify:all` passing against local Postgres, closing an audit gap |
| `RESEARCH-ROADMAP-2026-08-13.md` | Ranked roadmap of the next features to build, from competitor research |
| `design/LEDGER.md` | The fintech-style design system the app is migrating to |
| `design/INSTRUMENT.md` | The prior, now-superseded design system spec |
| `design/REBUILD-BRIEF.md` | The visual-rebuild direction brief ("flight department, not flight sim") |
| `research/FLIGHTDEPTPRO-AUDIT.md` | Full audit of competitor FlightDeptPro's live demo |
| `research/FLIGHTDEPTPRO-INSPIRATION.md` | Mechanisms worth adopting from that competitor, filtered through V1's scope |
| `research/PILOT-FEATURE-DEMAND.md` | Ranked contract-pilot feature demand list |
| `reviews/00` – `10` | A 10-part UX/CRO/content/churn audit series, `09-EXECUTIVE-SUMMARY.md` is the synthesis of the other nine |

`docs/PLAN.md` — cited by several files as the authoritative decision record
— is missing. See "A note before you go further" above.

## Known footguns

- **Schema is `pilot`, not `public`.** See "The mental model" above.
- **Two systems send mail, and only one reads this repo's config.** Product
  mail (invoices, receipts, reminders) reads `INVOICE_FROM_EMAIL`. Signup
  confirmation and password recovery are sent by Supabase Auth's own SMTP
  relay, configured in the Supabase dashboard — nothing in this repo
  configures it. Setting one and not the other leaves one flow broken while
  the other works fine.
- **Migration version numbers don't match filenames**, and the revoke trap
  strips every column grant, not just the one you named. See "Where the
  data lives" above before writing or reasoning about a migration.
- **`STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` are not
  interchangeable.** Stripe mints a distinct `whsec_` per endpoint.

## Keeping this guide honest

Update this file when routes, schema, or storage locations change. A stale
map is worse than no map — if a section here stops matching the code, fix
the section, don't leave it.
