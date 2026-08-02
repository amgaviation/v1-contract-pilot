#!/usr/bin/env node
/**
 * Design-overhaul insurance (docs/PLAN.md "Additional risk").
 *
 * Tony intends to overhaul this design later, and that only stays a
 * two-file change (app/tokens.css + lib/brand.ts) if no component ever
 * hardcodes a visual value. This script makes that mechanically
 * impossible to violate silently, rather than a matter of discipline.
 *
 * REWRITE NOTE: an adversarial code review of the first version of this
 * script found it caught almost nothing beyond bare same-line hex codes
 * — inline `style={{ borderRadius: 6 }}` objects, every modern CSS color
 * function (oklch, color-mix, lab, lch, hwb — notably Tailwind v4's OWN
 * default palette is oklch, so this was the format a developer was most
 * likely to paste), named CSS colors, 4-digit hex, every Tailwind
 * rounded-, font-[...], and color-utility class, and any declaration whose
 * value wrapped onto a second line all passed silently. `lib/` was never
 * scanned even though it was listed as exempt. This version was built by
 * empirically probing the old one and fixing every gap that probe found
 * — see the review this responded to for the full list.
 *
 * Scans app/, components/, and lib/ (excluding app/tokens.css and
 * lib/brand.ts, the two files everything is allowed to live in) for:
 *   - hex colors, at any valid length (3/4/6/8 digit)
 *   - rgb()/rgba()/hsl()/hsla() AND oklch()/oklab()/lab()/lch()/hwb()/
 *     color-mix()/color() — Tailwind v4's default palette is oklch
 *   - bare named CSS colors on color/background/border/fill/stroke
 *     properties (heuristic — not the full 150-name CSS list)
 *   - non-zero border-radius / any font-family declaration in a CSS file,
 *     matched across the whole file so a value wrapped onto its own line
 *     can't hide from a per-line scanner
 *   - JSX inline `style={{...}}` objects, flagged outright — there is no
 *     legitimate use of one in this design system, and it's exactly where
 *     camelCase borderRadius/fontFamily/fontWeight/fontSize hide from any
 *     CSS-syntax-shaped regex
 *   - Tailwind utility classes that hardcode a value instead of going
 *     through a token: rounded-*, font-[...], and bg-/text-/border-/
 *     ring-/fill-/stroke-/decoration-/from-/via-/to-/divide-/outline-/
 *     caret-/accent-/shadow- combined with a default-palette color name
 *     or an arbitrary `[...]` value
 *   - the literal brand strings "V1" / "AMG" outside lib/brand.ts
 *
 * Line comments and block comments are stripped before scanning, so this
 * file's own explanatory prose about hex codes and brand strings doesn't
 * trip the checks meant for actual rendered code. This is a textual
 * heuristic, not a parser — a `//` inside a string literal (e.g. a URL)
 * can be mis-stripped. Given this script's job is catching accidental
 * hardcoding, not verifying arbitrary code, that tradeoff favors fewer
 * false positives over perfect comment detection.
 *
 * Run: npm run tokens:verify
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib"];
const EXEMPT_FILES = new Set([
  join(ROOT, "app", "tokens.css"),
  join(ROOT, "lib", "brand.ts"),
]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

const TAILWIND_PALETTE_COLORS = [
  "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber",
  "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
  "indigo", "violet", "purple", "fuchsia", "pink", "rose", "white", "black",
].join("|");

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
  {
    name: "non-token border-radius",
    appliesTo: "css",
    // [\s\S]*? (not [^;]*) so a value wrapped onto its own line is still
    // matched — the bug that let a two-line border-radius declaration
    // pass the previous per-line scanner.
    pattern: /border-radius\s*:\s*(?!0\b)(?!var\()[\s\S]*?;/g,
  },
  {
    name: "font-family outside the token file",
    appliesTo: "css",
    pattern: /font-family\s*:\s*(?!var\()[\s\S]*?;/g,
  },
  {
    name: "inline style={{...}} object",
    appliesTo: "code",
    // No legitimate use in this design system — every visual value goes
    // through a `.v1-*` class. This is also the only reliable way to
    // catch camelCase JSX style props (borderRadius, fontFamily,
    // fontWeight, fontSize, ...), which no CSS-syntax regex will ever
    // match since they're JS object keys, not CSS declarations.
    pattern: /\bstyle\s*=\s*\{\s*\{/g,
  },
  {
    name: "hardcoded Tailwind radius utility",
    appliesTo: "code",
    pattern: /\brounded(?:-[\w[\]/.%#]+)?\b/g,
  },
  {
    name: "hardcoded Tailwind font utility",
    appliesTo: "code",
    pattern: /\bfont-\[[^\]]*\]/g,
  },
  {
    name: "hardcoded Tailwind color utility",
    appliesTo: "code",
    pattern: new RegExp(
      String.raw`\b(?:bg|text|border|ring|fill|stroke|decoration|from|via|to|divide|outline|caret|accent|shadow)-(?:\[[^\]]*\]|(?:${TAILWIND_PALETTE_COLORS})(?:-\d{2,3})?)\b`,
      "g"
    ),
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
  if (EXEMPT_FILES.has(file)) return;
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
    "Every visual value must live in app/tokens.css or lib/brand.ts. See that file's header comment for why this is enforced.\n"
  );
  process.exit(1);
}

console.log(
  "tokens:verify passed — no hardcoded visual values outside app/tokens.css / lib/brand.ts."
);
