import { Inter } from "next/font/google";

/**
 * The type system for "V1 Design" (synced from claude.ai/design — see
 * docs/DESIGN-SYSTEM.md). One family across all four roles, separated by
 * weight, size and tracking rather than by face:
 *
 *   label  600, uppercase, tracked — labels, captions, buttons, nav
 *   body   400/500 — running text and table cells
 *   data   500/600 + font-variant-numeric: tabular-nums — every figure.
 *          Inter's tabular figures are fixed-width, so money and decimal
 *          hours align down a column.
 *   doc    600 — invoice letterhead and logbook attestation
 *
 * Loaded via next/font/google, which downloads the font files at BUILD
 * time and serves them from this app's own origin. The upstream design
 * system pulls Inter from the Google Fonts CDN with an `@import`, and its
 * readme asks for woff2 binaries so that dependency can be dropped — this
 * is the better resolution of that request: no runtime request to Google,
 * no third-party connection on the critical path, and no risk of a silent
 * system-font fallback.
 *
 * Weights 300–700 are loaded because the ported Material Dashboard theme
 * (lib/mdpro/theme/base/typography.js) spans fontWeightLight (300) through
 * fontWeightBold (700) — the retired design system's "no 700" restraint
 * rule went with it.
 */
export const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const fontVariables = inter.variable;
