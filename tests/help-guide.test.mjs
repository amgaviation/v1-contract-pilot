import test from "node:test";
import assert from "node:assert/strict";

const { HELP_SECTIONS, HELP_TOPICS, searchHelp, searchHelpSections } = await import(
  "../lib/help/guide.ts"
);
const { NAV_SECTIONS, NAV_SETTINGS, NAV_HELP } = await import("../lib/nav.ts");

/**
 * THE GUIDE, and the search over it.
 *
 * Worth testing rather than eyeballing for one reason: the guide replaced
 * the explanations that used to sit under every screen's heading, so it is
 * now the ONLY place several of those facts are written down. A topic that
 * silently stops being findable is a fact the product no longer tells
 * anyone — and nothing about the UI would look broken.
 */

test("every topic is complete and uniquely addressable", () => {
  const ids = new Set();
  for (const topic of HELP_TOPICS) {
    assert.ok(topic.id, "a topic has no id");
    assert.ok(!ids.has(topic.id), `duplicate topic id: ${topic.id}`);
    ids.add(topic.id);

    // The id is used as the DOM anchor, so it has to be usable as one.
    assert.match(topic.id, /^[a-z0-9-]+$/, `${topic.id} is not anchor-safe`);
    assert.ok(topic.title.trim().length > 0, `${topic.id} has no title`);
    assert.ok(topic.summary.trim().length > 0, `${topic.id} has no summary`);
    assert.ok(topic.body.length > 0, `${topic.id} has no body`);
    for (const paragraph of topic.body) {
      assert.ok(paragraph.trim().length > 0, `${topic.id} has an empty paragraph`);
    }
  }
  assert.ok(HELP_TOPICS.length >= 15, "the guide should cover the product, not a corner of it");
});

test("every link in the guide points at a route this product actually has", () => {
  // A guide whose "Open" button 404s is worse than one with no button. The
  // check is deliberately loose about query strings (?tab=…) and specific
  // about the path, which is the part that can rot.
  const known = new Set([
    ...NAV_SECTIONS.map((s) => s.href),
    NAV_SETTINGS.href,
    NAV_HELP.href,
    "/settings/billing",
    "/settings/export",
    "/expenses/import",
  ]);

  for (const topic of HELP_TOPICS) {
    if (!topic.href) continue;
    const path = topic.href.split("?")[0];
    assert.ok(
      known.has(path),
      `${topic.id} links to ${topic.href}, which is not a route in NAV_SECTIONS or the known extras`
    );
  }
});

test("an empty query returns the whole guide, so the page browses", () => {
  assert.equal(searchHelp("").length, HELP_TOPICS.length);
  assert.equal(searchHelp("   ").length, HELP_TOPICS.length);
  assert.equal(
    searchHelpSections("").reduce((n, s) => n + s.topics.length, 0),
    HELP_TOPICS.length
  );
});

test("search finds a topic by words in its body, not just its title", () => {
  // The failure this pins: a title-only search would not find the IRS rate,
  // because the heading says "Mileage" and the useful sentence is below it.
  const irs = searchHelp("irs");
  assert.ok(
    irs.some((t) => t.id === "mileage"),
    "searching 'irs' must find the mileage topic"
  );

  // And by keyword, which is how someone finds a thing whose name they do
  // not know this product uses.
  const chase = searchHelp("chase");
  assert.ok(
    chase.some((t) => t.id === "reminders"),
    "searching 'chase' must find reminders"
  );
});

test("every word must match, or a common word returns the whole guide", () => {
  // "invoice" appears in most topics; "invoice mileage" should return the
  // few that carry both, not the union. An any-word search would make the
  // box useless on exactly the queries people type.
  const both = searchHelp("mileage rate");
  const justMileage = searchHelp("mileage");
  assert.ok(both.length <= justMileage.length);
  assert.ok(both.every((t) => justMileage.includes(t)));

  const nonsense = searchHelp("invoice zzzznotaword");
  assert.equal(nonsense.length, 0, "an unmatched term must exclude the topic");
});

test("search is case-insensitive and matches partial words", () => {
  assert.deepEqual(
    searchHelp("MILEAGE").map((t) => t.id),
    searchHelp("mileage").map((t) => t.id)
  );
  assert.ok(
    searchHelp("remind").some((t) => t.id === "reminders"),
    "a half-typed query should narrow, not miss"
  );
});

test("sections with no matching topic are dropped, not rendered empty", () => {
  const sections = searchHelpSections("mileage");
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.ok(section.topics.length > 0, `${section.id} rendered with no topics`);
  }
  assert.equal(searchHelpSections("zzzznotaword").length, 0);
});

test("the guide still carries the consequences the screens used to warn about", () => {
  // These sentences were removed from the UI. If the guide loses them too,
  // the product simply stops telling anyone — so each is pinned to the
  // topic that inherited it.
  const byId = Object.fromEntries(HELP_TOPICS.map((t) => [t.id, t]));
  const text = (id) => [byId[id].summary, ...byId[id].body].join(" ").toLowerCase();

  assert.match(
    text("online-payments"),
    /does not change a link you have already sent/,
    "the payment-methods warning must survive the move"
  );
  assert.match(
    text("categories"),
    /including on records you filed years ago/,
    "the rename-everywhere consequence must survive the move"
  );
  assert.match(
    text("mileage"),
    /never assumed by this product/,
    "the 'we do not guess the IRS rate' statement must survive the move"
  );
  assert.match(
    text("documents"),
    /does not compute currency/,
    "the expirations-are-not-currency limit must survive the move"
  );
});
