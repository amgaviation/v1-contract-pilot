# V1 — powered by AMG Aviation

A standalone SaaS for independent contract pilots to run their own business:
clients, invoices, expenses, logbook, and currency. **Log the trip once —
logbook entry, invoice, and expense file all post from it.**

This is a separate product from `amgaviation/amg1` (AMG's own operational
site and crew portal) — different brand, different Supabase project,
different codebase, by design. AMG appears in exactly one place in this
product: the footer, as "powered by AMG Aviation." See the full plan for
why and the complete decision record.

## Status

Phase 0 (Foundations) scaffold. Not deployed, not connected to a live
Supabase project. See `docs/PLAN.md` for the full build plan and
`docs/DESIGN-RESEARCH.md` for forward-looking design research (not yet
implemented — the current build uses the locked "Approach Plate" direction
as-is).

**Blocked:** three things need resolving outside this environment before the
next step can happen —
1. The Supabase MCP connection needs re-authorization before the new
   "master" Supabase project (`docs/PLAN.md` §2) can be created and
   `supabase/migrations/` can be applied.
2. The GitHub integration used to build this scaffold can't create new
   repositories (403 on both a personal-account and an org-scoped attempt).
3. The Vercel integration can't create new projects either (403, same
   shape, with and without an explicit team).

This repo exists only as a local git history until (1) and (2) are
resolved, or someone with the right access creates the repo/project by
hand and this history is pushed to it.

## Stack

Next.js 16 · React 19 · TypeScript (strict) · Tailwind v4 (CSS-first) ·
Supabase (`@supabase/ssr`) · Stripe (platform billing) + Stripe Connect
Standard (pilot's own client billing).

## Design system

"Approach Plate" — built from the instrument approach chart. The **entire**
visual system lives in two files:

- `app/tokens.css` — every color, radius, spacing, and type value
- `lib/brand.ts` — every brand string ("V1", "powered by AMG Aviation")

**No component may hardcode a color, radius, font, or brand string.**
`npm run tokens:verify` enforces this in CI — see that script's header
comment. Tony intends a full design overhaul later; this discipline is
what keeps that a two-file change.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in once the Supabase project exists
npm run dev
```

```bash
npm run typecheck       # tsc --noEmit
npm run tokens:verify    # fails on any hardcoded visual value outside the two token files
npm test                 # both of the above
```

## Directory map

```
app/                  routes (App Router). page.tsx = Overview, the home screen
components/shell/      left rail nav + app shell layout
components/ui/         Button, Panel, StatusTag, KpiTile — all token-driven
lib/brand.ts           the only source of brand strings
lib/fonts.ts            self-hosted Roboto / Roboto Condensed / Roboto Mono
lib/mock-data.ts       synthetic demo data for the Overview screen (deleted in Phase 3)
lib/supabase/          browser / server clients, service-role.ts (own file, server-only), proxy session-refresh helper
supabase/migrations/   Phase 1 tenancy schema (pilot.accounts, pilot.account_members, RLS)
scripts/verify-tokens.mjs   the token-discipline scanner
```

## What's next

See `docs/PLAN.md` §Build order. Phase 2 (Stripe subscription + self-serve
provisioning) is next once the Supabase project exists, followed by Clients
and Trips (Phase 3) — the parent-record model the whole product is built
around.
