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
 * THIS RULE NOW HAS A SECOND IMPLEMENTATION, IN SQL, AND THE TWO MUST BE
 * EDITED TOGETHER. pilot.unbilled_trip_money
 * (supabase/migrations/20260813010000_unbilled_money_reads.sql) computes
 * exactly this — same grouping key, same group-first-then-round, same
 * billable-only filter, same scalar fallback — because Overview needs the
 * figure AGGREGATED across every unbilled trip, and an aggregate summed in
 * JavaScript from a Data-API read is silently truncated at 1,000 rows. The
 * duplication is deliberate and bounded: the SQL exists to total, this
 * exists to price ONE trip on the screens that show one (trips list, trip
 * detail). If you change the arithmetic here, change it there, and vice
 * versa — the migration's header carries the rounding-parity argument for
 * why the two agree cent-for-cent on every value this schema can hold.
 *
 * PARITY REQUIRES EXACT DECIMAL ARITHMETIC, NOT MERELY THE SAME FORMULA.
 * Postgres rounds the exact value; a double rounds whatever it could
 * represent, and `0.5 * 0.29` is 0.14499999999999999 rather than 0.145. Every
 * quantity below therefore accumulates in INTEGER THOUSANDTHS and rounds with
 * integer arithmetic — see dayQuantityThousandths. Reverting any of that to
 * `quantity * units` in floats reintroduces a silent cent-scale disagreement
 * with both the SQL and the invoice, which is the exact defect this file
 * exists to remove. tests/unbilled-money.test.mjs §7 is the guard.
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
 * A day row's contribution to its group's summed quantity, as an EXACT
 * INTEGER COUNT OF THOUSANDTHS.
 *
 * WHY INTEGERS AND NOT `quantity * units`. pilot.trip_days.quantity is
 * numeric(3,1) and units numeric(3,2), so the true product is always an
 * exact multiple of 0.001 — but IEEE 754 cannot hold most of those values,
 * and the error lands exactly where it does damage. `0.5 * 0.29` is
 * 0.14499999999999999 as a double, so rounding it to 2dp gives 0.14, while
 * Postgres rounds the exact decimal 0.145 to 0.15. Ten (quantity, units)
 * pairs inside this schema's own CHECK bounds diverge that way, and roughly
 * one in a hundred multi-row group sums does.
 *
 * That divergence is not academic here: pilot.unbilled_trip_money computes
 * the same figure in exact `numeric`, so a float-accumulated JS answer would
 * make Overview's unbilled money disagree with the trips list, the trip
 * detail, and the invoice createInvoiceDraft actually writes — the
 * "two sources for one number" defect this file exists to remove. Working in
 * thousandths keeps every intermediate exact, so the two implementations
 * agree on every value the schema can hold rather than merely on the values
 * anyone happened to try.
 *
 * `Math.round` on each factor is what pulls a wire value back onto its
 * column's scale before it becomes an integer: a numeric arriving as 0.29
 * gives 28.999999999999996 when multiplied by 100, and truncating that would
 * silently drop a hundredth of a day.
 */
export function dayQuantityThousandths(
  quantity: number,
  units: number | null | undefined
): number {
  const unitFraction = units == null ? 1 : Number(units);
  return Math.round(Number(quantity) * 10) * Math.round(unitFraction * 100);
}

/**
 * A summed quantity in thousandths, rounded to invoice_lines.quantity's own
 * numeric(6,2) scale — the same rounding Postgres `round(numeric, 2)`
 * performs on the exact value.
 *
 * Half-up, which equals Postgres's half-away-from-zero because every input
 * is non-negative by CHECK (quantity > 0, units > 0). `n / 10` for an
 * integer n is exact at the .5 boundary, so the tie is decided by the rule
 * and never by representation error.
 */
export function roundThousandthsToHundredths(thousandths: number): number {
  return Math.round(thousandths / 10) / 100;
}

/**
 * Cents for one invoice-line-shaped group: a quantity in HUNDREDTHS times a
 * whole-cent rate, rounded once — mirroring pilot.invoice_lines.amount_cents'
 * generated `round(quantity * unit_amount_cents)`.
 *
 * The multiply happens in integers so the only inexact step is the final
 * `/ 100`, where a tie is an exactly-representable `.5` and rounds half-up
 * the way Postgres does.
 */
function groupCents(quantityHundredths: number, rateCents: number): number {
  return Math.round((quantityHundredths * rateCents) / 100);
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
    const groups = new Map<
      string,
      { rateCents: number; quantityThousandths: number }
    >();
    for (const row of dayRows) {
      if (!billableByDayType.get(row.day_type_id)) continue;
      const key = `${row.day_type_id}:${row.rate_cents}`;
      const group =
        groups.get(key) ?? { rateCents: row.rate_cents, quantityThousandths: 0 };
      group.quantityThousandths += dayQuantityThousandths(row.quantity, row.units);
      groups.set(key, group);
    }
    let total = 0;
    for (const group of groups.values()) {
      // Round to hundredths ONCE per group, then price it — the same two
      // steps, in the same order, as the SQL's
      // `sum(round(round(sum(quantity * units), 2) * rate_cents))`.
      const hundredths = Math.round(group.quantityThousandths / 10);
      total += groupCents(hundredths, group.rateCents);
    }
    return total;
  }

  // The scalar fallback, in tenths for the same reason: day_count and
  // travel_day_count are numeric(5,1), so `rate * count` is exact in tenths
  // of a cent and its .5 ties must round the way `round(numeric)` does
  // rather than the way the nearest double happens to fall.
  return (
    scalarHalfCents(trip.day_rate_cents, trip.day_count) +
    scalarHalfCents(trip.travel_day_rate_cents ?? 0, trip.travel_day_count ?? 0)
  );
}

/** One half of the scalar fallback: `round(rate_cents * count)`, exact. */
function scalarHalfCents(rateCents: number, count: number): number {
  return Math.round((rateCents * Math.round(Number(count) * 10)) / 10);
}

/**
 * "How many billable days does this trip's grid actually show" — the same
 * question pilot.trip_pl's `day_quantity` column answers in SQL
 * (`sum(td.quantity * td.units) filter (where dt.billable)`, rounded to
 * 2dp), mirrored here so a screen with no server-side join available can
 * still report the grid-derived count instead of the pre-grid scalar
 * day_count/travel_day_count columns.
 *
 * Deliberately NOT grouped by (day_type_id, rate_cents) the way
 * tripValueCents groups for money — a day count has no rate to key on, so
 * every billable row's contribution is summed directly and rounded ONCE at
 * the end, exactly as trip_pl's `round(days.day_quantity, 2)` does.
 *
 * Returns 0 for a trip with no rows (or none billable) rather than falling
 * back to the scalars — the caller decides when to use the scalar count
 * instead, the same has-rows branch tripValueCents' own callers apply.
 */
export function tripDayQuantity(
  dayRows: TripDayValueRow[] | undefined,
  billableByDayType: Map<string, boolean>
): number {
  if (!dayRows || dayRows.length === 0) return 0;
  let thousandths = 0;
  for (const row of dayRows) {
    if (!billableByDayType.get(row.day_type_id)) continue;
    thousandths += dayQuantityThousandths(row.quantity, row.units);
  }
  return roundThousandthsToHundredths(thousandths);
}
