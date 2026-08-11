import test from "node:test";
import assert from "node:assert/strict";

const {
  ESTIMATE_STATUSES,
  ESTIMATE_TRANSITIONS,
  ESTIMATE_STATUS_BADGE,
  ESTIMATE_LINE_TYPES,
  ESTIMATE_LINE_TYPE_LABEL,
  canTransition,
  parsePercentToBps,
  parseQuantity,
  isDate,
  previewTotals,
  estimateRefusalMessage,
} = await import("../app/(app)/estimates/estimate-lib.ts");

/**
 * The estimates screens' pure helpers. All fixtures synthetic.
 *
 * The transition table and the totals arithmetic are copies of rules that
 * live in supabase/migrations/20260810060000_phase10_estimates.sql
 * (pilot.estimates_protect and pilot.estimate_totals). These tests pin the
 * copies to the migration's own rules — including the exact fixture
 * numbers scripts/estimates-verify.mjs proves against a real Postgres —
 * so the UI's gating and its running preview can't quietly drift from
 * what the database will actually accept and compute.
 */

test("the status machine mirrors pilot.estimates_protect exactly", async (t) => {
  await t.test("every legal transition, and only those", () => {
    // The trigger's own table, verbatim:
    //   draft -> sent
    //   sent -> accepted | declined | draft
    //   declined -> sent | accepted
    const legal = new Set([
      "draft>sent",
      "sent>accepted",
      "sent>declined",
      "sent>draft",
      "declined>sent",
      "declined>accepted",
    ]);
    for (const from of ESTIMATE_STATUSES) {
      for (const to of ESTIMATE_STATUSES) {
        if (from === to) continue; // not a transition; the trigger only fires on change
        assert.equal(
          canTransition(from, to),
          legal.has(`${from}>${to}`),
          `${from} -> ${to} must ${legal.has(`${from}>${to}`) ? "be offered" : "never be offered"}`
        );
      }
    }
  });

  await t.test("accepted is terminal — conversion is a function, not a transition", () => {
    assert.deepEqual([...ESTIMATE_TRANSITIONS.accepted], []);
  });

  await t.test("every status renders a badge, so no state can render blank", () => {
    for (const status of ESTIMATE_STATUSES) {
      assert.ok(ESTIMATE_STATUS_BADGE[status]?.label, `${status} needs a badge`);
    }
  });

  await t.test("every line type the CHECK admits has a label, and no extras", () => {
    // pilot.estimate_lines.line_type's CHECK list — identical to
    // invoice_lines' vocabulary by the migration's own requirement.
    assert.deepEqual(
      [...ESTIMATE_LINE_TYPES].sort(),
      [
        "cancellation_fee",
        "flight_day",
        "other",
        "per_diem",
        "reimbursable_expense",
        "travel_day",
      ]
    );
    for (const type of ESTIMATE_LINE_TYPES) {
      assert.ok(ESTIMATE_LINE_TYPE_LABEL[type], `${type} needs a label`);
    }
  });
});

test("tax percent input to basis points", async (t) => {
  await t.test("ordinary rates", () => {
    assert.equal(parsePercentToBps("8.25"), 825);
    assert.equal(parsePercentToBps("0"), 0);
    assert.equal(parsePercentToBps("25"), 2500);
  });
  await t.test("blank is null (no rate), garbage is undefined (a typo, not zero)", () => {
    assert.equal(parsePercentToBps(""), null);
    assert.equal(parsePercentToBps("  "), null);
    assert.equal(parsePercentToBps("abc"), undefined);
    assert.equal(parsePercentToBps("8.255"), undefined);
  });
  await t.test("the column's own 25% ceiling is enforced before Postgres sees it", () => {
    assert.equal(parsePercentToBps("25.01"), undefined);
    assert.equal(parsePercentToBps("99"), undefined);
  });
});

test("quantity input for a numeric(6,2) column", async (t) => {
  await t.test("whole and two-decimal quantities pass", () => {
    assert.equal(parseQuantity("1"), 1);
    assert.equal(parseQuantity("2.5"), 2.5);
    assert.equal(parseQuantity("2.25"), 2.25);
  });
  await t.test("zero, negatives, three decimals and overflow are refused, never rounded", () => {
    // numeric(6,2) would silently ROUND 2.255 — refusing here is what
    // keeps the pilot's typed figure the billed figure.
    assert.equal(parseQuantity("0"), undefined);
    assert.equal(parseQuantity("-1"), undefined);
    assert.equal(parseQuantity("2.255"), undefined);
    assert.equal(parseQuantity("10000"), undefined);
  });
});

test("date strings", () => {
  assert.equal(isDate("2026-08-11"), true);
  assert.equal(isDate("2026-02-30"), false);
  assert.equal(isDate("2026-8-1"), false);
  assert.equal(isDate("not a date"), false);
});

test("the running preview computes what pilot.estimate_totals will", async (t) => {
  await t.test("the verify script's own fixture: tax on taxable lines only", () => {
    // scripts/estimates-verify.mjs's quote: three flight days at $1,200,
    // one travel day at $600, four days per diem at $75 (NOT taxable — a
    // reimbursement, not a service), at 8.25%. The database asserts
    // 450000|34650|484650 for this exact estimate; the preview must agree.
    const result = previewTotals(
      [
        { quantity: 3, unitAmountCents: 120000, taxable: true },
        { quantity: 1, unitAmountCents: 60000, taxable: true },
        { quantity: 4, unitAmountCents: 7500, taxable: false },
      ],
      825
    );
    assert.deepEqual(result, {
      subtotalCents: 450000,
      taxCents: 34650,
      totalCents: 484650,
    });
  });

  await t.test("per-line rounding, the generated column's own expression", () => {
    // amount_cents is round(quantity * unit_amount_cents) PER LINE — two
    // half-day lines at $333.33 round to 16667 + 16667, not round(33333.0).
    const result = previewTotals(
      [
        { quantity: 0.5, unitAmountCents: 33333, taxable: true },
        { quantity: 0.5, unitAmountCents: 33333, taxable: true },
      ],
      0
    );
    assert.equal(result.subtotalCents, 16667 + 16667);
  });

  await t.test("no lines is a $0.00 preview, not an error", () => {
    assert.deepEqual(previewTotals([], 825), {
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });
});

test("trigger refusals become sentences, and only known ones", async (t) => {
  await t.test("each named refusal maps", () => {
    const cases = [
      ["estimate EST-2026-0001 has already been converted", "already become an invoice"],
      [
        "only an accepted estimate can become an invoice (this one is draft)",
        "Only an accepted estimate",
      ],
      ["estimate EST-2026-0001 has no lines to invoice", "no line items"],
      // pilot.estimates_require_lines_on_send (the 20260812 migration) —
      // raised with the raw uuid, exactly like the invoice guard it mirrors.
      [
        "estimate 7c9e6679-7425-40de-944b-e07fc1f90ae7 cannot be sent with no line items",
        "can't be sent",
      ],
      ["estimate 5a0e... not found", "no longer exists"],
      ["estimate cannot move from draft to accepted", "status has changed"],
      ["estimate EST-2026-0001 has been sent; its number cannot change", "number is permanent"],
    ];
    for (const [message, expectFragment] of cases) {
      const result = estimateRefusalMessage({ code: "P0001", message });
      assert.ok(
        result && result.includes(expectFragment),
        `"${message}" should map to a sentence containing "${expectFragment}", got: ${result}`
      );
    }
  });

  await t.test("no raw uuid or estimate number ever passes through", () => {
    const result = estimateRefusalMessage({
      code: "P0001",
      message: "estimate 7c9e6679-7425-40de-944b-e07fc1f90ae7 has already been converted",
    });
    assert.ok(result && !result.includes("7c9e6679"));

    const emptySend = estimateRefusalMessage({
      code: "P0001",
      message: "estimate 7c9e6679-7425-40de-944b-e07fc1f90ae7 cannot be sent with no line items",
    });
    assert.ok(emptySend && !emptySend.includes("7c9e6679"));
  });

  await t.test("unknown codes and messages fall through to the generic scrubber", () => {
    // null tells the caller to use friendlyDbError — this map must never
    // invent a sentence for a message it doesn't actually know.
    assert.equal(estimateRefusalMessage({ code: "23505", message: "duplicate" }), null);
    assert.equal(
      estimateRefusalMessage({ code: "P0001", message: "some future trigger message" }),
      null
    );
    assert.equal(estimateRefusalMessage(null), null);
  });
});
