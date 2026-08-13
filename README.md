# V1 — powered by AMG Aviation

A standalone SaaS for independent contract pilots to run their own business:
clients, trips, invoices, expenses, logbook, documents. **Log the trip once —
your logbook draft and your invoice lines come from it, and your receipts
attach to it.**

(`docs/PLAN.md`'s thesis line still reads "expense file all post from it". That
third output was checked during the launch-ready review and does not exist:
nothing here creates an expense from a trip. The plan is Tony's decision record
and is not rewritten by an agent, so the correction lives in the copy — the
landing hero, the Trips feature card, `/welcome`, and `app/layout.tsx`'s
description — and is noted here and in the plan's delta log.)

This is a separate product from AMG's own operational site and crew portal —
different brand, different Supabase project, different codebase, by design.
AMG appears in exactly one place: the footer, as "powered by AMG Aviation".
`docs/PLAN.md` carries the full decision record and the reasoning.

## Status

Live Supabase project, live Stripe (test mode), deployed to Vercel. The product now spans:
clients, trips with legs and typed day records, estimates with convert-to-invoice, invoices
(sequential numbering, PDF with attached rebill receipts, email delivery with manual reminders,
share links with viewed tracking, recurring schedules, Stripe Connect payment links), expenses
(receipt OCR, bank/card statement import with a review queue, mileage), a full logbook
(manual, trip-derived drafts, CSV import and export), per-client statements, documents with
expiry tracking, per-operator 135 qualification records, three plan tiers with entitlement
gating, and an accounting layer — aviation-shaped chart of accounts, double-entry journal with
derived postings, bank reconciliation, balance sheet and cash flow. Reports: P&L, quarterly
estimated-tax, sales tax, year-end packet with 1099 reconciliation, CPA travel log, and
cross-operator 135.267 flight-time totals. The FAA currency engine and its /currency board are
built and ship dark behind CURRENCY_ENGINE_ENABLED.

`docs/WAVE-PARITY.md` scores all of it against Wave, row by row, with citations.

**One thing blocks real users:** signup returns `Error sending confirmation
email`. SMTP is configured against Resend, credentials are accepted, and the
send is rejected with `550 — the sending domain is not verified`. Until
`amgaviationgroup.com` is verified at resend.com/domains (DKIM + SPF records),
or the sender is temporarily pointed at `onboarding@resend.dev`, no new pilot
can complete signup. The same verification gates invoice email delivery.

## Stack

Next.js 16 · React 19 · TypeScript (strict) · **Radix Themes** ·
Supabase (`@supabase/ssr`) · Stripe (platform billing) + Stripe Connect
(the pilot's own client billing) · `@react-pdf/renderer` for invoices.

No Tailwind, no CSS-in-JS, no component library beyond Radix. Eleven runtime
dependencies.

## The design system is six props, plus one small defaults file

The entire visual system is the `<Theme>` element in `app/layout.tsx`:

```tsx
<Theme accentColor="blue" grayColor="auto" radius="none" scaling="90%"
       panelBackground="solid" appearance="light">
```

There is no token file and no design document. Restyling the product means
changing those props. That is deliberate: the look was specified in prose
three times before this — an "Approach Plate" spec, a white-heavy glass
system, then a ported Material Dashboard kit — and each time the code drifted
away from the document describing it.

There is one small exception to "no theme object": `components/ui/index.tsx`,
which re-exports every Radix Themes component and gives a handful of them a
chosen default prop (Card ships `variant="ghost"`, Badge ships `variant="solid"
color="red"`, and so on — the file's header lists all of them and why). Every
call site imports from `"@/components/ui"`, never `"@radix-ui/themes"`
directly, and `npm run tokens:verify` enforces that split mechanically — a
component reaching around it is exactly how this kind of drift starts. Every
default is a starting point, not a rule: an explicit prop at the call site
always wins.

Ghost Cards get one small correction on top of Radix's own CSS:
`app/globals.css` cancels the negative margin Radix's ghost Card variant
applies by default (it assumes a ghost Card is the sole child of an
already-padded container, which is not the shape any of this product's ghost
Cards are in — see that file's comment for the measured before/after
numbers; its count of them predates this feature push and is now stale).

`panelBackground="solid"` is the one non-default `<Theme>` choice worth
knowing: Radix defaults panels to translucent, and a pilot comparing a column
of decimal hours should not read it over a blur.

The app is pinned to `appearance="light"` and does not follow the operating
system. It used to: an earlier version stamped `.light`/`.dark` onto `<html>`
from an inline script reading `matchMedia` before first paint. That script,
and the second (dark) `theme-color` it existed to support, are both gone now
that the theme no longer varies with the OS.

### The four files allowed to spell a visual value out

Everything else must reach the theme through a component prop, or through
`style={{ ... var(--gray-a5) ... }}` for the cases Radix has no prop for.
`npm run tokens:verify` enforces this in CI and each of these documents its
own exemption at the top of the file. The exemption is scoped to *values*
only — none of the four files is exempt from the import-ban rules
(`@mui`/`@emotion`, or a raw `@radix-ui/themes` import outside
`components/ui/index.tsx`). `lib/invoice-pdf.tsx` in particular is a real
`.tsx` component file and must still be caught if it ever imports a Radix
component directly.

| File | Why |
|---|---|
| `app/globals.css` | The V1 mark's brand constants. The wordmark is literal black (white on dark), the bug literal `#036BFC` on every ground — trademark artwork, not UI tokens, so a future accent change can never retint it. |
| `lib/brand.ts` | The one `theme-color` value. Next's metadata layer cannot read CSS. (Previously two values, light and dark; now one, since `appearance` is pinned light.) |
| `lib/pdf-palette.ts` | The invoice PDF's colours, from `@radix-ui/colors` — the same scales Radix Themes is built on, published as JS, because `@react-pdf/renderer` cannot read CSS. |
| `lib/invoice-pdf.tsx` | react-pdf's `StyleSheet.create()` cannot take a `var()` at all. Its colours still come from `pdf-palette`. |

## Layout

```
app/(app)/          the authenticated product. One gate — requireAccount()
                    in the route-group layout — covers every screen.
app/(app)/reports/  the year-end packet (`reports/year-end`): cash-basis
                    income, deductible/rebilled expenses, unassigned
                    receipts, and 1099 reconciliation against
                    pilot.client_tax_forms.
app/(app)/logbook/export/  streaming CSV export of the pilot's own logbook —
                    the record-portability path out.
app/(app)/logbook/import/  and the path back in: ForeFlight and LogTen Pro
                    exports, plus any CSV through a generic column mapper,
                    with duplicate detection before anything is written
                    (parsers and the row fingerprint live in
                    lib/logbook-import/).
app/(auth)/         login, signup, password reset, and the post-checkout
                    welcome screen. One shared shell (the navy brand panel
                    beside the form) in app/(auth)/layout.tsx, with the
                    pieces every screen is built from in auth-parts.tsx.
app/api/stripe/     the webhook. The only place the service-role client is
                    used, anywhere in the product.
lib/supabase/       browser, server and service-role clients, all pinned to
                    the `pilot` schema.
lib/csv.ts          the one CSV encoder both exports share — RFC 4180
                    quoting plus a formula-injection guard.
supabase/migrations/  every schema change, applied in order. Read the file
                    headers — they carry the reasoning, including the
                    mistakes that produced the corrective migrations.
scripts/            executable verification, the house convention in place
                    of a test framework.
```

## Verification

```
npm run test                  typecheck + tokens:verify
npm run tokens:verify         no visual value hardcoded outside the four files
npm run tenancy:verify        two-tenant isolation — the gate on everything
npm run billing:verify        trial, webhook idempotency, out-of-order events
npm run trip:verify           trip → invoice line, expense, logbook DRAFT
npm run customisation:verify  day types, rate cards, and the money regression
```

The verify scripts drive real authenticated Supabase clients rather than the
service role, because every guarantee they test is a guarantee of RLS plus
column-scoped grants — and the service role holds BYPASSRLS, so asserting
through it would prove nothing. Every negative case asserts a specific
SQLSTATE; "an error happened" is not a pass. They refuse to run against a
non-local host without an explicit opt-in, because they create auth users.

`tenancy:verify` also runs an RLS sweep, load-bearing rather than
belt-and-braces: F1 fails if any `pilot` table has row-level security
disabled (the schema grants default SELECT on every future table to
`authenticated`, so RLS is the only barrier), and F1b fails if an
RLS-enabled table has no policy at all — reachable by no one, which is a
missing policy rather than a deliberate lockout. Both are probed against a
real table, not just read. Currently 37 assertions pass against a local
Postgres 16 running every migration.

`billing:verify` counts and names its own skips: sections that need a
service-role client (`NEXT_SUPABASE_URL` + `NEXT_SUPABASE_SECRET_KEY`) print
`SKIP` and are excluded from the pass/fail counters, and the summary says
outright when a run did not verify everything — a green count that quietly
asserted fewer things than it claims is exactly the defect this exists to
catch.

All fixtures are synthetic. No live pilot data, ever.
