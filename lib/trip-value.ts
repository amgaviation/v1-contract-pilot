/**
 * Single definition of "what an unbilled trip's DAYS are worth" — shared by
 * every screen that shows a trip's value before it is invoiced, so those
 * screens can never disagree with each other.
 *
 * Three screens had each hand-rolled this (Overview, the trips list, and the
 * trip detail page), and two of them priced from the scalar columns only,
 * so a trip with a day grid showed one number on Overview, another on
 * Trips, and billed a third. That is the "two sources for one number"
 * defect the trips list's own comment was already warning about.
 *
 * PRICING RULE, mirrored from createInvoiceDraft's day-row path
 * (app/(app)/invoices/actions.ts): once a trip has trip_days rows it is
 * priced from THEM — grouped by (day_type_id, rate_cents), summing
 * quantity, over BILLABLE day types only — and day_rate_cents / day_count /
 * travel_day_rate_cents / travel_day_count are ignored entirely. A trip
 * with no day rows falls back to the scalar calculation.
 *
 * GROUP FIRST, THEN ROUND. This is not incidental. The draft emits ONE
 * invoice line per (day type, rate) group with `quantity` = the summed
 * quantity, and pilot.invoice_lines.amount_cents is a generated column
 * computing `round(quantity * unit_amount_cents)`. So the rounding happens
 * once per group, against the summed quantity — not once per day. Summing
 * per-row rounded amounts instead gives a different answer: two half-days
 * at $125 are round(0.5 x 12500) x 2 = 12500, but round(1.0 x 12500) =
 * 12500 only because that example is clean; at $125.01 the two disagree by
 * a cent. A screen that is off by a cent from the invoice it is previewing
 * is the same defect this file exists to remove, just smaller.
 *
 * WHAT THIS DELIBERATELY DOES NOT INCLUDE, because the day value is not the
 * invoice total: per-diem lines (added when the client is on
 * per_diem_mode='per_diem'), a contract-minimum adjustment line, and
 * rebilled expenses. All three are added by createInvoiceDraft on top of
 * the day lines. The pre-Phase-9 scalar calculation excluded them too, so
 * this preserves what these screens have always meant by a trip's value —
 * but do not describe this number to a pilot as "what the invoice will
 * total", because it is not.
 */

export type TripValueScalar = {
  day_rate_cents: number;
  day_count: number;
  travel_day_rate_cents: number | null;
  travel_day_count: number | null;
};

export type TripDayValueRow = {
  day_type_id: string;
  rate_cents: number;
  quantity: number;
};

/**
 * Mirrors createInvoiceDraft's roundQuantity: 0.1 + 0.2 is
 * 0.30000000000000004 in JS, and pilot.trip_days.quantity is numeric(3,1),
 * so this removes float noise below the column's own scale rather than
 * changing what the sum should be.
 */
function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

export function tripValueCents(
  trip: TripValueScalar,
  dayRows: TripDayValueRow[] | undefined,
  billableByDayType: Map<string, boolean>
): number {
  if (dayRows && dayRows.length > 0) {
    // Key on day type AND rate, exactly as the draft does: the same day
    // type captured at two different agreed rates is two invoice lines,
    // and collapsing them here would round differently from the invoice.
    const groups = new Map<string, { rateCents: number; quantitySum: number }>();
    for (const row of dayRows) {
      if (!billableByDayType.get(row.day_type_id)) continue;
      const key = `${row.day_type_id}:${row.rate_cents}`;
      const group = groups.get(key) ?? { rateCents: row.rate_cents, quantitySum: 0 };
      group.quantitySum += Number(row.quantity);
      groups.set(key, group);
    }
    let total = 0;
    for (const group of groups.values()) {
      total += Math.round(roundQuantity(group.quantitySum) * group.rateCents);
    }
    return total;
  }

  return (
    Math.round(trip.day_rate_cents * Number(trip.day_count)) +
    Math.round(
      (trip.travel_day_rate_cents ?? 0) * Number(trip.travel_day_count ?? 0)
    )
  );
}
