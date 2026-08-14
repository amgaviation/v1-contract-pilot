import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ACCENT_SLOTS,
  APPEARANCE_SLOTS,
  DEFAULT_THEME_SLOTS,
  DENSITY_SLOTS,
  resolveThemeSlots,
  themeForSlots,
} from "../lib/theme-slots.ts";

/**
 * The tenant theme's contract, asserted against the REAL token file.
 *
 * This test used to read @radix-ui/themes/styles.css and compare the
 * lightness of slate steps. That apparatus is gone with Radix, but its INTENT
 * was right and is kept: the nav rail must never sink into the canvas it sits
 * on, in either mode. Under the old system that needed a mode-dependent swap
 * of which token the chrome asked for; under INSTRUMENT it falls out of the
 * palette, and this file is what proves the palette actually has that
 * property rather than assuming it.
 */

const TOKENS = readFileSync(
  fileURLToPath(new URL("../app/design/tokens.css", import.meta.url)),
  "utf8"
);

/** Pull a hex token out of a specific block of tokens.css. */
function tokenIn(blockSelector, name) {
  const start = TOKENS.indexOf(blockSelector);
  assert.notEqual(start, -1, `tokens.css has no ${blockSelector} block`);
  const end = TOKENS.indexOf("}", start);
  const block = TOKENS.slice(start, end);
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(m, `${blockSelector} does not declare --${name} as a hex`);
  return m[1];
}

/** Perceived lightness, 0-255. Good enough to order two greys. */
function lightness(hex) {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h.split("").map((c) => parseInt(c + c, 16))
      : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * n[0] + 0.587 * n[1] + 0.114 * n[2];
}

test("the resolved theme is three data attributes", async (t) => {
  await t.test("defaults resolve to the documented slots", () => {
    const theme = themeForSlots(DEFAULT_THEME_SLOTS);
    assert.equal(theme.appearance, "light");
    assert.equal(theme.accent, "indigo");
    assert.equal(theme.density, "compact");
  });

  await t.test("every density slot names a density the token layer declares", () => {
    for (const slot of DENSITY_SLOTS) {
      // "default" is the unattributed base in tokens.css; the others must
      // each have a [data-density="…"] block or the setting does nothing.
      if (slot.density === "default") continue;
      assert.ok(
        TOKENS.includes(`[data-density="${slot.density}"]`),
        `tokens.css has no block for density "${slot.density}"`
      );
    }
  });

  await t.test("every accent slot has a light AND a dark block", () => {
    for (const slot of ACCENT_SLOTS) {
      assert.ok(
        TOKENS.includes(`[data-accent="${slot.value}"]`),
        `tokens.css has no light block for accent "${slot.value}"`
      );
      assert.ok(
        TOKENS.includes(`[data-appearance="dark"][data-accent="${slot.value}"]`),
        `tokens.css has no dark counterpart for accent "${slot.value}" — it would ` +
          `render a mid-tone against the near-black canvas`
      );
    }
  });

  await t.test("every appearance slot is a block the token layer declares", () => {
    for (const slot of APPEARANCE_SLOTS) {
      if (slot.value === "light") continue; // the unattributed :root base
      assert.ok(TOKENS.includes(`[data-appearance="${slot.value}"]`));
    }
  });

  /**
   * A regression test for the "eight identical swatches" bug: the accent
   * picker paints each slot's swatch by stamping data-accent (and the
   * previewed data-appearance) on the swatch itself so the compound
   * selectors below resolve --signal per slot rather than inheriting the
   * account's CURRENT accent from an ancestor. That mechanism only works
   * if every slot's block actually declares a distinct --signal — this
   * proves the token layer holds up its half of the contract, in both
   * appearances.
   */
  await t.test("every accent slot's --signal is distinct, light and dark", () => {
    const light = new Map();
    const dark = new Map();
    for (const slot of ACCENT_SLOTS) {
      light.set(slot.value, tokenIn(`[data-accent="${slot.value}"] {`, "signal"));
      dark.set(
        slot.value,
        tokenIn(`[data-appearance="dark"][data-accent="${slot.value}"] {`, "signal")
      );
    }
    assert.equal(
      new Set(light.values()).size,
      ACCENT_SLOTS.length,
      `light --signal values collide: ${JSON.stringify([...light])}`
    );
    assert.equal(
      new Set(dark.values()).size,
      ACCENT_SLOTS.length,
      `dark --signal values collide: ${JSON.stringify([...dark])}`
    );
  });
});

/**
 * THE RELATIONSHIP THAT MATTERS. The rail, the phone strip and the sticky
 * header all paint with chromeBackground; the page paints with
 * canvasBackground. If the chrome is ever DARKER than the canvas, the rail
 * stops reading as a raised surface and reads as a hole cut in the page.
 */
test("chrome always sits above the canvas, in both modes", async (t) => {
  await t.test("the resolver asks for the same pair in both modes", () => {
    const light = themeForSlots({ ...DEFAULT_THEME_SLOTS, appearance: "light" });
    const dark = themeForSlots({ ...DEFAULT_THEME_SLOTS, appearance: "dark" });
    assert.equal(light.chromeBackground, "var(--paper)");
    assert.equal(light.canvasBackground, "var(--canvas)");
    // Identical, deliberately: INSTRUMENT's dark palette is a second design
    // rather than an inversion, so there is no mode-dependent branch here.
    assert.equal(dark.chromeBackground, light.chromeBackground);
    assert.equal(dark.canvasBackground, light.canvasBackground);
  });

  await t.test("LIGHT: paper is brighter than the canvas", () => {
    const paper = lightness(tokenIn(":root {\n  color-scheme: light;", "paper"));
    const canvas = lightness(tokenIn(":root {\n  color-scheme: light;", "canvas"));
    assert.ok(
      paper > canvas,
      `light: --paper (${paper.toFixed(1)}) must be brighter than --canvas (${canvas.toFixed(1)})`
    );
  });

  await t.test("DARK: paper is STILL brighter than the canvas", () => {
    const paper = lightness(tokenIn('[data-appearance="dark"] {', "paper"));
    const canvas = lightness(tokenIn('[data-appearance="dark"] {', "canvas"));
    assert.ok(
      paper > canvas,
      `dark: --paper (${paper.toFixed(1)}) must stay brighter than --canvas ` +
        `(${canvas.toFixed(1)}) — an inverted palette would sink the rail into the page`
    );
  });

  await t.test("DARK is genuinely dark, not merely a dimmed light", () => {
    const canvas = lightness(tokenIn('[data-appearance="dark"] {', "canvas"));
    const ink = lightness(tokenIn('[data-appearance="dark"] {', "ink"));
    assert.ok(canvas < 40, `dark canvas should be near-black, got ${canvas.toFixed(1)}`);
    assert.ok(ink > 200, `dark ink should be near-white, got ${ink.toFixed(1)}`);
  });
});

test("untrusted stored values resolve to the defaults", async (t) => {
  for (const bad of [null, undefined, 42, "dark", [], { appearance: "neon" }, { accent: "../etc" }]) {
    await t.test(`${JSON.stringify(bad) ?? "undefined"} falls back`, () => {
      const slots = resolveThemeSlots(bad);
      assert.ok(APPEARANCE_SLOTS.some((s) => s.value === slots.appearance));
      assert.ok(ACCENT_SLOTS.some((s) => s.value === slots.accent));
      assert.ok(DENSITY_SLOTS.some((s) => s.value === slots.density));
    });
  }
});
