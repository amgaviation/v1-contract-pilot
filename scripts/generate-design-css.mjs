#!/usr/bin/env node
/**
 * INSTRUMENT — emits app/design/system.generated.css.
 *
 * Run by `predev` and `prebuild`, and checkable in CI with `--check`, which
 * exits non-zero if the committed file is stale.
 *
 * WHY GENERATE IT
 *
 * Every responsive prop in this system works by writing CSS custom properties
 * on the element and letting a media-query ladder read them back with a
 * fallback chain. Written by hand that is ~35 properties x 5 breakpoints of
 * near-identical CSS, where the fallback chain has to list every LOWER
 * breakpoint in descending order or the prop silently stops inheriting at
 * some width. That is exactly the kind of rule a human writes correctly 34
 * times and wrong once, and the failure is invisible: the prop typechecks,
 * renders, and does nothing at one specific viewport.
 *
 * So both sides come from lib/ds/scales.ts — this generator emits the CSS,
 * and lib/ds/props.ts derives its TypeScript types from the same list. A prop
 * value with no rule behind it cannot exist.
 *
 * WHAT IT EMITS
 *
 *   1. The base layer: element resets and the three type families.
 *   2. One rule per layout property at `initial`.
 *   3. One media query per breakpoint, each re-declaring every layout
 *      property with the full descending fallback chain.
 *   4. Component CSS for every primitive in components/ds.
 *
 * The component CSS lives here rather than in a .css file per component for
 * one reason: it has to interleave with the responsive layer in a single
 * cascade, and splitting it across files makes the order that decides which
 * declaration wins depend on import order in a bundler. One file, one order,
 * written down.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "app", "design", "system.generated.css");

// scales.ts is TypeScript; rather than add a build step to read it, parse the
// handful of arrays this generator needs out of the source. Deliberately
// strict: if a list cannot be found the generator THROWS rather than emitting
// a stylesheet missing a property, because a silently short stylesheet is the
// precise failure this file exists to prevent.
const scalesSrc = readFileSync(join(ROOT, "lib", "ds", "scales.ts"), "utf8");

function parseObjectArray(name) {
  const m = scalesSrc.match(
    new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`)
  );
  if (!m) throw new Error(`generate-design-css: cannot find ${name} in scales.ts`);
  const rows = [];
  for (const entry of m[1].matchAll(/\{([^}]*)\}/g)) {
    const obj = {};
    for (const kv of entry[1].matchAll(/(\w+)\s*:\s*("([^"]*)"|\d+)/g)) {
      obj[kv[1]] = kv[3] !== undefined ? kv[3] : Number(kv[2]);
    }
    rows.push(obj);
  }
  if (!rows.length) throw new Error(`generate-design-css: ${name} parsed empty`);
  return rows;
}

function parseStringArray(name) {
  const m = scalesSrc.match(
    new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`)
  );
  if (!m) throw new Error(`generate-design-css: cannot find ${name} in scales.ts`);
  const vals = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (!vals.length) throw new Error(`generate-design-css: ${name} parsed empty`);
  return vals;
}

const BREAKPOINTS = parseObjectArray("BREAKPOINTS");
const LAYOUT_PROPS = parseObjectArray("LAYOUT_PROPS");
const TEXT_SIZE = parseStringArray("TEXT_SIZE");
const TONE = parseStringArray("TONE");
const CONTROL_SIZE = parseStringArray("CONTROL_SIZE");

const keys = BREAKPOINTS.map((b) => b.key);

/**
 * The fallback chain for one property at one breakpoint.
 *
 * At `md` with only `initial` and `md` set, the value must still resolve —
 * so the chain lists every lower breakpoint in DESCENDING order, ending at a
 * bare `initial` and then the property's own unset default. Getting this
 * order wrong is the bug the generator exists to make impossible, so it is
 * derived from the breakpoint list rather than written out.
 */
/**
 * The shorthand hierarchy. A longhand must fall back to the shorthand that
 * covers it before it falls back to its own default.
 *
 * WHY THIS EXISTS. The generated rule declares every property in list order,
 * so `padding-block-start` lands AFTER `padding-block` and `padding`. With a
 * bare `initial` fallback, an element that set only `p="4"` still got
 *     padding: 16px;                       <- from p
 *     padding-block: initial;              <- py unset -> 0, clobbers padding
 *     padding-block-start: initial;        <- pt unset -> 0, clobbers again
 * and ended up with no padding at all. Every shorthand spacing prop in the
 * product — p, px, py, m, mx, my — was silently doing nothing, which is how a
 * <Separator my="3"> came to sit flush against its neighbours.
 *
 * Found by measuring a computed margin on the seam harness, not by reading the
 * CSS: the declaration looks correct in isolation, and only the ORDER makes it
 * wrong.
 */
const SHORTHAND_FALLBACK = {
  pt: ["py", "p"],
  pb: ["py", "p"],
  pl: ["px", "p"],
  pr: ["px", "p"],
  px: ["p"],
  py: ["p"],
  mt: ["my", "m"],
  mb: ["my", "m"],
  ml: ["mx", "m"],
  mr: ["mx", "m"],
  mx: ["m"],
  my: ["m"],
};

/**
 * The full fallback chain for one property at one breakpoint.
 *
 * Resolution order at breakpoint B is: this property at B, then each broader
 * shorthand at B, then the same sequence at B-1, and so on down to `initial`,
 * ending at the property's own default. Written as nested var() fallbacks,
 * innermost last.
 *
 * The breakpoint half is what makes a value set at one width inherit upward
 * until another replaces it; the shorthand half is what stops a longhand
 * wiping out the shorthand declared above it.
 */
function chain(varName, uptoIndex, dflt) {
  const family = [varName, ...(SHORTHAND_FALLBACK[varName] ?? [])];
  // Innermost first: the widest fallback is the LAST thing tried, so build the
  // expression from the inside out.
  // BUILD ORDER IS THE WHOLE CORRECTNESS ARGUMENT, and getting it backwards
  // is silent. var() tries its own property first and the fallback second, so
  // whatever ends up OUTERMOST is tried FIRST. That means:
  //
  //   breakpoints ASCEND (initial wrapped first, so `md` ends outermost and is
  //     tried before `initial`). Built descending, `initial` ended up outermost
  //     and won at every width — which hid the nav rail at 1024px and up,
  //     because display={{ initial: "none", md: "block" }} resolved to "none"
  //     forever. layout:verify caught it; nothing else could have.
  //
  //   the shorthand family runs WIDEST-FIRST within each breakpoint, so the
  //     property's own var ends outermost and beats the shorthand it belongs
  //     to (pt before py before p).
  let expr = dflt;
  for (let i = 0; i <= uptoIndex; i++) {
    for (let f = family.length - 1; f >= 0; f--) {
      expr = `var(--i-${family[f]}-${keys[i]}, ${expr})`;
    }
  }
  return expr;
}

const out = [];
out.push(`/* GENERATED by scripts/generate-design-css.mjs — do not edit.
   Edit lib/ds/scales.ts (scale positions) or the component blocks in the
   generator itself, then re-run \`npm run design:css\`.

   INSTRUMENT design system. See docs/design/INSTRUMENT.md. */\n`);

/* ---- base ------------------------------------------------------------- */
out.push(`/* === BASE =========================================================== */
*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: var(--text-3);
  line-height: var(--lh-3);
  font-weight: var(--weight-regular);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* One focus treatment, product-wide. :focus-visible only, so a mouse click
   does not ring the control, but every keyboard path does. Never removed —
   if a control looks wrong with a ring, the ring moves to the right element,
   it does not get switched off. */
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--radius);
}

::selection { background: var(--signal-soft); color: var(--ink); }
`);

/* ---- responsive layout layer ------------------------------------------ */
out.push(`\n/* === LAYOUT PROPS ===================================================
   Each property reads a custom property the primitive writes on the element.
   The media queries below re-declare every property with the descending
   fallback chain, so a value set at one breakpoint inherits upward until
   another replaces it. */\n`);

const layoutSelector = ".i-box, .i-flex, .i-grid";

/* ── THE INHERITANCE RESET ────────────────────────────────────────────────
   CSS CUSTOM PROPERTIES INHERIT. That one fact nearly sank this whole
   approach, and the bug it produced is worth recording because it is
   invisible in code review and obvious on screen:

     <Stack>                     writes --i-fd-initial: column
       <Flex gap="2">…</Flex>    inherits it, and lays out as a COLUMN

   Every layout prop leaked into every descendant. A Stack made its nested
   rows vertical; a padded Box padded its grandchildren; a Grid's column count
   applied to nested grids that never asked for one. Found by rendering the
   specimen sheet and looking at it — the type-checker cannot see this, and
   neither can a unit test that does not compute style.

   The fix is to reset every custom property this system reads, at every
   element that reads them, so inheritance stops at each layout boundary. The
   CSS-wide keyword `initial` on a custom property makes it
   "guaranteed-invalid", which is precisely what we want: `var(--x, fallback)`
   then takes the fallback rather than the ancestor's value. A primitive that
   was passed a real value writes it as an INLINE style, which outranks this
   stylesheet rule, so the reset never fights an intentional value.

   Yes, this is props x breakpoints declarations in one rule. It is generated,
   it gzips to almost nothing, and the alternative is a system where layout
   silently depends on how deeply a component happens to be nested. */
out.push(`${layoutSelector} {`);
for (const p of LAYOUT_PROPS) {
  for (const k of keys) {
    out.push(`  --i-${p.varName}-${k}: initial;`);
  }
}
out.push(`}\n`);

out.push(`${layoutSelector} {`);
for (const p of LAYOUT_PROPS) {
  out.push(`  ${p.css}: ${chain(p.varName, 0, p.dflt)};`);
}
out.push(`}\n`);

for (let bi = 1; bi < BREAKPOINTS.length; bi++) {
  out.push(`@media (min-width: ${BREAKPOINTS[bi].min}px) {`);
  out.push(`  ${layoutSelector} {`);
  for (const p of LAYOUT_PROPS) {
    out.push(`    ${p.css}: ${chain(p.varName, bi, p.dflt)};`);
  }
  out.push(`  }`);
  out.push(`}\n`);
}

/* NO `display` DEFAULT RULE HERE, deliberately.
   An earlier version emitted `.i-flex { display: flex }` after the property
   block, which meant an explicit display prop on a Flex — the app shell's
   `display={{ initial: "none", md: "flex" }}` header, for one — lost to it at
   every breakpoint. Instead Box/Flex/Grid each WRITE their own
   `--i-d-initial` unless the call site passed `display`, so the default and
   the override travel through the same custom property and the later simply
   replaces the earlier. See components/ds/layout.tsx.

   There is likewise no `.i-flex > * { min-width: 0 }` rule: min-width's
   default in the chain above is already "0" for every primitive, which
   achieves the same thing without a descendant selector that would have
   outranked a child's own explicit minWidth prop. */

/* ---- type -------------------------------------------------------------- */
out.push(`\n/* === TYPE =========================================================== */`);
out.push(`.i-text { margin: 0; font-family: var(--font-body); }`);
// .i-figure MUST come after .i-text. Figure renders class="i-text i-figure",
// both rules are a single class (identical specificity), so source order is
// what decides the family — and with .i-figure emitted up in the base layer
// every figure in the product silently rendered in Inter instead of the mono
// face, tabular-nums and all. Caught by measuring computed style on the
// specimen sheet, which is exactly why that sheet exists.
out.push(`
/* Every figure in this product is money or decimal hours read down a column,
   and proportional digits make those columns ragged. Applied by the Figure
   component rather than left to ~40 screens to remember a utility class. */
.i-figure {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
/* Alias for the ~252 call sites still spelling out className="tnum" from
   the pre-INSTRUMENT system rather than the <Figure> primitive (0 app call
   sites use Figure yet — stage 6 migrates these). Deleted once that
   migration lands; until then this is the difference between every money
   and hours figure in the product rendering in tabular mono digits or
   silently falling back to proportional Inter. Kept byte-identical to
   .i-figure on purpose — it is the same rule under the old name. */
.tnum {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}`);
out.push(`.i-heading {
  margin: 0;
  font-family: var(--font-display);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  color: var(--ink);
}`);
TEXT_SIZE.forEach((s) => {
  out.push(`.i-t${s} { font-size: var(--text-${s}); line-height: var(--lh-${s}); }`);
});
out.push(`
/* The small uppercase label: column heads, eyebrows, group headers. Caps at
   11px set solid are unreadable, hence the tracking. */
.i-caps {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: var(--track-caps);
  font-weight: var(--weight-semibold);
  font-size: var(--text-1);
  line-height: var(--lh-1);
  color: var(--ink-3);
}
.i-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.i-w-regular  { font-weight: var(--weight-regular); }
.i-w-medium   { font-weight: var(--weight-medium); }
.i-w-semibold { font-weight: var(--weight-semibold); }
.i-w-bold     { font-weight: var(--weight-bold); }
`);

/* Tone → colour. Written from the TONE list so a new tone cannot be added to
   the type without also getting a rule. */
const TONE_COLOR = {
  default: "var(--ink)",
  muted: "var(--ink-2)",
  faint: "var(--ink-3)",
  signal: "var(--signal)",
  ok: "var(--ok)",
  caution: "var(--caution)",
  warn: "var(--warn)",
};
for (const t of TONE) {
  if (!TONE_COLOR[t]) throw new Error(`generate-design-css: no colour mapped for tone "${t}"`);
  out.push(`.i-tone-${t} { color: ${TONE_COLOR[t]}; }`);
}

/* ---- link -------------------------------------------------------------- */
out.push(`
/* === LINK =========================================================== */
.i-link {
  color: var(--signal);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  border-radius: var(--radius);
}
.i-link:hover { text-decoration-thickness: 2px; }
.i-link-plain { color: inherit; text-decoration: none; }
`);

/* ---- panel ------------------------------------------------------------- */
out.push(`
/* === PANEL ==========================================================
   The product's surface. Bordered, never shadowed: on a canvas, a hairline
   is structure and a drop shadow is decoration. --shadow-overlay exists for
   things in the top layer and is not reachable from here. */
.i-panel {
  background: var(--paper);
  border: var(--hairline) solid var(--edge);
  border-radius: var(--radius);
}
.i-panel-flush { padding: 0; }
.i-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-block-end: var(--hairline) solid var(--hair);
}
.i-panel-body { padding: var(--space-4); }
`);

/* ---- button ------------------------------------------------------------ */
out.push(`
/* === BUTTON =========================================================
   Primary is INK, not accent. Accent (--signal) is reserved for live state —
   links, focus, the current section — and stops meaning anything if it is
   also every submit button on the screen. */
.i-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-family: var(--font-display);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-normal);
  border-radius: var(--radius);
  border: var(--hairline) solid transparent;
  cursor: pointer;
  white-space: nowrap;
  text-decoration: none;
  transition: background-color var(--dur-fast) var(--ease),
              border-color var(--dur-fast) var(--ease),
              color var(--dur-fast) var(--ease);
}
.i-btn:disabled, .i-btn[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.5;
}`);
const CONTROL_PAD = { 1: "var(--space-2)", 2: "var(--space-3)", 3: "var(--space-4)" };
const CONTROL_TEXT = { 1: "var(--text-1)", 2: "var(--text-2)", 3: "var(--text-3)" };
for (const s of CONTROL_SIZE) {
  out.push(
    `.i-btn-${s} { height: var(--control-${s}); padding-inline: ${CONTROL_PAD[s]}; font-size: ${CONTROL_TEXT[s]}; }`
  );
}
out.push(`
.i-btn-primary { background: var(--btn-primary-bg); color: var(--btn-primary-ink); }
.i-btn-primary:hover:not(:disabled) { background: var(--btn-primary-bg-hover); }

.i-btn-outline { background: var(--paper); color: var(--ink); border-color: var(--edge); }
.i-btn-outline:hover:not(:disabled) { background: var(--sunk); }

.i-btn-quiet { background: transparent; color: var(--ink-2); }
.i-btn-quiet:hover:not(:disabled) { background: var(--sunk); color: var(--ink); }

/* Destructive. Outline rather than a solid red block: a delete button that is
   a wall of red reads as an error state on the page, and the confirmation
   dialog is what actually guards the action. */
.i-btn-danger { background: var(--paper); color: var(--warn); border-color: var(--warn-edge); }
.i-btn-danger:hover:not(:disabled) { background: var(--warn-soft); }
`);

/* ---- field ------------------------------------------------------------- */
out.push(`
/* === FIELD ==========================================================
   Inputs, textareas and the native select share one skin so a form never
   looks assembled from two families. */
.i-field {
  width: 100%;
  background: var(--paper);
  color: var(--ink);
  border: var(--hairline) solid var(--edge);
  border-radius: var(--radius);
  font-family: var(--font-body);
  transition: border-color var(--dur-fast) var(--ease);
}
.i-field::placeholder { color: var(--ink-3); }
.i-field:hover:not(:disabled) { border-color: var(--ink-3); }
.i-field:disabled { background: var(--sunk); color: var(--ink-3); cursor: not-allowed; }
.i-field[aria-invalid="true"] { border-color: var(--warn); }`);
for (const s of CONTROL_SIZE) {
  out.push(
    `.i-field-${s} { min-height: var(--control-${s}); padding: 0 var(--space-3); font-size: ${CONTROL_TEXT[s]}; }`
  );
}
out.push(`
/* A textarea has no single-line height to centre against, so it opts out of
   the control-height rule and pads symmetrically instead. */
textarea.i-field { padding: var(--space-2) var(--space-3); line-height: var(--lh-3); resize: vertical; }

/* The native select keeps its own disclosure arrow on every platform; the
   padding just makes room for it. Native is deliberate — on a phone this
   opens the OS picker, which is the better interaction one-handed. */
select.i-field { padding-inline-end: var(--space-6); cursor: pointer; }

.i-label {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-2);
  line-height: var(--lh-2);
  font-weight: var(--weight-medium);
  color: var(--ink-2);
  margin-block-end: var(--space-1);
}
.i-hint  { font-size: var(--text-1); line-height: var(--lh-1); color: var(--ink-3); margin-block-start: var(--space-1); }
.i-error { font-size: var(--text-1); line-height: var(--lh-1); color: var(--warn); margin-block-start: var(--space-1); }

/* Native checkbox and switch, sized from the token scale and tinted with
   accent-color so the platform draws the check. */
.i-check { width: 16px; height: 16px; accent-color: var(--signal); cursor: pointer; flex: none; }
`);

/* ---- badge / note ------------------------------------------------------ */
out.push(`
/* === BADGE ==========================================================
   Outline, never a filled pill. A table of solid status pills is a table you
   read the pills of instead of the data. */
.i-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--font-display);
  font-size: var(--text-1);
  line-height: var(--lh-1);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: var(--track-caps);
  padding: 2px var(--space-2);
  border-radius: var(--radius);
  border: var(--hairline) solid currentColor;
  white-space: nowrap;
}
.i-badge-default { color: var(--ink-2); }
.i-badge-muted   { color: var(--ink-2); }
.i-badge-faint   { color: var(--ink-3); }
.i-badge-signal  { color: var(--signal); background: var(--signal-soft); }
.i-badge-ok      { color: var(--ok);      background: var(--ok-soft); }
.i-badge-caution { color: var(--caution); background: var(--caution-soft); }
.i-badge-warn    { color: var(--warn);    background: var(--warn-soft); }

/* === NOTE ===========================================================
   The callout. A left rule carries the tone rather than a full tinted block,
   so a screen with three notes on it is still readable. */
.i-note {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--edge);
  border-inline-start: var(--rule) solid var(--ink-3);
  border-radius: var(--radius);
  background: var(--paper);
  font-size: var(--text-2);
  line-height: var(--lh-2);
  color: var(--ink-2);
}
.i-note-signal  { border-inline-start-color: var(--signal);  background: var(--signal-soft);  border-color: var(--signal-edge); color: var(--ink); }
.i-note-ok      { border-inline-start-color: var(--ok);      background: var(--ok-soft);      border-color: var(--ok-edge);     color: var(--ink); }
.i-note-caution { border-inline-start-color: var(--caution); background: var(--caution-soft); border-color: var(--caution-edge);color: var(--ink); }
.i-note-warn    { border-inline-start-color: var(--warn);    background: var(--warn-soft);    border-color: var(--warn-edge);   color: var(--ink); }
`);

/* ---- table ------------------------------------------------------------- */
out.push(`
/* === TABLE ==========================================================
   The scroll container is part of the component, not something a call site
   remembers to add. docs/RESPONSIVE-CONTRACT.md rule 1 is that the PAGE never
   scrolls sideways — wide content scrolls inside its own frame — and making
   that a property of the table is what keeps 40-odd call sites from each
   having to get it right. */
.i-table-scroll {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  -webkit-overflow-scrolling: touch;
  min-width: 0;
  max-width: 100%;
}
.i-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-2);
  line-height: var(--lh-2);
}
.i-table th {
  text-align: start;
  font-family: var(--font-display);
  font-size: var(--text-1);
  line-height: var(--lh-1);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: var(--track-caps);
  color: var(--ink-3);
  background: var(--sunk);
  padding: var(--space-2) var(--space-3);
  border-block-end: var(--hairline) solid var(--edge);
  white-space: nowrap;
}
.i-table td {
  padding: var(--space-2) var(--space-3);
  border-block-end: var(--hairline) solid var(--hair);
  height: var(--row-height);
  color: var(--ink);
  vertical-align: middle;
  /* CELLS DO NOT WRAP BY DEFAULT, and the scroll container above is why.
     With width:100% and wrapping cells, a twelve-column table shrinks to
     fit its frame and reflows every cell onto two or three lines — the
     scroller never engages, and a money column becomes unreadable at exactly
     the width where reading it matters. Caught on the specimen sheet, where
     the panel claimed "scrolls inside its own frame" while the table beside
     it was visibly wrapping instead.

     Nowrap makes the table take its natural width and hand the overflow to
     .i-table-scroll, which is the intended arrangement. A cell that genuinely
     holds prose rather than a value opts back in with the wrap prop, which
     is the rarer case and should be the one that says so. */
  white-space: nowrap;
}
/* The opt-out, for a cell holding a note or a description rather than a
   value. Paired with a sensible max so one long note cannot set the whole
   table's width. */
.i-table td.i-cell-wrap {
  white-space: normal;
  min-width: 22ch;
  max-width: 44ch;
}
.i-table tbody tr:last-child td { border-block-end: none; }
.i-table tbody tr[data-selected="true"] td { background: var(--selected); }
/* Totals sit under a 2px rule — the one place the heavier rule is used in a
   table, so it reads as "this line is different in kind". */
.i-table tfoot td { border-block-start: var(--rule) solid var(--ink); font-weight: var(--weight-semibold); }
.i-num { text-align: end; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
`);

/* ---- dialog ------------------------------------------------------------ */
out.push(`
/* === DIALOG =========================================================
   Native <dialog> + showModal(). Focus trapping, the inert background, the
   top layer and Esc-to-close are platform behaviour — a hand-rolled
   div-with-a-backdrop reimplements four things the browser already does
   correctly, and typically gets two of them wrong. */
.i-dialog {
  padding: 0;
  border: var(--hairline) solid var(--edge);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink);
  box-shadow: var(--shadow-overlay);
  max-width: min(92vw, 480px);
  width: 100%;
}
.i-dialog::backdrop { background: var(--scrim); }
.i-dialog-head { padding: var(--space-4) var(--space-4) 0; }
.i-dialog-body { padding: var(--space-3) var(--space-4); color: var(--ink-2); font-size: var(--text-2); line-height: var(--lh-3); }
.i-dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4) var(--space-4);
}
`);

/* ---- tabs / separator / spinner ---------------------------------------- */
out.push(`
/* === TABS ===========================================================
   The active tab carries a 2px rule, and the inactive ones carry a
   transparent one of the same width, so switching tabs never moves the
   layout by two pixels. */
.i-tabs {
  display: flex;
  gap: var(--space-4);
  border-block-end: var(--hairline) solid var(--hair);
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
.i-tab {
  appearance: none;
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-display);
  font-size: var(--text-2);
  line-height: var(--lh-2);
  font-weight: var(--weight-medium);
  color: var(--ink-3);
  padding: var(--space-2) 0;
  border-block-end: var(--rule) solid transparent;
  margin-block-end: calc(var(--hairline) * -1);
}
.i-tab:hover { color: var(--ink); }
.i-tab[aria-selected="true"] { color: var(--ink); border-block-end-color: var(--ink); }

/* === SEPARATOR ====================================================== */
.i-sep { border: none; background: var(--hair); }
.i-sep-h { height: var(--hairline); width: 100%; margin: 0; }
.i-sep-v { width: var(--hairline); align-self: stretch; margin: 0; }

/* === SPINNER ======================================================== */
.i-spinner {
  display: inline-block;
  border: 2px solid var(--hair);
  border-top-color: var(--ink-2);
  border-radius: var(--radius-full);
  animation: i-spin 700ms linear infinite;
}
@keyframes i-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  /* Still animate — a spinner that does not move is a broken spinner, and
     the criterion targets large/parallax motion, not a 16px progress
     indicator. Slowed so it is not a distraction. */
  .i-spinner { animation-duration: 2s; }
}

/* === VISUALLY HIDDEN ================================================
   Available to screen readers, invisible on screen, and — unlike
   display:none — still focusable, which skip links depend on. */
.i-vh {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`);

const css = out.join("\n") + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    console.error("design:css --check FAILED — app/design/system.generated.css does not exist. Run `npm run design:css`.");
    process.exit(1);
  }
  if (current !== css) {
    console.error(
      "design:css --check FAILED — app/design/system.generated.css is stale.\n" +
        "lib/ds/scales.ts or the generator changed without the stylesheet being regenerated.\n" +
        "Run `npm run design:css` and commit the result."
    );
    process.exit(1);
  }
  console.log("design:css --check passed — generated stylesheet is current.");
  process.exit(0);
}

writeFileSync(OUT, css);
console.log(
  `design:css — wrote app/design/system.generated.css ` +
    `(${LAYOUT_PROPS.length} layout props x ${BREAKPOINTS.length} breakpoints, ${css.length} bytes)`
);
