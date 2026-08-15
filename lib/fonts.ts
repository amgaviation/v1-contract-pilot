import localFont from "next/font/local";

/**
 * INSTRUMENT's three type families — see docs/design/INSTRUMENT.md, "Type".
 *
 * All three are VENDORED into lib/font-files/ and loaded with
 * next/font/local. They used to come from next/font/google, which also
 * self-hosts the result — but it fetches the files from fonts.gstatic.com at
 * BUILD time, which quietly made every production build depend on a third
 * party being reachable. That is not theoretical: a CI build failed with
 *
 *     Module not found: Can't resolve
 *     '@vercel/turbopack-next/internal/font/google/font'
 *
 * on a commit that touched no font code, purely because the runner could not
 * reach Google at that moment. A font is a static asset that changes roughly
 * never; downloading it on every build to render text that has not changed
 * buys nothing and puts an outage between the team and a deploy.
 *
 * What vendoring changes, precisely:
 *   - builds are hermetic: no network access needed to compile the app;
 *   - the served bytes are identical (next/font/google was already
 *     self-hosting these exact files from this origin);
 *   - upgrading a face is now a deliberate act — replace the .woff2 and say
 *     so in the commit — instead of silently following whatever Google
 *     serves that day, which is the same drift argument the token layer
 *     exists to make.
 *
 * ── ONE FILE PER FAMILY, NOT ONE PER WEIGHT ─────────────────────────────
 * All three are VARIABLE fonts: Google serves a single file per family that
 * covers the whole weight axis, and the three @font-face blocks it emits for
 * "weights 500, 600, 700" all point at that same file. Vendoring one file
 * per weight would have shipped the identical bytes three times. The weight
 * RANGES below are what tell the browser which slice to interpolate, and
 * they match the weights the old configuration requested, so nothing about
 * the rendered result moves.
 *
 * Latin subset only, matching the previous `subsets: ["latin"]`. Pulling
 * every subset would roughly triple the payload for glyphs this product has
 * no copy in.
 *
 * ── LICENSING ───────────────────────────────────────────────────────────
 * All three are SIL Open Font License 1.1, which permits redistribution and
 * requires the licence to travel with the files. The full texts are checked
 * in beside them as lib/font-files/LICENSE-*.txt. Do not delete those when
 * tidying: they are the terms under which these bytes may be in this repo.
 *
 * ── THE FAMILIES, AND WHY EACH ──────────────────────────────────────────
 * The system this replaces had exactly one family for everything, figures
 * included. Three families, each with one job, is the single change that most
 * separates how this product reads from how it read before:
 *
 *   Archivo         headings, section labels, table column heads, buttons.
 *                   A grotesk with real presence at small sizes and a genuine
 *                   condensed range, which is what dense column heads need.
 *
 *   Inter           body copy, form values, everything conversational. Kept
 *                   from the old system deliberately — it is still the
 *                   best-tuned UI face at 13-15px, and replacing a face that
 *                   is already correct would be change for its own sake.
 *
 *   JetBrains Mono  every figure: money, decimal hours, tail numbers, ICAO
 *                   codes, invoice numbers, payment references. Tabular by
 *                   construction, so a column of money cannot go ragged.
 *
 * Weights are pinned to the ones the type scale actually uses
 * (--weight-regular/medium/semibold/bold). Loading a wider range "just in
 * case" costs a real download on a phone for weights no component can ask for.
 */

const archivo = localFont({
  src: "./font-files/archivo-variable.woff2",
  // 500-700: --weight-medium, --weight-semibold, --weight-bold. Archivo is
  // never set at regular in this system; the display face earns its place by
  // having presence.
  weight: "500 700",
  style: "normal",
  variable: "--font-archivo",
  display: "swap",
});

const inter = localFont({
  src: "./font-files/inter-variable.woff2",
  weight: "400 600",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

const mono = localFont({
  src: "./font-files/jetbrains-mono-variable.woff2",
  weight: "400 600",
  style: "normal",
  // Named for its ROLE, not the typeface. app/design/tokens.css declares
  // `--font-mono: var(--font-mono-face), ...`, so swapping the mono face
  // later is a change here and nowhere else — a token that named the vendor
  // would have leaked that choice out into the stylesheet.
  variable: "--font-mono-face",
  display: "swap",
});

/**
 * LEDGER's one family (see docs/design/LEDGER.md). A single grotesk in
 * three working weights carries the whole migrated system — UI text and
 * figures alike, with tabular numerals switched on per-element by the
 * `tnum-l` utility rather than by a separate mono face. Vendored like the
 * three above (same hermetic-build reasoning); variable file covers
 * 400–900, and the range below pins the slice the type scale uses.
 * INSTRUMENT's three faces stay loaded until the last screen migrates —
 * both systems render side by side for the whole migration window.
 */
const schibsted = localFont({
  src: "./font-files/schibsted-grotesk-variable.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-schibsted",
  display: "swap",
});

export const fontVariables = `${archivo.variable} ${inter.variable} ${mono.variable} ${schibsted.variable}`;
