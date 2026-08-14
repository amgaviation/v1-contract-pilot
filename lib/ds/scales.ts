/**
 * INSTRUMENT — the scale definitions.
 *
 * THIS FILE IS THE SINGLE SOURCE FOR TWO CONSUMERS THAT MUST NOT DISAGREE:
 *
 *   1. scripts/generate-design-css.mjs, which emits every responsive rule in
 *      app/design/system.generated.css from the lists below.
 *   2. lib/ds/props.ts, whose TypeScript types are derived from the same
 *      lists, so a prop value that has no CSS rule behind it is a compile
 *      error rather than a silently dead attribute.
 *
 * That coupling is the whole point. The failure mode it exists to prevent is
 * specific and was hit by the system this replaces: a prop accepts a value at
 * a breakpoint for which no media query was ever generated, so the value is
 * accepted, typechecks, renders nothing, and nobody finds out until someone
 * resizes a window to exactly the wrong width. Deriving both sides from one
 * list makes that state unrepresentable.
 *
 * NOTHING HERE IS A VISUAL VALUE. These are scale POSITIONS and the CSS
 * custom-property names they map to. Every actual number, colour and length
 * lives in app/design/tokens.css. If you find yourself wanting to write a
 * pixel value in this file, it belongs there instead.
 */

/**
 * Breakpoints, in ascending order. `initial` is not a media query — it is
 * the base rule every element gets before any query applies.
 *
 * THE NUMBERS ARE DELIBERATELY UNCHANGED from the system this replaces.
 * Pages across the product already declare `{{ initial: "1", md: "3" }}`
 * against these widths, and docs/RESPONSIVE-CONTRACT.md pins the shell's
 * rail switch to `md`. Moving the design system and the breakpoint numbers
 * in the same change would make any resulting regression unattributable —
 * you would not know whether a screen broke because the component changed or
 * because the width it switches at moved. One variable at a time.
 */
export const BREAKPOINTS = [
  { key: "initial", min: 0 },
  { key: "xs", min: 520 },
  { key: "sm", min: 768 },
  { key: "md", min: 1024 },
  { key: "lg", min: 1280 },
  { key: "xl", min: 1640 },
] as const;

export type Breakpoint = (typeof BREAKPOINTS)[number]["key"];

/** Every breakpoint except `initial`, i.e. the ones that get a media query. */
export const MEDIA_BREAKPOINTS = BREAKPOINTS.filter(
  (b) => b.key !== "initial"
) as ReadonlyArray<{ key: Exclude<Breakpoint, "initial">; min: number }>;

/**
 * The space scale. 4px base unit; every step an integer multiple.
 *
 * "0" is included as a real position because `p="0"` and `gap="0"` are things
 * a layout legitimately asks for, and the alternative — omitting the prop —
 * cannot express "no gap HERE but a gap at the next breakpoint up", which is
 * an arrangement several screens need.
 */
export const SPACE = ["0", "1", "2", "3", "4", "5", "6", "7", "8"] as const;
export type Space = (typeof SPACE)[number];

/** Type scale positions. See docs/design/INSTRUMENT.md for the sizes. */
export const TEXT_SIZE = ["1", "2", "3", "4", "5", "6", "7"] as const;
export type TextSize = (typeof TEXT_SIZE)[number];

export const WEIGHT = ["regular", "medium", "semibold", "bold"] as const;
export type Weight = (typeof WEIGHT)[number];

/**
 * Semantic tones. Named by MEANING, never by hue — `caution`, not `amber`.
 *
 * The rename is the point. Under the previous system a status badge asked
 * for `color="amber"`, which welded the palette to the call site: changing
 * what "needs attention" looks like meant editing every screen that shows
 * something needing attention. `tone="caution"` survives a palette change
 * because it never named a colour in the first place.
 */
export const TONE = [
  "default", // ink on paper — the unmarked case
  "muted", // secondary information
  "faint", // tertiary: placeholders, disabled, timestamps
  "signal", // live: links, current section, active filter
  "ok", // current, paid, reconciled, compliant
  "caution", // due soon, expiring, draft, needs attention
  "warn", // overdue, not current, failed, destructive
] as const;
export type Tone = (typeof TONE)[number];

/** Control sizes. `2` is the default and computes to a 32px control. */
export const CONTROL_SIZE = ["1", "2", "3"] as const;
export type ControlSize = (typeof CONTROL_SIZE)[number];

export const ALIGN = ["start", "center", "end", "baseline", "stretch"] as const;
export const JUSTIFY = ["start", "center", "end", "between"] as const;
export const DIRECTION = ["row", "column", "row-reverse", "column-reverse"] as const;
export const WRAP = ["nowrap", "wrap", "wrap-reverse"] as const;
export const DISPLAY = ["none", "block", "inline", "inline-block", "flex", "inline-flex", "grid"] as const;
export const COLUMNS = ["1", "2", "3", "4", "5", "6", "12"] as const;

/**
 * The responsive layout properties, and how each maps to CSS.
 *
 * `varName` is the custom-property stem written on the element;
 * `css` is the declaration the generated stylesheet emits;
 * `scale` says how a prop value becomes a CSS value:
 *   - "space"   → var(--space-N) from tokens.css
 *   - "raw"     → the value verbatim (a keyword like "row", or a length)
 *
 * Adding a row here adds the prop, its types and its media queries at once.
 * There is no second place to update, which is the invariant this whole file
 * exists to hold.
 */
export const LAYOUT_PROPS = [
  { prop: "p", varName: "p", css: "padding", scale: "space", dflt: "initial" },
  { prop: "px", varName: "px", css: "padding-inline", scale: "space", dflt: "initial" },
  { prop: "py", varName: "py", css: "padding-block", scale: "space", dflt: "initial" },
  { prop: "pt", varName: "pt", css: "padding-block-start", scale: "space", dflt: "initial" },
  { prop: "pb", varName: "pb", css: "padding-block-end", scale: "space", dflt: "initial" },
  { prop: "pl", varName: "pl", css: "padding-inline-start", scale: "space", dflt: "initial" },
  { prop: "pr", varName: "pr", css: "padding-inline-end", scale: "space", dflt: "initial" },
  { prop: "m", varName: "m", css: "margin", scale: "space", dflt: "initial" },
  { prop: "mx", varName: "mx", css: "margin-inline", scale: "space", dflt: "initial" },
  { prop: "my", varName: "my", css: "margin-block", scale: "space", dflt: "initial" },
  { prop: "mt", varName: "mt", css: "margin-block-start", scale: "space", dflt: "initial" },
  { prop: "mb", varName: "mb", css: "margin-block-end", scale: "space", dflt: "initial" },
  { prop: "ml", varName: "ml", css: "margin-inline-start", scale: "space", dflt: "initial" },
  { prop: "mr", varName: "mr", css: "margin-inline-end", scale: "space", dflt: "initial" },
  { prop: "gap", varName: "gap", css: "gap", scale: "space", dflt: "initial" },
  { prop: "display", varName: "d", css: "display", scale: "raw", dflt: "initial" },
  { prop: "direction", varName: "fd", css: "flex-direction", scale: "raw", dflt: "initial" },
  { prop: "align", varName: "ai", css: "align-items", scale: "raw", dflt: "initial" },
  { prop: "justify", varName: "jc", css: "justify-content", scale: "raw", dflt: "initial" },
  { prop: "wrap", varName: "fw", css: "flex-wrap", scale: "raw", dflt: "initial" },
  { prop: "flexGrow", varName: "fg", css: "flex-grow", scale: "raw", dflt: "initial" },
  { prop: "flexShrink", varName: "fs", css: "flex-shrink", scale: "raw", dflt: "initial" },
  { prop: "width", varName: "w", css: "width", scale: "raw", dflt: "initial" },
  { prop: "minWidth", varName: "minw", css: "min-width", scale: "raw", dflt: "0" },
  { prop: "maxWidth", varName: "maxw", css: "max-width", scale: "raw", dflt: "initial" },
  { prop: "height", varName: "h", css: "height", scale: "raw", dflt: "initial" },
  { prop: "minHeight", varName: "minh", css: "min-height", scale: "raw", dflt: "initial" },
  { prop: "maxHeight", varName: "maxh", css: "max-height", scale: "raw", dflt: "initial" },
  { prop: "columns", varName: "gtc", css: "grid-template-columns", scale: "columns", dflt: "initial" },
  { prop: "gridColumn", varName: "gc", css: "grid-column", scale: "raw", dflt: "initial" },
  { prop: "position", varName: "pos", css: "position", scale: "raw", dflt: "initial" },
  { prop: "overflow", varName: "ov", css: "overflow", scale: "raw", dflt: "initial" },
  { prop: "overflowX", varName: "ovx", css: "overflow-x", scale: "raw", dflt: "initial" },
  { prop: "overflowY", varName: "ovy", css: "overflow-y", scale: "raw", dflt: "initial" },
  { prop: "textAlign", varName: "ta", css: "text-align", scale: "raw", dflt: "inherit" },
] as const;

export type LayoutPropName = (typeof LAYOUT_PROPS)[number]["prop"];

/** Justify's `between` is spelled `space-between` in CSS; same for around/evenly. */
export const JUSTIFY_CSS: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
};

export const ALIGN_CSS: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  baseline: "baseline",
  stretch: "stretch",
};
