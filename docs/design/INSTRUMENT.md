# INSTRUMENT — the V1 design system

Written 2026-08-14. Supersedes Radix Themes, which supersedes "Approach Plate",
which superseded the Manifest/Horizon port. This is the fourth visual system
this product has had and the last one that should need writing, for reasons
set out under *Why this one is different* below.

---

## The brief

> "Design system and layout rebuild from scratch. Don't use the same design
> system or try to rebuild it. Create a totally different one from scratch."

So: Radix Themes comes out entirely. Not re-themed, not re-configured —
removed. Every colour, every space step, every component, every line of CSS
in this system is written here.

## What "from scratch" does and does not mean here

**Built from scratch:** the token layer, the type system, the spatial system,
the colour system, every component's markup and CSS, the responsive prop
engine, and the visual language they express. There is no third-party design
system, no component library, no Tailwind, no CSS-in-JS runtime.

**Deliberately NOT hand-rolled:** the *behaviour* of the three components
where hand-rolling is how products ship accessibility bugs — modal focus
trapping, listbox keyboard semantics, and form control states. Those come
from the **web platform itself**, not from a library:

| Component | Built on | Why |
|---|---|---|
| Dialog / AlertDialog | native `<dialog>` + `showModal()` | Focus trap, inert background, Esc-to-close and the top layer are all platform behaviour now. A hand-rolled div-with-a-backdrop reimplements four things the browser already does correctly. |
| Select | native `<select>` | Fully keyboard- and screen-reader-correct for free, and on a phone it opens the OS picker — which is the *better* interaction for a pilot filling a form one-handed, not a compromise. |
| Checkbox / Switch | native `<input type="checkbox">` | Same reasoning. The switch is a checkbox with a different skin. |
| Tabs | hand-built, roving tabindex | Only two call sites, and the pattern is small enough to implement correctly. |

This is a design-system rebuild, not an accessibility rewrite. Using the
platform's own primitives is the *more* from-scratch answer than pulling in
another vendor's headless library would have been.

---

## Why this one is different

The three previous systems each died the same way: a written spec that the
code drifted away from. The counter-measure is not more discipline, it is
that **the system is the only thing that can produce a visual value.**

1. **One token file.** `app/design/tokens.css` holds every colour, space,
   size, radius, weight and duration in the product. Nothing else declares
   one.
2. **Components cannot take arbitrary values.** A primitive's props are
   *scale positions* — `gap="3"`, `size="2"`, `tone="caution"` — not CSS.
   There is no `color="#hex"` to reach for at 2am.
3. **`tokens:verify` fails the build** on any literal outside the token file.
4. **`layout:verify` fails the build** on any responsive regression, across
   16 widths × 2 heights. (See `docs/RESPONSIVE-CONTRACT.md`.)

A future restyle is a change to `tokens.css` and nothing else.

---

## The visual language

### The idea

A contract pilot's screen is a **working instrument**, not a brochure. It is
read in bright daylight on a ramp, in a dim FBO at 5am, and on a laptop
between legs. Everything below serves legibility under those conditions, and
nothing on the screen is decoration.

Three rules generate the whole look:

1. **Rules, not fills.** Hierarchy is carried by hairlines, 2px rules and
   whitespace. Tinted background blocks — Radix's central device — are
   restricted to *state* (a current nav item, a selected row). A screen of
   pastel panels is a screen where nothing is emphasised.
2. **Ink is the primary action.** The main button on any screen is a solid
   near-black block. Accent blue is reserved for things that are *live* —
   links, focus, the current section, an active filter. When everything
   important is blue, blue stops meaning anything.
3. **Figures are a first-class typeface.** Every number is set in a mono
   face with tabular figures, because this product is columns of money and
   decimal hours and a ragged column is a legibility bug.

### Ground: warm, not cool

The single most visible break from Radix. Radix Themes' slate is a
blue-grey; every surface in the product read cold and slightly clinical.
INSTRUMENT's neutrals are warm — a paper white and a stone canvas.

Light:

| Role | Value | Use |
|---|---|---|
| `--ink` | `#17150F` | Body text, primary buttons, 2px rules |
| `--ink-2` | `#4A463C` | Secondary text |
| `--ink-3` | `#7A7466` | Tertiary text, placeholders |
| `--paper` | `#FFFEFC` | Panels, inputs, the raised surface |
| `--canvas` | `#F2F0EA` | The app ground behind panels |
| `--sunk` | `#E8E5DC` | Table headers, inset blocks, disabled |
| `--hair` | `#DBD7CC` | 1px dividers |
| `--edge` | `#C4BEAF` | 1px panel borders, input borders |

Dark is a genuine second design, not an inversion: the canvas goes to a warm
near-black and panels *lift* off it, so cards keep reading as panels rather
than merging into the ground.

### Signal: one accent, four meanings

| Token | Light | Meaning — and it is only ever used for that |
|---|---|---|
| `--signal` | `#0B5FD9` | Live: links, focus ring, current section, active filter |
| `--ok` | `#1B6B3A` | Current, paid, reconciled, in compliance |
| `--caution` | `#8A5A00` | Due soon, expiring, draft, needs attention |
| `--warn` | `#A32B18` | Overdue, not current, failed, destructive |

Named by **meaning**, not hue. `tone="caution"` survives a future palette
change; `color="amber"` does not.

The V1 mark keeps its own two constants (`#000000` wordmark, `#036BFC` bug)
because those are trademark artwork, not UI. They are declared in
`app/design/tokens.css` under a clearly separated heading and never
participate in the semantic scale.

### Type: three faces, each with one job

Radix Themes gave this product a single Inter ramp for everything, including
figures. INSTRUMENT uses three:

| Face | Role | Why |
|---|---|---|
| **Archivo** | Headings, section labels, table column heads, buttons | A grotesk with real presence at small sizes and a genuine condensed range for dense column heads. Gives the product a voice Inter alone did not. |
| **Inter** | Body copy, form values, everything conversational | Already self-hosted, and the best-tuned UI face for small sizes. |
| **JetBrains Mono** | Every figure, tail number, ICAO code, invoice number, token | Tabular by construction. A tail number is an identifier and should not look like prose. |

All three self-hosted via `next/font` — no CDN request, no fallback flash.

**The type scale is integer pixels.** Radix at `scaling="90%"` produced
14.4px and 28.8px — fractional sizes that render soft at some zoom levels
and pushed the Sign out button under the WCAG target-size minimum. Every
step here is a whole number at 100%.

| Step | Size / line | Use |
|---|---|---|
| `1` | 11 / 16 | Column heads, eyebrows, meta |
| `2` | 13 / 20 | Secondary copy, table cells |
| `3` | 15 / 24 | Body default |
| `4` | 18 / 26 | Card titles |
| `5` | 22 / 30 | Section headings |
| `6` | 28 / 36 | Page titles |
| `7` | 36 / 44 | Marketing only |

### Space: 4px base, integers only

`--space-1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 24 · `6` 32 · `7` 48 · `8` 64

Control height is **32px** (`--control-2`), with 24px and 40px either side.
32 is a multiple of the base unit, clears WCAG 2.5.8's 24px minimum with
room, and gives a denser table row than Radix's 36px default.

### Geometry

`--radius: 3px`, one value, everywhere. Not 0 (reads brutalist, and the
previous system's owner rejected it), not 6+ (reads consumer-soft). 3px on a
1px border reads as a machined edge.

**No shadows on flat surfaces.** Panels are bordered. The one elevation
token exists for overlays that genuinely float above the page — dialog,
dropdown, toast — where the shadow communicates layer, not decoration.

---

## Density is a tenant setting, and it is real

Radix's `scaling` prop faked density by scaling font size, which is why the
fractional pixels happened. INSTRUMENT's three density slots change the
**spatial** scale and control height, leaving the type scale alone:

| Slot | Base unit | Control | Row |
|---|---|---|---|
| `compact` | 4px | 28px | 32px |
| `default` | 4px | 32px | 38px |
| `roomy` | 5px | 40px | 46px |

Type size is independent, so a pilot who wants bigger text and tight spacing
can have both — which the old scaling knob could not express.

---

## Layout

The responsive contract is unchanged and non-negotiable — see
`docs/RESPONSIVE-CONTRACT.md`. The rail switches at 1024px, the page never
scrolls sideways, and `layout:verify` runs in CI. The new system must pass
that suite unmodified; if a rebuild cannot satisfy the layout contract it is
the rebuild that is wrong.

Breakpoints keep the same numbers, because pages already declare against
them and changing both systems at once would make any regression
unattributable:

`xs` 520 · `sm` 768 · `md` 1024 · `lg` 1280 · `xl` 1640

---

## How responsive props work

Every layout prop accepts either a scale position or a breakpoint object:

```tsx
<Flex direction={{ initial: "column", md: "row" }} gap="4" px={{ initial: "3", md: "5" }}>
```

There is no utility-class explosion behind this. A prop emits **CSS custom
properties** on the element, one per breakpoint given, and the stylesheet
reads them through a fallback chain:

```css
.i-flex { gap: var(--i-gap-i, 0); }
@media (min-width: 520px)  { .i-flex { gap: var(--i-gap-xs, var(--i-gap-i, 0)); } }
@media (min-width: 768px)  { .i-flex { gap: var(--i-gap-sm, var(--i-gap-xs, var(--i-gap-i, 0))); } }
/* …and so on up the ladder */
```

One class per component, a handful of custom properties per element, and the
cascade does the inheritance. The stylesheet for this is **generated** by
`scripts/generate-design-css.mjs` from the same scale definitions the TypeScript
props are typed from, so the two cannot disagree — a drift that would
otherwise be invisible until a specific prop at a specific breakpoint
silently did nothing.

---

## Files

| File | Holds |
|---|---|
| `app/design/tokens.css` | **Every** value in the product. Light, dark, and the three density slots. |
| `app/design/system.generated.css` | Component + responsive CSS. Generated — never hand-edited. |
| `lib/ds/scales.ts` | The scale definitions both the CSS generator and the prop types read. |
| `lib/ds/props.ts` | The responsive prop engine. |
| `components/ds/*` | The primitives. |
| `components/ui/index.tsx` | Unchanged import path for the ~89 files that use it; re-exports `components/ds`. |
| `scripts/generate-design-css.mjs` | Emits the generated stylesheet. Run by `predev`/`prebuild`. |

`components/ui` keeps its path deliberately. Moving 89 import sites in the
same change that replaces every component underneath them would make a
compile error and a design regression indistinguishable. The path is a
module boundary, not a design decision.

---

## Migration

The rebuild lands in stages, each of which leaves `main` shippable:

1. Tokens, scales, prop engine, CSS generator. *Nothing rendered yet.*
2. Layout + type primitives (Box, Flex, Grid, Stack, Text, Heading).
3. Surface + control primitives (Panel, Button, Field, Select, Table, Badge,
   Note, Dialog, Tabs, Separator, Spinner, Link).
4. `components/ui` re-points to `components/ds`. Radix Themes uninstalled.
5. `tokens:verify` rewritten to enforce INSTRUMENT.
6. Screen-by-screen pass for anything the compatibility surface papered over.

Each stage ends with typecheck, unit tests, `tokens:verify`, `layout:verify`
and a build — all green — before the next begins.
