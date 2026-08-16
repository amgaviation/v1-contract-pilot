import localFont from "next/font/local";

/**
 * LEDGER's one type family (see docs/design/LEDGER.md). A single grotesk in
 * three working weights carries the whole system — UI text and figures
 * alike, with tabular numerals switched on per-element by the `tnum-l`
 * utility rather than by a separate mono face.
 *
 * VENDORED into lib/font-files/, not loaded from next/font/google, for the
 * same reason INSTRUMENT's three faces were (see git history if that
 * reasoning is needed again): a font is a static asset that changes
 * roughly never, and fetching it from a third party at build time puts an
 * outage between the team and a deploy for zero benefit. Variable file
 * covers weights 400–900; the range below pins the slice the type scale
 * actually uses. SIL Open Font License 1.1 — the license text is checked
 * in beside it as lib/font-files/LICENSE-*.txt.
 */
const schibsted = localFont({
  src: "./font-files/schibsted-grotesk-variable.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-schibsted",
  display: "swap",
});

export const fontVariables = schibsted.variable;
