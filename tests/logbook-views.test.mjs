import test from "node:test";
import assert from "node:assert/strict";

const {
  tailKeyOf,
  resolveLogbookFilter,
  resolveLogbookViews,
  saveLogbookView,
  removeLogbookView,
  findLogbookView,
  logbookFilterIsEmpty,
  logbookFiltersEqual,
  logbookFilterHref,
  logbookFilterFromSearchParams,
  describeLogbookFilter,
  MAX_LOGBOOK_VIEWS,
  MAX_VIEW_NAME,
  EMPTY_LOGBOOK_FILTER,
} = await import("../lib/logbook-views.ts");

/**
 * (lib/preferences.ts itself imports "server-only" and therefore cannot be
 * imported here — the same reason lib/theme-slots.ts and lib/nav.ts hold
 * their own validators and carry their own tests. This file covers the
 * validator this feature added; the composition of the three preference
 * keys is exercised by the app.)
 */

/**
 * Saved logbook views — the third key in pilot.account_preferences.prefs.
 *
 * What carries weight here:
 * 1. TOTALITY. The resolver's input is a jsonb blob written by an earlier
 *    build, a restored backup, or a support fix. Every shape resolves to a
 *    valid list; nothing throws.
 * 2. DROPPING WIDENS, NEVER NARROWS. An unresolvable facet is removed, so
 *    a stale view shows MORE of the logbook, not less — a record screen
 *    must never silently hide entries.
 * 3. THE NORMALISATION ORDER. tailKeyOf strips before uppercasing, which is
 *    not the same as the other order and shipped wrong once.
 * 4. THE NAME IS THE KEY: saving over a name replaces in place.
 */

// ---------------------------------------------------------------------------
// 3. Tail-key normalisation.
// ---------------------------------------------------------------------------

test("tailKeyOf folds the spellings of one registration together", () => {
  assert.equal(tailKeyOf("N447SP"), "N447SP");
  assert.equal(tailKeyOf("N-447SP"), "N447SP");
  assert.equal(tailKeyOf("n447sp"), "N447SP");
  assert.equal(tailKeyOf(" n-447 sp "), "N447SP");
  assert.equal(tailKeyOf("G-ABCD"), "GABCD");
});

test("tailKeyOf STRIPS BEFORE UPPERCASING — the order the generated column uses", () => {
  // 'ß'.toUpperCase() is "SS", so uppercasing first would PROMOTE a
  // character Postgres strips and answer "SSSS" where the database stores
  // an empty key. This is the bug that shipped once.
  const sharp = String.fromCharCode(0x00df);
  assert.equal(tailKeyOf(sharp + sharp), "");
  assert.notEqual(tailKeyOf(sharp + sharp), "SSSS");
});

// ---------------------------------------------------------------------------
// 1 & 2. Filter resolution: total, and dropping widens.
// ---------------------------------------------------------------------------

test("resolveLogbookFilter is total over junk input", () => {
  for (const junk of [
    null,
    undefined,
    0,
    "",
    "nonsense",
    [],
    [1, 2, 3],
    { tail: 42 },
    { role: {} },
    { dateFrom: [] },
    NaN,
    true,
  ]) {
    const filter = resolveLogbookFilter(junk);
    assert.deepEqual(filter, EMPTY_LOGBOOK_FILTER, `junk input: ${JSON.stringify(junk)}`);
    assert.equal(logbookFilterIsEmpty(filter), true);
  }
});

test("a filter accepts both the stored key names and the URL key names", () => {
  const stored = resolveLogbookFilter({
    tailKey: "N447SP",
    typeLabel: "CE-500",
    role: "PIC",
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
  });
  const fromUrl = resolveLogbookFilter({
    tail: "n-447sp",
    type: "CE-500",
    role: "PIC",
    from: "2026-01-01",
    to: "2026-12-31",
  });
  assert.deepEqual(stored, fromUrl);
  assert.equal(logbookFiltersEqual(stored, fromUrl), true);
});

test("an unrecognised role is dropped, never coerced to a real one", () => {
  assert.equal(resolveLogbookFilter({ role: "PIC" }).role, "PIC");
  assert.equal(resolveLogbookFilter({ role: "DUAL_GIVEN" }).role, null);
  assert.equal(resolveLogbookFilter({ role: "pic" }).role, null);
  assert.equal(resolveLogbookFilter({ role: "CAPTAIN" }).role, null);
});

test("a date that is a shape but not a date is dropped", () => {
  assert.equal(resolveLogbookFilter({ from: "2026-02-28" }).dateFrom, "2026-02-28");
  assert.equal(resolveLogbookFilter({ from: "2028-02-29" }).dateFrom, "2028-02-29");
  // Not real dates.
  assert.equal(resolveLogbookFilter({ from: "2026-02-31" }).dateFrom, null);
  assert.equal(resolveLogbookFilter({ from: "2026-13-01" }).dateFrom, null);
  assert.equal(resolveLogbookFilter({ from: "2026-00-10" }).dateFrom, null);
  assert.equal(resolveLogbookFilter({ from: "26-01-01" }).dateFrom, null);
});

test("an impossible range is dropped WHOLE — never kept, never swapped", () => {
  // Kept, it returns nothing and reads as a logbook that lost its entries.
  // Swapped, it answers a question nobody asked and looks like it worked.
  const filter = resolveLogbookFilter({ from: "2026-12-31", to: "2026-01-01" });
  assert.equal(filter.dateFrom, null);
  assert.equal(filter.dateTo, null);
  // A single-day range is legitimate and survives.
  const oneDay = resolveLogbookFilter({ from: "2026-05-05", to: "2026-05-05" });
  assert.equal(oneDay.dateFrom, "2026-05-05");
  assert.equal(oneDay.dateTo, "2026-05-05");
});

test("a tail that normalises out of range is dropped", () => {
  assert.equal(resolveLogbookFilter({ tail: "N" }).tailKey, null);
  assert.equal(resolveLogbookFilter({ tail: "---" }).tailKey, null);
  assert.equal(resolveLogbookFilter({ tail: "N1234567890123" }).tailKey, null);
  assert.equal(resolveLogbookFilter({ tail: "N1" }).tailKey, "N1");
});

// ---------------------------------------------------------------------------
// URL round trip.
// ---------------------------------------------------------------------------

test("a filter survives the round trip through a URL", () => {
  const filter = resolveLogbookFilter({
    tail: "N447SP",
    type: "CE-500",
    role: "SIC",
    from: "2025-01-01",
    to: "2025-12-31",
  });
  const href = logbookFilterHref(filter);
  const params = Object.fromEntries(new URL(href, "https://example.test").searchParams);
  assert.deepEqual(resolveLogbookFilter(params), filter);
});

test("an empty filter is the bare path, and a page is appended only past page 1", () => {
  assert.equal(logbookFilterHref(EMPTY_LOGBOOK_FILTER), "/logbook");
  assert.equal(logbookFilterHref(EMPTY_LOGBOOK_FILTER, 1), "/logbook");
  assert.equal(logbookFilterHref(EMPTY_LOGBOOK_FILTER, 3), "/logbook?page=3");
  assert.equal(
    logbookFilterHref(resolveLogbookFilter({ role: "PIC" }), 2),
    "/logbook?role=PIC&page=2"
  );
});

test("a repeated query parameter resolves to the first value rather than being dropped", () => {
  const filter = logbookFilterFromSearchParams({
    role: ["PIC", "SIC"],
    tail: ["N447SP"],
    type: undefined,
  });
  assert.equal(filter.role, "PIC");
  assert.equal(filter.tailKey, "N447SP");
  assert.equal(filter.typeLabel, null);
});

// ---------------------------------------------------------------------------
// 1. View list resolution.
// ---------------------------------------------------------------------------

test("resolveLogbookViews is total over junk input", () => {
  for (const junk of [null, undefined, 0, "", {}, "views", 42, true, [null], [[]], [7]]) {
    assert.deepEqual(resolveLogbookViews(junk), []);
  }
});

test("a view whose filter no longer resolves is dropped, not shown empty", () => {
  const views = resolveLogbookViews([
    { name: "Good", filter: { tail: "N447SP" } },
    // Every facet unresolvable → an empty filter → a name promising a
    // slice that would show the whole logbook.
    { name: "Stale", filter: { role: "DUAL_GIVEN", from: "not-a-date" } },
    { name: "Also stale", filter: {} },
    { name: "No filter key at all" },
  ]);
  assert.equal(views.length, 1);
  assert.equal(views[0].name, "Good");
});

test("names are normalised, capped, and deduplicated case-insensitively", () => {
  const views = resolveLogbookViews([
    { name: "  The   Citation  ", filter: { tail: "N447SP" } },
    { name: "the citation", filter: { role: "SIC" } },
    { name: "x".repeat(MAX_VIEW_NAME + 40), filter: { role: "PIC" } },
    { name: "   ", filter: { role: "PIC" } },
    { name: 7, filter: { role: "PIC" } },
  ]);
  assert.equal(views.length, 2);
  assert.equal(views[0].name, "The Citation");
  assert.equal(views[1].name.length, MAX_VIEW_NAME);
});

test("the list is capped so one preference key cannot fill the 16 KB row", () => {
  const many = Array.from({ length: MAX_LOGBOOK_VIEWS + 25 }, (_, i) => ({
    name: `View ${i}`,
    filter: { role: "PIC", from: "2020-01-01" },
  }));
  assert.equal(resolveLogbookViews(many).length, MAX_LOGBOOK_VIEWS);
});

// ---------------------------------------------------------------------------
// 4. The name is the key.
// ---------------------------------------------------------------------------

test("saving over an existing name replaces it IN PLACE", () => {
  const first = saveLogbookView([], "Citation", resolveLogbookFilter({ tail: "N447SP" }));
  assert.equal(first.ok, true);
  const second = saveLogbookView(first.views, "Night", resolveLogbookFilter({ role: "PIC" }));
  assert.equal(second.ok, true);

  const replaced = saveLogbookView(
    second.views,
    "  citation  ",
    resolveLogbookFilter({ tail: "N100AB" })
  );
  assert.equal(replaced.ok, true);
  assert.equal(replaced.views.length, 2);
  // Position kept — a filter you adjust should not jump in a list you have
  // learned the order of — but the SPELLING just typed wins, which is the
  // only rename path there is.
  assert.equal(replaced.views[0].name, "citation");
  assert.equal(replaced.views[0].filter.tailKey, "N100AB");
  assert.equal(replaced.views[1].name, "Night");
});

test("saving refuses a blank name and an empty filter, with a sentence", () => {
  const noName = saveLogbookView([], "   ", resolveLogbookFilter({ tail: "N447SP" }));
  assert.equal(noName.ok, false);
  assert.match(noName.error, /name/i);

  const noFilter = saveLogbookView([], "Everything", EMPTY_LOGBOOK_FILTER);
  assert.equal(noFilter.ok, false);
  assert.match(noFilter.error, /narrow/i);
});

test("saving a NEW view past the cap is refused rather than silently dropped", () => {
  let views = [];
  for (let i = 0; i < MAX_LOGBOOK_VIEWS; i += 1) {
    const result = saveLogbookView(views, `View ${i}`, resolveLogbookFilter({ tail: `N${i}00AB` }));
    assert.equal(result.ok, true);
    views = result.views;
  }
  const overflow = saveLogbookView(views, "One more", resolveLogbookFilter({ role: "PIC" }));
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, new RegExp(String(MAX_LOGBOOK_VIEWS)));

  // Saving OVER an existing name at the cap still works — it adds nothing.
  const replace = saveLogbookView(views, "View 0", resolveLogbookFilter({ role: "SIC" }));
  assert.equal(replace.ok, true);
  assert.equal(replace.views.length, MAX_LOGBOOK_VIEWS);
});

test("delete and find both match on the name key, not the raw string", () => {
  const saved = saveLogbookView([], "Citation V", resolveLogbookFilter({ tail: "N447SP" }));
  assert.ok(findLogbookView(saved.views, "  citation   v "));
  assert.equal(removeLogbookView(saved.views, "CITATION V").length, 0);
  // Removing something that is not there is a no-op, not an error.
  assert.equal(removeLogbookView(saved.views, "Nothing").length, 1);
});

// ---------------------------------------------------------------------------
// The caption a filtered total is printed under.
// ---------------------------------------------------------------------------

test("an empty filter describes itself as the whole logbook, not as nothing", () => {
  assert.equal(describeLogbookFilter(EMPTY_LOGBOOK_FILTER), "Every entry in your logbook");
});

test("the description prefers the registration as the pilot writes it", () => {
  const filter = resolveLogbookFilter({ tail: "N-447SP", role: "PIC" });
  assert.equal(describeLogbookFilter(filter, "N-447SP"), "N-447SP · as PIC");
  // No registry row in hand: the key is better than nothing.
  assert.equal(describeLogbookFilter(filter), "N447SP · as PIC");
});

test("the description names every facet that is set", () => {
  const filter = resolveLogbookFilter({
    tail: "N447SP",
    type: "CE-500",
    role: "SIC",
    from: "2025-01-01",
    to: "2025-12-31",
  });
  const text = describeLogbookFilter(filter, "N447SP");
  for (const part of ["N447SP", "CE-500", "as SIC", "2025-01-01", "2025-12-31"]) {
    assert.ok(text.includes(part), `description omitted ${part}: ${text}`);
  }
});

test("an open-ended range says which end is open", () => {
  assert.match(describeLogbookFilter(resolveLogbookFilter({ from: "2026-01-01" })), /on or after/);
  assert.match(describeLogbookFilter(resolveLogbookFilter({ to: "2026-01-01" })), /on or before/);
});
