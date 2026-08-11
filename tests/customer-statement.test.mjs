import test from "node:test";
import assert from "node:assert/strict";

const { resolveStatementPeriod, isValidIsoDate, assembleStatement } = await import(
  "../app/(app)/clients/[id]/statement/statement-lib.ts"
);
const { escapeHtml, renderStatementHtml } = await import(
  "../app/(app)/clients/[id]/statement/statement-html.ts"
);

/**
 * The client statement. All fixtures synthetic.
 *
 * Two behaviours here carry money-safety weight and get pinned hard:
 *
 * 1. assembleStatement REFUSES when an invoice has no invoice_totals row,
 *    instead of filling the gap with zeros. A statement is the document a
 *    client's AP department pays from; a $0.00 fabricated for a real
 *    invoice understates what's owed with no signal anywhere — the exact
 *    defect class lib/supabase/rows.ts exists to close.
 *
 * 2. The period totals are sums of the per-invoice figures shown on the
 *    same document, and of nothing else — so a reader adding the column by
 *    hand always reconciles to the printed total.
 */

// ---------------------------------------------------------------------------
// Period resolution (?from=/?to=, validated server-side).
// ---------------------------------------------------------------------------

test("no params defaults to the current calendar year of the passed-in today", () => {
  const period = resolveStatementPeriod({}, "2026-08-11");
  assert.deepEqual(period, {
    from: "2026-01-01",
    to: "2026-12-31",
    usedDefault: true,
  });
});

test("valid explicit bounds pass through untouched", () => {
  const period = resolveStatementPeriod(
    { from: "2025-03-01", to: "2025-06-30" },
    "2026-08-11"
  );
  assert.deepEqual(period, {
    from: "2025-03-01",
    to: "2025-06-30",
    usedDefault: false,
  });
});

test("an impossible calendar date falls back to the default for that bound only", () => {
  // Feb 31 passes a shape-only regex; resolveStatementPeriod checks the
  // real calendar so a hand-edited URL degrades to a working default
  // instead of a failed query.
  const period = resolveStatementPeriod(
    { from: "2026-02-31", to: "2026-06-30" },
    "2026-08-11"
  );
  assert.equal(period.from, "2026-01-01");
  assert.equal(period.to, "2026-06-30");
  // Half-defaulted is not THE default: the page must not light the
  // "This year" preset for it.
  assert.equal(period.usedDefault, false);
});

test("garbage params fall back entirely, flagged as the default period", () => {
  const period = resolveStatementPeriod(
    { from: "not-a-date", to: "05 AUG 2026" },
    "2026-08-11"
  );
  assert.deepEqual(period, {
    from: "2026-01-01",
    to: "2026-12-31",
    usedDefault: true,
  });
});

test("a reversed range is swapped, not rejected", () => {
  const period = resolveStatementPeriod(
    { from: "2026-06-30", to: "2026-03-01" },
    "2026-08-11"
  );
  assert.equal(period.from, "2026-03-01");
  assert.equal(period.to, "2026-06-30");
});

test("calendar validity knows about leap years", () => {
  assert.equal(isValidIsoDate("2024-02-29"), true);
  assert.equal(isValidIsoDate("2026-02-29"), false);
  assert.equal(isValidIsoDate("2026-04-31"), false);
  assert.equal(isValidIsoDate("2026-12-31"), true);
});

// ---------------------------------------------------------------------------
// Row assembly and period totals.
// ---------------------------------------------------------------------------

const invoice = (id, status, over = {}) => ({
  id,
  invoice_number: `2026-00${id}`,
  status,
  issued_on: "2026-02-01",
  due_on: "2026-03-03",
  ...over,
});

const totalsRow = (id, total, paid) => ({
  invoice_id: id,
  total_cents: total,
  amount_paid_cents: paid,
  balance_due_cents: total - paid,
});

test("rows join invoice, totals, and overdue; period totals are the column sums", () => {
  const result = assembleStatement(
    [invoice("a", "paid"), invoice("b", "partial"), invoice("c", "sent")],
    [totalsRow("a", 350000, 350000), totalsRow("b", 120050, 20050), totalsRow("c", 99900, 0)],
    [{ invoice_id: "c", days_overdue: 74 }]
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 3);

  const byId = new Map(result.rows.map((r) => [r.id, r]));
  assert.equal(byId.get("a").balanceCents, 0);
  assert.equal(byId.get("b").paidCents, 20050);
  // Past-due-ness comes from the invoices_overdue rows passed in, never
  // recomputed from due_on here.
  assert.equal(byId.get("c").daysOverdue, 74);
  assert.equal(byId.get("a").daysOverdue, null);
  assert.equal(byId.get("b").daysOverdue, null);

  // The three period figures are sums of the exact per-row figures above.
  assert.deepEqual(result.totals, {
    invoicedCents: 350000 + 120050 + 99900,
    paidCents: 350000 + 20050 + 0,
    outstandingCents: 0 + 100000 + 99900,
  });
});

test("an invoice with no totals row fails the whole assembly — never a fabricated $0.00", () => {
  const result = assembleStatement(
    [invoice("a", "sent"), invoice("b", "sent")],
    [totalsRow("a", 50000, 0)],
    []
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingTotalsFor, ["b"]);
});

test("an empty invoice list assembles to an empty statement with zero totals", () => {
  // The VALID empty case — the caller only reaches assembly after the
  // reads verifiably succeeded, so zeros here mean "genuinely nothing
  // issued", which the surfaces render as words, not as a bare $0.00.
  const result = assembleStatement([], [], []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.totals, {
    invoicedCents: 0,
    paidCents: 0,
    outstandingCents: 0,
  });
});

// ---------------------------------------------------------------------------
// The print document.
// ---------------------------------------------------------------------------

test("escapeHtml neutralizes markup and quotes", () => {
  assert.equal(
    escapeHtml(`<script>alert("x")</script> & 'quotes'`),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;"
  );
});

const htmlInput = (rows, totals) => ({
  account: {
    name: "Jane Doe Aviation LLC",
    address: {
      address_line1: "1 Hangar Rd",
      address_line2: null,
      city: "Teterboro",
      state: "NJ",
      postal_code: "07608",
      country: null,
    },
  },
  client: {
    name: 'Owner & Ops <Group> "West"',
    contactName: null,
    address: {
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
    },
  },
  period: { from: "2026-01-01", to: "2026-12-31", usedDefault: true },
  rows,
  totals,
  generatedOn: "2026-08-11",
});

test("the print document escapes party names and shows the period totals", () => {
  const rows = [
    {
      id: "a",
      invoiceNumber: "2026-0007",
      status: "sent",
      issuedOn: "2026-02-01",
      dueOn: "2026-03-03",
      totalCents: 99900,
      paidCents: 0,
      balanceCents: 99900,
      daysOverdue: 74,
    },
  ];
  const html = renderStatementHtml(
    htmlInput(rows, { invoicedCents: 99900, paidCents: 0, outstandingCents: 99900 })
  );
  // The client's name renders escaped, and the raw markup never survives.
  assert.ok(html.includes("Owner &amp; Ops &lt;Group&gt; &quot;West&quot;"));
  assert.ok(!html.includes("<Group>"));
  assert.ok(html.includes("$999.00"));
  // Overdue is flagged with the days figure from invoices_overdue.
  assert.ok(html.includes("Overdue · 74d"));
  assert.ok(html.includes("2026-0007"));
});

test("an empty period prints as words, not as a bare zero table", () => {
  const html = renderStatementHtml(
    htmlInput([], { invoicedCents: 0, paidCents: 0, outstandingCents: 0 })
  );
  assert.ok(
    html.includes("No invoices were issued to"),
    "the empty statement must say it covers a verified-empty period"
  );
  assert.ok(!html.includes("<tbody>"), "no invoice table when there are no invoices");
});
