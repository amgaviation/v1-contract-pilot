/**
 * Color and geometry constants for components/charts/*, resolved through
 * LEDGER's tokens (app/design/ledger.css) — never a literal hex.
 *
 * Migrated from INSTRUMENT's tokens.css (docs/design/LEDGER.md Phase 5:
 * "Chart colors re-point at Ledger tokens"). These two chart components
 * (period-comparison-bar-chart.tsx, item-margin-bar-chart.tsx) are used
 * exclusively by /reports/profit-loss and /reports/trip-pl — no other
 * screen imports this file — so repointing it here does not touch any
 * INSTRUMENT surface still on the old system.
 *
 * WHY var(--…) STRINGS WORK PASSED STRAIGHT TO RECHARTS: every color prop
 * these charts set (`fill`, `stroke`, the tooltip's inline `style`) lands
 * on a real SVG/HTML element as either a presentation attribute or a CSS
 * style declaration — recharts forwards `fill`/`stroke` unchanged onto the
 * underlying `<path>`/`<text>` (see node_modules/recharts/es6/shape/
 * Rectangle.js: `fill = props.fill` flows straight into
 * `React.createElement("path", { fill, ... })`). Both forms resolve CSS
 * custom properties exactly like an author stylesheet would in every
 * browser this product supports (SVG presentation attributes are CSS
 * values per the SVG2 spec, and inline `style` obviously is). That means
 * a bar's color is a LIVE reference to the token, not a value sampled
 * once at mount: it repaints itself the instant the ancestor
 * [data-appearance] subtree changes, with no getComputedStyle call and no
 * re-render wiring needed here. The one place recharts does NOT forward a
 * caller's string untouched is its own default Legend/Tooltip chrome —
 * neither chart below uses either default (each chart hand-builds its own
 * tooltip and legend row), so that gap never applies.
 */

// CURRENT vs PRIOR PERIOD — "emphasis", not categorical (see the dataviz
// skill's choosing-a-form.md): the current period is the point, the prior
// period is context. Ledger's one confident accent is the "this is the
// point" role (docs/design/LEDGER.md: "one filled accent action per
// view", extended here to "one emphasized series per chart"); --ledger-
// ink-3 is Ledger's own de-emphasis step.
export const CHART_CURRENT_COLOR = "var(--ledger-accent)";
export const CHART_PRIOR_COLOR = "var(--ledger-ink-3)";

// MARGIN SIGN — diverging, two hues either side of an implicit zero
// baseline. --ledger-good / --ledger-warn, not --ledger-crit: DeltaBadge
// (profit-loss/page.tsx) and <Money> (trip-pl/page.tsx) already read a
// negative dollar figure with Ledger's warn (amber) tone on these two
// pages — crit is reserved product-wide for overdue/failed/destructive
// state. Reusing the pair already on screen keeps "a negative figure" one
// color, chart or table, rather than introducing a second "bad" hue.
export const CHART_POSITIVE_COLOR = "var(--ledger-good)";
export const CHART_NEGATIVE_COLOR = "var(--ledger-warn)";

export const CHART_GRID_COLOR = "var(--ledger-hair)";
export const CHART_AXIS_TEXT_COLOR = "var(--ledger-ink-3)";
export const CHART_TOOLTIP_BG = "var(--ledger-card)";
export const CHART_TOOLTIP_BORDER = "var(--ledger-hair)";
export const CHART_CURSOR_FILL = "var(--ledger-sunk)";

// Mark geometry — plain numbers, not a token reference. Ledger's
// --radius-control/--radius-card scale is for UI chrome (panels,
// controls); recharts' own numeric props (barSize, the radius corner
// array) cannot take a var() string at all, so there is no token to
// point at here. Values are chosen to match the dataviz skill's mark
// spec (bar/column ≤24px thick, 4px rounded data-end) — 3px is used for
// the corner radius as a deliberate echo of Ledger's --radius-control
// (8px) family rather than a coincidence to maintain by hand.
export const CHART_BAR_THICKNESS = 22;
export const CHART_BAR_RADIUS: [number, number, number, number] = [3, 3, 0, 0];
