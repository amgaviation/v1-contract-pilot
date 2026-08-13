import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
  ACCENT_SLOTS,
  APPEARANCE_SLOTS,
  DENSITY_SLOTS,
  DEFAULT_THEME_SLOTS,
  DEFAULT_ACCENT,
  DEFAULT_DENSITY,
  DEFAULT_APPEARANCE,
  resolveThemeSlots,
  themeForSlots,
  resolveTheme,
} = await import("../lib/theme-slots.ts");

const STYLES = readFileSync(
  fileURLToPath(new URL("../node_modules/@radix-ui/themes/styles.css", import.meta.url)),
  "utf8"
);

/**
 * Reads a custom property's LIGHT and DARK values out of Radix's own
 * stylesheet. Both blocks declare the same names with plain hex; the
 * display-p3 variants live inside @supports blocks and use color(), so a
 * hex-anchored match cannot pick them up. First occurrence is the light
 * block, second the dark one — asserted below rather than assumed.
 */
function tokenValues(name) {
  const matches = [...STYLES.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, "g"))].map(
    (match) => match[1].toLowerCase()
  );
  return matches;
}

/** Rough relative lightness, enough to order two greys. */
function lightness(hex) {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("the curated accent palette", async (t) => {
  await t.test("every accent Radix pairs with DARK ink is excluded", () => {
    // Radix ships exactly five accents whose step 9 needs dark text.
    // lib/theme-slots.ts's whole curation rule is that none of them is
    // offered, so a solid Badge or Button can never end up with white
    // text on a light ground. Asserted against the installed stylesheet
    // rather than against a list copied out of the docs.
    const darkInkAccents = [];
    for (const match of STYLES.matchAll(/--([a-z]+)-contrast:\s*([^;]+);/g)) {
      const [, accent, value] = match;
      if (value.trim() !== "white") darkInkAccents.push(accent);
    }
    assert.ok(darkInkAccents.length > 0, "expected Radix to define some dark-ink accents");

    for (const slot of ACCENT_SLOTS) {
      assert.equal(
        darkInkAccents.includes(slot.value),
        false,
        `${slot.value} takes dark contrast ink in Radix — it must not be an offered accent`
      );
      const contrast = STYLES.match(new RegExp(`--${slot.value}-contrast:\\s*([^;]+);`));
      assert.ok(contrast, `${slot.value} is not a Radix accent at all`);
      assert.equal(contrast[1].trim(), "white");
    }
  });

  await t.test("each slot previews with a real Radix token, never a literal", () => {
    for (const slot of ACCENT_SLOTS) {
      assert.equal(slot.swatch, `var(--${slot.value}-9)`);
      assert.ok(
        STYLES.includes(`--${slot.value}-9:`),
        `--${slot.value}-9 is not defined by @radix-ui/themes`
      );
    }
  });

  await t.test("the default accent is the root theme's own", () => {
    assert.equal(DEFAULT_ACCENT, "indigo");
    assert.ok(ACCENT_SLOTS.some((slot) => slot.value === DEFAULT_ACCENT));
  });
});

test("density maps onto Radix scaling steps", async (t) => {
  await t.test("every density names a scaling value Radix accepts", () => {
    // Radix's scaling prop takes exactly these five.
    const allowed = new Set(["90%", "95%", "100%", "105%", "110%"]);
    for (const slot of DENSITY_SLOTS) assert.ok(allowed.has(slot.scaling));
  });

  await t.test("the default density is the product's pinned 90%", () => {
    // app/layout.tsx pins scaling="90%" so a month of trips fits without
    // scrolling. The default must render byte-identically to that.
    assert.equal(DEFAULT_DENSITY, "compact");
    assert.equal(themeForSlots(DEFAULT_THEME_SLOTS).scaling, "90%");
  });
});

test("resolveThemeSlots is total over untrusted jsonb", async (t) => {
  await t.test("anything unrecognised resolves to the app's defaults", () => {
    for (const raw of [
      null,
      undefined,
      0,
      "",
      "dark",
      true,
      [],
      ["dark"],
      { accent: "#ff0000" },
      { accent: "amber" }, // a real Radix accent, deliberately NOT offered
      { accent: 7, density: {}, appearance: [] },
      { appearance: "auto" },
      { density: "cozy" },
      { accent: null, density: null, appearance: null },
    ]) {
      assert.deepEqual(resolveThemeSlots(raw), DEFAULT_THEME_SLOTS);
    }
  });

  await t.test("a partially valid blob keeps the valid half", () => {
    assert.deepEqual(resolveThemeSlots({ accent: "jade", density: "nope", appearance: "dark" }), {
      accent: "jade",
      density: DEFAULT_DENSITY,
      appearance: "dark",
    });
  });

  await t.test("every offered slot round-trips", () => {
    for (const accent of ACCENT_SLOTS) {
      for (const density of DENSITY_SLOTS) {
        for (const appearance of APPEARANCE_SLOTS) {
          const stored = {
            accent: accent.value,
            density: density.value,
            appearance: appearance.value,
          };
          assert.deepEqual(resolveThemeSlots(stored), stored);
        }
      }
    }
  });

  await t.test("a prototype-polluting blob cannot smuggle a value in", () => {
    const hostile = JSON.parse('{"__proto__":{"accent":"jade"},"accent":"nope"}');
    assert.equal(resolveThemeSlots(hostile).accent, DEFAULT_ACCENT);
  });
});

/**
 * THE DARK-MODE COMPOSITION.
 *
 * The failure this guards against is specific and was the hard part of
 * the feature: with the shell in dark mode, --color-background resolves
 * to --gray-1 and --color-panel-solid to --gray-2, so a rail, a header, a
 * canvas and a Card can all land within one step of each other — "a dark
 * rail on a dark canvas with no separation".
 *
 * lib/theme-slots.ts answers it by SWAPPING the chrome and canvas grounds
 * between modes. This test resolves those two token names against Radix's
 * real stylesheet and asserts the three-layer hierarchy actually holds in
 * both directions, rather than trusting the prose.
 */
test("the shell's grounds separate in both modes", async (t) => {
  const light = themeForSlots({ ...DEFAULT_THEME_SLOTS, appearance: "light" });
  const dark = themeForSlots({ ...DEFAULT_THEME_SLOTS, appearance: "dark" });

  await t.test("light mode is byte-identical to the pre-tenant shell", () => {
    // The shell used --color-background for the header and --gray-2 for
    // the canvas before any of this existed. Turning tenant theming on
    // must not restyle a single light-mode pixel.
    assert.equal(light.chromeBackground, "var(--color-background)");
    assert.equal(light.canvasBackground, "var(--gray-2)");
  });

  await t.test("dark mode trades them, so the chrome sits above the canvas", () => {
    assert.equal(dark.chromeBackground, "var(--gray-2)");
    assert.equal(dark.canvasBackground, "var(--color-background)");
  });

  // Radix resolves --gray-* through the auto-paired gray scale; indigo
  // pairs to slate, which lib/brand.ts already asserts elsewhere. The
  // ORDERING property below holds for every Radix gray by construction
  // (step 1 is the darkest in dark mode, step 2 the next), so checking it
  // against slate checks the design, not one accent's pairing.
  const slate1 = tokenValues("slate-1");
  const slate2 = tokenValues("slate-2");

  await t.test("the stylesheet really does declare a light and a dark value", () => {
    assert.equal(slate1.length >= 2, true, "expected light and dark --slate-1");
    assert.equal(slate2.length >= 2, true, "expected light and dark --slate-2");
    // Light block first: the light grey is far brighter than the dark one.
    assert.ok(lightness(slate1[0]) > 200);
    assert.ok(lightness(slate1[1]) < 60);
  });

  await t.test("DARK: rail/header (gray-2) is lighter than the canvas (gray-1)", () => {
    const canvas = lightness(slate1[1]); // --color-background = --gray-1
    const chrome = lightness(slate2[1]); // --gray-2
    const panel = lightness(slate2[1]); // --color-panel-solid = --gray-2
    assert.ok(
      chrome > canvas,
      `dark chrome (${chrome}) must sit above the canvas (${canvas}) — otherwise the rail merges into the page`
    );
    assert.ok(
      panel > canvas,
      "a Card must still read as a panel against the dark canvas"
    );
  });

  await t.test("LIGHT: the canvas (gray-2) is darker than chrome and panels (white)", () => {
    const canvas = lightness(slate2[0]); // --gray-2
    const chrome = lightness("#ffffff"); // --color-background = white in light
    assert.ok(
      chrome > canvas,
      "the white header and white Cards must read against the gray-2 canvas"
    );
  });

  await t.test("the rail's own dark island is unchanged in light mode", () => {
    // Inside the rail's nested <Theme appearance="dark">, the token the
    // shell hands it — var(--color-background) — resolves to the DARK
    // scale's --gray-1. That is exactly what Radix's automatic
    // hasBackground painted before, so the light-mode rail is untouched.
    assert.equal(light.chromeBackground, "var(--color-background)");
    assert.ok(lightness(slate1[1]) < lightness(slate2[0]));
  });
});

test("resolveTheme goes from stored blob to shell props in one step", () => {
  const resolved = resolveTheme({ accent: "plum", density: "comfortable", appearance: "dark" });
  assert.deepEqual(resolved, {
    accentColor: "plum",
    scaling: "100%",
    appearance: "dark",
    chromeBackground: "var(--gray-2)",
    canvasBackground: "var(--color-background)",
  });
  assert.deepEqual(resolveTheme("garbage"), {
    accentColor: DEFAULT_ACCENT,
    scaling: "90%",
    appearance: DEFAULT_APPEARANCE,
    chromeBackground: "var(--color-background)",
    canvasBackground: "var(--gray-2)",
  });
});

/**
 * THE HOUSE CRITICAL ON `.upsert()`, asserted against the source rather
 * than trusted to review.
 *
 * PostgREST compiles `.upsert()` to `ON CONFLICT (<target>) DO UPDATE SET
 * <every payload column> = excluded.<col>` — the conflict-target column
 * included — and Postgres checks UPDATE privilege on every column named
 * in that SET list statically, before any conflict is evaluated. Against
 * this codebase's column-scoped grants that is a 42501 on every call, and
 * a silently-never-written table: it has already shipped four times
 * (guarantee_periods, trip_days, client_rates, mileage_rates), and
 * scripts/tenancy-verify.mjs replays the shape and asserts the 42501.
 *
 * pilot.account_preferences is grant-shaped exactly the same way —
 * insert(account_id, prefs), update(prefs), and account_id withheld from
 * UPDATE because it is the tenancy key — so an `.upsert()` here would
 * mean the entire appearance and nav-layout feature never persisting
 * anything, while the settings screen rendered as though it had. The
 * writer must branch: update when the row exists, insert when it does
 * not.
 */
test("preferences are written without PostgREST's .upsert()", async (t) => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL("../lib/preferences.ts", import.meta.url)),
    "utf8"
  );
  // Comments explain the ban at length; strip them so the prose about
  // `.upsert()` is not mistaken for a call to it.
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  await t.test("no .upsert() call survives in the writer", () => {
    assert.equal(
      /\.upsert\s*\(/.test(code),
      false,
      "lib/preferences.ts must not call .upsert() — account_id is not UPDATE-grantable, so the compiled ON CONFLICT DO UPDATE 42501s"
    );
  });

  await t.test("it writes through both an update and an insert instead", () => {
    assert.ok(/\.update\s*\(/.test(code), "the existing-row branch must UPDATE");
    assert.ok(/\.insert\s*\(/.test(code), "the missing-row branch must INSERT");
  });

  await t.test("every write is counted, so a denied write cannot pass as a save", () => {
    // PostgREST answers 200 with no error for a write that matched
    // nothing; count: "exact" is what turns that into a reported failure.
    const writes = code.match(/\.(?:update|insert)\s*\(/g) ?? [];
    const counted = code.match(/count:\s*"exact"/g) ?? [];
    assert.ok(writes.length > 0);
    assert.equal(
      counted.length,
      writes.length,
      "every insert/update in lib/preferences.ts needs count: \"exact\""
    );
  });
});
