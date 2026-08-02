# Design research — forward-looking, NOT implemented

**Status: reference document only.** Approach Plate (`app/tokens.css`) is
locked for this build — see `docs/PLAN.md` decision #19. Tony asked for
this research specifically to inform a *future* overhaul, after asking
for a synthesis of Chase, Apple, and ForeFlight ("just use the approach
plate design direction and I will overhaul it later"). Nothing below has
been applied to the current codebase. When the overhaul happens, this is
the starting brief — read the whole thing before changing a single token,
especially the **Slop risks** section at the bottom.

Produced by three independent Opus 5 research agents (one per reference,
each pulling real production values — Chase's actual CSS bundle, Apple's
published HIG JSON endpoints, ForeFlight's shipped app CSS and PDF guides
— rather than secondhand paraphrase) and one synthesis agent that combined
them. Full raw output is in the workflow journal if a claim needs
re-tracing to its source; the sourcing method is summarized under each
reference below.

## The organizing idea

**Don't average the three references — assign each one a non-overlapping
job**, the same way Chase itself assigns each of its four blues a
non-overlapping job. Blending references produces the generic median
(Inter, purple gradients, glassmorphism) — this is the same failure mode
flagged during the original design-direction comparison earlier in this
build. The synthesis instead assigns:

- **ForeFlight owns epistemics** — data age, limits shown beside values,
  planned-vs-actual, inline value coloring, signed artifacts, constant
  chrome across themes. It's the only reference that's domain-native;
  v1's users are quite literally ForeFlight's users.
- **Chase owns money and status** — a numeric type ramp where weight goes
  *down* as size goes *up*, status as a plain word colored only when
  actionable, rules instead of cards, a neutral focus ring, provenance
  disclaimers.
- **Apple owns craft discipline only** — per-size tracking as a token
  pair, tabular figures scoped to numerics rather than applied globally,
  the 28pt control floor (which *validates* the existing 28px row rather
  than challenging it), a one-shadow budget. **Apple's radius, capsule,
  concentricity, and materials guidance is rejected outright** — that's
  precisely the vector by which this drifts back into a rounded-card
  Tailwind default.

Approach Plate's structural spine — radius 0, zero shadows, 1px boxed
panels, dark header bars, the 172px dark rail, 28px rows, Roboto Condensed
uppercase — **survives intact, and is independently corroborated**: Chase
ships zero outer drop shadows in its entire production CSS bundle; Apple
ships zero `box-shadow` in 226KB of global header/footer.

So the overhaul is not a restyle. It's four things:
1. Re-typesetting money per Chase's ramp.
2. Moving the status signal off the trailing badge and onto the datum
   itself, per ForeFlight.
3. Adding three things Approach Plate currently has no vocabulary for at
   all — data age, limits, and selection state.
4. Splitting the accent color's overloaded job list (it currently does
   both "primary action" and "active nav," which leaves no color free for
   selection state).

Two of these are additions of *meaning*, not decoration — which is why
they don't drift generic.

**One thing the synthesis flagged in passing that's already fixed in this
build**: it caught `app/page.tsx:71`'s hardcoded `style={{ fontWeight:
700, fontSize: 14 }}` and route strings rendered in full-width Roboto Mono
as existing defects — both were independently found and fixed by the
code-review pass that ran alongside this research (see the `v1-row-amount`
class and the `.v1-num` scoping note below). The synthesis's proposed
`.v1-ident` split (mono for pure numerics, tabular body face for mixed
alphanumerics like tail numbers and routes) goes further than the current
fix and is captured below for the eventual overhaul.

## What to keep unchanged

1. **`--v1-radius: 0` everywhere.** The product's strongest identity
   token and the highest-value thing to refuse to change — it also makes
   Apple's entire concentricity section moot.
2. **Zero shadows / zero elevation.** Corroborated independently by both
   Chase (zero outer drop shadows in production CSS) and Apple (zero
   `box-shadow` in 226KB of global chrome).
3. **Boxed 1px panels with dark header bars.** Matches both Chase Connect
   and ForeFlight's grouped lists exactly.
4. **The 2px rule above totals.**
5. **`--v1-row: 28px`.** Apple's documented control *minimum* (not
   default — 44pt is the default, 28pt is the floor, the most commonly
   misquoted number in the HIG) validates this exact value.
6. **The 172px dark left rail with a 3px accent left-bar** on the active
   item, no filled background — this is Chase Connect's sidebar
   convention, already implemented correctly.
7. **Roboto Condensed uppercase for display/UI. Do not swap fonts.**
   ForeFlight uses a narrow humanist signage face (Gesta) for exactly the
   same reason — it survives at 9–11px uppercase in dense table headers.
   Swapping to Inter/Open Sans/SF is the generic median, spelled out.
8. **The ink-on-paper six-value palette discipline** (ink/paper/bg/
   field/line/hair).
9. **Tabular numerics as a concern — but scoped, not global** (see
   `.v1-num` / `.v1-ident` split below).
10. **The outlined-in-currentColor status tag, never a filled pill.**
    Chase quarantines pills to filter chips; ForeFlight uses a dot plus
    colored text. The form is right, only the *frequency* is wrong (see
    Chase's status finding below).
11. **`.v1-disclaimer` and the `CURRENCY_DISCLAIMER` copy** — this is
    Chase's provenance-disclaimer mechanism, already shipped, and a trust
    device almost no SaaS product uses. Extend it; never remove it.
12. **The single-file token doctrine + `scripts/verify-tokens.mjs` CI
    enforcement.** Architecturally the same thing Chase does with its own
    primitive → semantic → component token layers. Every proposal below
    inherits this rule, including the one new shadow token.

## Proposed token changes

| Token | Current | Proposed | Source |
|---|---|---|---|
| Money type ramp | 21px/700/Roboto Mono | `--v1-fig-sm` 26px/32/w400 (tiles); `--v1-fig-lg` 38px/46/w300 (one hero figure per page) | Chase |
| KPI caption placement | Label above, sub below, no ratio | Field name above at 10px; qualifier + data-age below at 12px, target ~3:1 figure-to-caption | Chase |
| `--v1-focus` (new) | Teal outline | Neutral `--v1-mute` grey, `outline-offset: -2px` — once teal means "selected," a teal focus ring is ambiguous | Chase |
| `--v1-accent` scope | Primary action **and** active nav | Exactly two jobs: primary action fill, selected-row fill. Active nav keeps the 3px bar + bold label, no fill | Synthesis |
| `--v1-select-fill/-ink/-soft` (new) | No selection state exists | Solid teal fill + white text on selected list rows — the single mechanism that makes a 200-row list navigable without a page load | ForeFlight |
| `--v1-chrome` / `--v1-chrome-2` (new) | Rail is flat `--v1-ink` | Two-step navy (`#101A22` / `#1E3044`) so the rail can express grouping — `--v1-ink` stays reserved for text-on-paper | ForeFlight |
| `--v1-chrome-text/-mute/-line` (new) | 6 raw hex literals inside component rules | Named tokens — 3 of the 6 are the same grey to three decimal places of intent | Synthesis |
| Tracking table | Ad hoc, and currently backwards (15px title tracks *more* than 11.5px nav item) | Explicit size→tracking pairs, inverted from Apple's curve since condensed uppercase needs opening as it shrinks | Apple |
| Smallest type steps | 9.5px labels | 10px floor (labels), 11px floor (prose) — 9.5px sits below Apple's own documented 10pt macOS floor | Apple |
| Line-height ladder | Flat 1.45 everywhere | Tightens as size grows, per Apple's leading curve | Apple |
| `.v1-num` scope | Applied to routes/tails too (already partly fixed) | Pure numerics only; new `.v1-ident` (body face + `tabular-nums`) for mixed alphanumerics | Apple |
| Spacing scale | Off-scale values throughout (14px, 18/22/26px, 11px, 9px, 5px, 7px) | Snap to Chase's published scale: 0·2·4·6·8·12·16·24·32·48·64 | Chase |
| `--v1-control` (new) | Buttons ≈26px tall | 28px min-height, shared with `--v1-row` | Apple |
| `--v1-shadow-transient` (new, the **only** shadow) | None | One shadow, permitted only on popovers/menus/drag ghosts/modals — never on panels, tables, tiles, rails | Synthesis |
| `.v1-age` (new) | No freshness vocabulary anywhere | Right-aligned timestamp on every synced/computed value, `--v1-warn` past a threshold | ForeFlight |
| `.v1-val--warn/--bad` (new) | Color only reaches a trailing badge | Recolor the number itself on exceedance — ForeFlight colors the datum that caused the state, not a pill beside it | ForeFlight |
| `.v1-tag` frequency | 4 of 6 currency rows currently render green "Current" | Terminal/steady states render as plain text, no border, no color — spend color only where action is needed | Chase |
| `.v1-lim` (new) | Status asserted with no visible threshold | A limits column / group-header suffix showing the rule a value was tested against (`1 \| 3`, `NET 30`) | ForeFlight |
| `.v1-term` (new) | None | Dashed underline on ambiguous billing/aviation terms (block vs flight time, duty day, PIC/SIC) | Chase |
| `--v1-bad` | `#A32B18` | **Unchanged** — Chase's crimson-magenta considered and explicitly rejected; the current oxide red already reads correctly against plate teal | Chase (rejected) |
| Dark theme block | Single light theme | `[data-theme='dark']` over the *same* variable names; chrome + accent stay byte-identical between themes, only the content plane flips | ForeFlight |

## Structural recommendations

- **Tables — two-tier headers, planned vs. actual.** The single
  highest-value structural addition for an invoicing product, and it
  currently has no expression at all. `RATE $` over `QUOTED/ACTUAL`,
  `TIME` over `EST/ACT`, deltas in parentheses. *(ForeFlight)*
- **Status as a sortable column, not a trailing badge**, with row actions
  that vary by state (`Draft → View | Edit | Void`, `Overdue → View |
  Remind | Write off`). Adopt Chase's negative-number convention: `-$0.05`
  in neutral text, no red, no parentheses. *(Chase)*
- **Rail: add group headers and breadcrumbs**, keep everything else.
  Uppercase group bands (`LOGBOOK / BILLING / CLIENTS`) on
  `--v1-chrome-2`; breadcrumbs above every detail page. Do **not** add
  Chase's stacked masthead bars — the rail already carries top-level nav.
  *(Chase)*
- **Within a module: list-left, detail-right**, selected row filled solid
  teal with white text. One sub-tab pattern only (underline tabs) —
  Chase's own documented failure mode is exactly icon/tab-pattern drift.
  *(Synthesis)*
- **Provenance and data age as a required slot**, not optional prose. The
  `Panel` component's `context` prop currently holds description text
  ("From your logbook and document dates"); it should hold freshness
  (`AS OF 02 AUG 1412Z · 47 ENTRIES`). Port this onto every generated
  invoice/logbook export too. *(ForeFlight)*
- **Extend the disclaimer mechanism** beyond the currency panel — YTD
  earnings, tax-set-aside estimates, hours summaries. Naming what a
  number *isn't* is a trust mechanism almost no SaaS product uses, and
  this one touches both FAA-relevant data and money. *(Chase)*
- **Grouped lists — rules, not cards.** One bordered container per group,
  hairline-divided records, no per-record card. The existing `.v1-kpis`
  strip already does this correctly and is the model to extend. *(Chase)*
- **A pinned summary strip on every detail view** (`BILLABLE · EXPENSES ·
  TAX · TOTAL DUE`), matching ForeFlight's Weight & Balance pattern —
  today a detail page gives no running total until you scroll to the
  bottom. *(ForeFlight)*
- **Search and filtering** — a filter bar on every list, one categorical
  global search grouped by record type. *(ForeFlight)*
- **Elevation: keep at zero**, budget exactly one shadow token, lint its
  usage the way `verify-tokens.mjs` already lints hex codes. Explicitly
  ban `backdrop-filter`. *(Synthesis)*
- **Model an issued invoice as an immutable artifact**, not a re-render —
  Draft recalculates live; Issued is frozen, carries its own provenance
  header, and moves to a separate bucket. *(ForeFlight)*
- **A printable trip sheet with ruled blank fields** a pilot fills in
  during flight (`OUT: ___ IN: ___ BLOCK: ___`). A real workflow — a pilot
  cannot type while taxiing — and the single most credible signal that
  this product was built by someone who has flown. *(ForeFlight)*
- **Four-line list rows**: bold identifier, then comma-delimited metadata
  at 11px across up to three more lines, one right-aligned age stamp.
  Hierarchy from weight and color alone, nothing boxed. *(ForeFlight)*
- **Middle-truncate identifiers** (`N41…21C`), never hide them entirely —
  matches Chase's `(...6606)` masked-account convention. *(Apple)*
- **Default to a table, not a chart.** Apple's own HIG guidance. Where a
  chart is genuinely warranted, encode direction with two tones of the
  accent (Chase's outflow token is *gray*, not red) and reserve
  `--v1-ok`/`--v1-bad` strictly for outcome states. *(Synthesis)*

## Slop risks — read this before touching a token

The synthesis flagged ten specific ways this proposal could regress into
generic AI-slop patterns if implemented carelessly. In order of severity:

1. **Dark theme is the #1 vector.** "Add a dark mode" is where
   glassmorphism, glow accents, and blur enter every project. Mitigation:
   chrome and accent stay byte-identical between themes; only the content
   plane flips. If the dark theme needs one new hue light mode doesn't
   have, the theme is wrong.
2. **The 38px hero figure drifts into "big number on a gradient card."**
   Enforce Chase's inversion mechanically — weight 300, tracking 0, never
   colored, exactly one instance per page.
3. **Chase's ~33% right rail of utility cards is a trap.** Copied
   naively it becomes rounded, shadowed, icon-topped cards. Don't adopt
   the rail; use a hairline-divided list instead.
4. **Everything in Apple's radius/materials/capsule section** —
   `border-radius: 980px`, squircles, Liquid Glass, ultraThin materials.
   Reject the entire section explicitly and in writing so it isn't
   re-proposed in six months as "Apple does it."
5. **The single shadow token gets reused on cards within one sprint.**
   Name it `--v1-shadow-transient`, not `--v1-shadow-sm` — the latter
   implies a scale, and a shadow scale is a shadow system.
6. **Chase's four-blue system cannot be copied literally into a teal
   product** — "many blues" is itself a fintech tell. Copy the
   *principle* (one meaning per color), not the palette. Total new
   chromatic tokens: zero.
7. **ForeFlight's four-level severity scale (VFR/MVFR/IFR/LIFR) invites
   invented states.** Stay at three (`ok`/`warn`/`bad`) unless a genuine
   fourth state exists in the data model.
8. **"More whitespace, larger type" is the default drift of any
   Apple-influenced review, and would destroy this product.** Apple
   publishes no spacing scale at all — spacing comes from Chase's scale
   only. Type floors rise 0.5–1px to clear Apple's stated minimum and
   stop there. The 13px base and 28px row do not move. Density is the
   product, not an unfinished state.
9. **Font substitution.** Averaging Open Sans + Gesta + SF Pro produces
   Inter — the single most recognizable AI-slop signature in SaaS. The
   three Roboto faces are locked.
10. **Adding icons acquires an icon system**, which is exactly how a
    product ends up with three inconsistent icon styles (Chase's own
    documented failure mode). If icons are added at all: one style, 1px
    stroke, `currentColor`, no fills — and only where text genuinely
    can't fit.
