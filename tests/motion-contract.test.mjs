import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE MOTION CONTRACT, pinned against the generated stylesheet.
 *
 * These rules were absent for the whole life of the design system and
 * nobody noticed, because nothing failed when they were missing — a button
 * with no pressed state looks completely fine in a screenshot and only
 * feels wrong under a finger. That is precisely the class of thing a test
 * has to hold, so this file asserts the four claims docs/design/
 * INSTRUMENT.md ("Motion: acknowledge, don't perform") now makes.
 *
 * Read against app/design/system.generated.css rather than the generator,
 * because the generated file is what ships and is checked in — a rule that
 * exists in the generator but was never regenerated is exactly the drift
 * worth catching.
 */

const CSS = readFileSync(
  new URL("../app/design/system.generated.css", import.meta.url),
  "utf8"
);
const TOKENS = readFileSync(new URL("../app/design/tokens.css", import.meta.url), "utf8");

test("every interactive control acknowledges a press", () => {
  // The rule that did not exist before. :hover is not feedback on a phone,
  // and this product is used on phones.
  assert.match(
    CSS,
    /\.i-btn:active:not\(:disabled\)[^{]*\{[^}]*transform:\s*scale\(var\(--press-scale\)\)/,
    "buttons must scale on :active — a touch user has no other acknowledgement"
  );
  assert.match(CSS, /\.i-tab:active\s*\{[^}]*opacity/, "tabs must respond to a press");
  assert.match(TOKENS, /--press-scale:\s*0?\.\d+/, "--press-scale must be a token, not a literal");
});

test("press feedback is instant, and survives reduced motion", () => {
  // The transform is transitioned at --dur-instant so it lands inside the
  // window where a response still reads as part of the touch.
  assert.match(
    CSS,
    /\.i-btn\s*\{[^}]*transition:[^;]*transform var\(--dur-instant\)/,
    "the press transition must use --dur-instant"
  );
  // Reduced motion zeroes the DURATIONS; it must not delete the feedback,
  // or a touch user in that mode is left with nothing at all.
  const reducedBlock = TOKENS.slice(TOKENS.indexOf("prefers-reduced-motion"));
  assert.ok(
    !/--press-scale/.test(reducedBlock),
    "reduced motion must not neutralise --press-scale — it guards against large sustained movement, not a 3% press"
  );
});

test("nothing animates a property the compositor cannot handle", () => {
  // Rule 3 of the doctrine. Catches an `animation`/`transition` on a
  // layout-triggering property, which drops frames on the day grid.
  const banned = /transition:[^;]*\b(height|width|top|left|right|bottom|margin|padding)\b/g;
  const offenders = CSS.match(banned) ?? [];
  assert.deepEqual(
    offenders,
    [],
    `transitions must be limited to transform/opacity/colour: ${offenders.join(" | ")}`
  );
});

test("no duration exceeds the 200ms ceiling", () => {
  // Every duration must come from a token, and every token must be under
  // 200ms. A literal ms value in the stylesheet is the drift this catches.
  const declared = [...TOKENS.matchAll(/--dur-[a-z]+:\s*(\d+)ms/g)].map((m) => Number(m[1]));
  assert.ok(declared.length >= 3, "expected the three duration tokens");
  for (const ms of declared) {
    assert.ok(ms < 200, `duration ${ms}ms exceeds the 200ms ceiling`);
  }
});

test("a dialog materialises rather than blinking into existence", () => {
  // Native <dialog> enters the top layer, so BOTH halves are required:
  // @starting-style supplies the entry's "from", and allow-discrete on
  // display/overlay is what keeps the element around long enough to animate
  // out. Missing either one silently produces no animation in that
  // direction, which is why both are asserted.
  assert.match(CSS, /@starting-style\s*\{[^}]*\.i-dialog\[open\]/s, "dialog needs @starting-style");
  assert.match(
    CSS,
    /\.i-dialog\s*\{[^}]*transition:[^;]*display[^;]*allow-discrete/s,
    "dialog needs allow-discrete on display or it cannot animate out"
  );
  assert.match(
    CSS,
    /\.i-dialog\s*\{[^}]*transition:[^;]*overlay[^;]*allow-discrete/s,
    "dialog needs allow-discrete on overlay or it leaves the top layer immediately"
  );
  assert.match(CSS, /\.i-dialog\[open\]::backdrop\s*\{[^}]*opacity:\s*1/, "the scrim fades in step");
});

test("tracking is a function of size, not one value for every size", () => {
  // The defect this replaced: .i-heading carried a single --track-tight, so
  // a 36px page title and a 13px card title were spaced identically.
  assert.ok(
    !/\.i-heading\s*\{[^}]*letter-spacing/s.test(CSS),
    ".i-heading must not pin one tracking value for every size"
  );
  for (const step of [1, 2, 3, 4, 5, 6, 7]) {
    assert.match(
      CSS,
      new RegExp(`\\.i-t${step}\\s*\\{[^}]*letter-spacing: var\\(--track-${step}\\)`),
      `.i-t${step} must carry its own tracking`
    );
  }
  // And the ramp must actually run downhill: open at small sizes, closed at
  // large ones. A ramp that is flat or backwards would satisfy the check
  // above while reproducing the original bug.
  const ramp = [1, 2, 3, 4, 5, 6, 7].map((step) => {
    const m = TOKENS.match(new RegExp(`--track-${step}:\\s*(-?[\\d.]+)em`));
    assert.ok(m, `--track-${step} must be declared`);
    return Number(m[1]);
  });
  for (let i = 1; i < ramp.length; i += 1) {
    assert.ok(
      ramp[i] < ramp[i - 1],
      `tracking must tighten as size grows: --track-${i + 1} (${ramp[i]}) should be below --track-${i} (${ramp[i - 1]})`
    );
  }
});

test("floating chrome is translucent, and gives that up on request", () => {
  assert.match(CSS, /\.i-chrome\s*\{[^}]*backdrop-filter: var\(--chrome-blur\)/s);
  assert.match(CSS, /\.i-chrome-edge::after\s*\{[^}]*background: var\(--chrome-edge\)/s);
  // The edge fade lies over scrolling content; if it ever swallowed taps it
  // would break every link that passes under the header.
  assert.match(CSS, /\.i-chrome-edge::after\s*\{[^}]*pointer-events: none/s);
  for (const query of ["prefers-reduced-transparency", "prefers-contrast"]) {
    const block = CSS.slice(CSS.indexOf(query));
    assert.ok(
      /\.i-chrome\s*\{[^}]*backdrop-filter: none/s.test(block.slice(0, 600)),
      `${query} must drop the blur entirely, not merely soften it`
    );
  }
});
