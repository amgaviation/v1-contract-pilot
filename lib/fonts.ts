import { Archivo, Inter, JetBrains_Mono } from "next/font/google";

/**
 * INSTRUMENT's three type families — see docs/design/INSTRUMENT.md, "Type".
 *
 * All three are loaded via next/font/google, which downloads the files at
 * BUILD time and self-hosts them from this app's own origin: no runtime
 * request to a font CDN, no third-party connection on a page that renders a
 * pilot's client list, and no silent system-font fallback on a slow ramp
 * connection.
 *
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

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  // Named for its ROLE, not the typeface. app/design/tokens.css declares
  // `--font-mono: var(--font-mono-face), ...`, so swapping the mono face
  // later is a change here and nowhere else — a token that named the vendor
  // would have leaked that choice out into the stylesheet.
  variable: "--font-mono-face",
  display: "swap",
});

export const fontVariables = `${archivo.variable} ${inter.variable} ${mono.variable}`;
