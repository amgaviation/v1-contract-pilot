import test from "node:test";
import assert from "node:assert/strict";

const { cn } = await import("../lib/ledger/cn.ts");

/**
 * Guards the one tailwind-merge configuration Ledger cannot ship without.
 *
 * Ledger renames three Tailwind scales in app/design/ledger.css: the
 * font-size scale (text-caption … text-figure), the radius scale
 * (rounded-control/-card) and the shadow scale (shadow-card/-raised). A bare
 * twMerge knows only stock Tailwind, so it cannot tell that `text-body` is a
 * FONT SIZE — its text-color validator swallows any unknown word, dropping
 * `text-body` and `text-accent-ink` into ONE text-* conflict group and
 * keeping only whichever was written last. cva composes the size variant
 * after the colour, so `text-accent-ink` lost on every filled button and the
 * label fell back to near-black `text-ink` on indigo (~2.4:1, unreadable).
 * These assertions fail loudly if that config is ever reverted.
 */

test("a colour and a font size survive on the same element (the button bug)", () => {
  const out = cn("bg-accent text-accent-ink", "px-3 text-body-s");
  assert.match(out, /\btext-accent-ink\b/, "text colour must not be dropped by the size class");
  assert.match(out, /\btext-body-s\b/, "font size must remain");
});

test("danger's text-white is not eaten by its size class", () => {
  const out = cn("bg-crit text-white", "text-body");
  assert.match(out, /\btext-white\b/);
  assert.match(out, /\btext-body\b/);
});

test("a table cell keeps both its caption size and its ink colour", () => {
  // LTh's real base string: caption size and ink-3 colour in one literal.
  const out = cn("text-left text-caption font-semibold text-ink-3");
  assert.match(out, /\btext-caption\b/);
  assert.match(out, /\btext-ink-3\b/);
});

test("same-group overrides still collapse to the last one", () => {
  assert.equal(cn("text-body", "text-caption"), "text-caption", "two sizes → last wins");
  assert.equal(cn("text-ink", "text-accent"), "text-accent", "two colours → last wins");
  assert.equal(cn("rounded-card", "rounded-control"), "rounded-control", "two radii → last wins");
  assert.equal(cn("shadow-card", "shadow-raised"), "shadow-raised", "two shadows → last wins");
});
