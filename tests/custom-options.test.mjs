import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
  BUILTIN_OPTIONS,
  CUSTOM_OPTION_DOMAINS,
  DOMAIN_KEYS_ARE_PINNED,
  choicesFor,
  isCustomOptionDomain,
  labelsFor,
  rowsForDomain,
  storableKeys,
} = await import("../lib/custom-options.ts");

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260813000000_preferences_and_custom_options.sql",
      import.meta.url
    )
  ),
  "utf8"
);

let nextId = 0;
function row(domain, key, extra = {}) {
  nextId += 1;
  return {
    id: `row-${nextId}`,
    domain,
    key,
    label: key,
    sort_order: 0,
    is_builtin: true,
    archived_at: null,
    ...extra,
  };
}

test("the built-in vocabulary matches what the migration seeds", async (t) => {
  // The seeder and this list are two copies of the same 30 rows. They are
  // allowed to be two copies — one is SQL and one is TypeScript — but they
  // are not allowed to disagree, and "someone will notice" is not a
  // mechanism. Parsed out of the migration rather than retyped here.
  const seeded = {};
  for (const match of MIGRATION.matchAll(
    /\(target_account_id,\s*'([a-z_]+)',\s*'([a-z0-9_]+)',\s*'([^']*)'/g
  )) {
    const [, domain, key, label] = match;
    (seeded[domain] ??= []).push({ value: key, label });
  }

  for (const domain of CUSTOM_OPTION_DOMAINS) {
    await t.test(`${domain} — same keys, same labels, same order`, () => {
      assert.deepEqual(
        BUILTIN_OPTIONS[domain].map((option) => ({ ...option })),
        seeded[domain],
        `lib/custom-options.ts and seed_custom_options disagree about ${domain}`
      );
    });
  }

  await t.test("the counts the migration's own header claims", () => {
    assert.equal(BUILTIN_OPTIONS.expense_category.length, 15);
    assert.equal(BUILTIN_OPTIONS.trip_kind.length, 7);
    assert.equal(BUILTIN_OPTIONS.document_kind.length, 8);
  });
});

test("isCustomOptionDomain guards the domain vocabulary", () => {
  for (const domain of CUSTOM_OPTION_DOMAINS) assert.equal(isCustomOptionDomain(domain), true);
  for (const bad of ["", "expense", "day_type", null, 7, {}, ["trip_kind"]]) {
    assert.equal(isCustomOptionDomain(bad), false);
  }
});

test("rowsForDomain orders the way the pickers render", async (t) => {
  await t.test("sort_order first, key as a stable tiebreak", () => {
    const rows = [
      row("trip_kind", "ferry", { sort_order: 20 }),
      row("trip_kind", "other", { sort_order: 10 }),
      row("trip_kind", "contract_pilot", { sort_order: 10 }),
      row("expense_category", "hotel", { sort_order: 1 }),
    ];
    assert.deepEqual(
      rowsForDomain(rows, "trip_kind").map((r) => r.key),
      ["contract_pilot", "other", "ferry"]
    );
  });

  await t.test("other domains are not mixed in", () => {
    const rows = [row("trip_kind", "ferry"), row("document_kind", "w9")];
    assert.deepEqual(rowsForDomain(rows, "document_kind").map((r) => r.key), ["w9"]);
  });

  await t.test("the input array is not mutated", () => {
    const rows = [row("trip_kind", "b", { sort_order: 2 }), row("trip_kind", "a", { sort_order: 1 })];
    const before = rows.map((r) => r.key);
    rowsForDomain(rows, "trip_kind");
    assert.deepEqual(rows.map((r) => r.key), before);
  });
});

test("choicesFor — what a picker may offer", async (t) => {
  await t.test("a tenant's labels and order win", () => {
    const rows = [
      row("trip_kind", "ferry", { label: "Ferry flight", sort_order: 10 }),
      row("trip_kind", "other", { label: "Something else", sort_order: 20 }),
    ];
    assert.deepEqual(choicesFor(rows, "trip_kind"), [
      { value: "ferry", label: "Ferry flight" },
      { value: "other", label: "Something else" },
    ]);
  });

  await t.test("archived options are not offered", () => {
    const rows = [
      row("trip_kind", "ferry", { sort_order: 10 }),
      row("trip_kind", "other", { sort_order: 20, archived_at: "2026-08-01T00:00:00Z" }),
    ];
    assert.deepEqual(choicesFor(rows, "trip_kind").map((c) => c.value), ["ferry"]);
  });

  await t.test("a key the column's CHECK would refuse is never offered", () => {
    // The storability guard. No app path can create such a row today, but
    // a hand-written INSERT or a restored backup can — and a picker that
    // offers a value the database refuses is worse than one that does
    // not. See lib/custom-options.ts's header.
    assert.ok(DOMAIN_KEYS_ARE_PINNED.expense_category, "guard only applies while pinned");
    const rows = [
      row("expense_category", "hotel", { sort_order: 10 }),
      row("expense_category", "hangar_rent", {
        sort_order: 20,
        is_builtin: false,
        label: "Hangar rent",
      }),
    ];
    const offered = choicesFor(rows, "expense_category").map((c) => c.value);
    assert.equal(offered.includes("hangar_rent"), false);
    assert.equal(offered.includes("hotel"), true);
    // ...and every key that IS offered is one the column accepts.
    const storable = storableKeys("expense_category");
    for (const value of offered) assert.ok(storable.has(value));
  });

  await t.test("an empty or unreadable options table falls back to the built-ins", () => {
    // A failed read must never produce an empty picker: a pilot who
    // cannot file an expense because a settings table blinked is far
    // worse than one who briefly sees the stock labels.
    for (const rows of [[], [row("document_kind", "w9")]]) {
      const choices = choicesFor(rows, "trip_kind");
      assert.deepEqual(
        choices,
        BUILTIN_OPTIONS.trip_kind.map((option) => ({ ...option }))
      );
    }
  });

  await t.test("archiving every option still leaves a usable picker", () => {
    const rows = BUILTIN_OPTIONS.trip_kind.map((option, index) =>
      row("trip_kind", option.value, {
        sort_order: index * 10,
        archived_at: "2026-08-01T00:00:00Z",
      })
    );
    assert.equal(choicesFor(rows, "trip_kind").length, BUILTIN_OPTIONS.trip_kind.length);
  });
});

test("labelsFor — what history renders", async (t) => {
  await t.test("an ARCHIVED option still resolves to its name", () => {
    // The whole reason custom_options archives instead of deleting: three
    // years of expenses filed under a retired category must keep
    // rendering under whatever it is called, even though it is no longer
    // offered for new ones.
    const rows = [
      row("expense_category", "hotel", {
        label: "Lodging",
        sort_order: 10,
        archived_at: "2026-08-01T00:00:00Z",
      }),
      // A second, live option, so the "never leave a picker empty"
      // fallback is not what makes this assertion pass.
      row("expense_category", "fuel", { label: "Fuel", sort_order: 20 }),
    ];
    assert.equal(labelsFor(rows, "expense_category").hotel, "Lodging");
    assert.equal(
      choicesFor(rows, "expense_category").some((c) => c.value === "hotel"),
      false,
      "an archived option must be labelled but not offered"
    );
  });

  await t.test("keys with no stored row still resolve, via the built-ins", () => {
    const labels = labelsFor([], "expense_category");
    assert.equal(labels.rideshare, "Rideshare");
    assert.equal(labels.dues, "Dues / publications");
    assert.equal(Object.keys(labels).length, BUILTIN_OPTIONS.expense_category.length);
  });

  await t.test("a rename shows everywhere, including on past records", () => {
    const rows = [row("expense_category", "rideshare", { label: "Uber & Lyft" })];
    assert.equal(labelsFor(rows, "expense_category").rideshare, "Uber & Lyft");
  });

  await t.test("even an unstorable key gets a label if a row exists for it", () => {
    // It is kept OUT of the picker (above) but IN the label map: if such
    // a row ever reached a record, the screen showing that record must
    // still render a word rather than a raw key.
    const rows = [
      row("expense_category", "hangar_rent", { is_builtin: false, label: "Hangar rent" }),
    ];
    assert.equal(labelsFor(rows, "expense_category").hangar_rent, "Hangar rent");
  });
});
