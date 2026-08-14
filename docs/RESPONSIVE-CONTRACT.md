# The responsive contract

What every screen in V1 must do at every viewport, and the script that
enforces it. Written 2026-08-14.

## Why this document exists

The product's chrome — the dark rail, the phone strip, the sticky header,
the canvas and its measure — sat inline in `app/(app)/layout.tsx`, behind
`requireAccount()`. That meant the layout governing every page could not be
rendered without a real session and a real tenant, so it had no automated
check of any kind. It was verified by looking at it, at whatever window
size the last person happened to have open, and it drifted accordingly.

Three defects shipped that way, all found the first time the shell was
actually measured:

1. **A crushed band between 768 and 1023px.** The rail switched on at `sm`
   (768px) and took a fixed 240px, leaving 483px of usable canvas at 768px
   — *less* than the phone layout gives at the same viewport, because
   there the whole width belongs to the page.
2. **A hard 1136px content cap.** On a 1920px monitor that left ~550px of
   empty canvas beside twelve-column reports that were scrolling
   horizontally inside their own frames.
3. **A Sign out button 59×22 CSS px**, below WCAG 2.5.8's 24×24 minimum.

## Zoom is not a separate axis

This is the part that is worth internalising, because it is the source of
most "it breaks when I zoom" reports and it has a tidy explanation.

**Browser zoom does not scale the viewport. It shrinks the viewport
measured in CSS pixels** — and CSS pixels are the unit every media query in
the product is written in. A 1440px monitor at 175% zoom is an 823px
viewport and takes the 823px path through the layout. A 1280px laptop at
200% is a 640px viewport and gets the phone layout.

So there is no separate zoom bug and no separate zoom fix. A layout that is
correct at every width is correct at every zoom level, and the reason zoom
*felt* like its own problem here is that the 768–1023px band — the band
common desktop zoom levels land in — was the one band nobody had looked at.

| Monitor | 100% | 125% | 150% | 175% | 200% |
|---|---|---|---|---|---|
| 1280 | 1280 | 1024 | 853 | 731 | 640 |
| 1440 | 1440 | 1152 | 960 | 823 | 720 |
| 1920 | 1920 | 1536 | 1280 | 1097 | 960 |

Every one of those numbers is inside the matrix `scripts/layout-verify.mjs`
tests.

Zoom does hit one axis harder than width: **height**. A 900px-tall laptop
at 175% has 514 CSS px of height, which is why the rail is now
`height: 100dvh; overflow-y: auto` — below that height a tenant with every
section visible pushed the account block off the bottom with no way to
reach it. The verify script runs every width at two heights, 514 and 900,
for this reason.

## The contract

At every viewport from 320px to 1920px:

1. **The page never scrolls sideways.** Wide content scrolls inside its own
   frame. Radix's `Table.Root` already wraps its `<table>` in a ScrollArea,
   so tables get this for free — do not add a second wrapper. What does
   need care is unbroken strings (a Stripe payment-intent id has no spaces
   to break at and will set its container's min-content width) and any flex
   or grid child holding wide content, which needs `minWidth="0"` or it
   refuses to shrink below its content.
2. **Navigation is reachable in exactly one shape** — the rail at ≥1024px,
   the strip below it. Never both, never neither.
3. **Primary controls stay on screen.** In particular the header's email is
   user-supplied and unbounded, and truncates rather than pushing Sign out
   off the right edge.
4. **Chrome tap targets are at least 24×24 CSS px** (WCAG 2.5.8 AA). Inline
   links inside prose are exempt by the success criterion itself.

## The breakpoint is `md` (1024px), and only `md`

The rail switches at Radix's `md`, which is a literal
`@media (min-width: 1024px)` in its stylesheet. Using the same number means
the shell switches in lockstep with every `md` a page below it declares. It
was `sm` (768px), which switched 256px earlier than the pages did.

Below 1024 the full-width strip layout wins in every case, because the
alternative at those widths is a 240px rail eating a quarter to a third of
the viewport. Measured, before and after:

| Viewport | Usable canvas before | after |
|---|---|---|
| 768 (iPad portrait) | 483px | 723px |
| 823 (1440 @ 175%) | 538px | 778px |
| 834 (iPad Air portrait) | 549px | 789px |
| 900 (1280 @ 145%) | 615px | 855px |
| 1023 | 738px | 978px |
| 1440 | 1136px | 1141px |
| 1920 | 1136px | 1536px |

## Where the code lives

| File | Role |
|---|---|
| `app/(app)/app-shell.tsx` | The chrome. Props only, no data access. Every layout decision above is here. |
| `app/(app)/layout.tsx` | The session read, and nothing else. Passes results to the shell. |
| `app/(app)/nav-rail.tsx` | Both nav shapes. The strip scrolls the current section into view. |
| `app/(dev)/layout-harness/` | Fixture render of the shell, development-only, 404 in production. |
| `scripts/layout-verify.mjs` | The matrix. `npm run layout:verify`. |

## Running it

```
npm run dev            # in one shell
npm run layout:verify  # in another
```

It drives a real Chromium over 5 routes × 16 widths × 2 heights and exits
non-zero on any breach, naming the offending element.

**If you add a shape the shell has to survive, add it to the harness.** The
script is only as good as what it is pointed at. The harness currently
carries a twelve-column table, a four-up KPI grid, an unbroken 46-character
token, a 44-character email, a long tenant account name, and a form row —
each one a real shape from a real screen, not an invented stress case.

## Known gap

The harness renders the *shell* with representative content, not each of
the product's ~40 screens. A screen could still introduce its own overflow
inside a correct shell. Extending the script to walk real screens needs a
seeded test tenant, which needs either a Supabase branch or a local stack —
neither was available when this was written. Until then, the shell is
covered mechanically and individual screens are not.
