# Design system — V1 Design (synced)

**The shipping visual system is "V1 Design", synced from Claude Design.**

- Project: `V1 Design` — https://claude.ai/design/p/7e31cf02-7832-40c3-9b8e-8ba1b4cf5109
- Synced: 2026-08-05
- Supersedes: **"Approach Plate"**, the direction locked in `docs/PLAN.md`
  decision #19. That direction is dead. Do not restore its values.

## What it is, in one paragraph

White-heavy glass. The interface is a stack of translucent sheets over a
faintly lit ground. One rule keeps that from costing legibility:

> **Glass at the container level, opaque at the content level.**

Rails, panels, panel headers, toolbars and buttons are translucent and blurred.
Table bodies, cells, list rows and figures sit on an opaque surface. A pilot
compares a column of decimal hours down a page; putting that column over a
blurred backdrop trades reading for decoration, and this reader will not
forgive that trade.

Blue (`#2768F5`) means **commanded**: the action that commits, the destination
you are in, the row you selected. Nothing else may use it. Status uses the
aviation annunciator scale — green normal, amber caution, red warning — and
each chip carries a **shape as well as a hue** (`● ▲ ■ ○`) so the level
survives greyscale and colour-blindness. Type is Inter across four roles,
separated by weight, size and tracking. Radius is 14px on panels and 8px on
controls. Elevation is a two-step scale and a surface takes exactly one shadow.
Nothing animates.

## Where it lives

| Path | What it is |
|---|---|
| `app/tokens/fonts.css` | Family tokens |
| `app/tokens/colors.css` | Ground, glass and opaque surfaces, ink, edges, commanded blue, annunciators |
| `app/tokens/typography.css` | Sizes, weights, tracking, leading |
| `app/tokens/spacing.css` | Spacing, the two radii, row and control height, rail width |
| `app/tokens/effects.css` | Blur, the two-step shadow scale, the lit top edge, focus ring |
| `app/tokens/dark.css` | `[data-theme="dark"]` — dark glass, same architecture inverted |
| `app/base.css` | Reset, ground, focus, selection |
| `app/components.css` | Every `.v1-*` class |
| `app/globals.css` | The entry point — `@import` lines only |
| `lib/brand.ts` | Brand strings and `THEME_COLOR` |

`scripts/verify-tokens.mjs` treats that whole set as the token layer and fails
CI on any colour, radius, font, shadow or blur spelled out anywhere else.

## Divergences from upstream

Three, all deliberate. **A future sync must preserve them.**

### 1. Fonts come from `next/font/google`, not a CDN `@import`

Upstream `tokens/fonts.css` pulls Inter from the Google Fonts CDN and its
readme asks for woff2 binaries so that dependency can be dropped. This app
resolves it better: `lib/fonts.ts` loads Inter through `next/font/google`,
which downloads the files at **build** time and serves them from this app's own
origin. No runtime request to Google, no third-party connection on the critical
path, no silent system-font fallback. `app/tokens/fonts.css` therefore resolves
the four family tokens through the `--font-inter` variable rather than an
`@import`.

Weight 700 is deliberately not loaded — every weight token tops out at 600,
because the system is explicit that "headings sit at 600, not 700, and the
uppercase labels carry meaning through tracking rather than boldness."

### 2. Only the standard `backdrop-filter` is declared

**Do not copy upstream's `-webkit-backdrop-filter` lines back in.** Lightning
CSS (which Next 16 uses to compile Tailwind v4) treats an author-written prefix
as a signal that it owns prefixing for that declaration, and collapses the pair
down to the `-webkit-` form alone. The bundle that first shipped here contained:

```
.v1-rail{ … -webkit-backdrop-filter:var(--v1-blur); … }
```

with the standard property **gone**. Chromium honours the alias, so it looked
correct in review. Firefox supports unprefixed `backdrop-filter` and does not
alias the `-webkit-` spelling, so the glass would have silently stopped blurring
there — losing the system's entire visual identity in one browser, with nothing
failing loudly. Declaring only the standard property lets Lightning CSS add
prefixes from browserslist itself, which is what it is for. The compiled bundle
now carries both forms; verify by grepping `.next/**/*.css`, not by reading the
source.

### 3. `SKILL.md` upstream is stale — ignore it

Upstream `SKILL.md` states the non-negotiables are *"radius 0 everywhere, zero
elevation, no gradients or blur."* That describes the **previous** direction,
not this one. `tokens/spacing.css` sets `--v1-radius: 14px`, `tokens/effects.css`
defines a two-step shadow scale and `blur(20px)`, and upstream's own `readme.md`
says plainly that "radius and elevation went from zero to 14px and a two-step
shadow scale, because glass needs depth and rounding to read as glass."

**The tokens and `readme.md` are authoritative. `SKILL.md` is not.** Anyone
invoking that skill will be told to build the opposite of what ships here.

## Not yet ported

The design system carries more than this app currently uses. Available upstream,
not in the repo:

- `components/data/` — `DataTable`, `RecordRow`, `MetaList`, `Toolbar`, `KpiStrip`
- `components/forms/` — `TextField`, `SelectField`
- `components/core/` — `EmptyState`, `Disclaimer`
- `ui_kits/v1-app/` — Trips list and detail, Invoice editor, Logbook screens
- `ui_kits/invoice-document/` — the outgoing invoice (`.v1-doc`, already in
  `components.css` but with no screen using it yet)

The `.v1-*` classes for all of the above are already present in
`app/components.css`, so porting a component is writing the TSX, not the CSS.
Pull them across as the phases that need them land — Phase 3 (Clients, Trips),
Phase 5 (Invoices), Phase 6 (Logbook).

## Re-syncing

The `DesignSync` tool reads the project directly. Read `readme.md` first, then
the `tokens/` files, then `components.css`. Copy values verbatim, then re-apply
the three divergences above and re-run:

```
npm run test          # typecheck + tokens:verify
npm run build
```

Then grep the compiled CSS for `backdrop-filter:var(` and confirm **both**
prefixed and unprefixed forms are present.
