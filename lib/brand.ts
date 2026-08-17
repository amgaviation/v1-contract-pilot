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
  lockup: "V1: powered by AMG Aviation",
  attribution: "powered by AMG Aviation",
  tagline: "The books for your flying business.",
} as const;

export type Brand = typeof BRAND;

/**
 * `<meta name="theme-color">`, which tints the browser's own chrome. It
 * has to continue the surface the reader is looking at, so it is the page
 * GROUND, not the ink.
 *
 * Duplicated as a literal only because Next's `viewport.themeColor` export
 * is evaluated at the metadata layer, which cannot read a CSS custom
 * property — so it cannot ask Radix Themes for `--color-background` the
 * way every component does.
 *
 * A single value because the <Theme> in app/layout.tsx is pinned
 * `appearance="light"` — the app no longer follows the reader's OS
 * preference, so there is no dark browser chrome to match.
 *
 * The literal tracks Radix's slate scale step 1 (light), because
 * `grayColor="auto"` on that same <Theme> resolves to slate for an indigo
 * accent (Radix's getMatchingGrayColor — re-checked when the accent moved
 * from blue to indigo in the 2026-08 rebuild; both resolve to slate, so
 * this value did not move). Change the accent colour and this value must
 * be re-checked again — it is asserted to match, not derived from it.
 *
 * (The previous value, #eef1f6, was the ground of a design system that was
 * deleted in 6ed0e46 — it referred to an app/tokens/colors.css that no
 * longer existed, so it had been tinting browser chrome to match nothing
 * at all.)
 */
export const THEME_COLOR = "#fcfcfd";

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
