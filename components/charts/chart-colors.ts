/**
 * Color and geometry constants for components/charts/*, resolved through
 * INSTRUMENT's tokens (app/design/tokens.css) — never a literal hex.
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
 * [data-appearance]/[data-accent] subtree changes, with no
 * getComputedStyle call and no re-render wiring needed here. The one
 * place recharts does NOT forward a caller's string untouched is its own
 * default Legend/Tooltip chrome — neither chart below uses either
 * default (see chart-tooltip.tsx and each chart's own legend row), so
 * that gap never applies.
 */

// CURRENT vs PRIOR PERIOD — "emphasis", not categorical (see the dataviz
// skill's choosing-a-form.md): the current period is the point, the prior
// period is context. --signal is already this product's "this is live /
// current" role (tokens.css §3, "Signal — LIVE things only"); --ink-3 is
// the system's own de-emphasis step.
export const CHART_CURRENT_COLOR = "var(--signal)";
export const CHART_PRIOR_COLOR = "var(--ink-3)";

// MARGIN SIGN — diverging, two hues either side of an implicit zero
// baseline. Deliberately --ok / --caution, NOT --ok / --warn: DeltaBadge
// (profit-loss/page.tsx) and <Money> (trip-pl/page.tsx) already read a
// negative dollar figure as --caution (amber) everywhere on these two
// pages — --warn (red) is reserved product-wide for overdue/failed/
// destructive state (components/ui/index.tsx's TONE_FOR_COLOR table).
// Reusing the pair already on screen keeps "a negative figure" one
// color, chart or table, rather than introducing a second "bad" hue.
export const CHART_POSITIVE_COLOR = "var(--ok)";
export const CHART_NEGATIVE_COLOR = "var(--caution)";

export const CHART_GRID_COLOR = "var(--hair)";
export const CHART_AXIS_TEXT_COLOR = "var(--ink-3)";
export const CHART_TOOLTIP_BG = "var(--paper)";
export const CHART_TOOLTIP_BORDER = "var(--edge)";
export const CHART_CURSOR_FILL = "var(--sunk)";

// Mark geometry — plain numbers, not a token reference. app/design/
// tokens.css's --space-*/--radius scale is for UI chrome (panels,
// controls); recharts' own numeric props (barSize, the radius corner
// array) cannot take a var() string at all, so there is no token to
// point at here. Values are chosen to match the dataviz skill's mark
// spec (bar/column ≤24px thick, 4px rounded data-end) — 3px is used for
// the corner radius because it happens to equal tokens.css's --radius,
// a deliberate echo of the rest of the product's "machined edge" register
// rather than a coincidence to maintain by hand.
export const CHART_BAR_THICKNESS = 22;
export const CHART_BAR_RADIUS: [number, number, number, number] = [3, 3, 0, 0];
