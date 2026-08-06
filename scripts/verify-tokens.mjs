#!/usr/bin/env node
/**
 * Keeps components from reaching around Radix Themes.
 *
 * The product's entire visual system is the <Theme> element in
 * app/layout.tsx — five props, no token file, no theme object, no
 * component stylesheet. That arrangement is only true for as long as no
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
 *
 * The three files allowed to spell a value out are listed at EXEMPT_FILES
 * below, each with the reason it earns the exemption.
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
 * Only three files may spell a visual value out:
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
 */
const EXEMPT_FILES = new Set([
  join(ROOT, "app", "globals.css"),
  join(ROOT, "lib", "brand.ts"),
  join(ROOT, "lib", "pdf-palette.ts"),
  join(ROOT, "lib", "invoice-pdf.tsx"),
]);
const EXEMPT_DIRS = [];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

function isExempt(file) {
  if (EXEMPT_FILES.has(file)) return true;
  return EXEMPT_DIRS.some((dir) => file.startsWith(dir + "/"));
}

const NAMED_COLOR_ALLOWLIST = new Set([
  "inherit", "currentcolor", "transparent", "initial", "unset", "none", "inset",
]);

/**
 * Each rule: { name, pattern, appliesTo: 'css' | 'code' | 'both' }.
 * Patterns run against the WHOLE file (not per line) with the `g` flag so
 * a value split across lines is still caught, and every match is
 * reported (matchAll), not just the first per pattern.
 */
const RULES = [
  {
    name: "hardcoded hex color",
    appliesTo: "both",
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    name: "hardcoded color function (rgb/hsl/oklch/lab/color-mix/...)",
    appliesTo: "both",
    pattern: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix|color)\s*\(/g,
  },
  {
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
    name: "non-token border-radius",
    appliesTo: "css",
    // [^;]* rather than [^\n;]* so a value wrapped onto its own line is
    // still matched: a negated character class matches newlines.
    pattern: /border-radius\s*:(?!\s*(?:0\b|var\())[^;]*;/g,
  },
  {
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
    name: "non-token box-shadow (must resolve through a Radix --shadow-* var)",
    appliesTo: "css",
    // The var() lookahead spans the whole declaration rather than just its
    // head: a legitimate shadow is often two tokens composed —
    // `var(--v1-shadow-1), var(--v1-shadow-inset)` — so requiring var()
    // immediately after the colon would reject the system's own idiom.
    pattern: /box-shadow\s*:(?!\s*none\b)(?![^;]*var\()[^;]*;/g,
  },
  {
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
    name: "@mui or @emotion import (this product is on Radix Themes)",
    appliesTo: "code",
    pattern: /["']@(?:mui|emotion)\/[^"']+["']/g,
  },
  {
    name: 'literal brand string ("V1" / "AMG") outside lib/brand.ts',
    appliesTo: "code",
    pattern: /\b(V1|AMG)\b/g,
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
  if (isExempt(file)) return;
  const ext = extname(file);
  const raw = readFileSync(file, "utf8");
  const content = stripComments(raw, ext);
  const kind = ext === ".css" ? "css" : "code";

  for (const rule of RULES) {
    if (rule.appliesTo !== "both" && rule.appliesTo !== kind) continue;
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
      "  the whole product's look  the five <Theme> props in app/layout.tsx. That is the\n" +
      "                         entire design system; there is no token file to edit.\n\n" +
      "Only app/globals.css, lib/brand.ts, lib/pdf-palette.ts and lib/invoice-pdf.tsx may\n" +
      "spell a value out, and each documents why at the top of the file.\n"
  );
  process.exit(1);
}

console.log(
  "tokens:verify passed — no visual values hardcoded outside the four documented files."
);
