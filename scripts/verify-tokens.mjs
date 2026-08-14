#!/usr/bin/env node
/**
 * Keeps components from reaching around INSTRUMENT — see docs/design/INSTRUMENT.md.
 *
 * The product's entire visual system is `app/design/tokens.css` (every colour,
 * space step, size, radius, weight and duration in the product) plus the
 * generated component stylesheet `app/design/system.generated.css`
 * (`scripts/generate-design-css.mjs`). No CSS-in-JS runtime, no arbitrary
 * `style={{ color: "#hex" }}`. That arrangement is only true for as long as no
 * file hardcodes a value the token layer cannot reach, or spells a class name
 * the generator never emitted — and this script is what makes both mechanical
 * rather than a matter of discipline.
 *
 * WHY THAT MATTERS. Under a hand-built token layer, a stray hex is a value in
 * the wrong file — annoying, findable, fixable by moving it. A `var(--gray-a5)`
 * reference to a name NOTHING declares is worse: it type-checks, it builds, it
 * renders — as nothing, silently, because an undefined custom property simply
 * resolves to the property's initial value. That is exactly how the Radix
 * Themes removal shipped ~40 dead token references across app/ (the nav rail's
 * current-section marker, the skip link, the marketing header, the onboarding
 * wizard's step circles — all rendering with no colour and no signal that
 * anything was wrong). Every rule below that bans a hardcoded value would have
 * passed every one of those lines; only a rule that checks a referenced name
 * against the set of names that actually exist catches this class of bug, so
 * that is what the EXISTENCE rules at the bottom of this file do. This is
 * `docs/design/INSTRUMENT.md`'s stage 5 ("`tokens:verify` rewritten to enforce
 * INSTRUMENT") — the previous version of this script still described and
 * enforced Radix Themes, the system stage 4 removed.
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
 *   - JSX inline `style={{...}}` objects: a camelCase visual property
 *     (borderRadius, fontFamily, ...) carrying a literal rather than a
 *     var(--...) reference. Plain `style={{ borderRight: "1px solid
 *     var(--edge)" }}` is INSTRUMENT's own idiom for the cases Box/Flex
 *     don't cover and is not banned outright.
 *   - `@mui/*` and `@emotion/*` imports — never part of this product
 *   - the literal brand strings "V1" / "AMG" outside lib/brand.ts
 *   - `@radix-ui/themes` imports anywhere. The package is uninstalled
 *     (stage 4); this rule is a regression fence, not a live constraint —
 *     see the "radix-themes-import" rule's own comment below.
 *   - EXISTENCE: any `var(--x)` whose name nothing declares, and any
 *     className/cx() literal in INSTRUMENT's own naming families
 *     (`i-*`, `v1-*`, `tnum`) that names a class the generated stylesheet
 *     does not define. See "THE EXISTENCE RULES" below.
 *
 * The files allowed to spell a value out are listed at EXEMPT_FILES below,
 * each with the reason it earns the exemption. That exemption is scoped to
 * the VALUE rules only (hex/color-function/named-color/radius/font-family/
 * box-shadow/backdrop-filter/inline-style-literal) — it does NOT extend to
 * the import-ban rules or the existence rules. See the note above
 * EXEMPT_FILES for why that distinction matters.
 *
 * REWRITE NOTE, retained because it is still the reason several of these
 * patterns look the way they do: an adversarial review of an early version
 * of this script found it caught almost nothing beyond bare same-line hex —
 * inline style objects, every modern colour function, named colours,
 * 4-digit hex, and any declaration whose value wrapped onto a second line
 * all passed silently, and lib/ was never scanned despite being listed.
 * The current patterns were built by probing the script empirically, not by
 * reading it. Probe any new rule the same way; see the note above the
 * border-radius rule for a lookahead that reads correct and is not.
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
 * Only seven files may spell a visual value out:
 *
 *   app/design/tokens.css  THE token layer. Every colour, length, weight and
 *                       duration in the product is declared here and nowhere
 *                       else — the entire premise of INSTRUMENT — so it is
 *                       exempt for the same reason a dictionary is exempt
 *                       from a spell-checker. That exemption is what makes
 *                       the rule enforceable everywhere ELSE: there is now a
 *                       correct place to put a value, so "move it to
 *                       tokens.css" is always an available answer.
 *                       app/design/system.generated.css is deliberately NOT
 *                       listed — it is generated entirely from tokens and
 *                       var() references and passes the value rules as they
 *                       stand, which is a useful check that the generator is
 *                       not inventing values. It IS scanned by the existence
 *                       rules below, same as every other file.
 *   lib/ds/props.ts    The responsive prop engine assembles custom-property
 *                       NAMES at runtime (`--i-${stem}-${breakpoint}`). That
 *                       is the mechanism, not a leak: the stems come from
 *                       lib/ds/scales.ts, which the CSS generator reads too,
 *                       so a name with no rule behind it cannot exist, and no
 *                       VALUE is ever assembled here.
 *   app/globals.css    The V1 mark's brand-identity constants and the
 *                       signed-out surface's navy panel — aliases onto
 *                       app/design/tokens.css's own --brand-* values (see
 *                       that file's header) plus the handful of `.v1-*`
 *                       classes those two surfaces still use directly.
 *   lib/brand.ts        the two theme-color literals, which Next's
 *                       metadata layer cannot read from CSS.
 *   lib/pdf-palette.ts  the bridge to the invoice PDF. @react-pdf/renderer
 *                       has its own styling engine and cannot read CSS, so
 *                       it reaches the same palette through
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
  join(ROOT, "app", "design", "tokens.css"),
  join(ROOT, "lib", "ds", "props.ts"),
  join(ROOT, "app", "globals.css"),
  join(ROOT, "lib", "brand.ts"),
  join(ROOT, "lib", "pdf-palette.ts"),
  join(ROOT, "lib", "invoice-pdf.tsx"),
  join(ROOT, "lib", "pilot-history-pdf.tsx"),
  join(ROOT, "lib", "estimate-pdf.tsx"),
  join(ROOT, "lib", "reimbursables-packet-pdf.tsx"),
]);
const EXEMPT_DIRS = [];

// EXEMPT_FILES/isExempt() below governs the VALUE rules only (category
// "value" on RULES) — hex, color functions, named colors, radius,
// font-family, box-shadow, backdrop-filter, inline-style literals. It
// must NEVER be consulted for the import-ban rules (category
// "import-ban") or the existence rules (category "existence") — isExempt()
// used to be checked before ANY rule ran, which meant app/globals.css,
// lib/brand.ts, lib/pdf-palette.ts and lib/invoice-pdf.tsx were silently
// exempt from the @radix-ui/themes import ban too. lib/invoice-pdf.tsx is a
// real .tsx component file — the one place in the exemption list a Radix
// component could actually be imported directly with no signal anywhere
// that it happened. scanFile() below now applies EXEMPT_FILES only to
// rules whose category is "value"; import-ban and existence rules run on
// every scanned file regardless of EXEMPT_FILES, with only the narrower,
// explicit carve-outs named where each rule is defined.
//
// Verified by temporarily adding `import { Card } from "@radix-ui/themes";`
// to lib/invoice-pdf.tsx and confirming `node scripts/verify-tokens.mjs`
// failed on it, then reverting.

// @radix-ui/themes is uninstalled (docs/design/INSTRUMENT.md stage 4) — no
// file in this product needs to import it any more, including
// components/ui/index.tsx, which used to be the one file required to
// (Radix Themes owned every component default; now components/ui/index.tsx
// is a plain seam over components/ds and imports nothing from the removed
// package). So the "radix-themes-import" rule below carries no exemption —
// there used to be one, keyed to components/ui/index.tsx, and it is gone
// on purpose rather than merely unused: if a future migration genuinely
// needs a carve-out again, that is a decision to make deliberately when it
// happens, not a dead allow-list left lying around for something to fall
// into unnoticed.

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
 * visual value as a closed list (accent / density / appearance names) and
 * resolves an untrusted blob against it with a total function. If that
 * file is the only place such a value can come from, and the only places
 * it can be APPLIED are the two files that render a resolved slot, then no
 * other file in the product can inject one — which is the same guarantee
 * the rules above give for hardcoded values, extended to values that do
 * not exist until runtime.
 *
 * Two constructions carry that risk and both are banned outside their one
 * permitted home:
 *
 *   runtime-css-var     `var(--${x})` — a custom property NAME assembled
 *                       at runtime. This is the construction that turns an
 *                       arbitrary string into a token reference, and it is
 *                       how a free-text colour would eventually be smuggled
 *                       into a style. Only lib/theme-slots.ts may write it
 *                       (today it does not need to: each slot's swatch
 *                       token is written out per slot, which is stricter
 *                       still — the rule guards the next author, not this
 *                       one).
 *   dynamic-theme-prop  a data-appearance/data-accent/data-density value
 *                       (or object spread) applied from a JSX expression.
 *                       Everywhere except the app shell and the appearance
 *                       panel's live preview, a tenant theme attribute must
 *                       come from a literal, so no third file can start
 *                       theming anything from data.
 *
 * NOTE WHAT IS NOT DONE HERE. lib/theme-slots.ts is deliberately NOT added
 * to EXEMPT_FILES. The hex ban must keep applying to it above all — "a
 * curated palette of enumerated slots, never a free hex" is the promise
 * that file exists to make, and exempting it from the hex rule would be
 * exempting it from its own contract. It needs no value exemption anyway:
 * its swatches are var() references to the token layer's own scales, not
 * colours.
 * ---------------------------------------------------------------------------
 */
const SLOT_ORIGIN_FILE = join(ROOT, "lib", "theme-slots.ts");
const DS_PROPS_FILE = join(ROOT, "lib", "ds", "props.ts");
const THEME_APPLIER_FILES = new Set([
  // The app shell: stamps the tenant's resolved slots as data attributes.
  //
  // This used to be app/(app)/layout.tsx, and it MOVED. The shell's markup
  // was extracted to app-shell.tsx so it could be rendered without a
  // session and measured across a viewport matrix by
  // scripts/layout-verify.mjs. layout.tsx is now the session read alone and
  // applies no theme attributes at all, so it is deliberately NOT listed
  // here: this allow-list has to name the file that actually applies the
  // slots, or it stops meaning anything. If the shell moves again, move
  // this entry with it rather than adding a second one.
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
 * "value" (governed by EXEMPT_FILES), "import-ban" or "slot-origin"
 * (never governed by EXEMPT_FILES — see the note above EXEMPT_FILES for
 * why). Patterns run against the WHOLE file (not per line) with the `g`
 * flag so a value split across lines is still caught, and every match is
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
   * — is broken. `\s*` is greedy but it BACKTRACKS: when the lookahead
   * fails at the position after the space, the engine retries with `\s*`
   * matching zero characters, which slides the lookahead onto the SPACE
   * rather than onto `var`, where `(?!var\()` trivially succeeds. The guard
   * then guards nothing, and `border-radius: var(--radius);` — the correct
   * form — is reported as a violation.
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
    // The system has both real elevation and real blur (one token of
    // each — --shadow-overlay, used only by things that genuinely float in
    // the top layer). "A surface may take exactly one shadow" and "do not
    // add a second" are only enforceable if every shadow resolves through
    // the token layer.
    id: "box-shadow",
    category: "value",
    name: "non-token box-shadow (must resolve through a --shadow-* var)",
    appliesTo: "css",
    // The var() lookahead spans the whole declaration rather than just its
    // head: a legitimate shadow is often two tokens composed —
    // `var(--shadow-overlay), var(--shadow-inset)` — so requiring var()
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
    // Inline style objects are NOT banned outright. The token layer is
    // reached through CSS custom properties, and the primitives
    // deliberately do not give every surface a prop for every declaration,
    // so `style={{ borderRight: "1px solid var(--edge)" }}` is
    // INSTRUMENT's own idiom for the cases Box and Flex don't cover.
    // Banning it outright would push people toward worse workarounds.
    //
    // What is still banned is a camelCase visual property carrying a
    // LITERAL — `borderRadius: 6`, `fontFamily: "Inter"` — because those
    // are JS object keys that no CSS-syntax regex will ever see, which is
    // exactly where hardcoded values hide. Requiring var() on this short
    // list keeps the escape hatch open and the token layer authoritative.
    // THE WHITESPACE IS INSIDE THE LOOKAHEAD, and it has to be. Written
    // as `\s*:\s*(?!["'`]?\s*var\()`, the trailing `\s*` is greedy and
    // BACKTRACKS: when the lookahead correctly fails against `"var(`, the
    // engine retries with `\s*` matching zero characters, which slides the
    // lookahead onto the SPACE, where `var\(` cannot match and the negative
    // lookahead trivially succeeds. Every correct `borderRadius:
    // "var(--radius)"` was reported as a violation.
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
    // Material Dashboard theme they came with, well before INSTRUMENT. The
    // failure mode is not someone deciding to bring MUI back wholesale — it
    // is one import sneaking in for one component the token layer does not
    // happen to cover, and then a second, until two design systems are live
    // at once and neither can be restyled. MATCH THE SPECIFIER, NOT THE
    // `from` KEYWORD. Anchoring on `from` caught `import X from
    // "@mui/material"` and nothing else — a review probe found three
    // working ways past it:
    //
    //     import "@emotion/css";              // side-effect import
    //     require("@emotion/styled");         // CJS
    //     await import("@mui/icons-material") // dynamic
    //
    // all of which reintroduce a removed system with a green
    // tokens:verify. A quoted module specifier is the thing that is
    // actually forbidden, so that is what this looks for, in any syntax
    // that can carry one.
    id: "mui-emotion-import",
    category: "import-ban",
    name: "@mui or @emotion import (this product has no CSS-in-JS runtime)",
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
    // A REGRESSION FENCE, NOT A LIVE CONSTRAINT. @radix-ui/themes is
    // uninstalled (docs/design/INSTRUMENT.md stage 4) — no file in the
    // product imports it, so this rule currently matches nothing, and that
    // is the point: it stays in place so an import cannot come back one
    // component at a time inside a screen that seems, on its own, like an
    // easy place to reach for a familiar library. No exemption, deliberately
    // — components/ui/index.tsx used to carry one for the package's own
    // styles.css, which nothing imports any more (verified: no
    // "@radix-ui/themes/styles.css" specifier anywhere in app/, components/
    // or lib/ at the time this rule was rewritten). A future migration that
    // genuinely needs one should add it back as a conscious decision, not
    // find it already there and unused.
    //
    // MATCH THE SPECIFIER, NOT THE `from` KEYWORD — the @mui/@emotion rule
    // above already learned this lesson: anchoring on `from` misses
    // `import "@radix-ui/themes/styles.css"` (side-effect, no `from`),
    // `require("@radix-ui/themes")` (CJS), and `await import("@radix-ui/
    // themes")` (dynamic). All three are checked by the quoted specifier
    // instead, exactly like the @mui/@emotion rule.
    //
    // BACKTICKS COUNT. `import(`@radix-ui/themes`)` is legal and an early
    // version of this rule, which allowed only " and ', sailed straight
    // past it. That is precisely the "reads correct and is not" failure
    // the header records more than once, so the delimiter class carries `
    // too.
    id: "radix-themes-import",
    category: "import-ban",
    name: '"@radix-ui/themes" import (the package is uninstalled)',
    appliesTo: "code",
    pattern: /["'`]@radix-ui\/themes(?:\/[^"'`]*)?["'`]/g,
  },
  {
    // See the long note above SLOT_ORIGIN_FILE. Matches `var(--${x})` and
    // `var(${x})` in either quoting style, and — like every rule here —
    // runs against the whole file so a wrapped expression cannot hide.
    // The `[^)\n]*` stops at the closing paren so a legitimate
    // `var(--canvas)` followed later on the same line by an unrelated
    // template literal is not swept up.
    id: "runtime-css-var",
    category: "slot-origin",
    name: "CSS custom property assembled at runtime (only lib/theme-slots.ts may originate one)",
    appliesTo: "code",
    pattern: /var\(\s*(?:--)?[^)\n]*\$\{/g,
  },
  {
    // A JSX-expression value on one of the tenant theme attributes
    // (data-appearance / data-accent / data-density), or a spread that
    // could carry one. A literal (`data-appearance="dark"`) is untouched —
    // the rule is about a value the token layer did not choose, not about
    // the attributes themselves.
    id: "dynamic-theme-prop",
    category: "slot-origin",
    name: "tenant theme attribute (data-appearance/data-accent/data-density) set from a runtime value outside the app shell or the appearance preview",
    appliesTo: "code",
    pattern:
      /\bdata-(?:appearance|accent|density)\s*=\s*\{(?!["'`][^{}]*["'`]\s*\})/g,
  },
];

/*
 * ---------------------------------------------------------------------------
 * THE EXISTENCE RULES (category "existence").
 *
 * Everything above polices a value written where it should not be. Neither
 * rule above catches the opposite failure: a reference to something that is
 * spelled correctly, looks like a token, and names NOTHING. `var(--gray-a5)`
 * is not a literal — it is the system's own vocabulary, one release out of
 * date — so no hex/color-function/named-color rule fires, it type-checks,
 * it builds, and it renders as no colour at all with no error anywhere.
 * That is how ~40 dead references shipped in the Radix Themes removal:
 * the nav rail's current-section marker, the skip link, the marketing
 * header's ground and hairline, the onboarding wizard's step circles, and
 * the accent picker's swatches all pointed at custom properties nothing
 * declares.
 *
 * The fix is not a new pattern to ban — it is a set of names to check
 * against, built once at start-up:
 *
 *   DECLARED_TOKEN_NAMES  every `--name` app/design/tokens.css and
 *                        app/globals.css declare, plus the three
 *                        --font-archivo/--font-inter/--font-mono-face
 *                        names lib/fonts.ts's next/font loaders create
 *                        (they are never declared with a CSS `:` — the
 *                        font loader writes them). A name starting `i-`
 *                        is always accepted without being enumerated: the
 *                        responsive prop engine assembles
 *                        `--i-<stem>-<breakpoint>` at RUNTIME from
 *                        lib/ds/scales.ts (see the runtime-css-var note
 *                        above and lib/ds/props.ts), so no static list of
 *                        them can be complete, and `npm run design:css
 *                        --check` is what keeps that family internally
 *                        consistent — this script's job is the STATIC
 *                        vocabulary, not the generated one.
 *   DECLARED_CLASS_NAMES  every class app/design/system.generated.css and
 *                        app/globals.css actually define. Checked against
 *                        only the two class FAMILIES this product ever
 *                        hand-writes as a literal string — `i-*` (every
 *                        INSTRUMENT component class) and `v1-*` plus the
 *                        one bare exception `tnum` (the signed-out
 *                        surface's own small vocabulary, app/globals.css).
 *                        A `className="tnum"` on 252 money and hours
 *                        figures across ~44 screens was exactly this
 *                        failure: the class read as real, typechecked,
 *                        rendered, and matched no rule in the generated
 *                        stylesheet at all.
 *
 * Both checks are textual, like every rule above: a className or cx()
 * argument that is a template literal WITH interpolation
 * (`` className={`i-tab ${x}`} ``) or a bare expression is not evaluated —
 * this scans literal strings only, which is where the actual defect
 * shipped and remains the common case in this codebase (verified empty
 * for the interpolated form at the time this rule was written). A single
 * false negative there is a smaller risk than a parser here.
 * ---------------------------------------------------------------------------
 */

function collectDeclaredTokenNames() {
  const names = new Set();
  const tokensCss = readFileSync(join(ROOT, "app", "design", "tokens.css"), "utf8");
  const globalsCss = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  for (const css of [tokensCss, globalsCss]) {
    for (const m of css.matchAll(/--([a-zA-Z][\w-]*)\s*:/g)) names.add(m[1]);
  }
  const fontsSrc = readFileSync(join(ROOT, "lib", "fonts.ts"), "utf8");
  for (const m of fontsSrc.matchAll(/variable:\s*"(--[a-zA-Z][\w-]*)"/g)) {
    names.add(m[1].slice(2));
  }
  return names;
}

function collectDeclaredClassNames() {
  const classes = new Set();
  // Read directly off disk rather than importing the generator: this
  // script has to work whether or not `npm run design:css` has just run,
  // and re-running the generator here would make a verify step have a
  // build-time side effect. `npm run tokens:verify` is documented (see
  // package.json) to run after `design:css`, same as this file's own
  // header instructs.
  const genCss = readFileSync(
    join(ROOT, "app", "design", "system.generated.css"),
    "utf8"
  );
  const globalsCss = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  for (const css of [genCss, globalsCss]) {
    for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(m[1]);
  }
  return classes;
}

const DECLARED_TOKEN_NAMES = collectDeclaredTokenNames();
const DECLARED_CLASS_NAMES = collectDeclaredClassNames();

function isDeclaredTokenName(name) {
  // The responsive prop engine's own runtime namespace — see the long
  // comment above this section for why it is a prefix check rather than
  // an enumerated list.
  if (name.startsWith("i-")) return true;
  return DECLARED_TOKEN_NAMES.has(name);
}

/** Only these two families are ever hand-written as a literal class string
 *  in this product; anything else (a one-off `"flex-1"`-style utility, if
 *  one ever appeared) is not this rule's concern. */
function isCheckedClassToken(token) {
  return token.startsWith("i-") || token.startsWith("v1-") || token === "tnum";
}

function checkTokenExistence(file, content, relFile) {
  for (const m of content.matchAll(/var\(\s*(--[a-zA-Z][\w-]*)/g)) {
    const full = m[1];
    const after = content.slice(m.index + m[0].length, m.index + m[0].length + 2);
    // `var(--space-${value})` in lib/ds/props.ts: the regex above greedily
    // matches the static PREFIX of a runtime-assembled name up to where
    // the template interpolation starts. That construction is already
    // governed by the runtime-css-var slot-origin rule; checking a
    // deliberately-truncated prefix against the declared set here would
    // be a false positive on the one file allowed to build a name that
    // way, not a real dead reference.
    if (after === "${") continue;
    const name = full.slice(2);
    if (isDeclaredTokenName(name)) continue;
    violations.push({
      file: relFile,
      line: lineNumberAt(content, m.index),
      rule: "dead token reference (var(--…) names nothing tokens.css/globals.css declares)",
      snippet: full.replace(/\s+/g, " ").trim(),
    });
  }
}

const CLASS_ATTR_PATTERNS = [
  /className\s*=\s*"([^"]*)"/g,
  /className\s*=\s*'([^']*)'/g,
];

function checkClassExistence(file, content, relFile) {
  function reportToken(token, index, source) {
    if (!isCheckedClassToken(token)) return;
    if (DECLARED_CLASS_NAMES.has(token)) return;
    violations.push({
      file: relFile,
      line: lineNumberAt(content, index),
      rule: "dead class reference (className/cx() names a class the generated stylesheet does not define)",
      snippet: `${source}: "${token}"`,
    });
  }

  for (const pattern of CLASS_ATTR_PATTERNS) {
    for (const m of content.matchAll(pattern)) {
      for (const token of m[1].split(/\s+/).filter(Boolean)) {
        reportToken(token, m.index, "className");
      }
    }
  }

  // cx(...) calls: only its own bare quoted-string arguments, never a
  // template literal or an identifier — cx("i-btn", `i-btn-${variant}`,
  // className) is real call-site shape throughout components/ds, and the
  // interpolated/identifier arguments are exactly the ones this textual
  // check cannot and should not evaluate.
  for (const call of content.matchAll(/\bcx\(([^)]*)\)/g)) {
    const inner = call[1];
    const innerStart = call.index + call[0].indexOf(inner);
    for (const m of inner.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const value = m[1] ?? m[2] ?? "";
      for (const token of value.split(/\s+/).filter(Boolean)) {
        reportToken(token, innerStart + m.index, "cx()");
      }
    }
  }
}

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
  // here — an early bug in this script — would silently exempt
  // app/globals.css, lib/brand.ts, lib/pdf-palette.ts and
  // lib/invoice-pdf.tsx from the import-ban rules too, with
  // lib/invoice-pdf.tsx (a real .tsx component file) the one place that
  // actually matters. It would also exempt every EXEMPT_FILES entry from
  // the existence rules, which must apply everywhere: a value-exempt file
  // spelling a value out on purpose is a different thing from that same
  // file referencing a token that does not exist.
  const fileIsValueExempt = isExempt(file);
  const ext = extname(file);
  const raw = readFileSync(file, "utf8");
  const content = stripComments(raw, ext);
  const kind = ext === ".css" ? "css" : "code";
  const relFile = relative(ROOT, file);

  for (const rule of RULES) {
    if (rule.appliesTo !== "both" && rule.appliesTo !== kind) continue;
    if (rule.category === "value" && fileIsValueExempt) continue;
    // The slot-origin carve-outs, keyed off `id` for the same reason the
    // one above is (see the note over RULES): an error message is prose
    // and is expected to change; behaviour must not move with it. These
    // are deliberately NOT folded into EXEMPT_FILES — that set means "may
    // spell a visual value out", and lib/theme-slots.ts specifically must
    // NOT be allowed to.
    // lib/ds/props.ts is the INSTRUMENT responsive prop engine, and
    // assembling custom-property names at runtime is the whole mechanism —
    // `--i-${stem}-${breakpoint}`. It is not a leak of the kind this rule
    // guards against: the stems come from lib/ds/scales.ts, which the CSS
    // generator reads too, so a name with no rule behind it cannot exist, and
    // no VALUE is ever assembled — only the name of a property whose value
    // the stylesheet supplies. Listed alongside SLOT_ORIGIN_FILE rather than
    // widening the rule, so the carve-out stays two named files.
    if (
      rule.id === "runtime-css-var" &&
      (file === SLOT_ORIGIN_FILE || file === DS_PROPS_FILE)
    )
      continue;
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
        file: relFile,
        line,
        rule: rule.name,
        snippet:
          snippetSource.length > 160
            ? snippetSource.slice(0, 160) + "…"
            : snippetSource,
      });
    }
  }

  // THE EXISTENCE RULES. Never governed by EXEMPT_FILES (see the comment
  // above fileIsValueExempt) and not part of RULES above because each
  // needs the pre-built declared-name/declared-class sets rather than a
  // single self-contained pattern.
  //
  // Token existence runs on every scanned file, css or code — var()
  // appears in both plain stylesheets and inline JSX style objects. Class
  // existence only makes sense in code — a className/cx() literal is a
  // JSX/JS construction, and .css files declare classes rather than
  // reference them by that name.
  checkTokenExistence(file, content, relFile);
  if (kind === "code") {
    checkClassExistence(file, content, relFile);
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
    "app/design/tokens.css owns every visual value in this product, and\n" +
      "app/design/system.generated.css owns every component class. Reach for\n" +
      "them instead of spelling a value out or guessing a class name:\n\n" +
      "  colour, spacing, size    a component prop — <Text tone=\"muted\" size=\"2\">,\n" +
      "                           <Badge tone=\"warn\">, <Flex gap=\"3\">. Scale\n" +
      "                           POSITIONS, not CSS — lib/ds/props.ts's whole point\n" +
      "                           is that an out-of-scale value cannot compile.\n" +
      "  something with no prop   style={{ ... var(--edge) ... }} — the system's own\n" +
      "                           idiom. The scales are CSS custom properties in\n" +
      "                           app/design/tokens.css; use them by NAME, and check\n" +
      "                           that name is actually declared there — a plausible-\n" +
      "                           looking var(--gray-a5) that nothing declares passes\n" +
      "                           every rule above this one and renders as nothing.\n" +
      "  a class name              only app/design/system.generated.css (run `npm run\n" +
      "                           design:css` after editing scripts/generate-design-\n" +
      "                           css.mjs or lib/ds/scales.ts) and app/globals.css's\n" +
      "                           handful of `.v1-*` classes exist. If the class you\n" +
      "                           want is not in either, it does not exist yet — add\n" +
      "                           it to the generator, do not just reference it.\n" +
      "  the whole product's look  app/design/tokens.css, and nothing else. There is\n" +
      "                           no second place to override a value.\n\n" +
      `Only ${EXEMPT_FILES.size} files may spell a visual value out directly ` +
      "(see EXEMPT_FILES\nat the top of this script), and each documents why at the top of the file.\n\n" +
      "A per-tenant visual value (accent, density, light/dark) is a different rule:\n" +
      "  it must ORIGINATE in lib/theme-slots.ts, which enumerates every one of them\n" +
      "  and resolves an untrusted stored value against that list. A tenant theme\n" +
      "  attribute may only take a runtime value in the app shell\n" +
      "  (app/(app)/app-shell.tsx) and the appearance panel's preview; a var(--...)\n" +
      "  name may only be assembled at runtime in lib/theme-slots.ts. Add the slot\n" +
      "  to that file, don't inject the value here.\n"
  );
  process.exit(1);
}

console.log(
  `tokens:verify passed — no visual values hardcoded outside the ${EXEMPT_FILES.size} ` +
    `documented files, and every var()/className/cx() reference names something ` +
    `${join("app", "design", "tokens.css")} or ${join("app", "design", "system.generated.css")} actually declares.`
);
