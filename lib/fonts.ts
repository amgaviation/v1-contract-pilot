import localFont from "next/font/local";

/**
 * THE THREE FACES, and the one job each of them has.
 *
 * Schibsted carries the product. Archivo and Azeret Mono exist for the
 * SIGNED-OUT surface (marketing, auth) and are the answer to a page that
 * read as machine-assembled: one grotesk doing headlines, body, labels and
 * figures at every size is exactly what a template looks like, and no
 * amount of layout work fixes it while every word on the page is the same
 * shape. Three faces is the ceiling, not a target — a page carrying four
 * reads as accumulated rather than designed.
 *
 * VENDORED, not next/font/google, and fetched from the google/fonts
 * repository rather than the Google Fonts CDN. Two separate reasons, both
 * load-bearing:
 *
 *   1. A font is a static asset that changes roughly never, and fetching
 *      it from a third party at build time puts an outage between the team
 *      and a deploy. That is why Schibsted was vendored (see git history).
 *
 *   2. THE CDN STRIPS OPENTYPE FEATURES from the woff2 subsets it serves.
 *      The upstream files carry `tnum`, `zero`, `case` and `frac`; the CDN
 *      copies of several families carry none of them. This product puts
 *      money and flight times in columns and reaches for tabular figures
 *      with the `tnum-l` utility, so a face whose `tnum` was quietly
 *      dropped in transit would misalign every invoice table with nothing
 *      failing anywhere. Each file below was checked for `tnum` after
 *      subsetting; see lib/font-files/README.md for how to re-check.
 *
 * SIL Open Font License 1.1 for all three. The licence text is checked in
 * beside each file as lib/font-files/LICENSE-*.txt, which is a condition
 * of redistributing the bytes, not housekeeping.
 */

/**
 * The interface face: UI text and figures alike, tabular numerals switched
 * on per-element by `tnum-l` rather than by a separate mono. Its digits are
 * strongly proportional by default (the `1` is 703 units against the `0`'s
 * 1252), which is precisely why that utility is not decorative.
 */
const schibsted = localFont({
  src: "./font-files/schibsted-grotesk-variable.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-schibsted",
  display: "swap",
});

/**
 * The display face: headlines on the signed-out surface, nothing else.
 * Archivo is a grotesque with DIN and American-gothic bones, pinned here to
 * width 112 of its 62–125 axis — the semi-expanded cut, which is what gives
 * it the aircraft-placard and signage read rather than another neutral
 * sans. Pinning the width rather than shipping the axis keeps the file at
 * 33KB; nothing on the surface animates or varies width, so the axis would
 * be dead weight.
 *
 * preload: false — this face renders on four public pages, and preloading
 * it would make every authenticated screen in the product pay for bytes it
 * never draws. The @font-face still ships; the browser fetches it the
 * moment something actually uses it.
 */
const archivo = localFont({
  src: "./font-files/archivo-semiexpanded-variable.woff2",
  weight: "400 800",
  style: "normal",
  variable: "--font-archivo",
  display: "swap",
  preload: false,
});

/**
 * The identifier face. Tail numbers, airport identifiers, step numbers,
 * eyebrows and figures set in a true monospace, because that is what those
 * strings ARE: a pilot reads N412SP and KTEB the way they read them on a
 * flight strip and a logbook line, in fixed columns. It is also the one
 * move in this category nobody has taken — an audit of fifteen aviation
 * sites in 2026-08 found essentially no monospace, no flight-strip
 * layouts and no chart typography anywhere, while the adjacent
 * finance-and-ops brands that read as designed rather than generated
 * (Basecamp, Brex, Puzzle) all use a mono as a brand voice.
 *
 * preload: false for the same reason as Archivo.
 */
const azeretMono = localFont({
  src: "./font-files/azeret-mono-variable.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-azeret-mono",
  display: "swap",
  preload: false,
});

/** Stamped together onto <html> by app/layout.tsx. */
export const fontVariables = [
  schibsted.variable,
  archivo.variable,
  azeretMono.variable,
].join(" ");
