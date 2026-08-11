/**
 * The four inline style objects the public site repeats.
 *
 * The marketing surface's primary action is the brand navy, which is NOT a
 * Radix accent-scale name — so it cannot be a `color` prop and has to be
 * set through the --v1-marketing-* custom properties declared in
 * app/globals.css (see that file's comment for why the literals live
 * there and only there). These were being spelled out at five call sites;
 * one definition each means the header, hero, CTA band and pricing page
 * cannot drift apart.
 *
 * Nothing here is a visual VALUE — every entry is a var() reference, which
 * is the escape hatch scripts/verify-tokens.mjs deliberately keeps open.
 */
export const NAVY_SURFACE = {
  background: "var(--v1-marketing-navy)",
  color: "var(--v1-marketing-navy-ink)",
} as const;

/** For a button sitting ON a navy panel: the fill and the ink swap. */
export const NAVY_SURFACE_INVERSE = {
  background: "var(--v1-marketing-navy-ink)",
  color: "var(--v1-marketing-navy)",
} as const;

/** Heading/primary copy on a navy ground. */
export const NAVY_INK = { color: "var(--v1-marketing-navy-ink)" } as const;

/** Secondary copy on a navy ground — Radix's gray scales are tuned for a
 *  light ground and go muddy here. */
export const NAVY_INK_MUTED = {
  color: "var(--v1-marketing-navy-ink-muted)",
} as const;
