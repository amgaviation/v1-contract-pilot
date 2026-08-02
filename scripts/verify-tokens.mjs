#!/usr/bin/env node
/**
 * Design-overhaul insurance (docs/PLAN.md "Additional risk").
 *
 * Tony intends to overhaul this design later, and that only stays a
 * two-file change (app/tokens.css + lib/brand.ts) if no component ever
 * hardcodes a visual value. This script makes that mechanically
 * impossible to violate silently, rather than a matter of discipline.
 *
 * Scans app/ and components/ (excluding app/tokens.css and lib/brand.ts
 * themselves) for:
 *   - raw hex colors           (#0e1215, incl. inside Tailwind arbitrary
 *                                values like bg-[#0e1215])
 *   - rgb()/rgba()/hsl()/hsla() literals
 *   - non-zero border-radius literals (border radius must be 0 or a
 *     var(--v1-radius) reference)
 *   - font-family declarations outside the token file
 *
 * Run: npm run tokens:verify
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];
const EXEMPT_FILES = new Set([
  join(ROOT, "app", "tokens.css"),
  join(ROOT, "lib", "brand.ts"),
]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

const HEX_COLOR = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g;
const RGB_HSL = /\b(?:rgba?|hsla?)\s*\(/g;
const NONZERO_RADIUS = /border-radius\s*:\s*(?!0\b)(?!var\()[^;]+/g;
const FONT_FAMILY = /font-family\s*:\s*(?!var\()[^;]+/g;

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

function scanFile(file) {
  if (EXEMPT_FILES.has(file)) return;
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  lines.forEach((lineText, idx) => {
    checkPattern(file, idx + 1, lineText, HEX_COLOR, "hardcoded hex color");
    checkPattern(file, idx + 1, lineText, RGB_HSL, "hardcoded rgb()/hsl() literal");
    checkPattern(file, idx + 1, lineText, NONZERO_RADIUS, "non-token border-radius");
    checkPattern(file, idx + 1, lineText, FONT_FAMILY, "font-family outside token file");
  });
}

function checkPattern(file, lineNumber, lineText, pattern, rule) {
  pattern.lastIndex = 0;
  const match = pattern.exec(lineText);
  if (match) {
    violations.push({
      file: relative(ROOT, file),
      line: lineNumber,
      rule,
      snippet: lineText.trim(),
    });
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

console.log("tokens:verify passed — no hardcoded visual values outside app/tokens.css / lib/brand.ts.");
