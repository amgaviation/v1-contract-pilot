# V1 — powered by AMG Aviation

A standalone SaaS for independent contract pilots to run their own business:
clients, trips, invoices, expenses, logbook, documents. **Log the trip once —
logbook entry, invoice line, and expense file all post from it.**

This is a separate product from AMG's own operational site and crew portal —
different brand, different Supabase project, different codebase, by design.
AMG appears in exactly one place: the footer, as "powered by AMG Aviation".
`docs/PLAN.md` carries the full decision record and the reasoning.

## Status

Live Supabase project, live Stripe (test mode), deployed to Vercel. Phases 0–6
and 8 are built; Phase 9 Layer 1 (tenant-defined day types and rate cards) is
merged. Phase 7 (currency) is deliberately unbuilt — it ships behind a flag,
dark, and only after counsel re-confirms the disclaimer wording.

**One thing blocks real users:** signup returns `Error sending confirmation
email`. SMTP is configured against Resend, credentials are accepted, and the
send is rejected with `550 — the sending domain is not verified`. Until
`amgaviationgroup.com` is verified at resend.com/domains (DKIM + SPF records),
or the sender is temporarily pointed at `onboarding@resend.dev`, no new pilot
can complete signup.

## Stack

Next.js 16 · React 19 · TypeScript (strict) · **Radix Themes** ·
Supabase (`@supabase/ssr`) · Stripe (platform billing) + Stripe Connect
(the pilot's own client billing) · `@react-pdf/renderer` for invoices.

No Tailwind, no CSS-in-JS, no component library beyond Radix. Ten runtime
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
already-padded container, which is not the shape any of this product's 51
ghost Cards are in — see that file's comment for the measured before/after
numbers).

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
app/(auth)/         login, signup, password reset, and the post-checkout
                    welcome screen.
app/api/stripe/     the webhook. The only place the service-role client is
                    used, anywhere in the product.
lib/supabase/       browser, server and service-role clients, all pinned to
                    the `pilot` schema.
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

All fixtures are synthetic. No live pilot data, ever.
