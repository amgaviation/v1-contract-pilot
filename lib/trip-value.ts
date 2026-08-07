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
 *
 * UNITS (20260807070000_trip_day_units_away_cancel.sql): a row's
 * contribution to its group's summed quantity is `quantity * units`, not
 * bare quantity — units is a RATE fraction (e.g. a travel day paid at half
 * the day rate), distinct from quantity's TIME fraction, and it does NOT
 * join the (day_type_id, rate_cents) grouping key. See that migration's
 * header for the full reasoning; it applies here identically because this
 * function mirrors createInvoiceDraft's day-row path exactly.
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
  /**
   * Rate fraction (0 < x <= 1) this day bills at. OPTIONAL, not required:
   * all callers of this function now select trip_days.units, but the field
   * stays optional as a safety net — `Number(undefined)` is NaN, which
   * would NaN out every trip's value if a future caller forgot to select
   * it. A missing units reads as 1.0 (full rate — what every trip_days row
   * meant before this column existed), the same "absent means the
   * pre-feature default" rule the migration itself applies to existing
   * rows, so an unupdated caller keeps computing exactly what it always
   * has.
   */
  units?: number;
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
      const units = row.units == null ? 1 : Number(row.units);
      group.quantitySum += Number(row.quantity) * units;
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
