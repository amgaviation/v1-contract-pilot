import { Inter } from "next/font/google";

/**
 * The product's one type family: Inter, loaded via next/font/google. That
 * downloads the font files at BUILD time and self-hosts them from this
 * app's own origin — no runtime request to a font CDN, and no risk of a
 * silent system-font fallback on a slow connection.
 *
 * `variable: "--font-inter"` publishes it as a CSS custom property;
 * app/globals.css points Radix Themes' own `--default-font-family` and
 * `--heading-font-family` at it, which is the only wiring this needs —
 * Radix Themes owns the rest of the type ramp (size, weight, tracking)
 * via the <Theme> props in app/layout.tsx.
 *
 * Weights 300–700 are loaded so every weight step the product uses is
 * covered; the tabular-figure behaviour money and decimal-hour columns
 * rely on comes from the `.tnum` utility class in globals.css
 * (`font-variant-numeric: tabular-nums`), not from a weight choice here.
 */
export const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const fontVariables = inter.variable;
