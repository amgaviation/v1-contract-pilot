/**
 * The inline style objects the SIGNED-OUT surface repeats — the public
 * marketing pages (app/(marketing)/*) and the auth screens
 * (app/(auth)/*), which now share one composition: a navy brand panel
 * beside light content.
 *
 * It lives in lib/ rather than inside app/(marketing)/ because two route
 * groups read it. Before the 2026-08 marketing rewrite it was
 * app/(marketing)/marketing-style.ts; the auth redesign gave the signup
 * and login screens the same navy panel as the hero, and a route group
 * reaching sideways into another route group's private file is the kind
 * of coupling that survives exactly until someone moves a folder.
 *
 * The signed-out surface's primary action is the brand navy, which is NOT
 * a Radix accent-scale name — so it cannot be a `color` prop and has to be
 * set through the --v1-marketing-* custom properties declared in
 * app/globals.css (see that file's comment for why the literals live
 * there and only there).
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

/**
 * The section-band ground — the SAME canvas token the app shell paints its
 * ground with (docs/design/INSTRUMENT.md: marketing sections alternate the
 * page ground with canvas bands so the public site and the product read as
 * one canvas/panel system). Surface Cards sit on it as paper panels, exactly
 * as they do inside the app.
 */
export const GRAY_BAND = {
  background: "var(--canvas)",
} as const;

/** The hairline used where two same-ground sections meet. */
export const HAIRLINE_TOP = {
  borderTop: "1px solid var(--hair)",
} as const;
