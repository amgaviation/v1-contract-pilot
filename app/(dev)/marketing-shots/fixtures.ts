import { visibleNavSections, type NavItem } from "@/lib/nav";
import type {
  UnbilledClientRow,
  UnbilledSummaryRow,
  UnbilledTripMoneyRow,
} from "../../(app)/overview/unbilled-lib";
import type { LineRow } from "../../(app)/invoices/[id]/lines-editor";
import type { InvoiceTotalsView } from "../../(app)/invoices/[id]/totals";
import type {
  HoursByTypeView,
  LogbookEntryCells,
  LogbookTotalsView,
} from "../../(app)/logbook/panels";

/**
 * EVERY FIGURE, NAME, TAIL NUMBER, CLIENT AND DOLLAR AMOUNT IN THIS FILE IS
 * INVENTED. There is no customer here and nothing below may ever be
 * presented as one — same standard the marketing surface has always held.
 * Airports are REAL ICAO identifiers and aircraft are REAL ICAO type
 * designators, because a made-up identifier reads as wrong to the only
 * audience these pictures have; the registrations, operators and money are
 * synthetic, chosen to be plausible rather than real.
 *
 * AVIATION CORRECTNESS is part of "plausible" and is not negotiable:
 *
 *   - A medical, a flight review and a 61.58 PIC proficiency check all
 *     expire on the LAST DAY OF A CALENDAR MONTH (14 CFR 61.23(d),
 *     61.56(c), 61.58(c)). A mid-month expiry on one of those reads as
 *     wrong. A passport and an insurance policy carry ordinary dates and
 *     deliberately do not follow that rule.
 *   - Logbook time is per LEG, PIC and SIC are separate columns, and
 *     simulator time is never folded into aircraft time (61.51).
 *
 * NOTHING HERE IS A CURRENCY DETERMINATION. The counsel-gated currency
 * engine appears on no public surface (docs/PRICING.md §4), which is why
 * the nav below is built from visibleNavSections(false) — the flag-OFF
 * view, exactly as the marketing surface has always used.
 */

export const FIXTURE_ACCOUNT = "Cascade Ridge Aviation LLC";
export const FIXTURE_EMAIL = "nate.rowe@cascaderidgeaviation.com";

/**
 * A FIXED CLOCK. Several of the real components price "how long has this
 * been waiting" from a `now` the caller passes in (unbilled-lib's
 * daysSince), so pinning it here keeps every capture byte-identical
 * whenever the script is re-run instead of drifting a day at a time.
 * 2026-08-18, the date every fixture below is written around.
 */
export const FIXTURE_NOW = Date.UTC(2026, 7, 18);

/**
 * THE HARNESS'S OWN URL PREFIX.
 *
 * The rail marks the current section with lib/nav.ts's isCurrentSection,
 * which compares an item's href against the live pathname — so on a route
 * that is not one of the product's own, nothing would render as current
 * and every screenshot would show an unhighlighted rail the product never
 * shows. Each screen here therefore serves at `${SHOT_BASE}/<section>` and
 * the rail is handed the real, flag-filtered section list with its hrefs
 * prefixed the same way. Labels, order and grouping are untouched: they
 * still come from visibleNavSections(false), so this cannot advertise a
 * section the product does not have.
 */
export const SHOT_BASE = "/marketing-shots";

export function shotSections(): readonly NavItem[] {
  return visibleNavSections(false).map((item) => ({
    ...item,
    href: `${SHOT_BASE}${item.href}`,
  }));
}

/* ── Overview ───────────────────────────────────────────────────────── */

export const OVERVIEW_SUMMARY: UnbilledSummaryRow = {
  client_count: 2,
  trip_count: 3,
  billable_days: 7,
  day_value_cents: 945000,
  rebill_expense_cents: 218400,
  total_cents: 1163400,
  // 11 days before FIXTURE_NOW, which is what the "oldest 11 days" clause
  // on the unbilled card is computed from rather than typed.
  oldest_ends_on: "2026-08-07",
};

export const OVERVIEW_CLIENT_ROWS: UnbilledClientRow[] = [
  {
    client_id: "c-northlight",
    client_name: "Northlight Air Partners",
    trip_count: 2,
    billable_days: 5,
    day_value_cents: 675000,
    rebill_expense_cents: 128400,
    total_cents: 803400,
    oldest_ends_on: "2026-08-07",
  },
  {
    client_id: "c-cardinal",
    client_name: "Cardinal Ridge Aviation",
    trip_count: 1,
    billable_days: 2,
    day_value_cents: 270000,
    rebill_expense_cents: 90000,
    total_cents: 360000,
    oldest_ends_on: "2026-08-12",
  },
];

/**
 * The trip rows behind those client rows. They RECONCILE with the summary
 * above on every column — 7 days, $9,450.00 of day money, $2,184.00 of
 * rebillable receipts — because that reconciliation is the one property
 * the real screen prints a total row to let a pilot check for themselves,
 * and a screenshot whose columns do not add up would be the first thing a
 * reader noticed.
 */
export const OVERVIEW_TRIPS: (UnbilledTripMoneyRow & { route: string })[] = [
  {
    trip_id: "t-1041",
    client_id: "c-northlight",
    client_name: "Northlight Air Partners",
    starts_on: "2026-08-05",
    ends_on: "2026-08-07",
    aircraft_ident: "N684CR",
    billable_days: 3,
    day_value_cents: 405000,
    rebill_expense_cents: 109840,
    route: "KBED → KTEB → KBED",
  },
  {
    trip_id: "t-1042",
    client_id: "c-cardinal",
    client_name: "Cardinal Ridge Aviation",
    starts_on: "2026-08-11",
    ends_on: "2026-08-12",
    aircraft_ident: "N317MW",
    billable_days: 2,
    day_value_cents: 270000,
    rebill_expense_cents: 90000,
    route: "KHPN → KPBI",
  },
  {
    trip_id: "t-1043",
    client_id: "c-northlight",
    client_name: "Northlight Air Partners",
    starts_on: "2026-08-14",
    ends_on: "2026-08-15",
    aircraft_ident: "N684CR",
    billable_days: 2,
    day_value_cents: 270000,
    rebill_expense_cents: 18560,
    route: "KTEB → KASE → KTEB",
  },
];

/** The two figures the unbilled chain does not supply. */
export const OVERVIEW_AWAITING_CENTS = 915000;
export const OVERVIEW_AWAITING_INVOICES = 2;
export const OVERVIEW_PAID_CENTS = 14690000;
export const OVERVIEW_PAID_COUNT = 24;
export const OVERVIEW_DEDUCTIBLE_CENTS = 1286540;
export const OVERVIEW_DEDUCTIBLE_COUNT = 38;

/**
 * Document expirations, ordered by expiry the way pilot.expirations serves
 * them. `ladder_stage` is a real stage name so the real badge map
 * (documents/expiry-badge.ts) supplies the tone and the wording — the
 * screenshot cannot invent a badge the product does not have.
 *
 * The three certificate-shaped rows all fall on a month end; the passport
 * and the insurance policy deliberately do not. See this file's header.
 */
export const OVERVIEW_EXPIRATIONS: {
  id: string;
  label: string;
  expires_on: string;
  ladder_stage: string;
}[] = [
  {
    id: "x-pic-check",
    label: "PIC proficiency check (61.58)",
    expires_on: "2026-08-31",
    ladder_stage: "t_minus_14",
  },
  {
    id: "x-medical",
    label: "First-class medical",
    expires_on: "2026-09-30",
    ladder_stage: "ok",
  },
  {
    id: "x-insurance",
    label: "Non-owned aircraft insurance",
    expires_on: "2027-01-31",
    ladder_stage: "ok",
  },
  {
    id: "x-flight-review",
    label: "Flight review",
    expires_on: "2027-04-30",
    ladder_stage: "ok",
  },
  {
    id: "x-passport",
    label: "Passport",
    expires_on: "2029-03-11",
    ladder_stage: "ok",
  },
];

/* ── Invoice ────────────────────────────────────────────────────────── */

export const INVOICE_ID = "inv-2026-0184";
export const INVOICE_NUMBER = "INV-2026-0184";

export const INVOICE_HEADER = {
  id: INVOICE_ID,
  client_id: "c-northlight",
  bill_to_name: "Northlight Air Partners",
  bill_to_contact_name: "Dana Whitfield",
  bill_to_email: "accounts@northlightairpartners.com",
  bill_to_address_line1: "18 Ridgeway Court, Suite 210",
  bill_to_address_line2: null,
  bill_to_city: "Bedford",
  bill_to_state: "MA",
  bill_to_postal_code: "01730",
  bill_to_country: "United States",
  issued_on: "2026-08-08",
  // Net 30 off the issue date.
  due_on: "2026-09-07",
  tax_rate_bps: 0,
  notes: "Trip 1041, KBED–KTEB–KBED, 5–7 August. Receipts attached.",
};

export const INVOICE_CLIENTS = [
  { id: "c-northlight", name: "Northlight Air Partners" },
  { id: "c-cardinal", name: "Cardinal Ridge Aviation" },
  { id: "c-harbor", name: "Harbor Rock Holdings" },
];

/**
 * The lines a completed trip generated, in the order createInvoiceDraft
 * emits them: day money first, then per diem, then one
 * reimbursable_expense line per rebillable receipt.
 */
export const INVOICE_LINES: LineRow[] = [
  {
    id: "l-1",
    invoice_id: INVOICE_ID,
    line_type: "flight_day",
    description: "Flight day — Aug 5–7, 2026",
    quantity: 3,
    unit_amount_cents: 135000,
    amount_cents: 405000,
    taxable: false,
    trip_id: "t-1041",
    expense_id: null,
  },
  {
    id: "l-2",
    invoice_id: INVOICE_ID,
    line_type: "travel_day",
    description: "Travel day — Aug 4, 2026",
    quantity: 1,
    unit_amount_cents: 67500,
    amount_cents: 67500,
    taxable: false,
    trip_id: "t-1041",
    expense_id: null,
  },
  {
    id: "l-3",
    invoice_id: INVOICE_ID,
    line_type: "per_diem",
    description: "Per diem — 4 days",
    quantity: 4,
    unit_amount_cents: 7500,
    amount_cents: 30000,
    taxable: false,
    trip_id: "t-1041",
    expense_id: null,
  },
  {
    id: "l-4",
    invoice_id: INVOICE_ID,
    line_type: "reimbursable_expense",
    description: "Crew hotel — Teterboro, 2 nights",
    quantity: 1,
    unit_amount_cents: 61240,
    amount_cents: 61240,
    taxable: false,
    trip_id: "t-1041",
    expense_id: "e-1",
  },
  {
    id: "l-5",
    invoice_id: INVOICE_ID,
    line_type: "reimbursable_expense",
    description: "Airline — positioning to KBED",
    quantity: 1,
    unit_amount_cents: 48610,
    amount_cents: 48610,
    taxable: false,
    trip_id: "t-1041",
    expense_id: "e-2",
  },
];

/** Adds up to the lines above, to the cent. Nothing is taxed at 0 bps. */
export const INVOICE_TOTALS: InvoiceTotalsView = {
  subtotal_cents: 612350,
  tax_cents: 0,
  total_cents: 612350,
  amount_paid_cents: 0,
  balance_due_cents: 612350,
};

/** Two of the five lines are rebilled receipts, and both have a file. */
export const INVOICE_RECEIPT_COUNT = 2;

/* ── Logbook ────────────────────────────────────────────────────────── */

/**
 * A career, not a month: the figures a pilot-history form asks for.
 * Simulator time is its own figure and is never added into Total — see
 * this file's header, and panels.tsx's own column comment.
 */
export const LOGBOOK_TOTALS: LogbookTotalsView = {
  total: 8412.6,
  pic: 5187.3,
  night: 1104.8,
  instrument: 612.4,
  simulator: 214.0,
  landings: 5312,
};

/** Sums to LOGBOOK_TOTALS.total across the six rows plus the unlabelled bucket. */
export const LOGBOOK_BY_TYPE: HoursByTypeView[] = [
  {
    label: "CE-560XL",
    total: 2410.7,
    pic: 1580.2,
    sic: 830.5,
    night: 318.4,
    simulator: 96.0,
    registered: true,
  },
  {
    label: "C25B",
    total: 1876.4,
    pic: 1201.9,
    sic: 674.5,
    night: 244.1,
    simulator: 48.0,
    registered: true,
  },
  {
    label: "PC-12/47E",
    total: 1342.8,
    pic: 1342.8,
    sic: 0.0,
    night: 188.6,
    simulator: 0.0,
    registered: true,
  },
  {
    label: "LR-45",
    total: 964.3,
    pic: 402.1,
    sic: 562.2,
    night: 142.7,
    simulator: 40.0,
    registered: true,
  },
  {
    label: "BE-400",
    total: 618.5,
    pic: 318.4,
    sic: 300.1,
    night: 79.2,
    simulator: 30.0,
    registered: true,
  },
  {
    label: "C208B",
    total: 512.9,
    pic: 341.9,
    sic: 171.0,
    night: 61.3,
    simulator: 0.0,
    registered: false,
  },
];

/**
 * ONE ENTRY PER LEG, which is the only form 61.51 recognises — a three-leg
 * day is three rows here, not one. PIC and SIC never share a column, and
 * `source` is what the real screen badges: an entry a completed trip
 * drafted reads "From trip", one typed by hand reads "Manual", one that
 * arrived through the CSV mapper reads "Imported".
 */
export const LOGBOOK_ENTRIES: LogbookEntryCells[] = [
  {
    id: "e-9001",
    entry_date: "2026-08-15",
    from_icao: "KASE",
    to_icao: "KTEB",
    aircraft_ident: "N684CR",
    role: "PIC",
    simulator_device_type: null,
    total_time: 3.9,
    night_time: 0.4,
    instrument_actual_time: 0.3,
    instrument_simulated_time: null,
    day_landings_full_stop: 1,
    day_landings_touch_go: 0,
    night_landings_full_stop: 0,
    night_landings_touch_go: 0,
    source: "trip",
  },
  {
    id: "e-9002",
    entry_date: "2026-08-14",
    from_icao: "KTEB",
    to_icao: "KASE",
    aircraft_ident: "N684CR",
    role: "PIC",
    simulator_device_type: null,
    total_time: 4.3,
    night_time: 0.0,
    instrument_actual_time: 0.6,
    instrument_simulated_time: null,
    day_landings_full_stop: 1,
    day_landings_touch_go: 0,
    night_landings_full_stop: 0,
    night_landings_touch_go: 0,
    source: "trip",
  },
  {
    id: "e-9003",
    entry_date: "2026-08-12",
    from_icao: "KPBI",
    to_icao: "KHPN",
    aircraft_ident: "N317MW",
    role: "SIC",
    simulator_device_type: null,
    total_time: 2.8,
    night_time: 1.1,
    instrument_actual_time: 0.2,
    instrument_simulated_time: null,
    day_landings_full_stop: 0,
    day_landings_touch_go: 0,
    night_landings_full_stop: 1,
    night_landings_touch_go: 0,
    source: "trip",
  },
  {
    id: "e-9004",
    entry_date: "2026-08-11",
    from_icao: "KHPN",
    to_icao: "KPBI",
    aircraft_ident: "N317MW",
    role: "SIC",
    simulator_device_type: null,
    total_time: 2.6,
    night_time: 0.0,
    instrument_actual_time: 0.0,
    instrument_simulated_time: 0.4,
    day_landings_full_stop: 1,
    day_landings_touch_go: 0,
    night_landings_full_stop: 0,
    night_landings_touch_go: 0,
    source: "trip",
  },
  {
    id: "e-9005",
    entry_date: "2026-08-09",
    from_icao: null,
    to_icao: null,
    aircraft_ident: "CE-560XL FFS",
    // 61.51: a wholly-simulator session has no crew role, because there is
    // no aircraft to be pilot in command of. The device type is what the
    // real screen shows in the Role column instead.
    role: null,
    simulator_device_type: "ffs",
    total_time: 0.0,
    night_time: 0.0,
    instrument_actual_time: 0.0,
    instrument_simulated_time: 0.0,
    day_landings_full_stop: 0,
    day_landings_touch_go: 0,
    night_landings_full_stop: 0,
    night_landings_touch_go: 0,
    source: "manual",
  },
  {
    id: "e-9006",
    entry_date: "2026-08-07",
    from_icao: "KTEB",
    to_icao: "KBED",
    aircraft_ident: "N684CR",
    role: "PIC",
    simulator_device_type: null,
    total_time: 1.2,
    night_time: 0.0,
    instrument_actual_time: 0.0,
    instrument_simulated_time: null,
    day_landings_full_stop: 1,
    day_landings_touch_go: 0,
    night_landings_full_stop: 0,
    night_landings_touch_go: 0,
    source: "trip",
  },
  {
    id: "e-9007",
    entry_date: "2026-08-05",
    from_icao: "KBED",
    to_icao: "KTEB",
    aircraft_ident: "N684CR",
    role: "PIC",
    simulator_device_type: null,
    total_time: 1.1,
    night_time: 0.0,
    instrument_actual_time: 0.0,
    instrument_simulated_time: null,
    day_landings_full_stop: 1,
    day_landings_touch_go: 0,
    night_landings_full_stop: 0,
    night_landings_touch_go: 0,
    source: "trip",
  },
  {
    id: "e-9008",
    entry_date: "2026-07-30",
    from_icao: "KBJC",
    to_icao: "KAPA",
    aircraft_ident: "N905FL",
    role: "PIC",
    simulator_device_type: null,
    total_time: 0.9,
    night_time: 0.9,
    instrument_actual_time: 0.0,
    instrument_simulated_time: null,
    day_landings_full_stop: 0,
    day_landings_touch_go: 0,
    night_landings_full_stop: 1,
    night_landings_touch_go: 2,
    source: "import",
  },
  {
    id: "e-9009",
    entry_date: "2026-07-28",
    from_icao: "KFXE",
    to_icao: "KOPF",
    aircraft_ident: "N228TQ",
    role: "SIC",
    simulator_device_type: null,
    total_time: 0.7,
    night_time: 0.0,
    instrument_actual_time: 0.0,
    instrument_simulated_time: null,
    day_landings_full_stop: 1,
    day_landings_touch_go: 0,
    night_landings_full_stop: 0,
    night_landings_touch_go: 0,
    source: "import",
  },
];

export const LOGBOOK_ENTRY_COUNT = 3184;
