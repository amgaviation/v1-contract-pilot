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

## The design system is five props

The entire visual system is the `<Theme>` element in `app/layout.tsx`:

```tsx
<Theme accentColor="blue" grayColor="slate" radius="small"
       scaling="95%" panelBackground="solid">
```

There is no token file, no theme object, and no design document. Restyling the
product means changing those props. That is deliberate: the look was specified
in prose three times before this — an "Approach Plate" spec, a white-heavy
glass system, then a ported Material Dashboard kit — and each time the code
drifted away from the document describing it. A component cannot drift from a
token layer that does not exist.

`panelBackground="solid"` is the one non-default choice worth knowing: Radix
defaults panels to translucent, and a pilot comparing a column of decimal
hours should not read it over a blur.

Dark mode follows the operating system, stamped onto `<html>` by a small
inline script before first paint — Radix's dark tokens are class-scoped and
its stylesheet has no `prefers-color-scheme` queries, so the prop alone does
not do it.

### The four files allowed to spell a visual value out

Everything else must reach the theme through a component prop, or through
`style={{ ... var(--gray-a5) ... }}` for the cases Radix has no prop for.
`npm run tokens:verify` enforces this in CI and each of these documents its
own exemption at the top of the file:

| File | Why |
|---|---|
| `app/globals.css` | The V1 mark's brand constants. The wordmark is literal black (white on dark), the bug literal `#036BFC` on every ground — trademark artwork, not UI tokens, so a future accent change can never retint it. |
| `lib/brand.ts` | The two `theme-color` values. Next's metadata layer cannot read CSS. |
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
