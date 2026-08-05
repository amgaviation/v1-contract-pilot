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
 * Must match --v1-bg in app/tokens/colors.css exactly. Duplicated here
 * only because Next's `<meta name="theme-color">` (the
 * `viewport.themeColor` export in app/layout.tsx) needs a literal string
 * at the metadata-export layer and cannot read a CSS custom property. If
 * --v1-bg ever changes, this must change with it — that coupling is the
 * reason it lives here rather than as an unexplained literal in
 * layout.tsx.
 *
 * This is the page GROUND, not the ink. theme-color tints the browser's
 * own chrome, so it should continue the surface the user is looking at:
 * under the previous dark-rail system that happened to be the ink, but
 * V1 Design is white-heavy glass over a cool near-white, so it is the
 * ground.
 */
export const THEME_COLOR = "#eef1f6";

/**
 * COUNSEL-REVIEWED COPY — verbatim, docs/PLAN.md Design system. This is
 * the one string in the codebase where a paraphrase is a liability
 * question, not a style question. It lives here, not inline on the
 * Overview screen that will eventually show it, because the currency
 * feature itself ships behind a flag, dark, until this exact wording is
 * re-confirmed with counsel (docs/PLAN.md decision #15) — this text has to
 * survive whatever screen work happens before that flag flips.
 */
export const CURRENCY_DISCLAIMER =
  "Currency is calculated from the entries you logged and is a planning aid, not a determination of regulatory compliance. You remain responsible for your own currency and airworthiness decisions.";
