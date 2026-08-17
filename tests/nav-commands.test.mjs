import test from "node:test";
import assert from "node:assert/strict";

const { NAV_COMMANDS, NAV_SECTIONS, NAV_SETTINGS, NAV_HELP } = await import("../lib/nav.ts");

/**
 * THE COMMAND PALETTE'S FEATURE LAYER (NAV_COMMANDS).
 *
 * These are the actions and sub-pages ⌘K offers beyond the top-level
 * sections. The properties asserted here are the ones a careless edit
 * breaks silently — a duplicate that makes cmdk highlight the wrong row, a
 * label that scores nothing, or an href under no section (which would slip
 * past robots.txt, since app/robots.ts disallows by SECTION prefix).
 */

const SECTION_PREFIXES = [...NAV_SECTIONS, NAV_SETTINGS, NAV_HELP].map((s) => s.href);

test("every command href is a sub-path of a known section (so robots.txt covers it)", () => {
  for (const cmd of NAV_COMMANDS) {
    const covered = SECTION_PREFIXES.some(
      (prefix) => cmd.href === prefix || cmd.href.startsWith(prefix + "/")
    );
    assert.ok(covered, `${cmd.href} is under no NAV_SECTIONS/Settings/Help prefix`);
  }
});

test("command hrefs are unique", () => {
  const hrefs = NAV_COMMANDS.map((c) => c.href);
  assert.equal(new Set(hrefs).size, hrefs.length, "duplicate command href");
});

test("command labels are unique and non-empty (cmdk keys selection off the value)", () => {
  const labels = NAV_COMMANDS.map((c) => c.label);
  for (const label of labels) assert.ok(label.length > 0, "empty command label");
  assert.equal(new Set(labels).size, labels.length, "duplicate command label");
});

test("a command label never collides with a section/Settings/Help label", () => {
  const navLabels = new Set(
    [...NAV_SECTIONS, NAV_SETTINGS, NAV_HELP].map((s) => s.label)
  );
  for (const cmd of NAV_COMMANDS) {
    assert.ok(!navLabels.has(cmd.label), `${cmd.label} collides with a nav label`);
  }
});

test("every command is in one of the two rendered groups", () => {
  for (const cmd of NAV_COMMANDS) {
    assert.ok(
      cmd.group === "Create" || cmd.group === "Go to",
      `${cmd.href} has an unrenderable group ${cmd.group}`
    );
  }
});

test("keywords, where present, are non-empty lowercase terms", () => {
  for (const cmd of NAV_COMMANDS) {
    if (!cmd.keywords) continue;
    for (const kw of cmd.keywords) {
      assert.ok(kw.length > 0, `${cmd.href} has an empty keyword`);
      assert.equal(kw, kw.toLowerCase(), `${cmd.href} keyword "${kw}" is not lowercase`);
    }
  }
});
