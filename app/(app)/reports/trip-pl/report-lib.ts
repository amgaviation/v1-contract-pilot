/**
 * Pure assembly and arithmetic for the trip-profitability report — no I/O,
 * no Supabase, no Next imports, so tests/trip-pl.test.mjs can exercise it
 * directly (the same split as app/(app)/reports/sales-tax/report-lib.ts,
 * whose refuse-rather-than-fabricate discipline this file follows).
 *
 * ===========================================================================
 * THE BASIS DECISION, stated once and repeated on screen and in the CSV.
 *
 * Every money figure on this report is INVOICED, NOT COLLECTED. It is the
 * only per-trip revenue figure this schema can honestly produce, and the
 * reasoning is not a preference:
 *
 *   pilot.invoice_payments is INVOICE-level. It records that $6,000
 *   arrived against invoice INV-0042 on a date. It does NOT record which
 *   LINE of that invoice the money paid — there is no line-level
 *   allocation column anywhere in the schema (20260805090000). An invoice
 *   routinely bills two trips plus a monthly guarantee plus three
 *   rebilled receipts. Attributing a slice of that payment to one trip
 *   would require inventing an allocation policy — pro-rata by line
 *   amount, or oldest-line-first, or any of a dozen others — and then
 *   presenting the invention as the pilot's collected income. Refusing to
 *   invent it IS the house rule here, the same one that keeps
 *   /reports/sales-tax from pro-rating tax across partial payments.
 *
 * So: this report answers "what was this trip WORTH, and what did it cost
 * me to fly" — an accrual-shaped question about work done. It does NOT
 * answer "what did I make", which is a cash question that
 * /reports/profit-loss, /reports/year-end and /reports/quarterly all
 * answer from sum(invoice_payments.amount_cents) by paid_on. Those three
 * remain the cash-basis authority and this report must never be read as
 * disagreeing with them: it is measuring a different thing on a different
 * basis, which is why every surface labels the figures "invoiced, not
 * collected" and shows each trip's invoice status alongside.
 *
 * ===========================================================================
 * WHAT IS IN THE MARGIN, AND WHAT IS NEXT TO IT.
 *
 *   margin = invoiced day money − deductible expenses
 *
 * and nothing else. Four things sit BESIDE the margin, each visible, each
 * labelled, none summed into it:
 *
 * 1. REBILL PASS-THROUGH — both legs excluded. A rebilled receipt is
 *    money the pilot fronted and billed straight back; cost and
 *    reimbursement are one transaction with two legs. Including either
 *    leg alone would move the margin by the full amount in the wrong
 *    direction; including both would net to zero while inflating the
 *    revenue and cost columns and making every ratio meaningless.
 *
 *    NOTE THE GEOMETRY FLIP vs /reports/profit-loss, because it looks
 *    like a contradiction and is not. That report COUNTS rebilled costs
 *    in Expenses, and its own "THE REBILL DECISION" note explains why:
 *    its income figure is the WHOLE payment, "with no line-level
 *    decomposition by kind", so the reimbursement is already inside its
 *    income and only counting the outflow lets the two legs cancel. This
 *    report's revenue figure is day money with reimbursable_expense lines
 *    already EXCLUDED — the reimbursement is not inside it — so counting
 *    the cost here would NOT cancel against anything and would understate
 *    every trip's margin by exactly its rebilled cost. Same money, two
 *    revenue definitions, two correct-and-opposite treatments.
 *
 *    The two legs are compared rather than merely dropped: a rebill never
 *    invoiced, or invoiced short, is money the pilot fronted and did not
 *    get back, and rebillGapCents surfaces it. Silence there would hide a
 *    real loss — the gap year-end's own section C exists to reconcile.
 *
 * 2. UNDECIDED RECEIPTS (treatment='unassigned' with a trip_id) — the
 *    rebill-vs-deduct call has not been made, so the report does not make
 *    it. Shown per trip as its own figure, the same framing profit-loss
 *    uses account-wide: money currently being lost in both directions.
 *
 * 3. MILEAGE — in MILES, never dollars. The standard mileage rate and
 *    actual vehicle expenses are alternative methods for a vehicle-year,
 *    "never additive" (20260809020000), so no mileage dollar figure may
 *    enter a margin; and the Schedule C dollar figure is computed once,
 *    from total miles × that year's rate, in lib/mileage.ts. A per-trip
 *    dollar amount here would be a third computation of one deduction.
 *
 * 4. UNATTRIBUTED CLIENT REVENUE — live invoice lines with no trip at
 *    all, chiefly monthly guarantees, which createInvoiceDraft writes
 *    without a trip_id on purpose. Real revenue; not attributable to any
 *    one trip without inventing an allocation. Shown on the client
 *    rollup, outside the margin.
 */

// ---------------------------------------------------------------------------
// Period resolution — the /reports/profit-loss picker idiom (year /
// quarter / month / month-to-date / custom), minus its prior-period
// comparison window. A prior-period column is omitted deliberately: the
// rows here are TRIPS, and a trip has no counterpart in a previous
// period to compare against, so a delta badge would be comparing two
// different sets of work and calling it a trend.
//
// All bounds are plain "YYYY-MM-DD" strings compared directly against
// Postgres `date` columns — no JS Date round-trip, no timezone
// conversion. Same discipline as yearBounds in ../year-end/db.ts.
// ---------------------------------------------------------------------------

export type TripPLPeriodKind = "year" | "quarter" | "month" | "mtd" | "custom";

export type TripPLPeriod = {
  kind: TripPLPeriodKind;
  label: string;
  start: string;
  end: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "2026-02-30" passes a regex but is not a date — round-trip through the
 *  UTC date constructor to reject it, same shape as sales-tax's. */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Today as "YYYY-MM-DD" in UTC — calendar facts are UTC facts here. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function monthBounds(year: number, month1to12: number): { start: string; end: string } {
  return {
    start: `${year}-${pad2(month1to12)}-01`,
    end: `${year}-${pad2(month1to12)}-${pad2(daysInMonth(year, month1to12))}`,
  };
}

function quarterBounds(year: number, quarter1to4: number): { start: string; end: string } {
  const firstMonth = (quarter1to4 - 1) * 3 + 1;
  return {
    start: monthBounds(year, firstMonth).start,
    end: monthBounds(year, firstMonth + 2).end,
  };
}

const QUARTER_LABEL = ["Q1", "Q2", "Q3", "Q4"];
const MONTH_LABEL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type TripPLPeriodParams = {
  kind?: string;
  year?: string;
  quarter?: string;
  month?: string;
  start?: string;
  end?: string;
};

/**
 * ?kind=/?year=/?quarter=/?month=/?start=/?end= → a concrete inclusive
 * period. `today` is passed in rather than read from the clock so tests
 * can pin "month to date" without freezing time.
 */
export function resolveTripPLPeriod(
  params: TripPLPeriodParams,
  today: string
): TripPLPeriod {
  const currentYear = Number(today.slice(0, 4));
  const yearNum = Number(params.year);
  const year =
    params.year && Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
      ? yearNum
      : currentYear;

  const kind: TripPLPeriodKind =
    params.kind === "quarter" || params.kind === "month" ||
    params.kind === "mtd" || params.kind === "custom"
      ? params.kind
      : "year";

  if (kind === "quarter") {
    const qNum = Number(params.quarter);
    const quarter = Number.isInteger(qNum) && qNum >= 1 && qNum <= 4 ? qNum : 1;
    const { start, end } = quarterBounds(year, quarter);
    return { kind, label: `${QUARTER_LABEL[quarter - 1]} ${year}`, start, end };
  }

  if (kind === "month") {
    const mNum = Number(params.month);
    const month = Number.isInteger(mNum) && mNum >= 1 && mNum <= 12 ? mNum : 1;
    const { start, end } = monthBounds(year, month);
    return { kind, label: `${MONTH_LABEL[month - 1]} ${year}`, start, end };
  }

  if (kind === "mtd") {
    const ty = Number(today.slice(0, 4));
    const tm = Number(today.slice(5, 7));
    const td = Number(today.slice(8, 10));
    return {
      kind,
      label: `${MONTH_LABEL[tm - 1]} 1-${td}, ${ty} (month to date)`,
      start: monthBounds(ty, tm).start,
      end: today,
    };
  }

  if (kind === "custom") {
    const startValid = Boolean(params.start && isValidIsoDate(params.start));
    const endValid = Boolean(params.end && isValidIsoDate(params.end));
    const start = startValid ? (params.start as string) : `${year}-01-01`;
    const end = endValid ? (params.end as string) : `${year}-12-31`;
    // ISO dates sort lexically, so string comparison is date comparison.
    // A reversed pair is swapped rather than rejected — "between these two
    // dates" is unambiguous. Same treatment as resolveSalesTaxPeriod.
    const [lo, hi] = start <= end ? [start, end] : [end, start];
    return { kind, label: `${lo} to ${hi}`, start: lo, end: hi };
  }

  return { kind: "year", label: `${year}`, start: `${year}-01-01`, end: `${year}-12-31` };
}

// ---------------------------------------------------------------------------
// The raw row shapes returned by pilot.trip_pl and
// pilot.client_unattributed_lines.
//
// Every numeric field is read through Number() during assembly rather than
// trusted as one: PostgREST serializes `numeric` in a way that has changed
// between versions, and `Number(undefined)` is NaN — which would propagate
// silently through every sum and print "$NaN" rather than failing. Same
// defensiveness as lib/trip-value.ts's `Number(row.quantity)`.
// ---------------------------------------------------------------------------

export type TripPLRawRow = {
  trip_id: string;
  client_id: string | null;
  trip_kind: string;
  trip_status: string;
  billing_state: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  invoiced_day_money_cents: number;
  draft_day_money_cents: number;
  rebilled_cost_cents: number;
  rebill_invoiced_cents: number;
  deductible_cents: number;
  unassigned_cents: number;
  day_quantity: number;
  has_day_rows: boolean;
  scalar_day_count: number;
  mileage_miles: number;
  mileage_entry_count: number;
};

export type UnattributedRawRow = {
  client_id: string;
  unattributed_line_cents: number;
  unattributed_line_count: number;
  draft_unattributed_line_cents: number;
  draft_unattributed_line_count: number;
};

// ---------------------------------------------------------------------------
// The arithmetic. Three tiny functions, each the ONE definition of its
// figure — used by the trip rows, the client rollups and the grand total
// alike, so those three can never disagree about what a margin is.
// ---------------------------------------------------------------------------

/**
 * THE margin definition: invoiced day money − deductible expenses.
 *
 * Integer cents throughout, never floats — every monetary column in the
 * `pilot` schema is bigint cents (lib/format.ts), and subtraction of two
 * integers is exact, so a margin never acquires a rounding error of its
 * own. The only rounding in this file is marginPerDayCents's division.
 */
export function marginCents(input: {
  invoicedDayMoneyCents: number;
  deductibleExpenseCents: number;
}): number {
  return input.invoicedDayMoneyCents - input.deductibleExpenseCents;
}

/**
 * The rebill reconciliation: what was billed back minus what was fronted.
 *
 *   0  — the pass-through closed; nothing to see.
 *   <0 — SHORT. A receipt was rebilled but never invoiced, or invoiced for
 *        less than it cost. Real money the pilot ate, invisible in the
 *        margin by design (both legs are excluded from it), so the report
 *        shows this gap explicitly.
 *   >0 — billed back MORE than the recorded cost. Usually a receipt
 *        recorded short or a markup; surfaced rather than assumed benign.
 */
export function rebillGapCents(input: {
  rebillInvoicedCents: number;
  rebilledCostCents: number;
}): number {
  return input.rebillInvoicedCents - input.rebilledCostCents;
}

/**
 * Which day count a trip's margin-per-day divides by, and where it came
 * from.
 *
 * PRECEDENCE, mirroring lib/trip-value.ts exactly: once a trip has
 * trip_days rows it is measured from THEM, and the scalar day_count /
 * travel_day_count columns are ignored entirely. A trip with a day grid
 * whose billable quantity is legitimately zero (every day row is a
 * non-billable type — an off day, a standby day the contract doesn't pay)
 * keeps source "day_rows" and quantity 0; it does NOT fall back to the
 * scalar, because falling back would resurrect a number the day grid
 * deliberately replaced.
 */
export type DayQuantitySource = "day_rows" | "scalar" | "none";

export function effectiveDayQuantity(row: {
  hasDayRows: boolean;
  dayQuantity: number;
  scalarDayCount: number;
}): { quantity: number; source: DayQuantitySource } {
  if (row.hasDayRows) return { quantity: row.dayQuantity, source: "day_rows" };
  if (row.scalarDayCount > 0) return { quantity: row.scalarDayCount, source: "scalar" };
  return { quantity: 0, source: "none" };
}

/**
 * Margin per billable day, or NULL when there are no days to divide by.
 *
 * NULL, NEVER ZERO AND NEVER Infinity. A trip with no billable days is
 * not a trip earning $0.00 per day — it is a trip the question does not
 * apply to (a cancellation fee with no days worked is the paradigm case:
 * real margin, zero days). Returning 0 would put a fabricated figure in a
 * money column; returning `margin / 0` would print "$Infinity". The
 * caller renders null as an em dash.
 *
 * ROUNDING IS HALF-AWAY-FROM-ZERO, not Math.round. Math.round breaks .5
 * ties toward +Infinity, so it rounds -166.5 to -166 but 166.5 to 167 —
 * it treats a loss more kindly than an equal-sized gain. Margins here are
 * genuinely signed (a trip whose deductible expenses exceed what it
 * billed is a real, common row), so the tie-break is made symmetric: a
 * gain and a loss of the same magnitude round to the same magnitude.
 */
export function marginPerDayCents(
  marginTotalCents: number,
  dayQuantity: number
): number | null {
  if (!(dayQuantity > 0)) return null;
  const exact = marginTotalCents / dayQuantity;
  return exact < 0 ? -Math.round(-exact) : Math.round(exact);
}

// ---------------------------------------------------------------------------
// Assembled shapes.
// ---------------------------------------------------------------------------

export type TripPLTripRow = {
  tripId: string;
  clientId: string | null;
  clientName: string;
  tripKind: string;
  tripStatus: string;
  billingState: string;
  startsOn: string;
  endsOn: string;
  /** Tail number, when recorded. Rendered as-is — it is an N-number. */
  aircraftIdent: string | null;

  /** Live (non-void) non-rebill invoice line money. INVOICED, NOT COLLECTED. */
  invoicedDayMoneyCents: number;
  /** The DRAFT SUBSET of invoicedDayMoneyCents — not an addend. */
  draftDayMoneyCents: number;
  /** True when any of this trip's day money sits on an unsent invoice. */
  hasDraftMoney: boolean;

  /** Pass-through leg 1: what the pilot fronted. Excluded from margin. */
  rebilledCostCents: number;
  /** Pass-through leg 2: what was billed back. Excluded from margin. */
  rebillInvoicedCents: number;
  /** leg2 − leg1. Non-zero means the pass-through did not close. */
  rebillGapCents: number;

  deductibleExpenseCents: number;
  /** treatment='unassigned' receipts on this trip. Excluded from margin. */
  unassignedExpenseCents: number;

  marginCents: number;
  dayQuantity: number;
  dayQuantitySource: DayQuantitySource;
  marginPerDayCents: number | null;

  /** Informational only, in MILES. Never valued in dollars here. */
  mileageMiles: number;
  mileageEntryCount: number;
};

export type TripPLClientRow = {
  clientId: string | null;
  clientName: string;
  tripCount: number;

  invoicedDayMoneyCents: number;
  draftDayMoneyCents: number;
  rebilledCostCents: number;
  rebillInvoicedCents: number;
  rebillGapCents: number;
  deductibleExpenseCents: number;
  unassignedExpenseCents: number;

  marginCents: number;
  dayQuantity: number;
  marginPerDayCents: number | null;

  /** Live line money for this client attached to NO trip (monthly
   *  guarantees). Real revenue, outside the margin — see the file header.
   *  Placed in the period by the INVOICE'S ISSUE DATE, not by trip dates:
   *  having no trip, it has no travel dates to overlap. Sent invoices
   *  only. */
  unattributedLineCents: number;
  unattributedLineCount: number;
  /** The same money on invoices that have NOT been sent, at any date.
   *
   *  DISJOINT FROM the pair above — an ADDEND, not a subset, which is the
   *  OPPOSITE convention to draftDayMoneyCents a few fields up. The two
   *  differ because pilot.client_unattributed_lines splits by invoice
   *  STATUS while trip_pl's draft column is a filter narrowed from a
   *  total. Every surface renders these as "$X + $Y"; reading either pair
   *  with the other's convention double-counts or hides money. */
  draftUnattributedLineCents: number;
  draftUnattributedLineCount: number;

  mileageMiles: number;
};

export type TripPLTotals = {
  tripCount: number;
  invoicedDayMoneyCents: number;
  draftDayMoneyCents: number;
  rebilledCostCents: number;
  rebillInvoicedCents: number;
  rebillGapCents: number;
  deductibleExpenseCents: number;
  unassignedExpenseCents: number;
  marginCents: number;
  dayQuantity: number;
  marginPerDayCents: number | null;
  unattributedLineCents: number;
  unattributedLineCount: number;
  draftUnattributedLineCents: number;
  draftUnattributedLineCount: number;
  mileageMiles: number;
};

export type TripPLAssembly =
  | { ok: true; trips: TripPLTripRow[]; clients: TripPLClientRow[]; totals: TripPLTotals }
  | { ok: false; reason: string };

/** The bucket key/label for trips and lines with no client attached. A
 *  trip may legitimately have client_id null (pilot.trips.client_id is
 *  nullable) — that is a real state, not a missing row, and it gets its
 *  own honest bucket rather than being dropped or blamed on a short read.
 *
 *  The key is internal (never rendered) and only has to be a string no
 *  client UUID can equal — '~' is outside the UUID alphabet, so it cannot
 *  collide. Deliberately a PRINTABLE sentinel: an earlier version used a
 *  literal NUL byte, which made this whole file binary to git, grep and
 *  every diff view — an unreviewable source file is too high a price for
 *  a map key. */
const NO_CLIENT_KEY = "~no-client~";
const NO_CLIENT_LABEL = "No client on the trip";

/**
 * Joins the reads into per-trip rows, per-client rollups and a grand
 * total — REFUSING, never fabricating, whenever a figure it must print is
 * missing or the inputs contradict themselves.
 *
 * The refusal discipline is ../year-end/travel-log.ts's ("trip day X
 * references trip Y which the trips read didn't return — refusing to
 * print a partial travel log") and ../sales-tax/report-lib.ts's ("refuse
 * rather than total a partial join"). It matters more here than usual:
 * this report's headline is a SUBTRACTION, so a short read of the
 * expenses side does not zero a margin, it INFLATES one, and an inflated
 * margin looks exactly like good news.
 *
 * The client rollups are summed from the very trip rows rendered above
 * them — never re-aggregated from a second query — so a reader adding the
 * printed column by hand always reconciles to the printed subtotal. Same
 * rule as the client statement and the sales-tax report.
 */
export function assembleTripPL(input: {
  trips: TripPLRawRow[];
  unattributed: UnattributedRawRow[];
  /** id → name for every client referenced by a trip or an unattributed line. */
  clientNames: Map<string, string>;
}): TripPLAssembly {
  const trips: TripPLTripRow[] = [];
  const seenTripIds = new Set<string>();

  for (const raw of input.trips) {
    // A duplicated trip id can only mean the aggregation fanned out — the
    // exact bug pilot.trip_pl's LATERAL subqueries exist to prevent. It
    // is impossible today (the function returns one row per trip), so
    // this can only fire on a future SQL edit that reintroduces a
    // multiplying join. Catching it here costs one Set and turns a
    // silently doubled margin into a visible refusal.
    if (seenTripIds.has(raw.trip_id)) {
      return {
        ok: false,
        reason: `trip ${raw.trip_id} appears twice in the aggregation, so this report won't total a fanned-out join`,
      };
    }
    seenTripIds.add(raw.trip_id);

    const invoicedDayMoneyCents = Number(raw.invoiced_day_money_cents);
    const draftDayMoneyCents = Number(raw.draft_day_money_cents);
    const rebilledCostCents = Number(raw.rebilled_cost_cents);
    const rebillInvoicedCents = Number(raw.rebill_invoiced_cents);
    const deductibleExpenseCents = Number(raw.deductible_cents);
    const unassignedExpenseCents = Number(raw.unassigned_cents);
    const dayQuantityRaw = Number(raw.day_quantity);
    const scalarDayCount = Number(raw.scalar_day_count);
    const mileageMiles = Number(raw.mileage_miles);
    const mileageEntryCount = Number(raw.mileage_entry_count);

    // NaN would propagate silently through every sum below and surface as
    // "$NaN" in a money column — refuse instead. This fires if a numeric
    // column ever arrives as a non-numeric string, or if a caller forgets
    // to select a column (Number(undefined) === NaN).
    for (const [name, value] of [
      ["invoiced_day_money_cents", invoicedDayMoneyCents],
      ["draft_day_money_cents", draftDayMoneyCents],
      ["rebilled_cost_cents", rebilledCostCents],
      ["rebill_invoiced_cents", rebillInvoicedCents],
      ["deductible_cents", deductibleExpenseCents],
      ["unassigned_cents", unassignedExpenseCents],
      ["day_quantity", dayQuantityRaw],
      ["scalar_day_count", scalarDayCount],
      ["mileage_miles", mileageMiles],
      // Checked even though no surface prints it yet: the moment one does
      // ("210.4 miles across NaN drives") it is exactly the failure this
      // loop exists to refuse, and an unchecked numeric column is a trap
      // laid for whoever adds that column to the table.
      ["mileage_entry_count", mileageEntryCount],
    ] as const) {
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          reason: `trip ${raw.trip_id}: ${name} did not arrive as a number, so this report won't print a figure derived from it`,
        };
      }
    }

    // draft_day_money_cents is a SUBSET of invoiced_day_money_cents (same
    // filter plus `status = 'draft'`). If it ever exceeds the total, the
    // two filters have drifted apart and neither figure can be trusted —
    // the same class of self-check as sales-tax's "base x rate must
    // reproduce tax_cents". Refuse rather than print a "of which draft"
    // larger than the number it is part of.
    if (draftDayMoneyCents > invoicedDayMoneyCents) {
      return {
        ok: false,
        reason: `trip ${raw.trip_id}: draft day money exceeds total invoiced day money, so this report won't print figures that don't reconcile`,
      };
    }

    const clientId = raw.client_id;
    let clientName: string;
    if (clientId === null) {
      clientName = NO_CLIENT_LABEL;
    } else {
      const found = input.clientNames.get(clientId);
      if (found === undefined) {
        // A trip's client_id is a composite FK into pilot.clients, so a
        // missing name means the clients read came back short — not that
        // the client doesn't exist. Refuse: quietly relabelling the row
        // "Unknown client" would leave the margin correct while the
        // per-client rollup silently split one client's trips into two
        // buckets, which is worse than a wrong total because nothing on
        // screen says the grouping is short.
        return {
          ok: false,
          reason: `trip ${raw.trip_id} references client ${clientId} which the clients read didn't return, so this report won't print a partial per-client rollup`,
        };
      }
      clientName = found;
    }

    const { quantity, source } = effectiveDayQuantity({
      hasDayRows: raw.has_day_rows,
      dayQuantity: dayQuantityRaw,
      scalarDayCount,
    });
    const margin = marginCents({ invoicedDayMoneyCents, deductibleExpenseCents });

    trips.push({
      tripId: raw.trip_id,
      clientId,
      clientName,
      tripKind: raw.trip_kind,
      tripStatus: raw.trip_status,
      billingState: raw.billing_state,
      startsOn: raw.starts_on,
      endsOn: raw.ends_on,
      aircraftIdent: raw.aircraft_ident,

      invoicedDayMoneyCents,
      draftDayMoneyCents,
      hasDraftMoney: draftDayMoneyCents !== 0,

      rebilledCostCents,
      rebillInvoicedCents,
      rebillGapCents: rebillGapCents({ rebillInvoicedCents, rebilledCostCents }),

      deductibleExpenseCents,
      unassignedExpenseCents,

      marginCents: margin,
      dayQuantity: quantity,
      dayQuantitySource: source,
      marginPerDayCents: marginPerDayCents(margin, quantity),

      mileageMiles,
      mileageEntryCount,
    });
  }

  // ---- Per-client rollups, summed from the rows above and nothing else --
  const byClient = new Map<string, TripPLClientRow>();
  const clientKey = (id: string | null) => id ?? NO_CLIENT_KEY;

  for (const t of trips) {
    const key = clientKey(t.clientId);
    let row = byClient.get(key);
    if (!row) {
      row = {
        clientId: t.clientId,
        clientName: t.clientName,
        tripCount: 0,
        invoicedDayMoneyCents: 0,
        draftDayMoneyCents: 0,
        rebilledCostCents: 0,
        rebillInvoicedCents: 0,
        rebillGapCents: 0,
        deductibleExpenseCents: 0,
        unassignedExpenseCents: 0,
        marginCents: 0,
        dayQuantity: 0,
        marginPerDayCents: null,
        unattributedLineCents: 0,
        unattributedLineCount: 0,
        draftUnattributedLineCents: 0,
        draftUnattributedLineCount: 0,
        mileageMiles: 0,
      };
      byClient.set(key, row);
    }
    row.tripCount += 1;
    row.invoicedDayMoneyCents += t.invoicedDayMoneyCents;
    row.draftDayMoneyCents += t.draftDayMoneyCents;
    row.rebilledCostCents += t.rebilledCostCents;
    row.rebillInvoicedCents += t.rebillInvoicedCents;
    row.deductibleExpenseCents += t.deductibleExpenseCents;
    row.unassignedExpenseCents += t.unassignedExpenseCents;
    row.dayQuantity += t.dayQuantity;
    row.mileageMiles += t.mileageMiles;
  }

  // Unattributed client revenue joins the rollup — including for clients
  // with NO trips in this period, which is a real and important row: a
  // monthly guarantee invoiced in a month the pilot flew nothing for that
  // client is exactly the case a guarantee exists to cover.
  for (const u of input.unattributed) {
    const cents = Number(u.unattributed_line_cents);
    const count = Number(u.unattributed_line_count);
    const draftCents = Number(u.draft_unattributed_line_cents);
    const draftCount = Number(u.draft_unattributed_line_count);
    if (
      !Number.isFinite(cents) || !Number.isFinite(count) ||
      !Number.isFinite(draftCents) || !Number.isFinite(draftCount)
    ) {
      return {
        ok: false,
        reason: `client ${u.client_id}: unattributed line figures did not arrive as numbers, so this report won't print a rollup derived from them`,
      };
    }

    const name = input.clientNames.get(u.client_id);
    if (name === undefined) {
      // invoices.client_id is NOT NULL with a composite FK, so this is a
      // short clients read, same as above — refuse rather than print a
      // revenue line with no owner.
      return {
        ok: false,
        reason: `client ${u.client_id} has unattributed invoice lines but the clients read didn't return it, so this report won't print a partial per-client rollup`,
      };
    }

    let row = byClient.get(u.client_id);
    if (!row) {
      row = {
        clientId: u.client_id,
        clientName: name,
        tripCount: 0,
        invoicedDayMoneyCents: 0,
        draftDayMoneyCents: 0,
        rebilledCostCents: 0,
        rebillInvoicedCents: 0,
        rebillGapCents: 0,
        deductibleExpenseCents: 0,
        unassignedExpenseCents: 0,
        marginCents: 0,
        dayQuantity: 0,
        marginPerDayCents: null,
        unattributedLineCents: 0,
        unattributedLineCount: 0,
        draftUnattributedLineCents: 0,
        draftUnattributedLineCount: 0,
        mileageMiles: 0,
      };
      byClient.set(u.client_id, row);
    }
    row.unattributedLineCents += cents;
    row.unattributedLineCount += count;
    row.draftUnattributedLineCents += draftCents;
    row.draftUnattributedLineCount += draftCount;
  }

  // Derived figures, computed through the SAME functions the trip rows
  // used — one definition of margin, applied at both altitudes.
  for (const row of byClient.values()) {
    // Renormalise BEFORE dividing by it. Day quantity is a sum of
    // numeric(3,1) x numeric(3,2) products, each already rounded to 2dp
    // per trip in SQL, but summing them in JS floats reintroduces noise
    // below that scale (0.1 + 0.2 = 0.30000000000000004). Dividing by the
    // noisy value can shift margin-per-day by a cent. This changes no
    // value, only its float representation — the same 2dp scale
    // roundQuantity uses in lib/trip-value.ts.
    row.dayQuantity = Math.round(row.dayQuantity * 100) / 100;
    row.marginCents = marginCents({
      invoicedDayMoneyCents: row.invoicedDayMoneyCents,
      deductibleExpenseCents: row.deductibleExpenseCents,
    });
    row.rebillGapCents = rebillGapCents({
      rebillInvoicedCents: row.rebillInvoicedCents,
      rebilledCostCents: row.rebilledCostCents,
    });
    row.marginPerDayCents = marginPerDayCents(row.marginCents, row.dayQuantity);
  }

  const clients = [...byClient.values()].sort(
    (a, b) =>
      b.marginCents - a.marginCents ||
      a.clientName.localeCompare(b.clientName) ||
      // Total order, so the render is stable when two clients tie.
      clientKey(a.clientId).localeCompare(clientKey(b.clientId))
  );

  const totals: TripPLTotals = {
    tripCount: trips.length,
    invoicedDayMoneyCents: 0,
    draftDayMoneyCents: 0,
    rebilledCostCents: 0,
    rebillInvoicedCents: 0,
    rebillGapCents: 0,
    deductibleExpenseCents: 0,
    unassignedExpenseCents: 0,
    marginCents: 0,
    dayQuantity: 0,
    marginPerDayCents: null,
    unattributedLineCents: 0,
    unattributedLineCount: 0,
    draftUnattributedLineCents: 0,
    draftUnattributedLineCount: 0,
    mileageMiles: 0,
  };
  // Summed from the client rollups, which were summed from the trip rows
  // — one chain, so every level reconciles to the one below it.
  for (const c of clients) {
    totals.invoicedDayMoneyCents += c.invoicedDayMoneyCents;
    totals.draftDayMoneyCents += c.draftDayMoneyCents;
    totals.rebilledCostCents += c.rebilledCostCents;
    totals.rebillInvoicedCents += c.rebillInvoicedCents;
    totals.deductibleExpenseCents += c.deductibleExpenseCents;
    totals.unassignedExpenseCents += c.unassignedExpenseCents;
    totals.dayQuantity += c.dayQuantity;
    totals.unattributedLineCents += c.unattributedLineCents;
    totals.unattributedLineCount += c.unattributedLineCount;
    totals.draftUnattributedLineCents += c.draftUnattributedLineCents;
    totals.draftUnattributedLineCount += c.draftUnattributedLineCount;
    totals.mileageMiles += c.mileageMiles;
  }
  totals.marginCents = marginCents({
    invoicedDayMoneyCents: totals.invoicedDayMoneyCents,
    deductibleExpenseCents: totals.deductibleExpenseCents,
  });
  totals.rebillGapCents = rebillGapCents({
    rebillInvoicedCents: totals.rebillInvoicedCents,
    rebilledCostCents: totals.rebilledCostCents,
  });
  // Renormalised before dividing, for the same reason the client rollups
  // are — see the note in the loop above.
  totals.dayQuantity = Math.round(totals.dayQuantity * 100) / 100;
  totals.marginPerDayCents = marginPerDayCents(totals.marginCents, totals.dayQuantity);

  return { ok: true, trips, clients, totals };
}

/** Day quantity for display: "2.5", "3", never "3.0000000000000004". */
export function formatDayQuantity(quantity: number): string {
  return String(Math.round(quantity * 100) / 100);
}

/** Miles for display, one decimal — the scale pilot.mileage_entries.miles
 *  stores (numeric(7,1)). */
export function formatMiles(miles: number): string {
  return (Math.round(miles * 10) / 10).toFixed(1);
}
