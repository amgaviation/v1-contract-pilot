/**
 * Single source of every brand string in the product. No component may
 * render a literal "V1" or "AMG" string outside this file — see
 * docs/PLAN.md decision #5 (name) and #18 (brand placement).
 *
 * `attribution` is the ONLY place AMG Aviation appears anywhere in this
 * product: the app footer and the marketing about page. It must never
 * appear in the nav rail, the header, an invoice PDF, or transactional
 * email — the invoice is a document the pilot's own client sees, and it
 * carries no AMG branding.
 */
export const BRAND = {
  name: "V1",
  wordmark: "V1",
  descriptor: "Contract Pilot",
  lockup: "V1 — powered by AMG Aviation",
  attribution: "powered by AMG Aviation",
  tagline: "Log the trip once.",
} as const;

export type Brand = typeof BRAND;

/**
 * Must match --v1-ink in app/tokens.css exactly. Duplicated here only
 * because Next's `<meta name="theme-color">` (the `viewport.themeColor`
 * export in app/layout.tsx) needs a literal string at the metadata-export
 * layer and cannot read a CSS custom property. If --v1-ink ever changes,
 * this must change with it — that coupling is the reason it lives here
 * rather than as an unexplained literal in layout.tsx.
 */
export const THEME_COLOR = "#0e1215";
