/**
 * THE ENUMERATED THEME SLOTS — the only module in this product that may
 * name a tenant-overridable visual value.
 *
 * ===========================================================================
 * WHY A LIST AND NOT A COLOUR PICKER.
 *
 * The obvious shape for "let a tenant theme the app" is a hex field. It is
 * also the shape that eventually ships an unreadable product. Radix Themes
 * pairs every accent with a CONTRAST ink at step 9 — the colour a solid
 * Badge, Button or nav marker puts its text in — and it can only do that
 * for accents it knows. An arbitrary hex has no such pairing: it lands on
 * white badge text whether or not white is legible on it, the failure is
 * partial (one badge, at one weight, on one screen), and the pilot who
 * hits it cannot debug it. They did not choose a contrast ratio, they
 * chose a colour they liked.
 *
 * So the slots below are ENUMERATED. Each is a Radix accent name, which
 * means Radix's own attribute selectors re-alias --accent-1…12,
 * --accent-a1…a12, --accent-contrast, --accent-surface, --accent-indicator
 * and --accent-track for the whole subtree, and every screen in the
 * product picks the change up for free because every screen already
 * resolves those tokens by name. Nothing else changes. No component is
 * edited, no literal is introduced, and there is no colour the theme
 * cannot reach.
 *
 * THE CURATION RULE, and it is mechanical: every accent listed here has
 * `--<accent>-contrast: white` in @radix-ui/themes' own stylesheet. Radix
 * ships exactly five accents that do NOT — amber, yellow, lime, mint and
 * sky, whose step 9 is light enough to need dark ink — and all five are
 * deliberately absent. tests/theme-slots.test.mjs asserts that against the
 * installed stylesheet, so this paragraph cannot quietly stop being true.
 *
 * WHAT IS DELIBERATELY NOT A SLOT, with the reason already written in
 * app/layout.tsx:
 *   grayColor        must stay "auto" so Radix keeps pairing the grey
 *                    scale to the accent (indigo→slate). A tenant-chosen
 *                    grey breaks the coupling that file calls "the
 *                    coupling working as designed".
 *   panelBackground  "solid" is a documented legibility decision about
 *                    reading a column of decimal hours, not taste.
 *   radius           one chosen product-wide read.
 *   the logo mark    brand-identity constants (app/globals.css), pointedly
 *                    not wired to the accent.
 *
 * ===========================================================================
 * WHY THIS FILE IS THE ONLY ORIGIN, and how that is enforced.
 *
 * scripts/verify-tokens.mjs carries two rules (category "slot-origin")
 * that exist for this file:
 *
 *   runtime-css-var     a CSS custom property assembled at runtime —
 *                       `var(--${something})` — may appear ONLY here. That
 *                       is the one construction that can smuggle a value
 *                       the theme layer never saw into a rendered style.
 *   dynamic-theme-prop  a <Theme> prop with a JSX-expression value may
 *                       appear only in the two files that APPLY a resolved
 *                       slot (the app shell and the appearance panel's
 *                       preview). Everywhere else a Theme prop must be a
 *                       literal, so no other file can inject one.
 *
 * This file is NOT in verify-tokens' EXEMPT_FILES, and that is on purpose:
 * the hex ban must keep applying HERE most of all, because "a curated
 * palette, never a free hex" is precisely the promise this module makes.
 * The swatch values below are var() references to Radix's own scales, not
 * colours — there is nothing here for an exemption to permit.
 * ===========================================================================
 *
 * TOTALITY. resolveThemeSlots() is a total function over `unknown`. Its
 * input is a jsonb blob written by an earlier version of this app, so an
 * unrecognised accent, a null, a number, an array, or a key that used to
 * mean something are all ordinary inputs — every one of them resolves to
 * the app/layout.tsx default rather than to an unstyled shell. The
 * database can guarantee that `prefs` is an object under 16 KB and
 * nothing more; this function is the rest of that guarantee.
 */

/**
 * The curated accent palette. `swatch` is the token the settings screen
 * paints the real colour with — written out per slot rather than
 * assembled from the value, so even here no CSS custom property is built
 * at runtime.
 */
export const ACCENT_SLOTS = [
  { value: "indigo", label: "Indigo", swatch: "var(--signal)" },
  { value: "blue", label: "Blue", swatch: "var(--signal)" },
  { value: "cyan", label: "Cyan", swatch: "var(--signal)" },
  { value: "teal", label: "Teal", swatch: "var(--signal)" },
  { value: "jade", label: "Jade", swatch: "var(--signal)" },
  { value: "violet", label: "Violet", swatch: "var(--signal)" },
  { value: "plum", label: "Plum", swatch: "var(--signal)" },
  { value: "bronze", label: "Bronze", swatch: "var(--signal)" },
] as const;

export type ThemeAccent = (typeof ACCENT_SLOTS)[number]["value"];

/**
 * The root default (app/layout.tsx): the same hue family as the marketing
 * navy and the dark rail, so app accent, marketing ground and rail read as
 * one blue system.
 */
export const DEFAULT_ACCENT: ThemeAccent = "indigo";

/**
 * Density. Radix's `scaling` prop takes 90/95/100/105/110%, and the
 * product is pinned at 90% "so a month of trips fits without scrolling" —
 * so COMPACT is the default, not an alternative to it. Comfortable is the
 * 100% step: larger type and larger hit targets for a pilot who would
 * rather scroll than squint. The two steps are deliberately far apart;
 * offering 95% as well would be a setting nobody could see the effect of.
 */
export const DENSITY_SLOTS = [
  {
    value: "compact",
    label: "Compact",
    density: "compact",
    hint: "More rows on screen. The default.",
  },
  {
    value: "comfortable",
    label: "Comfortable",
    density: "default",
    hint: "Larger type and bigger targets.",
  },
] as const;

export type ThemeDensity = (typeof DENSITY_SLOTS)[number]["value"];
export type ThemeDensityToken = (typeof DENSITY_SLOTS)[number]["density"];

export const DEFAULT_DENSITY: ThemeDensity = "compact";

export const APPEARANCE_SLOTS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export type ThemeAppearance = (typeof APPEARANCE_SLOTS)[number]["value"];

export const DEFAULT_APPEARANCE: ThemeAppearance = "light";

/** What a tenant actually stored, after validation. */
export type ThemeSlots = {
  accent: ThemeAccent;
  density: ThemeDensity;
  appearance: ThemeAppearance;
};

export const DEFAULT_THEME_SLOTS: ThemeSlots = {
  accent: DEFAULT_ACCENT,
  density: DEFAULT_DENSITY,
  appearance: DEFAULT_APPEARANCE,
};

function readString(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function isThemeAccent(value: unknown): value is ThemeAccent {
  return ACCENT_SLOTS.some((slot) => slot.value === value);
}

export function isThemeDensity(value: unknown): value is ThemeDensity {
  return DENSITY_SLOTS.some((slot) => slot.value === value);
}

export function isThemeAppearance(value: unknown): value is ThemeAppearance {
  return APPEARANCE_SLOTS.some((slot) => slot.value === value);
}

/**
 * Untrusted jsonb → three known-good values. Never throws, never returns
 * a value that is not in one of the lists above.
 */
export function resolveThemeSlots(raw: unknown): ThemeSlots {
  const accent = readString(raw, "accent");
  const density = readString(raw, "density");
  const appearance = readString(raw, "appearance");

  return {
    accent: isThemeAccent(accent) ? accent : DEFAULT_ACCENT,
    density: isThemeDensity(density) ? density : DEFAULT_DENSITY,
    appearance: isThemeAppearance(appearance) ? appearance : DEFAULT_APPEARANCE,
  };
}

/**
 * The app shell's grounds, and the one piece of real thinking in this
 * file.
 *
 * THE PROBLEM DARK MODE CREATES HERE. The rail and the phone top strip are
 * a nested <Theme appearance="dark"> — the product's one dark surface —
 * and Radix paints their ground automatically (verified against the
 * installed 3.3.0 source: `hasBackground` defaults to true whenever
 * `appearance` is passed explicitly, on a nested Theme as much as on the
 * root, so the rail keeps painting itself no matter what the shell around
 * it is doing). On a LIGHT shell that produces the intended reading: a
 * dark rail against a --gray-2 canvas holding white panels.
 *
 * Turn the shell dark and the naive result is three near-identical
 * near-blacks. --color-background resolves to --gray-1 in dark, so the
 * rail, the sticky header and the canvas all land within one scale step of
 * one another, and --color-panel-solid resolves to --gray-2 — the same
 * value the canvas was using — so every Card stops reading as a panel too.
 * A dark rail on a dark canvas with nothing between them.
 *
 * THE FIX, and it is one line of thinking rather than a special case: the
 * two grounds SWAP. Chrome (rail, phone strip, sticky header) and canvas
 * trade places between modes, and the panel layer stays where Radix puts
 * it.
 *
 *   light   chrome = --color-background (white, and inside the rail's own
 *                    dark subtree that same token resolves to the dark
 *                    scale's --gray-1 — byte-for-byte today's rail)
 *           canvas = --gray-2            panels = white
 *
 *   dark    chrome = --gray-2            (the rail LIFTS off the canvas)
 *           canvas = --color-background  (--gray-1, the recessed ground)
 *                                        panels = --gray-2
 *
 * Both modes therefore keep the same three-layer hierarchy — chrome and
 * panels one step off a canvas that sits between/below them — and light
 * mode is unchanged to the byte, because `--color-background` and
 * `--gray-2` are exactly the tokens the shell already used. What flips is
 * only which of the two the chrome asks for.
 */
export type ResolvedTheme = {
  /** Stamped as data-accent. Moves --signal ONLY; see app/design/tokens.css. */
  accent: ThemeAccent;
  /** Stamped as data-density. Moves SPACE and control height, never type size. */
  density: ThemeDensityToken;
  /** Stamped as data-appearance. */
  appearance: ThemeAppearance;
  /** Ground for the rail, the phone strip and the sticky header. */
  chromeBackground: string;
  /** Ground for the page canvas the panels sit on. */
  canvasBackground: string;
};

export function themeForSlots(slots: ThemeSlots): ResolvedTheme {
  const density = DENSITY_SLOTS.find((slot) => slot.value === slots.density);
  return {
    accent: slots.accent,
    density: density ? density.density : "compact",
    appearance: slots.appearance,
    // ONE PAIR IN BOTH MODES, and that is the point rather than an oversight.
    //
    // The old system had to swap these between light and dark, because its
    // dark palette was an inversion: the token that was brighter in light
    // became darker in dark, so the rail would have sunk into the canvas
    // unless the chrome asked for a different token at night.
    //
    // INSTRUMENT's dark palette is a second design, not an inversion —
    // --paper is lifted ABOVE --canvas in both (app/design/tokens.css §8) —
    // so "chrome is paper, canvas is canvas" holds either way and there is no
    // mode-dependent branch to get wrong. tests/theme-slots.test.mjs asserts
    // that relationship against the real token values in both modes.
    chromeBackground: "var(--paper)",
    canvasBackground: "var(--canvas)",
  };
}

/** Untrusted jsonb straight to the props the shell renders with. */
export function resolveTheme(raw: unknown): ResolvedTheme {
  return themeForSlots(resolveThemeSlots(raw));
}
