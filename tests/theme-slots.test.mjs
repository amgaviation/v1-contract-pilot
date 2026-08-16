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
 * This test used to assert against app/design/tokens.css: that INSTRUMENT's
 * accent/density slots each had a `[data-accent="…"]`/`[data-density="…"]`
 * block, and that every accent's `--signal` was genuinely distinct light and
 * dark (the "eight identical swatches" regression). All of that apparatus is
 * gone with INSTRUMENT (docs/design/LEDGER.md, phase 6) — Ledger has exactly
 * one accent and no per-accent or per-density CSS block, by design ("One
 * filled accent action per view. Restraint is the brand"). See
 * lib/theme-slots.ts's own note above ACCENT_SLOTS: the slots stay
 * enumerated (a tenant's stored choice still round-trips) but currently
 * carry no visual effect.
 *
 * What's still real and still worth asserting: the chrome/canvas contrast
 * relationship (the rail must never sink into the page it sits on) and
 * resolveThemeSlots' totality guarantee over untrusted stored data. Both
 * are checked below against app/design/ledger.css.
 */

const LEDGER = readFileSync(
  fileURLToPath(new URL("../app/design/ledger.css", import.meta.url)),
  "utf8"
);

/** Pull a hex token out of a specific block of ledger.css. */
function tokenIn(blockSelector, name) {
  const start = LEDGER.indexOf(blockSelector);
  assert.notEqual(start, -1, `ledger.css has no ${blockSelector} block`);
  const end = LEDGER.indexOf("}", start);
  const block = LEDGER.slice(start, end);
  const m = block.match(new RegExp(`--ledger-${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(m, `${blockSelector} does not declare --ledger-${name} as a hex`);
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

  await t.test("every appearance slot is a block the token layer declares", () => {
    for (const slot of APPEARANCE_SLOTS) {
      if (slot.value === "light") continue; // the unattributed :root base
      assert.ok(LEDGER.includes(`[data-appearance="${slot.value}"]`));
    }
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
    assert.equal(light.chromeBackground, "var(--ledger-card)");
    assert.equal(light.canvasBackground, "var(--ledger-canvas)");
    assert.equal(dark.chromeBackground, light.chromeBackground);
    assert.equal(dark.canvasBackground, light.canvasBackground);
  });

  await t.test("LIGHT: card is brighter than the canvas", () => {
    const card = lightness(tokenIn(":root {", "card"));
    const canvas = lightness(tokenIn(":root {", "canvas"));
    assert.ok(
      card > canvas,
      `light: --ledger-card (${card.toFixed(1)}) must be brighter than --ledger-canvas (${canvas.toFixed(1)})`
    );
  });

  await t.test("DARK: card is STILL brighter than the canvas", () => {
    const card = lightness(tokenIn('[data-appearance="dark"] {', "card"));
    const canvas = lightness(tokenIn('[data-appearance="dark"] {', "canvas"));
    assert.ok(
      card > canvas,
      `dark: --ledger-card (${card.toFixed(1)}) must stay brighter than --ledger-canvas ` +
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
