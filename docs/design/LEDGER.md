# LEDGER — the design system this product is migrating to

Chosen 15 AUG 2026 from the "Second Approach" proposal (three directions were
rendered and costed; Ledger — the fintech register — was picked). This file is
the system's specification and the migration's order of operations. The token
sheet itself is `app/design/ledger.css`; the primitives are
`components/ledger/`; the class combiner is `lib/ledger/cn.ts`.

## Why this register

A contract pilot is a business of one, and this product is, above all, how
they get paid. Ledger borrows the language of the best modern fintech — calm
paper ground, one confident indigo, large tabular numerals, status pills,
soft elevation — because that is the register an operator's AP clerk already
trusts on sight, and the pilot-facing money surfaces and the client-facing
portals should be siblings.

What it deliberately gives up: the aviation-native identity of the other two
proposed directions. What it must NOT give up (these are requirements, not
suggestions):

- **Tabular numerals on every figure a pilot cross-checks.** The `tnum-l`
  utility exists for exactly this; `LStat`, `LTd numeric` apply it themselves.
- **Semantic color is scarce and means money/attention states only** —
  good=paid/done, warn=due/aging, crit=overdue/lapsed. Never decoration.
- **Density where capture happens.** Ledger's marketing register is airy; its
  forms are not. Control text is 15px (`text-body`), which also clears iOS
  Safari's 16px focus-zoom threshold without INSTRUMENT's 90% scaling hack.
- **One filled accent action per view.** Restraint is the brand.

## Tokens (authoritative list lives in ledger.css)

| Role | Day | Night | Utility |
|---|---|---|---|
| Canvas | `#FBFBFA` | `#15171A` | `bg-canvas` |
| Card | `#FFFFFF` | `#1D2024` | `bg-card` + `shadow-card` |
| Sunk (wells, quiet fills) | `#F2F2F0` | `#191C1F` | `bg-sunk` |
| Ink | `#191D1B` | `#E9EBE9` | `text-ink` |
| Ink 2 (secondary) | `#545A56` | `#B3B8B4` | `text-ink-2` |
| Ink 3 (labels, hints) | `#737A75` | `#878D89` | `text-ink-3` |
| Hairline | `#E5E6E3` | `#2B2F33` | `border-hair` |
| Accent (indigo) | `#35509C` | `#8FA3D9` | `bg-accent` / `text-accent` |
| Good | `#1C7A52` | `#4CC38A` | + `-soft` fills |
| Warn | `#92600F` | `#D9A04B` | + `-soft` fills |
| Crit | `#B03434` | `#E0716B` | + `-soft` fills |

Contrast: every ink-on-ground pair above holds ≥ 4.5:1 in its own theme
(ink-3 on card is the floor at ~4.6:1 day / ~4.5:1 night); accent-on-white is
7.4:1; accent-ink on accent ≥ 4.5:1 both themes. Night is a designed palette
(desaturated accent, lifted semantic hues), not an inversion.

### The brand ground — signed-out surface only

| Role | Value | Utility |
|---|---|---|
| Brand (navy) | `#0B1F33` | `bg-brand` |
| Brand 2 (panel on navy) | `#13314F` | `bg-brand-2` |
| Brand hairline | `#1E3A57` | `border-brand-hair` |
| Brand ink | `#FFFFFF` | `text-brand-ink` |
| Brand ink 2 | `#9FB3C8` | `text-brand-ink-2` (7.4:1 on brand) |
| Brand accent | `#5B9BFF` | `text-brand-accent` (6.0:1 on brand) |

The navy is not new: it is what every file in `public/brand/` is already
drawn on, promoted from artwork to a token so the marketing and auth
surfaces can stand on the brand. **These six do not flip in the night
block**, deliberately — they are brand constants in the same sense as the
logo values in `app/globals.css`, and the presentation lockup must look
like itself whichever appearance a tenant runs. `LButton`'s `onBrand` and
`onBrandOutline` variants exist for this ground because the indigo accent
is a 1.6:1 smudge on it.

**Nothing in `app/(app)` may use them.** The restraint rule is unchanged
for the product; it was never an argument for a front door with no
identity.

### Type

Three families, three jobs, all vendored and all SIL OFL:

| Token | Family | Job |
|---|---|---|
| `font-ledger` | **Schibsted Grotesk** 400–700 | The interface. Every product screen, all body copy, all figures. |
| `font-display` | **Archivo**, width pinned to 112, 400–800 | Headlines on the signed-out surface. The semi-expanded cut is what gives it the signage read. |
| `font-mono` | **Azeret Mono** 400–700 | Identifiers: tail numbers, airport identifiers, step numbers, eyebrows. |

Scale `caption 12 / body-s 13.5 / body 15 / lead 17 / h3 20 / h2 24 /
h1 30 / figure 28`, plus two fluid display sizes for the signed-out surface
only: `display` (34→60px) and `display-s` (26→36px). Figures set
`tracking-tight` + `tnum-l`.

**Vendored from the google/fonts repository, never the Google CDN.** The
CDN strips OpenType features from the subsets it serves, and this product
reaches for `tnum` on every money column — Schibsted's digits are strongly
proportional by default (the `1` is 703 units against the `0`'s 1252), so a
face whose `tnum` was dropped in transit would misalign every invoice table
with nothing failing anywhere. See `lib/font-files/README.md` for the check.

Shape: `rounded-control` (8px) on inputs/buttons, `rounded-card` (12px) on
panels, full pills for status. Elevation: `shadow-card` resting,
`shadow-raised` for overlays only.

Day/night rides the **existing** `data-appearance` attribute app-shell stamps,
so the tenant appearance slot works identically across both design systems
for the whole migration.

## Architecture

Tailwind v4 (`@tailwindcss/postcss`) + hand-written shadcn-style primitives
composed with `cva` + `cn()` (clsx + tailwind-merge). No component library
dependency beyond that: the native-element decisions INSTRUMENT proved out
(dialog via `<dialog>`/showModal, native selects, roving-tabindex tabs) are
kept and reskinned when each is first needed by a migrated screen.

**The coexistence rule (do not break this):** `ledger.css` imports Tailwind's
theme + utilities layers, never preflight. Utilities are additive; no
un-migrated INSTRUMENT screen changes until its own markup migrates.
Preflight turns on in Phase 6, when nothing INSTRUMENT-styled remains.

**Guardrails:** `tokens:verify` still governs the whole repo — `ledger.css`
is the 10th value-exempt file and its tokens join the declared set. Ledger's
theme wipes Tailwind's stock palette (`--color-*: initial`), so a
non-Ledger color utility has no definition and fails visibly rather than
shipping quietly. The two class combiners must not cross: `cx()` for
INSTRUMENT files, `cn()` for Ledger files.

## Migration order

Each phase is a PR that leaves the app fully working in both systems.

| Phase | Scope | Notes |
|---|---|---|
| 0 ✅ | Foundation: theme, font, primitives, verifier | This PR |
| 1 ✅ | **Overview** — the visual contract | This PR; sign-off screen for everything after |
| 2 | The shell: nav rail/strip, header, canvas swap, PageShell successor | The moment the app *reads* as Ledger; INSTRUMENT pages keep rendering inside it |
| 3 | Money surfaces: Invoices (list/detail/new), Estimates, client-facing portals | The register's home turf; portals get the softer marketing variant |
| 4 | Capture surfaces: Trips + day grid, Expenses, Logbook | Density requirements bind hardest here; port the two-shapes day-grid pattern as-is |
| 5 | Everything else: Clients, Reports (+ recharts token swap), Settings, Accounting, Documents, Currency, Help, auth/onboarding/marketing | Chart colors re-point at Ledger tokens |
| 6 | Decommission: enable preflight, delete components/ds + components/ui + tokens.css + system.generated.css + the CSS generator, drop Archivo/Inter/JetBrains faces, retire INSTRUMENT rules from tokens:verify | The compat shim dies last, by construction |

Per-phase acceptance: `typecheck`, `tokens:verify`, `test:unit`,
`layout:verify` (Phase 2 especially — the shell is measured across the width
matrix), plus a manual day/night pass on the migrated screens.
