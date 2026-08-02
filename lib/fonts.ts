import { Roboto, Roboto_Condensed, Roboto_Mono } from "next/font/google";

/**
 * The locked type system for "Approach Plate" (see docs/PLAN.md → Design
 * system). All three are loaded via next/font/google, which downloads the
 * font files at BUILD time and serves them from this app's own origin —
 * there is no runtime request to Google's font CDN and no risk of a
 * silent system-font fallback. This satisfies the plan's "self-hosted,
 * no CDN" requirement; it is a deliberate substitution for the plan's
 * literal `next/font/local` suggestion, made because raw font binaries
 * weren't available to vendor by hand in this environment. Functionally
 * equivalent for the property that matters (zero third-party runtime
 * requests).
 */
export const robotoCondensed = Roboto_Condensed({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-roboto-condensed",
  display: "swap",
});

export const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

export const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto-mono",
  display: "swap",
});

export const fontVariables = [
  robotoCondensed.variable,
  roboto.variable,
  robotoMono.variable,
].join(" ");
