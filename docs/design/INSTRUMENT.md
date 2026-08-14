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

### Motion: acknowledge, don't perform

This system had motion tokens (`--dur-instant/fast/base`, `--ease`) from the
start and almost no rules using them, which meant every motion decision was
made at a call site with nothing to check it against. The doctrine, written
down:

**Motion here does one job: tell the user their input landed.** It is never
decoration, never a reveal, never a thing you notice. A pilot on a ramp
between legs is trying to finish a task, and an interface that performs at
them is an interface that wastes their time. When in doubt, do not animate.

The four rules that follow from that:

1. **Acknowledge on pointer-DOWN, not on completion.** This is the one piece
   of feedback that has to exist, because the system's other states are all
   `:hover` and a touch device has no hover. A control must respond when the
   finger lands, not when the server answers — `.i-btn:active` scales to
   `--press-scale`, `.i-tab:active` dims. New interactive components get a
   pressed state or they are not finished.

2. **Under 200ms, always.** Every duration token is `--dur-instant` (80ms),
   `--dur-fast` (120ms) or `--dur-base` (180ms). There is no slower step and
   adding one needs an argument. Feedback that outlasts the gesture stops
   being feedback.

3. **Animate `transform` and `opacity` only.** They are the two properties
   the compositor can animate without laying the page out again. Animating
   `height`, `width` or `top` on a screen that also holds a 40-row day grid
   drops frames on exactly the hardware pilots use.

4. **Arriving surfaces materialise; they do not blink.** Anything entering
   the top layer — today that is `.i-dialog` — fades and scales from
   `--overlay-scale-from`, with its scrim fading in step. A dialog that is
   absent on one frame and complete on the next reads as a rendering fault,
   and these dialogs guard destructive actions.

**Reduced motion is three assignments, not a sweep.** Every transition in
the system reads the duration tokens, so `prefers-reduced-motion` takes all
three to zero in `tokens.css` and the whole product goes still. Note what
is *not* removed: the press scale survives, because the preference guards
against vestibular disturbance from large sustained movement, not against a
3% scale on the thing under your finger — and removing it would leave a
touch user with no acknowledgement at all. It simply becomes instant.

### Materials: translucent chrome, opaque structure

Chrome that content scrolls **under** — the phone top bar, the desktop
header, the marketing header — is a translucent blurred material
(`.i-chrome`: `--chrome-veil` + `--chrome-blur`) with a short fade below it
(`.i-chrome-edge`: `--chrome-edge`) instead of a 1px rule. The rule asserted
a boundary that is not real, since the content genuinely continues beneath
the bar.

Chrome that **is** structure — the nav rail — stays opaque. A heavy material
separates regions; a light one floats over content. Two light translucent
surfaces stacked on each other stop being legible, which is the failure this
distinction exists to prevent.

Both classes fall back to a solid bar under `prefers-reduced-transparency`
(a legibility request deserves an opaque answer, not a less blurry one) and
under `prefers-contrast: more` (a translucent ground cannot promise a
contrast ratio against whatever scrolls beneath it).

This replaces the earlier blanket ban on `backdrop-filter`. The ban existed
because a blur spelled out at a call site is exactly the kind of value that
drifts; the material living in tokens answers that without giving up the
effect.

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

---

## Verifying the seam

`components/ui` translates the old API onto INSTRUMENT for the ~89 files that
have not been rewritten yet (stage 4). Every such seam fails the same way:
**silently**. A prop the screens pass and the seam drops type-checks, builds,
renders, and is simply gone.

The authenticated screens cannot be rendered in CI — they are behind
`requireAccount()` and every one queries Supabase, so exercising them needs a
seeded tenant. Two checks stand in for that, and between them they caught
every defect this migration produced:

| Check | What it does |
|---|---|
| `npm run seam:audit` | Walks `app/(app)` and prints every (component, prop) pair the screens actually pass, with counts. It does not decide what is a bug — a seam *should* drop some props deliberately — it makes the list visible so the decision is made rather than assumed. |
| `app/(dev)/seam-harness` | Renders every shimmed component in those same prop shapes, so the result can be looked at and measured. In the `layout:verify` matrix. |

**Six defects, none of which a type-check or a build could see:**

1. **Separator swallowed `my`/`mb`/`mt`** — twelve rules sat flush against
   their content.
2. **Table cells understood only `justify="end"`** — the 63 cells passing
   `center` or `between` silently lost their alignment.
3. **`Select.Trigger` dropped `id`** — twenty `<label htmlFor>` attributes
   pointed at nothing, so those fields had no associated label.
4. **Compound objects exported from a `"use client"` module are opaque
   proxies.** `export const Tabs = {Root, List, …}` crosses the RSC boundary
   as a client *reference*, and reading `.Root` off it from a server component
   yields `undefined` — which React reports as "Element type is invalid",
   naming nothing. Real screens hit this: `settings/billing/page.tsx` is a
   server component rendering `<DataList.Root>`. Each part is now exported as
   a named function and the objects are assembled in the server module.
5. **Longhand spacing clobbered the shorthands.** The generated rule declares
   properties in list order, so `padding-block-start` lands after `padding`.
   With a bare `initial` fallback, an element setting only `p="4"` got
   `padding: 16px` and then `padding-block: initial` → 0 and
   `padding-block-start: initial` → 0. **Every shorthand spacing prop in the
   product — `p`, `px`, `py`, `m`, `mx`, `my` — was doing nothing.** Longhands
   now fall back through their shorthands before their own default
   (`SHORTHAND_FALLBACK` in the generator).
6. **`"use client"` on the whole seam broke `asChild` everywhere** — children
   written in a server component crossed the boundary and arrived as a lazy
   reference rather than an element.

Numbers 4 and 5 are the ones worth remembering: both were invisible in the
source, both required *measuring a rendered page* to find, and number 5 had
been shipping since the first commit of the prop engine.
