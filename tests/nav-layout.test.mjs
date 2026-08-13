import test from "node:test";
import assert from "node:assert/strict";

const {
  NAV_SECTIONS,
  NAV_SETTINGS,
  CURRENCY_PATH,
  DASHBOARD_PATH,
  DEFAULT_NAV_LAYOUT,
  applyNavLayout,
  navGroupsAreContiguous,
  normalizeNavLayout,
  visibleNavSections,
  isCurrentSection,
} = await import("../lib/nav.ts");

const hrefs = (items) => items.map((item) => item.href);
const ALL = visibleNavSections(true);

/**
 * THE TENANT NAV LAYOUT (Phase 9 Layer 2).
 *
 * Two properties matter more than the reordering itself, and both are
 * asserted below rather than described:
 *
 *   1. HIDING IS A DISPLAY PREFERENCE, NOT A PERMISSION. A hidden section
 *      keeps its route, keeps matching isCurrentSection, and keeps its
 *      robots.txt disallow entry — because robots derives from
 *      NAV_SECTIONS, not from the layout. If that ever stopped being
 *      true, a pilot who tidied their rail would have silently locked
 *      themselves out of a screen they paid for, or worse, a hidden
 *      screen would have been quietly invited to crawlers.
 *   2. THE RESOLVER IS TOTAL. Its input is a jsonb blob written by an
 *      older build; garbage, stale hrefs and hostile shapes are ordinary
 *      inputs, not error cases.
 */

test("normalizeNavLayout is total over untrusted input", async (t) => {
  await t.test("non-objects resolve to the default layout", () => {
    for (const raw of [null, undefined, 0, 1, "", "layout", true, [], [["/trips"]], NaN]) {
      assert.deepEqual(normalizeNavLayout(raw), DEFAULT_NAV_LAYOUT);
    }
  });

  await t.test("mistyped fields are ignored, not coerced", () => {
    assert.deepEqual(normalizeNavLayout({ order: "/trips", hidden: 7 }), DEFAULT_NAV_LAYOUT);
    assert.deepEqual(
      normalizeNavLayout({ order: ["/trips", 7, null, {}, ["/logbook"]] }),
      { order: ["/trips"], hidden: [] }
    );
  });

  await t.test("unknown and stale hrefs are dropped", () => {
    // The expected steady state after any nav change: a section that was
    // renamed or removed leaves a string behind in every stored layout.
    const layout = normalizeNavLayout({
      order: ["/trips", "/mileage-tracker-2019", "https://example.com", "/trips/1"],
      hidden: ["/gone", "/expenses"],
    });
    assert.deepEqual(layout.order, ["/trips"]);
    assert.deepEqual(layout.hidden, ["/expenses"]);
  });

  await t.test("duplicates collapse so one section cannot claim two ranks", () => {
    const layout = normalizeNavLayout({
      order: ["/trips", "/trips", "/logbook", "/trips"],
      hidden: ["/expenses", "/expenses"],
    });
    assert.deepEqual(layout.order, ["/trips", "/logbook"]);
    assert.deepEqual(layout.hidden, ["/expenses"]);
  });

  await t.test("/settings survives in neither list, however it got in there", () => {
    // Settings is not one of NAV_SECTIONS — the rail renders it
    // separately, below its own separator — so it is neither orderable
    // nor hideable. A stored blob naming it cannot take away the way
    // back to the screen where this setting is undone.
    const layout = normalizeNavLayout({
      order: [NAV_SETTINGS.href, "/trips"],
      hidden: [NAV_SETTINGS.href, "/trips"],
    });
    assert.equal(layout.hidden.includes(NAV_SETTINGS.href), false);
    assert.equal(layout.order.includes(NAV_SETTINGS.href), false);
    assert.deepEqual(layout.hidden, ["/trips"]);
    assert.deepEqual(layout.order, ["/trips"]);
  });

  await t.test("an absurdly long stored array is truncated rather than honoured", () => {
    const order = Array.from({ length: 500 }, () => "/trips");
    assert.ok(normalizeNavLayout({ order }).order.length <= 64);
  });
});

test("applyNavLayout orders and hides", async (t) => {
  await t.test("an empty layout changes nothing", () => {
    assert.deepEqual(hrefs(applyNavLayout(ALL, DEFAULT_NAV_LAYOUT)), hrefs(ALL));
  });

  await t.test("named sections lead, in the order given", () => {
    const result = applyNavLayout(ALL, { order: ["/expenses", "/trips"], hidden: [] });
    assert.deepEqual(hrefs(result).slice(0, 2), ["/expenses", "/trips"]);
  });

  await t.test("unlisted sections keep their relative order, stably", () => {
    const result = applyNavLayout(ALL, { order: ["/documents"], hidden: [] });
    const rest = hrefs(result).slice(1);
    const expected = hrefs(ALL).filter((href) => href !== "/documents");
    assert.deepEqual(rest, expected);
  });

  await t.test("a layout written before a section existed still applies", () => {
    // The stored order names three sections; the product has since grown
    // others. Nothing is lost and nothing is reshuffled.
    const result = applyNavLayout(ALL, {
      order: ["/invoices", "/clients", "/gone-section"],
      hidden: [],
    });
    assert.deepEqual(hrefs(result).slice(0, 2), ["/invoices", "/clients"]);
    assert.equal(result.length, ALL.length);
  });

  await t.test("hidden sections leave the rendered list", () => {
    const result = applyNavLayout(ALL, { order: [], hidden: ["/estimates", "/accounting"] });
    assert.equal(hrefs(result).includes("/estimates"), false);
    assert.equal(hrefs(result).includes("/accounting"), false);
    assert.equal(result.length, ALL.length - 2);
  });

  await t.test("Settings is never hidden even by a hand-built layout", () => {
    // normalizeNavLayout already strips it; this asserts the belt as well
    // as the braces, for a NavLayout built in code rather than parsed.
    const result = applyNavLayout([...ALL, NAV_SETTINGS], {
      order: [],
      hidden: [NAV_SETTINGS.href],
    });
    assert.equal(hrefs(result).includes(NAV_SETTINGS.href), true);
  });

  await t.test("hiding everything still returns an empty list, not a throw", () => {
    const result = applyNavLayout(ALL, { order: [], hidden: hrefs(ALL) });
    assert.deepEqual(result, []);
  });

  await t.test("the layout cannot resurrect a flag-gated section", () => {
    // Currency is filtered upstream by the engine flag. A stored layout
    // that names it must stay inert — navigation is one of that flag's
    // four independent enforcement points.
    const withoutCurrency = visibleNavSections(false);
    const result = applyNavLayout(withoutCurrency, {
      order: [CURRENCY_PATH],
      hidden: [],
    });
    assert.equal(hrefs(result).includes(CURRENCY_PATH), false);
  });

  await t.test("a stored place for a flag-gated section returns with the flag", () => {
    const layout = normalizeNavLayout({ order: [CURRENCY_PATH], hidden: [] });
    assert.deepEqual(layout.order, [CURRENCY_PATH]);
    const result = applyNavLayout(visibleNavSections(true), layout);
    assert.equal(hrefs(result)[0], CURRENCY_PATH);
  });
});

/**
 * The property the whole feature turns on. A "hidden" section is hidden
 * from the RAIL. Everything that makes it a route is untouched.
 */
test("hiding a section hides the nav entry only — the route is untouched", async (t) => {
  const HIDDEN = "/estimates";
  const layout = normalizeNavLayout({ order: [], hidden: [HIDDEN] });
  const rendered = applyNavLayout(ALL, layout);

  await t.test("it is gone from the rail", () => {
    assert.equal(hrefs(rendered).includes(HIDDEN), false);
  });

  await t.test("it is still a section of the product", () => {
    assert.ok(NAV_SECTIONS.some((item) => item.href === HIDDEN));
  });

  await t.test("its route still resolves as the current section", () => {
    assert.equal(isCurrentSection(HIDDEN, HIDDEN), true);
    assert.equal(isCurrentSection(HIDDEN, `${HIDDEN}/abc123`), true);
  });

  await t.test("robots.txt still disallows it — robots derives from NAV_SECTIONS", async () => {
    process.env.VERCEL_ENV = "production";
    const robots = (await import("../app/robots.ts")).default;
    const rules = robots().rules;
    const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];
    assert.ok(
      disallow.includes(HIDDEN),
      "a section hidden from one tenant's rail must still be disallowed to crawlers"
    );
    assert.ok(disallow.includes(DASHBOARD_PATH));
  });
});

/**
 * GROUP HEADERS SURVIVE ONLY WHILE THEY MEAN SOMETHING.
 *
 * The rail draws a header wherever the group changes walking the list.
 * That is correct exactly while each group is one contiguous run, and it
 * silently stops being correct when a tenant's order interleaves two —
 * at which point the rail prints the same group name twice with a gap
 * injected mid-list, and after two more moves carries a header above
 * nearly every item. navGroupsAreContiguous is the predicate the rail
 * gates on, so the failure is an ungrouped (honest) rail rather than a
 * striped one.
 */
test("navGroupsAreContiguous decides whether the rail may draw headers", async (t) => {
  await t.test("the default order is contiguous", () => {
    assert.equal(navGroupsAreContiguous(ALL), true);
  });

  await t.test("hiding sections keeps the runs intact", () => {
    const result = applyNavLayout(ALL, { order: [], hidden: ["/estimates"] });
    assert.equal(navGroupsAreContiguous(result), true);
  });

  await t.test("promoting a whole group keeps its headers", () => {
    // Every BUSINESS section to the front, in one block: three runs
    // still, just in a different order.
    const business = ALL.filter((item) => item.group === "BUSINESS");
    assert.ok(business.length > 1, "fixture needs a multi-item group");
    const result = applyNavLayout(ALL, {
      order: business.map((item) => item.href),
      hidden: [],
    });
    assert.equal(navGroupsAreContiguous(result), true);
  });

  await t.test("interleaving two groups breaks them, and is detected", () => {
    // One BUSINESS section alone at the top, the rest left where they
    // were — the "moved Invoices to the top" case exactly.
    const business = ALL.find((item) => item.group === "BUSINESS");
    const ops = ALL.find((item) => item.group === "OPS");
    assert.ok(business && ops, "fixture needs both groups");
    const result = applyNavLayout(ALL, { order: [business.href], hidden: [] });
    assert.equal(navGroupsAreContiguous(result), false);
  });

  await t.test("an empty or single-item list is trivially contiguous", () => {
    assert.equal(navGroupsAreContiguous([]), true);
    assert.equal(navGroupsAreContiguous([ALL[0]]), true);
  });
});
