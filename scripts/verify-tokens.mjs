#!/usr/bin/env node
/**
 * Keeps components from reaching around Radix Themes.
 *
 * The product's entire visual system is the <Theme> element in
 * app/layout.tsx — six props — plus one small defaults file,
 * components/ui/index.tsx, that sets component-level defaults (Card's
 * variant, TextField/Select's size, etc.). No token file, no theme
 * object, no component stylesheet. That arrangement is only true for as long as no
 * component hardcodes a value the theme cannot reach, and this script is
 * what makes that mechanical rather than a matter of discipline.
 *
 * WHY THAT MATTERS MORE HERE THAN IT DID BEFORE. Under a hand-built token
 * layer, a stray hex was a value in the wrong file — annoying, findable,
 * fixable by moving it. Under Radix Themes there is nowhere to move it to:
 * a literal in a component is simply outside the system, and no
 * re-theming will ever reach it. The look has already been decided three
 * times in this codebase and drifted each time; the drift was never a
 * decision, it was accumulated literals.
 *
 * Scans app/, components/ and lib/ for:
 *   - hex colours at any valid length (3/4/6/8 digit)
 *   - rgb()/rgba()/hsl()/hsla(), and oklch()/oklab()/lab()/lch()/hwb()/
 *     color-mix()/color()
 *   - bare named CSS colours on colour-bearing properties (a heuristic,
 *     not the full 150-name list)
 *   - non-zero border-radius, any font-family, non-token box-shadow and
 *     backdrop-filter — matched across the whole file so a value wrapped
 *     onto its own line cannot hide from a per-line scanner
 *   - JSX inline `style={{...}}` objects, flagged outright. Radix Themes
 *     components take props for this, and an inline object is exactly
 *     where camelCase borderRadius/fontFamily/fontSize hide from any
 *     CSS-shaped regex
 *   - `@mui/*` and `@emotion/*` imports, which this rebuild removed
 *   - the literal brand strings "V1" / "AMG" outside lib/brand.ts
 *   - `@radix-ui/themes` imports outside components/ui/index.tsx, the one
 *     place component defaults may be set (styles.css is exempted)
 *
 * The four files allowed to spell a value out are listed at EXEMPT_FILES
 * below, each with the reason it earns the exemption. That exemption is
 * scoped to the VALUE rules only (hex/color-function/named-color/radius/
 * font-family/box-shadow/backdrop-filter/inline-style-literal) — it does
 * NOT extend to the import-ban rules (@mui/@emotion, @radix-ui/themes).
 * See the note above EXEMPT_FILES for why that distinction matters.
 *
 * REWRITE NOTE, retained because it is still the reason several of these
 * patterns look the way they do: an adversarial review of the first
 * version found it caught almost nothing beyond bare same-line hex —
 * inline style objects, every modern colour function, named colours,
 * 4-digit hex, and any declaration whose value wrapped onto a second line
 * all passed silently, and lib/ was never scanned despite being listed.
 * The current patterns were built by probing the old script empirically,
 * not by reading it. Probe any new rule the same way; see the note above
 * the border-radius rule for a lookahead that reads correct and is not.
 *
 * Line and block comments are stripped before scanning, so this file's own
 * prose about hex codes and brand strings does not trip the checks. That
 * is a textual heuristic, not a parser — a `//` inside a string literal
 * can be mis-stripped, a tradeoff that favours fewer false positives.
 *
 * Run: npm run tokens:verify
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib"];

/**
 * THERE IS NO LONGER A TOKEN LAYER TO PROTECT, and that is the point.
 *
 * Radix Themes owns every colour, radius, shadow and space step, and it is
 * configured entirely by the <Theme> props in app/layout.tsx. So this
 * script's job changed: it used to keep a hand-built token file
 * authoritative, and it now keeps components from reaching AROUND the
 * theme. A hex in a component is no longer "a value in the wrong file" —
 * it is a value the theme cannot reach at all, which is worse, because no
 * amount of re-theming will ever move it.
 *
 * Only five files may spell a visual value out:
 *
 *   app/globals.css     the V1 mark's brand-identity constants. The
 *                       wordmark is literal black and the bug literal
 *                       #036BFC on every ground; wiring them to the accent
 *                       would let a future accent change retint trademark
 *                       artwork.
 *   lib/brand.ts        the two theme-color literals, which Next's
 *                       metadata layer cannot read from CSS.
 *   lib/pdf-palette.ts  the bridge to the invoice PDF. @react-pdf/renderer
 *                       has its own styling engine and cannot read CSS, so
 *                       it reaches the same Radix scales through
 *                       @radix-ui/colors instead. Read that file's header
 *                       before adding anything to it.
 *   lib/invoice-pdf.tsx the PDF document itself. Same reason, one step
 *                       further: react-pdf's StyleSheet.create() is not
 *                       CSS and not a JSX style prop — it cannot take a
 *                       var() reference at all, so `fontSize: 10` is the
 *                       only thing that can be written there. Its COLOURS
 *                       still come from pdf-palette, which is the part
 *                       that actually matters; sizes and weights are
 *                       necessarily literal in a PDF.
 *   lib/pilot-history-pdf.tsx
 *                       the second react-pdf document — the pilot-history
 *                       report an airman hands to an underwriter or a
 *                       chief pilot. Identical reasoning to
 *                       lib/invoice-pdf.tsx, and it is LISTED rather than
 *                       the exemption being widened to a `lib/*-pdf.tsx`
 *                       glob: a pattern would silently exempt the next
 *                       file somebody happens to name that way, which is
 *                       exactly the drift this list exists to keep
 *                       deliberate. Its colours come from pdf-palette
 *                       too; only StyleSheet.create()'s sizes and weights
 *                       need the exemption.
 */
const EXEMPT_FILES = new Set([
  join(ROOT, "app", "globals.css"),
  join(ROOT, "lib", "brand.ts"),
  join(ROOT, "lib", "pdf-palette.ts"),
  join(ROOT, "lib", "invoice-pdf.tsx"),
  join(ROOT, "lib", "pilot-history-pdf.tsx"),
]);
const EXEMPT_DIRS = [];

// EXEMPT_FILES/isExempt() below governs the VALUE rules only (category
// "value" on RULES) — hex, color functions, named colors, radius,
// font-family, box-shadow, backdrop-filter, inline-style literals. It
// must NEVER be consulted for the import-ban rules (category
// "import-ban": @mui/@emotion, @radix-ui/themes) — isExempt() used to be
// checked before ANY rule ran, which meant app/globals.css, lib/brand.ts,
// lib/pdf-palette.ts and lib/invoice-pdf.tsx were silently exempt from
// the @radix-ui/themes import ban too. lib/invoice-pdf.tsx is a real
// .tsx component file — the one place in the exemption list a Radix
// component could actually be imported directly with no signal anywhere
// that it happened. scanFile() below now applies EXEMPT_FILES only to
// rules whose category is "value"; import-ban rules run on every scanned
// file regardless of EXEMPT_FILES, with only the narrower, explicit
// RADIX_THEMES_IMPORT_EXEMPT_FILE carve-out below.
//
// Verified by temporarily adding `import { Card } from "@radix-ui/themes";`
// to lib/invoice-pdf.tsx and confirming `node scripts/verify-tokens.mjs`
// failed on it, then reverting.

// The one file allowed — required, in fact — to import "@radix-ui/themes"
// directly. It is not folded into EXEMPT_FILES above because that set
// means "may spell a visual value out", a different and narrower promise
// than "may import the raw package"; components/ui/index.tsx should
// still be scanned by every other rule.
const RADIX_THEMES_IMPORT_EXEMPT_FILE = join(
  ROOT,
  "components",
  "ui",
  "index.tsx"
);

/*
 * ---------------------------------------------------------------------------
 * THE SLOT-ORIGIN RULES (category "slot-origin"), added with Phase 9's
 * per-tenant appearance.
 *
 * Everything above this point polices values a DEVELOPER writes. A tenant
 * theme adds a second, sharper problem: a visual value that arrives at
 * render time, from a database row, and therefore from outside every rule
 * above — none of which can see a string that is not in the source.
 *
 * The answer is not to police the value (there is nothing to grep) but to
 * police the ORIGIN. lib/theme-slots.ts enumerates every overridable
 * visual value as a closed list of Radix accent / scaling / appearance
 * names, and resolves an untrusted blob against it with a total function.
 * If that file is the only place such a value can come from, and the only
 * places it can be APPLIED are the two files that render a resolved slot,
 * then no other file in the product can inject one — which is the same
 * guarantee the rules above give for hardcoded values, extended to values
 * that do not exist until runtime.
 *
 * Two constructions carry that risk and both are banned outside their one
 * permitted home:
 *
 *   runtime-css-var     `var(--${x})` — a custom property NAME assembled
 *                       at runtime. This is the construction that turns an
 *                       arbitrary string into a token reference, and it is
 *                       how a free-text colour would eventually be smuggled
 *                       into a style. Only lib/theme-slots.ts may write it
 *                       (today it does not need to: each slot's preview
 *                       token is written out per slot, which is stricter
 *                       still — the rule guards the next author, not this
 *                       one).
 *   dynamic-theme-prop  a <Theme> prop whose value is a JSX expression
 *                       rather than a literal. Everywhere except the app
 *                       shell and the appearance panel's live preview, a
 *                       Theme prop must be a literal — so app/layout.tsx's
 *                       six documented defaults, and the two nested
 *                       appearance="dark" islands, stay exactly as they
 *                       are, and no third file can start theming anything
 *                       from data.
 *
 * NOTE WHAT IS NOT DONE HERE. lib/theme-slots.ts is deliberately NOT added
 * to EXEMPT_FILES. The hex ban must keep applying to it above all — "a
 * curated palette of Radix accent names, never a free hex" is the promise
 * that file exists to make, and exempting it from the hex rule would be
 * exempting it from its own contract. It needs no value exemption anyway:
 * its swatches are var() references to Radix's own scales, not colours.
 * ---------------------------------------------------------------------------
 */
const SLOT_ORIGIN_FILE = join(ROOT, "lib", "theme-slots.ts");
const THEME_APPLIER_FILES = new Set([
  // The app shell: one nested <Theme> carrying the tenant's resolved slots.
  //
  // This used to be app/(app)/layout.tsx, and it MOVED. The shell's markup
  // was extracted to app-shell.tsx so it could be rendered without a
  // session and measured across a viewport matrix by
  // scripts/layout-verify.mjs. layout.tsx is now the session read alone and
  // applies no <Theme> at all, so it is deliberately NOT listed here: this
  // allow-list has to name the file that actually applies the slots, or it
  // stops meaning anything. If the shell moves again, move this entry with
  // it rather than adding a second one.
  join(ROOT, "app", "(app)", "app-shell.tsx"),
  // The appearance panel's preview card, which shows a pilot the accent
  // they are about to save before they save it. Same values, same
  // enumerated source, one screen.
  join(ROOT, "app", "(app)", "settings", "appearance-panel.tsx"),
]);
// .js/.jsx included alongside .ts/.tsx/.css: Next.js compiles .jsx and
// .js in app/ exactly the same as .tsx, so an import or a hardcoded
// value written in one of those files would otherwise be invisible to
// this scanner. Only app/, components/ and lib/ are scanned (SCAN_DIRS
// above) and walk() already skips node_modules and .next, so widening
// the extension set does not risk scanning build output or dependencies
// — there is no .js/.jsx under those three directories today.
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

function isExempt(file) {
  if (EXEMPT_FILES.has(file)) return true;
  return EXEMPT_DIRS.some((dir) => file.startsWith(dir + "/"));
}

const NAMED_COLOR_ALLOWLIST = new Set([
  "inherit", "currentcolor", "transparent", "initial", "unset", "none", "inset",
]);

/**
 * Each rule: { id, category, name, pattern, appliesTo: 'css' | 'code' | 'both' }.
 * `id` is the stable key scanFile() uses to special-case a rule (e.g. the
 * components/ui/index.tsx import carve-out below) — NEVER `name`. `name`
 * is prose meant to read well in the failure output and is expected to
 * change; keying behaviour off it means editing an error message for
 * clarity silently changes which file is exempt from what. `category` is
 * "value" (governed by EXEMPT_FILES) or "import-ban" (never governed by
 * EXEMPT_FILES — see the note above EXEMPT_FILES for why).
 * Patterns run against the WHOLE file (not per line) with the `g` flag so
 * a value split across lines is still caught, and every match is
 * reported (matchAll), not just the first per pattern.
 */
const RULES = [
  {
    id: "hex-color",
    category: "value",
    name: "hardcoded hex color",
    appliesTo: "both",
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    id: "color-function",
    category: "value",
    name: "hardcoded color function (rgb/hsl/oklch/lab/color-mix/...)",
    appliesTo: "both",
    pattern: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix|color)\s*\(/g,
  },
  {
    id: "named-color",
    category: "value",
    name: "bare named color on a color-bearing CSS property",
    appliesTo: "both",
    pattern:
      /\b(?:color|background-color|border-color|fill|stroke)\s*:\s*([a-zA-Z]+)\s*;/g,
    filter: (match) => !NAMED_COLOR_ALLOWLIST.has(match[1].toLowerCase()),
  },
  /*
   * A NOTE ON THE SHAPE OF THE FOUR RULES BELOW.
   *
   * Each means "this property must resolve through a token", so each needs
   * a negative lookahead for `var(`. The obvious spelling —
   *
   *     /border-radius\s*:\s*(?!var\()[^;]*;/
   *
   * — is broken, and shipped broken in the previous version of this file.
   * `\s*` is greedy but it BACKTRACKS: when the lookahead fails at the
   * position after the space, the engine retries with `\s*` matching zero
   * characters, which slides the lookahead onto the SPACE rather than onto
   * `var`, where `(?!var\()` trivially succeeds. The guard then guards
   * nothing, and `border-radius: var(--v1-radius);` — the correct form —
   * is reported as a violation.
   *
   * The fix is to pull the whitespace inside the lookahead, leaving no
   * separate quantifier to backtrack over:
   *
   *     /border-radius\s*:(?!\s*var\()[^;]*;/
   *
   * Found by probing this script against a file of known-good and
   * known-bad declarations, not by reading it. Probe any future rule of
   * this shape the same way — the failure is invisible on inspection.
   */
  {
    id: "border-radius",
    category: "value",
    name: "non-token border-radius",
    appliesTo: "css",
    // [^;]* rather than [^\n;]* so a value wrapped onto its own line is
    // still matched: a negated character class matches newlines.
    pattern: /border-radius\s*:(?!\s*(?:0\b|var\())[^;]*;/g,
  },
  {
    id: "font-family",
    category: "value",
    name: "font-family outside the token file",
    appliesTo: "css",
    pattern: /font-family\s*:(?!\s*var\()[^;]*;/g,
  },
  {
    // New under V1 Design. The previous direction had zero elevation and
    // zero blur, so there was nothing to police — any shadow at all was
    // already caught as a hex or rgba() literal. This system has both, and
    // they are the two values most likely to be quietly duplicated. "A
    // surface may take exactly one shadow" and "keep the two radii and do
    // not add a third" are only enforceable if every shadow and blur
    // resolves through the token layer.
    id: "box-shadow",
    category: "value",
    name: "non-token box-shadow (must resolve through a Radix --shadow-* var)",
    appliesTo: "css",
    // The var() lookahead spans the whole declaration rather than just its
    // head: a legitimate shadow is often two tokens composed —
    // `var(--v1-shadow-1), var(--v1-shadow-inset)` — so requiring var()
    // immediately after the colon would reject the system's own idiom.
    pattern: /box-shadow\s*:(?!\s*none\b)(?![^;]*var\()[^;]*;/g,
  },
  {
    id: "backdrop-filter",
    category: "value",
    name: "non-token backdrop-filter",
    appliesTo: "css",
    pattern: /backdrop-filter\s*:(?!\s*(?:none\b|var\())[^;]*;/g,
  },
  {
    // Inline style objects are NOT banned outright under Radix Themes, and
    // the previous blanket ban would have been wrong here. Radix exposes
    // its scales as CSS custom properties and deliberately does not give
    // every surface a prop, so `style={{ borderRight: "1px solid
    // var(--gray-a5)" }}` is the library's own idiom for the cases Box and
    // Flex don't cover. Banning it would push people toward worse
    // workarounds.
    //
    // What is still banned is a camelCase visual property carrying a
    // LITERAL — `borderRadius: 6`, `fontFamily: "Inter"` — because those
    // are JS object keys that no CSS-syntax regex will ever see, which is
    // exactly where hardcoded values hide. Requiring var() on this short
    // list keeps the escape hatch open and the theme authoritative.
    // THE WHITESPACE IS INSIDE THE LOOKAHEAD, and it has to be — this rule
    // shipped broken for exactly as long as it took to run it once. Written
    // as `\s*:\s*(?!["'`]?\s*var\()`, the trailing `\s*` is greedy and
    // BACKTRACKS: when the lookahead correctly fails against `"var(`, the
    // engine retries with `\s*` matching zero characters, which slides the
    // lookahead onto the SPACE, where `var\(` cannot match and the negative
    // lookahead trivially succeeds. Every correct `borderRadius:
    // "var(--radius-2)"` was reported as a violation.
    //
    // This is the second rule in this file to hit that trap; the note above
    // the border-radius rule describes the first. Both were found by
    // running the script, not by reading it. Probe the next one too.
    id: "inline-style-literal",
    category: "value",
    name: "camelCase style property with a literal value (must use var(--…))",
    appliesTo: "code",
    pattern:
      /\b(?:borderRadius|fontFamily|fontSize|fontWeight|letterSpacing|boxShadow|lineHeight)\s*:(?!\s*["'`]?\s*var\()/g,
  },
  {
    // THE RULE THAT KEEPS THIS REBUILD FROM UNDOING ITSELF.
    //
    // MUI and emotion were removed wholesale, along with the ported
    // Material Dashboard theme. The failure mode is not someone deciding
    // to bring MUI back — it is one import sneaking in for one component
    // that Radix Themes does not happen to have, and then a second, until
    // two design systems are live at once and neither can be restyled.
    // Radix Themes plus the unstyled Radix primitives underneath it cover
    // this product; anything genuinely missing gets built, not imported.
    // MATCH THE SPECIFIER, NOT THE `from` KEYWORD. Anchoring on `from`
    // caught `import X from "@mui/material"` and nothing else — a review
    // probe found three working ways past it:
    //
    //     import "@emotion/css";              // side-effect import
    //     require("@emotion/styled");         // CJS
    //     await import("@mui/icons-material") // dynamic
    //
    // all of which reintroduce the removed system with a green
    // tokens:verify. A quoted module specifier is the thing that is
    // actually forbidden, so that is what this looks for, in any syntax
    // that can carry one.
    id: "mui-emotion-import",
    category: "import-ban",
    name: "@mui or @emotion import (this product is on Radix Themes)",
    appliesTo: "code",
    pattern: /["']@(?:mui|emotion)\/[^"']+["']/g,
  },
  {
    id: "brand-string",
    category: "value",
    name: 'literal brand string ("V1" / "AMG") outside lib/brand.ts',
    appliesTo: "code",
    pattern: /\b(V1|AMG)\b/g,
  },
  {
    // THE RULE THAT KEEPS THE DEFAULTS LAYER FROM BEING BYPASSED.
    //
    // components/ui/index.tsx is the ONLY place a component default may live
    // (variant, size, colour, weight — see its header). If a call site can
    // still import a component straight from "@radix-ui/themes", it can
    // silently skip every default that file sets, and the product splits
    // into two looks with no signal anywhere that it happened.
    //
    // MATCH THE SPECIFIER, NOT THE `from` KEYWORD — the @mui/@emotion rule
    // above already learned this lesson: anchoring on `from` misses
    // `import "@radix-ui/themes/styles.css"` (side-effect, no `from`),
    // `require("@radix-ui/themes")` (CJS), and `await import("@radix-ui/
    // themes")` (dynamic). All three are checked by the quoted specifier
    // instead, exactly like the @mui/@emotion rule.
    //
    // BACKTICKS COUNT. `import(`@radix-ui/themes`)` is legal and the first
    // version of this rule, which allowed only " and ', sailed straight
    // past it — while the comment above claimed to cover all three import
    // forms. That is precisely the "reads correct and is not" failure the
    // header records three times, so the delimiter class carries ` too.
    //
    // ONE DELIBERATE CARVE-OUT: "@radix-ui/themes/styles.css" must still
    // be importable — app/layout.tsx needs Radix's stylesheet, and that
    // import carries no components to bypass the defaults with. The
    // pattern excludes only that one path via a negative lookahead sat
    // right after the package name, with the whitespace-inside-lookahead
    // discipline the two notes above this list both call out — there is
    // no separate quantifier here to backtrack over, so the exclusion
    // cannot slide the way theirs originally did.
    //
    // components/ui/index.tsx itself is exempt below
    // (RADIX_THEMES_IMPORT_EXEMPT_FILE, keyed off `id` — see the note
    // above the RULES array) — it is the one file allowed, in fact
    // required, to import the raw package.
    id: "radix-themes-import",
    category: "import-ban",
    name: '"@radix-ui/themes" import outside components/ui/index.tsx',
    appliesTo: "code",
    pattern: /["'`]@radix-ui\/themes(?!\/styles\.css["'`])(?:\/[^"'`]*)?["'`]/g,
  },
  {
    // See the long note above SLOT_ORIGIN_FILE. Matches `var(--${x})` and
    // `var(${x})` in either quoting style, and — like every rule here —
    // runs against the whole file so a wrapped expression cannot hide.
    // The `[^)\n]*` stops at the closing paren so a legitimate
    // `var(--gray-2)` followed later on the same line by an unrelated
    // template literal is not swept up.
    id: "runtime-css-var",
    category: "slot-origin",
    name: "CSS custom property assembled at runtime (only lib/theme-slots.ts may originate one)",
    appliesTo: "code",
    pattern: /var\(\s*(?:--)?[^)\n]*\$\{/g,
  },
  {
    // A JSX-expression value on one of the theme-configuring <Theme>
    // props, or a spread onto <Theme>. A literal (`appearance="dark"`,
    // `accentColor="indigo"`) is untouched — the rule is about a value
    // the theme layer did not choose, not about the props themselves.
    //
    // ANCHORED ON `<Theme`, and it has to be. The first version of this
    // rule matched the prop name alone and immediately fired on
    // `<SettingsTabs appearance={<AppearancePanel …/>} />` — a prop that
    // happens to share a name with a Theme prop and carries a React node,
    // not a colour. `[^>]*?` cannot cross the `>` that closes the opening
    // tag, so the prop must genuinely belong to that Theme element;
    // newlines are inside the negated class, so a multi-line <Theme …>
    // is still matched. Probed both ways after changing it (a real
    // <Theme appearance={x}> in a non-permitted file fails; the
    // SettingsTabs prop passes).
    id: "dynamic-theme-prop",
    category: "slot-origin",
    name: "<Theme> prop with a runtime value (only the app shell and the appearance preview may apply one)",
    appliesTo: "code",
    pattern:
      /<Theme\b[^>]*?(?:\b(?:accentColor|grayColor|panelBackground|scaling|appearance)\s*=\s*\{|\{\s*\.\.\.)/g,
  },
];

/** @type {{file: string, line: number, rule: string, snippet: string}[]} */
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full);
    } else if (SCAN_EXTENSIONS.has(extname(full))) {
      scanFile(full);
    }
  }
}

function stripComments(content, ext) {
  let out = content.replace(/\/\*[\s\S]*?\*\//g, "");
  if (ext !== ".css") {
    out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  return out;
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function scanFile(file) {
  // isExempt() (EXEMPT_FILES) is consulted per-RULE below, not up front,
  // and only for category "value" rules. Short-circuiting the whole file
  // here — the original bug — would silently exempt app/globals.css,
  // lib/brand.ts, lib/pdf-palette.ts and lib/invoice-pdf.tsx from the
  // import-ban rules too, with lib/invoice-pdf.tsx (a real .tsx
  // component file) the one place that actually matters: it is the one
  // file in EXEMPT_FILES a raw `@radix-ui/themes` import could land in
  // with no signal anywhere that it happened.
  const fileIsValueExempt = isExempt(file);
  const ext = extname(file);
  const raw = readFileSync(file, "utf8");
  const content = stripComments(raw, ext);
  const kind = ext === ".css" ? "css" : "code";

  for (const rule of RULES) {
    if (rule.appliesTo !== "both" && rule.appliesTo !== kind) continue;
    if (rule.category === "value" && fileIsValueExempt) continue;
    if (
      rule.id === "radix-themes-import" &&
      file === RADIX_THEMES_IMPORT_EXEMPT_FILE
    ) {
      continue;
    }
    // The slot-origin carve-outs, keyed off `id` for the same reason the
    // one above is (see the note over RULES): an error message is prose
    // and is expected to change; behaviour must not move with it. These
    // are deliberately NOT folded into EXEMPT_FILES — that set means "may
    // spell a visual value out", and lib/theme-slots.ts specifically must
    // NOT be allowed to.
    if (rule.id === "runtime-css-var" && file === SLOT_ORIGIN_FILE) continue;
    if (
      rule.id === "dynamic-theme-prop" &&
      (file === SLOT_ORIGIN_FILE || THEME_APPLIER_FILES.has(file))
    ) {
      continue;
    }
    for (const match of content.matchAll(rule.pattern)) {
      if (rule.filter && !rule.filter(match)) continue;
      const line = lineNumberAt(content, match.index);
      // Show the actual matched text, not just the line it starts on —
      // for a multi-line match (e.g. a border-radius value wrapped onto
      // its own line) the starting line alone can be uninformative on
      // its own ("border-radius:" with no value visible).
      const snippetSource = match[0].replace(/\s+/g, " ").trim();
      violations.push({
        file: relative(ROOT, file),
        line,
        rule: rule.name,
        snippet:
          snippetSource.length > 160
            ? snippetSource.slice(0, 160) + "…"
            : snippetSource,
      });
    }
  }
}

for (const dir of SCAN_DIRS) {
  const full = join(ROOT, dir);
  try {
    statSync(full);
    walk(full);
  } catch {
    // directory doesn't exist yet — nothing to scan
  }
}

if (violations.length > 0) {
  console.error(`\ntokens:verify FAILED — ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
    console.error(`    ${v.snippet}\n`);
  }
  console.error(
    "Radix Themes owns every visual value in this product. Reach for it instead of\n" +
      "spelling a value out:\n\n" +
      "  colour, size, weight   a Radix component prop — <Text color=\"gray\" size=\"2\">,\n" +
      "                         <Badge color=\"amber\">, <Flex gap=\"3\">\n" +
      "  something with no prop  style={{ ... var(--gray-a5) ... }} — Radix's own idiom.\n" +
      "                         The scales are CSS custom properties; use them by name.\n" +
      "  the whole product's look  the six <Theme> props in app/layout.tsx plus\n" +
      "                         components/ui/index.tsx's component defaults. That is\n" +
      "                         the entire design system; there is no token file to edit.\n\n" +
      "Only app/globals.css, lib/brand.ts, lib/pdf-palette.ts and lib/invoice-pdf.tsx may\n" +
      "spell a value out, and each documents why at the top of the file.\n\n" +
      "A per-tenant visual value (accent, density, light/dark) is a different rule:\n" +
      "  it must ORIGINATE in lib/theme-slots.ts, which enumerates every one of them\n" +
      "  and resolves an untrusted stored value against that list. A <Theme> prop may\n" +
      "  only take a runtime value in the app shell (app/(app)/app-shell.tsx) and the\n" +
      "  appearance panel's preview; a var(--...) name may only be assembled at\n" +
      "  runtime in lib/theme-slots.ts. Add the slot to that file, don't inject the\n" +
      "  value here.\n"
  );
  process.exit(1);
}

console.log(
  `tokens:verify passed — no visual values hardcoded outside the ${EXEMPT_FILES.size} documented files.`
);
