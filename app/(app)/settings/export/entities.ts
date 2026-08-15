import type { Database } from "@/lib/supabase/database.types";
import {
  CLIENT_OPERATING_RULE_LABEL,
  TRIP_OPERATING_RULE_LABEL,
} from "@/lib/operating-rule";
import { DOCUMENT_KIND_LABEL } from "../../documents/kinds";
import { CATEGORY_LABEL } from "../../reports/year-end/db";

/**
 * The account-wide export: every CSV's header row and the pure row→values
 * mapper behind it, in ONE file so the two can be length-checked against
 * each other at module load — the same guard
 * app/(app)/logbook/export/route.ts carries, for the same reason: a CSV
 * whose header and rows disagree does not fail, it SHIFTS, silently, and
 * in a data-portability file that looks complete and reads wrong the
 * pilot has no way to spot it. The check at the bottom of this file
 * probes every mapper with an empty row; a mismatch is a startup error,
 * never a corrupted download.
 *
 * PURE ON PURPOSE. Nothing here touches Supabase, the request, or
 * next/*, so tests/account-export.test.mjs can run these mappers under
 * `node --test` exactly as the route runs them. All I/O — auth, paging
 * past the Data API's silent 1000-row cap, streaming — lives in
 * ./[entity]/route.ts.
 *
 * Labels come from the modules that already own them wherever one exists
 * (lib/operating-rule.ts, documents/kinds.ts, the year-end report's
 * expense CATEGORY_LABEL), so this export can never drift from what the
 * pilot sees on screen. The few vocabularies whose labels live only
 * inside client components (invoice status badges, trip status badges)
 * are restated here with the same strings — a component file with "use
 * client" cannot be imported by a route handler or a node test.
 *
 * Money: integer cents in the data, exported as the plain dollars string
 * the year-end report's CSVs already use — see centsToDollarsString,
 * copied verbatim from app/(app)/reports/year-end/export/route.ts so the
 * two exports can never disagree about the numeric form.
 */

type Tables = Database["pilot"]["Tables"];
type Views = Database["pilot"]["Views"];

/** What lib/csv.ts's csvField accepts. */
export type CsvValue = string | number | null | undefined;

// ---------------------------------------------------------------------------
// Small pure formatting helpers
// ---------------------------------------------------------------------------

/**
 * Identical, by intent, to the year-end export's own function of the same
 * name: cents → "1234.56", blank for unknown. Blank, not "0.00" — a
 * missing figure must never read as a real zero.
 */
export function centsToDollarsString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Basis points → a percent string ("875" → "8.75"). Exact: bps/100 always
 * has at most two decimals, so toFixed(2) never rounds anything away.
 */
export function bpsToPercentString(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "";
  return (bps / 100).toFixed(2);
}

/**
 * A timestamp (or date) → ISO YYYY-MM-DD, blank for null. The `date`
 * columns pass through untouched; timestamptz columns lose their time
 * part, which is what a spreadsheet date column wants.
 */
export function isoDate(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

/**
 * The filename component of a storage path
 * ("accountId/documentId/medical.pdf" → "medical.pdf") — the metadata
 * this export carries INSTEAD of the file itself. Blank when no file is
 * attached.
 */
export function fileBasename(path: string | null | undefined): string {
  if (!path) return "";
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Booleans are written as Yes/No for the same reason the logbook export
 * writes its one boolean that way: a pilot reads this CSV, and "false" in
 * a column headed "Away from home base" is worse than useless next to a
 * page of numbers.
 */
export function yesNo(value: boolean | null | undefined): string {
  return value ? "Yes" : "No";
}

/** Filesystem/header-safe filename component — same as the other exports. */
export function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pilot"
  );
}

// ---------------------------------------------------------------------------
// Vocabulary labels restated from client components (see file header)
// ---------------------------------------------------------------------------

/** Same strings as app/(app)/invoices/page.tsx's STATUS_BADGE. */
const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Partially paid",
  paid: "Paid",
  void: "Void",
};

/** Same strings as app/(app)/trips/trip-form.tsx's STATUSES. */
const TRIP_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  canceled: "Canceled",
};

/** Same strings as app/(app)/trips/page.tsx's BILLING_BADGE. */
const BILLING_STATE_LABEL: Record<string, string> = {
  unbilled: "Unbilled",
  invoiced: "Invoiced",
  paid: "Paid",
  written_off: "Written off",
};

/** Same strings as app/(app)/trips/trip-form.tsx's TRIP_KINDS. */
const TRIP_KIND_LABEL: Record<string, string> = {
  contract_pilot: "Contract pilot",
  owner_trip: "Owner trip",
  repositioning: "Repositioning",
  ferry: "Ferry",
  maintenance_flight: "Maintenance flight",
  delivery_flight: "Delivery flight",
  other: "Other",
};

/** Same strings as trip-form.tsx's CANCELLATION_NOTICE_FROM_OPTIONS. */
const CANCELLATION_NOTICE_LABEL: Record<string, string> = {
  client: "Client",
  pilot: "Pilot",
  weather: "Weather",
  maintenance: "Maintenance",
  other: "Other",
};

/** Same strings as app/(app)/invoices/[id]/lines-editor.tsx's LINE_TYPE_LABEL. */
const LINE_TYPE_LABEL: Record<string, string> = {
  flight_day: "Flight day",
  travel_day: "Travel day",
  per_diem: "Per diem",
  reimbursable_expense: "Rebilled expense",
  cancellation_fee: "Cancellation fee",
  other: "Other",
};

/** Same strings as app/(app)/invoices/[id]/payment-panel.tsx's METHODS. */
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  ach: "ACH",
  check: "Check",
  wire: "Wire",
  card: "Card",
  cash: "Cash",
  other: "Other",
};

const TREATMENT_LABEL: Record<string, string> = {
  rebill: "Rebill to client",
  deduct: "Deductible",
  unassigned: "Unassigned",
};

const PER_DIEM_MODE_LABEL: Record<string, string> = {
  per_diem: "Per diem",
  receipts: "Receipts",
};

const MINIMUM_BASIS_LABEL: Record<string, string> = {
  per_trip: "Per trip",
  per_month: "Per month",
};

const W9_STATUS_LABEL: Record<string, string> = {
  not_requested: "Not requested",
  requested: "Requested",
  on_file: "On file",
};

const DELIVERY_LABEL: Record<string, string> = {
  platform_email: "Emailed from here",
  manual_download: "Downloaded to send yourself",
};

/**
 * Same strings as app/(app)/estimates/estimate-lib.ts's
 * ESTIMATE_STATUS_BADGE. Restated rather than imported: that directory is
 * another agent's surface this session (the same reason estimate-lib.ts
 * itself restates parsePercentToBps instead of importing it from
 * invoices/actions.ts).
 */
const ESTIMATE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
};

/** Same strings as estimate-lib.ts's ESTIMATE_LINE_TYPE_LABEL — note
 *  "Reimbursable expense", not the invoice screens' "Rebilled expense";
 *  the estimate export must read as the estimate screens do. */
const ESTIMATE_LINE_TYPE_LABEL: Record<string, string> = {
  flight_day: "Flight day",
  travel_day: "Travel day",
  per_diem: "Per diem",
  reimbursable_expense: "Reimbursable expense",
  cancellation_fee: "Cancellation fee",
  other: "Other",
};

/** Same strings as app/(app)/clients/[id]/operator-qualification-kinds.ts's
 *  OPERATOR_QUALIFICATION_REQUIREMENTS labels — restated rather than
 *  imported, same posture as the invoice/estimate/trip vocabularies above
 *  (that directory is another agent's surface this session). Covers the
 *  post-20260807110000 requirement vocabulary (written_test_135_293a /
 *  competency_check_135_293b), which is why `requirement` below is typed
 *  as a plain string rather than Tables[...]'s stale union — see
 *  OperatorQualificationExportRow. */
const OPERATOR_QUALIFICATION_REQUIREMENT_LABEL: Record<string, string> = {
  basic_indoc: "Basic indoctrination",
  initial_training: "Initial training",
  recurrent_training: "Recurrent training",
  written_test_135_293a: "Written/oral knowledge test",
  competency_check_135_293b: "Competency check",
  ipc_135_297: "Instrument proficiency check (IPC)",
  line_check_135_299: "Line check",
  drug_alcohol_program_120: "Drug & alcohol program",
  prd_consent_111: "PRD (Pilot Records Database) consent",
  insurance_approval: "Insurance approval",
  company_manuals: "Company manuals issued/current",
  other: "Other",
};

/** Same strings as operator-qualification-kinds.ts's STATUS_OPTIONS. This
 *  is the pilot's OWN assertion about their standing with an operator
 *  (not a computed currency verdict), so "Current" here is fine — unlike
 *  the ok-stage badge on documents/expiry-badge.ts, which is derived. */
const OPERATOR_QUALIFICATION_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  current: "Current",
  lapsed: "Lapsed",
  n_a: "N/A for this operator",
};

const AIRCRAFT_GEAR_LABEL: Record<string, string> = {
  tricycle: "Tricycle",
  tailwheel: "Tailwheel",
  skid: "Skid",
  float: "Float",
  ski: "Ski",
};

const BANK_ACCOUNT_KIND_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
};

const BANK_REVIEW_STATE_LABEL: Record<string, string> = {
  unreviewed: "Unreviewed",
  reviewed: "Reviewed",
  ignored: "Ignored",
};

const CHART_ACCOUNT_KIND_LABEL: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

const JOURNAL_SOURCE_TYPE_LABEL: Record<string, string> = {
  manual: "Manual entry",
  invoice_issued: "Invoice issued",
  invoice_voided: "Invoice voided",
  payment: "Payment",
  payment_void_reclass: "Payment reclass (void)",
  expense: "Expense",
  mileage: "Mileage",
};

const JOURNAL_SIDE_LABEL: Record<string, string> = {
  debit: "Debit",
  credit: "Credit",
};

const LATE_FEE_BASIS_LABEL: Record<string, string> = {
  flat: "Flat",
  bps_per_month: "Percent per month",
};

const RECURRING_CADENCE_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
};

// ---------------------------------------------------------------------------
// Cross-reference lookups
// ---------------------------------------------------------------------------

export type TripRef = {
  starts_on: string;
  aircraft_ident: string | null;
  client_id: string | null;
};

export type InvoiceRef = {
  invoice_number: string | null;
  status: string;
  /** Null since 20260815100000 when the invoice bills typed details. */
  client_id: string | null;
  bill_to_name: string | null;
};

export type InvoiceTotalsRef = Pick<
  Views["invoice_totals"]["Row"],
  | "subtotal_cents"
  | "tax_cents"
  | "total_cents"
  | "amount_paid_cents"
  | "last_paid_on"
  | "balance_due_cents"
>;

export type EstimateRef = {
  estimate_number: string | null;
  status: string;
  client_id: string;
};

/** pilot.estimate_totals is the single money source for an estimate —
 *  same posture as InvoiceTotalsRef above. */
export type EstimateTotalsRef = Pick<
  Views["estimate_totals"]["Row"],
  "subtotal_cents" | "tax_cents" | "total_cents"
>;

/**
 * The in-memory joins. No PostgREST embeds anywhere — they resolve to
 * `never` against this app's hand-authored types (see
 * lib/supabase/account.ts), so every join is flat queries resolved in
 * memory, the same shape as app/(app)/reports/year-end/queries.ts. The
 * route fills only the maps an entity's `needs` declares; the rest stay
 * empty.
 */
export type Lookups = {
  clientNameById: Map<string, string>;
  tripById: Map<string, TripRef>;
  invoiceById: Map<string, InvoiceRef>;
  dayTypeLabelById: Map<string, string>;
  totalsByInvoiceId: Map<string, InvoiceTotalsRef>;
  estimateById: Map<string, EstimateRef>;
  estimateTotalsByEstimateId: Map<string, EstimateTotalsRef>;
  /** "Chase checking …4521" — label plus last4 when set, built in
   *  buildLookups so bank_transactions never prints a bank account UUID. */
  bankAccountLabelById: Map<string, string>;
  chartAccountNameById: Map<string, string>;
};

export function emptyLookups(): Lookups {
  return {
    clientNameById: new Map(),
    tripById: new Map(),
    invoiceById: new Map(),
    dayTypeLabelById: new Map(),
    totalsByInvoiceId: new Map(),
    estimateById: new Map(),
    estimateTotalsByEstimateId: new Map(),
    bankAccountLabelById: new Map(),
    chartAccountNameById: new Map(),
  };
}

/**
 * A set client_id that fails to resolve prints "Unknown client", never a
 * blank — a blank means "this row has no client", which is a different
 * fact (same distinction the year-end report draws). A null client_id is
 * the legitimate blank.
 */
function clientName(lookups: Lookups, clientId: string | null | undefined): string {
  if (!clientId) return "";
  return lookups.clientNameById.get(clientId) ?? "Unknown client";
}

/**
 * WHO AN INVOICE BILLS, for the Client column of every invoice-derived
 * export. A clientless invoice (20260815100000) prints the name typed on it
 * rather than a blank: a blank in this column has always meant "no client",
 * and while that is still literally true here, the export's job is to say who
 * was billed, and this row knows.
 *
 * The Client ID column stays blank for one, which is the honest answer to a
 * question about a foreign key that is genuinely null.
 */
function invoicePayerName(
  lookups: Lookups,
  invoice: { client_id: string | null; bill_to_name: string | null } | undefined
): string {
  if (!invoice) return "";
  if (invoice.client_id === null) return invoice.bill_to_name ?? "";
  return clientName(lookups, invoice.client_id);
}

// ---------------------------------------------------------------------------
// Per-entity headers and mappers
// ---------------------------------------------------------------------------

export type ClientExportRow = Pick<
  Tables["clients"]["Row"],
  | "id"
  | "name"
  | "contact_name"
  | "contact_email"
  | "contact_phone"
  | "address_line1"
  | "address_line2"
  | "city"
  | "state"
  | "postal_code"
  | "country"
  | "operating_rule"
  | "default_day_rate_cents"
  | "default_travel_day_rate_cents"
  | "default_per_diem_cents"
  | "per_diem_mode"
  | "payment_terms_days"
  | "default_expense_treatment"
  | "minimum_days"
  | "minimum_basis"
  | "cancellation_policy_note"
  | "w9_status"
  | "w9_sent_at"
  | "w9_received_at"
  | "notes"
  | "archived_at"
>;

export const CLIENT_HEADER = [
  "Client",
  "Contact name",
  "Contact email",
  "Contact phone",
  "Address line 1",
  "Address line 2",
  "City",
  "State",
  "Postal code",
  "Country",
  "Operating rule",
  "Default day rate",
  "Default travel day rate",
  "Default per diem",
  "Per diem mode",
  "Payment terms (days)",
  "Default expense treatment",
  "Minimum days",
  "Minimum basis",
  "W-9 status",
  "W-9 requested on",
  "W-9 received on",
  "Cancellation policy",
  "Notes",
  "Archived on",
  "Client ID",
] as const;

export function clientValues(row: ClientExportRow): CsvValue[] {
  return [
    row.name,
    row.contact_name,
    row.contact_email,
    row.contact_phone,
    row.address_line1,
    row.address_line2,
    row.city,
    row.state,
    row.postal_code,
    row.country,
    CLIENT_OPERATING_RULE_LABEL[row.operating_rule] ?? "",
    centsToDollarsString(row.default_day_rate_cents),
    centsToDollarsString(row.default_travel_day_rate_cents),
    centsToDollarsString(row.default_per_diem_cents),
    PER_DIEM_MODE_LABEL[row.per_diem_mode] ?? "",
    row.payment_terms_days,
    TREATMENT_LABEL[row.default_expense_treatment] ?? "",
    row.minimum_days,
    MINIMUM_BASIS_LABEL[row.minimum_basis] ?? "",
    W9_STATUS_LABEL[row.w9_status] ?? "",
    isoDate(row.w9_sent_at),
    isoDate(row.w9_received_at),
    row.cancellation_policy_note,
    row.notes,
    isoDate(row.archived_at),
    row.id,
  ];
}

export type TripExportRow = Pick<
  Tables["trips"]["Row"],
  | "id"
  | "client_id"
  | "trip_kind"
  | "status"
  | "starts_on"
  | "ends_on"
  | "aircraft_ident"
  | "aircraft_type"
  | "operating_rule"
  | "day_rate_cents"
  | "day_count"
  | "travel_day_rate_cents"
  | "travel_day_count"
  | "billing_state"
  | "canceled_at"
  | "cancellation_notice_from"
  | "notes"
>;

export const TRIP_HEADER = [
  "Start date",
  "End date",
  "Status",
  "Trip kind",
  "Client",
  "Tail number",
  "Aircraft type",
  "Operating rule",
  "Day rate",
  "Flight days",
  "Travel day rate",
  "Travel days",
  "Billing state",
  "Canceled on",
  "Cancellation notice from",
  "Notes",
  "Trip ID",
  "Client ID",
] as const;

export function tripValues(row: TripExportRow, lookups: Lookups): CsvValue[] {
  return [
    row.starts_on,
    row.ends_on,
    TRIP_STATUS_LABEL[row.status] ?? "",
    TRIP_KIND_LABEL[row.trip_kind] ?? "",
    clientName(lookups, row.client_id),
    row.aircraft_ident,
    row.aircraft_type,
    TRIP_OPERATING_RULE_LABEL[row.operating_rule] ?? "",
    centsToDollarsString(row.day_rate_cents),
    row.day_count,
    centsToDollarsString(row.travel_day_rate_cents),
    row.travel_day_count,
    BILLING_STATE_LABEL[row.billing_state] ?? "",
    isoDate(row.canceled_at),
    row.cancellation_notice_from
      ? CANCELLATION_NOTICE_LABEL[row.cancellation_notice_from] ?? ""
      : "",
    row.notes,
    row.id,
    row.client_id,
  ];
}

export type TripDayExportRow = Pick<
  Tables["trip_days"]["Row"],
  | "id"
  | "trip_id"
  | "day_on"
  | "day_type_id"
  | "rate_cents"
  | "quantity"
  | "units"
  | "away"
  | "notes"
>;

export const TRIP_DAY_HEADER = [
  "Date",
  "Day type",
  "Client",
  "Tail number",
  "Rate",
  "Quantity (fraction of day worked)",
  "Units (rate fraction)",
  "Away from home base",
  "Notes",
  "Trip start date",
  "Trip ID",
] as const;

export function tripDayValues(row: TripDayExportRow, lookups: Lookups): CsvValue[] {
  const trip = row.trip_id ? lookups.tripById.get(row.trip_id) : undefined;
  return [
    row.day_on,
    // Snapshot semantics: the day type LABEL resolves from today's
    // day_types row, but the money on the day is rate_cents, snapshotted
    // at capture — never re-derived here.
    (row.day_type_id && lookups.dayTypeLabelById.get(row.day_type_id)) ||
      "Unknown day type",
    clientName(lookups, trip?.client_id),
    trip?.aircraft_ident,
    centsToDollarsString(row.rate_cents),
    row.quantity,
    row.units,
    yesNo(row.away),
    row.notes,
    trip?.starts_on,
    row.trip_id,
  ];
}

export type TripLegExportRow = Pick<
  Tables["trip_legs"]["Row"],
  | "id"
  | "trip_id"
  | "leg_date"
  | "from_icao"
  | "to_icao"
  | "out_at"
  | "in_at"
  | "block_hours"
  | "night_hours"
  | "instrument_hours"
  | "instrument_actual_hours"
  | "instrument_simulated_hours"
  | "cross_country_hours"
  | "day_takeoffs"
  | "day_landings"
  | "day_landings_full_stop"
  | "night_takeoffs"
  | "night_landings_full_stop"
  | "night_landings_touch_go"
  | "approaches"
  | "holds"
>;

export const TRIP_LEG_HEADER = [
  "Leg date",
  "From",
  "To",
  "Tail number",
  "Out (UTC)",
  "In (UTC)",
  "Block hours",
  "Night hours",
  "Instrument hours (combined)",
  "Instrument actual hours",
  "Instrument simulated hours",
  "Cross country hours",
  "Day takeoffs",
  "Day landings",
  "Day landings full stop",
  "Night takeoffs",
  "Night landings full stop",
  "Night landings touch and go",
  "Approaches",
  "Holds",
  "Trip ID",
] as const;

export function tripLegValues(row: TripLegExportRow, lookups: Lookups): CsvValue[] {
  const trip = row.trip_id ? lookups.tripById.get(row.trip_id) : undefined;
  return [
    row.leg_date,
    row.from_icao,
    row.to_icao,
    trip?.aircraft_ident,
    // Full ISO timestamps, not dates — OOOI times are times, and they are
    // stored (and exported) in UTC.
    row.out_at,
    row.in_at,
    row.block_hours,
    row.night_hours,
    // The legacy combined figure is NOT the sum of the two split columns
    // (see the trip_legs schema comment); all three are exported so the
    // spreadsheet holds exactly what the pilot recorded.
    row.instrument_hours,
    row.instrument_actual_hours,
    row.instrument_simulated_hours,
    row.cross_country_hours,
    row.day_takeoffs,
    row.day_landings,
    row.day_landings_full_stop,
    row.night_takeoffs,
    row.night_landings_full_stop,
    row.night_landings_touch_go,
    row.approaches,
    row.holds,
    row.trip_id,
  ];
}

export type InvoiceExportRow = Pick<
  Tables["invoices"]["Row"],
  | "id"
  | "client_id"
  | "bill_to_name"
  | "bill_to_contact_name"
  | "bill_to_email"
  | "bill_to_address_line1"
  | "bill_to_address_line2"
  | "bill_to_city"
  | "bill_to_state"
  | "bill_to_postal_code"
  | "bill_to_country"
  | "invoice_number"
  | "status"
  | "issued_on"
  | "due_on"
  | "sent_at"
  | "tax_rate_bps"
  | "delivery_method"
  | "notes"
  | "created_at"
>;

export const INVOICE_HEADER = [
  "Invoice number",
  "Client",
  "Status",
  "Issued on",
  "Due on",
  "Sent on",
  "Tax rate (%)",
  "Subtotal",
  "Tax",
  "Total",
  "Amount paid",
  "Last paid on",
  "Balance due",
  "Delivery",
  "Notes",
  "Created on",
  "Invoice ID",
  "Client ID",
  // THE TYPED BILL-TO BLOCK, and it has to be here rather than inferred.
  //
  // A clientless invoice (20260815100000) has no row in the clients export
  // to join back to, so these nine columns are the ONLY record of who was
  // billed. Exporting the name alone would leave an account-wide export
  // that cannot answer "where did this invoice go", which is the one thing
  // this file promises: every record type, on every plan. A linked invoice
  // leaves them all blank by construction, since the check constraint
  // forbids it carrying any of them.
  "Bill to name",
  "Bill to contact",
  "Bill to email",
  "Bill to address 1",
  "Bill to address 2",
  "Bill to city",
  "Bill to state",
  "Bill to postal code",
  "Bill to country",
] as const;

export function invoiceValues(row: InvoiceExportRow, lookups: Lookups): CsvValue[] {
  // pilot.invoice_totals is the ONE source for invoice money (its own
  // schema comment). A totals row that failed to resolve exports as
  // blanks, never zeros — blank money is "not computed", zero money is a
  // claim.
  const totals = row.id ? lookups.totalsByInvoiceId.get(row.id) : undefined;
  return [
    row.invoice_number,
    invoicePayerName(lookups, row),
    INVOICE_STATUS_LABEL[row.status] ?? "",
    row.issued_on,
    row.due_on,
    isoDate(row.sent_at),
    bpsToPercentString(row.tax_rate_bps),
    centsToDollarsString(totals?.subtotal_cents),
    centsToDollarsString(totals?.tax_cents),
    centsToDollarsString(totals?.total_cents),
    centsToDollarsString(totals?.amount_paid_cents),
    totals?.last_paid_on ?? "",
    centsToDollarsString(totals?.balance_due_cents),
    row.delivery_method ? DELIVERY_LABEL[row.delivery_method] ?? "" : "",
    row.notes,
    isoDate(row.created_at),
    row.id,
    row.client_id,
    row.bill_to_name,
    row.bill_to_contact_name,
    row.bill_to_email,
    row.bill_to_address_line1,
    row.bill_to_address_line2,
    row.bill_to_city,
    row.bill_to_state,
    row.bill_to_postal_code,
    row.bill_to_country,
  ];
}

export type InvoiceLineExportRow = Pick<
  Tables["invoice_lines"]["Row"],
  | "id"
  | "invoice_id"
  | "line_type"
  | "description"
  | "quantity"
  | "unit_amount_cents"
  | "amount_cents"
  | "taxable"
  | "trip_id"
  | "expense_id"
  | "sort_order"
>;

export const INVOICE_LINE_HEADER = [
  "Invoice number",
  "Client",
  "Line type",
  "Description",
  "Quantity",
  "Unit amount",
  "Amount",
  "Taxable",
  "Sort order",
  "Trip ID",
  "Expense ID",
  "Invoice ID",
] as const;

export function invoiceLineValues(
  row: InvoiceLineExportRow,
  lookups: Lookups
): CsvValue[] {
  const invoice = row.invoice_id ? lookups.invoiceById.get(row.invoice_id) : undefined;
  return [
    // Blank for a draft invoice — numbers are assigned at issue. The
    // Invoice ID column still says exactly which invoice the line is on.
    invoice?.invoice_number,
    invoicePayerName(lookups, invoice),
    LINE_TYPE_LABEL[row.line_type] ?? "",
    row.description,
    row.quantity,
    centsToDollarsString(row.unit_amount_cents),
    centsToDollarsString(row.amount_cents),
    yesNo(row.taxable),
    row.sort_order,
    row.trip_id,
    row.expense_id,
    row.invoice_id,
  ];
}

export type InvoicePaymentExportRow = Pick<
  Tables["invoice_payments"]["Row"],
  "id" | "invoice_id" | "paid_on" | "amount_cents" | "method" | "notes"
> & {
  /**
   * 20260810120000_payment_reversals.sql: set on a CORRECTION row, naming
   * the payment it cancels (the row carries exactly the negative of that
   * payment's amount). Declared locally because database.types.ts's
   * invoice_payments Row predates that migration — the same local
   * declaration app/(app)/invoices/[id]/payment-panel.tsx carries.
   */
  reverses_payment_id: string | null;
  reversal_reason: string | null;
};

export const INVOICE_PAYMENT_HEADER = [
  "Date paid",
  "Client",
  "Invoice",
  "Invoice status",
  "Method",
  "Amount",
  "Correction reason",
  "Notes",
  "Invoice ID",
  "Payment ID",
  "Reverses payment ID",
] as const;

export function invoicePaymentValues(
  row: InvoicePaymentExportRow,
  lookups: Lookups
): CsvValue[] {
  const invoice = row.invoice_id ? lookups.invoiceById.get(row.invoice_id) : undefined;
  return [
    row.paid_on,
    invoicePayerName(lookups, invoice),
    invoice?.invoice_number,
    // The full payment ledger, INCLUDING payments whose invoice was later
    // voided — the year-end income figure excludes those, and this status
    // column is what lets a spreadsheet user do the same.
    invoice ? INVOICE_STATUS_LABEL[invoice.status] ?? "" : "",
    row.method ? PAYMENT_METHOD_LABEL[row.method] ?? "" : "",
    centsToDollarsString(row.amount_cents),
    row.reversal_reason,
    row.notes,
    row.invoice_id,
    // The correction linkage. Without the payment's own id and the
    // reverses column, a corrected ledger shows an unexplained negative
    // amount with no way to tell which payment it cancels — the ledger is
    // append-only (the wrong row and its correction BOTH export), so the
    // pair of IDs is what makes the two rows read as one story.
    row.id,
    row.reverses_payment_id,
  ];
}

export type ExpenseExportRow = Pick<
  Tables["expenses"]["Row"],
  | "id"
  | "trip_id"
  | "incurred_on"
  | "category"
  | "vendor"
  | "amount_cents"
  | "treatment"
  | "receipt_path"
  | "notes"
>;

export const EXPENSE_HEADER = [
  "Date",
  "Category",
  "Vendor",
  "Amount",
  "Treatment",
  "Client",
  "Tail number",
  "Receipt on file",
  "Notes",
  "Trip ID",
  "Expense ID",
] as const;

export function expenseValues(row: ExpenseExportRow, lookups: Lookups): CsvValue[] {
  const trip = row.trip_id ? lookups.tripById.get(row.trip_id) : undefined;
  return [
    row.incurred_on,
    CATEGORY_LABEL[row.category] ?? row.category,
    row.vendor,
    centsToDollarsString(row.amount_cents),
    TREATMENT_LABEL[row.treatment] ?? "",
    clientName(lookups, trip?.client_id),
    trip?.aircraft_ident,
    // Metadata only, same posture as the documents export: the receipt
    // image itself is not in this file.
    yesNo(Boolean(row.receipt_path)),
    row.notes,
    row.trip_id,
    row.id,
  ];
}

export type MileageExportRow = Pick<
  Tables["mileage_entries"]["Row"],
  | "id"
  | "drove_on"
  | "miles"
  | "from_place"
  | "to_place"
  | "purpose"
  | "client_id"
  | "trip_id"
  | "rate_cents_per_mile"
  | "amount_cents"
  | "notes"
>;

export const MILEAGE_HEADER = [
  "Date",
  "Miles",
  "From",
  "To",
  "Purpose",
  "Client",
  "Rate (cents/mile)",
  "Amount",
  "Notes",
  "Trip ID",
  "Entry ID",
] as const;

export function mileageValues(row: MileageExportRow, lookups: Lookups): CsvValue[] {
  return [
    row.drove_on,
    row.miles,
    row.from_place,
    row.to_place,
    row.purpose,
    clientName(lookups, row.client_id),
    row.rate_cents_per_mile,
    // The per-drive amount at the rate SNAPSHOTTED when it was recorded.
    // The year-end report's Schedule C figure is a different, deliberate
    // computation (total miles × the year's rate, rounded once — see
    // lib/mileage.ts) and these rows will not necessarily sum to it.
    centsToDollarsString(row.amount_cents),
    row.notes,
    row.trip_id,
    row.id,
  ];
}

export type DocumentExportRow = Pick<
  Tables["documents"]["Row"],
  | "id"
  | "kind"
  | "label"
  | "issued_on"
  | "expires_on"
  | "client_id"
  | "file_path"
  | "notes"
  | "created_at"
>;

export const DOCUMENT_HEADER = [
  "Kind",
  "Label",
  "Issued on",
  "Expires on",
  "Filename",
  "Client",
  "Notes",
  "Added on",
  "Document ID",
] as const;

export function documentValues(row: DocumentExportRow, lookups: Lookups): CsvValue[] {
  return [
    DOCUMENT_KIND_LABEL[row.kind] ?? "Other",
    row.label,
    row.issued_on,
    row.expires_on,
    // Metadata only — the filename, never the file. The scans themselves
    // stay downloadable one at a time from /documents.
    fileBasename(row.file_path),
    clientName(lookups, row.client_id),
    row.notes,
    isoDate(row.created_at),
    row.id,
  ];
}

export type EstimateExportRow = Pick<
  Tables["estimates"]["Row"],
  | "id"
  | "client_id"
  | "trip_id"
  | "estimate_number"
  | "status"
  | "issued_on"
  | "valid_until"
  | "sent_at"
  | "tax_rate_bps"
  | "terms"
  | "notes"
  | "converted_invoice_id"
  | "converted_at"
  | "created_at"
>;

// The date columns are the ones the schema actually has: issued_on,
// valid_until, sent_at, converted_at, created_at. There is no accepted-on
// or declined-on timestamp in pilot.estimates — the status column is the
// whole record of the client's answer — so none is invented here.
export const ESTIMATE_HEADER = [
  "Estimate number",
  "Client",
  "Status",
  "Issued on",
  "Valid until",
  "Sent on",
  "Tax rate (%)",
  "Subtotal",
  "Tax",
  "Total",
  "Terms",
  "Notes",
  "Converted to invoice",
  "Converted on",
  "Created on",
  "Estimate ID",
  "Client ID",
  "Trip ID",
  "Converted invoice ID",
] as const;

export function estimateValues(row: EstimateExportRow, lookups: Lookups): CsvValue[] {
  // pilot.estimate_totals is the ONE source for estimate money (its own
  // schema comment) — same posture, same blank-not-zero rule, as the
  // invoices export above.
  const totals = row.id ? lookups.estimateTotalsByEstimateId.get(row.id) : undefined;
  const converted = row.converted_invoice_id
    ? lookups.invoiceById.get(row.converted_invoice_id)
    : undefined;
  return [
    // Blank for a draft — estimate numbers are assigned on send, exactly
    // like invoice numbers.
    row.estimate_number,
    clientName(lookups, row.client_id),
    ESTIMATE_STATUS_LABEL[row.status] ?? "",
    row.issued_on,
    row.valid_until,
    isoDate(row.sent_at),
    bpsToPercentString(row.tax_rate_bps),
    centsToDollarsString(totals?.subtotal_cents),
    centsToDollarsString(totals?.tax_cents),
    centsToDollarsString(totals?.total_cents),
    row.terms,
    row.notes,
    // Conversion produces a DRAFT invoice, which has no number until the
    // pilot sends it — this column may be blank while the Converted
    // invoice ID column still carries the linkage.
    converted?.invoice_number,
    isoDate(row.converted_at),
    isoDate(row.created_at),
    row.id,
    row.client_id,
    row.trip_id,
    row.converted_invoice_id,
  ];
}

export type EstimateLineExportRow = Pick<
  Tables["estimate_lines"]["Row"],
  | "id"
  | "estimate_id"
  | "line_type"
  | "description"
  | "quantity"
  | "unit_amount_cents"
  | "amount_cents"
  | "taxable"
  | "sort_order"
>;

export const ESTIMATE_LINE_HEADER = [
  "Estimate number",
  "Client",
  "Line type",
  "Description",
  "Quantity",
  "Unit amount",
  "Amount",
  "Taxable",
  "Sort order",
  "Estimate ID",
] as const;

export function estimateLineValues(
  row: EstimateLineExportRow,
  lookups: Lookups
): CsvValue[] {
  const estimate = row.estimate_id
    ? lookups.estimateById.get(row.estimate_id)
    : undefined;
  return [
    // Blank for a draft estimate — numbers are assigned on send. The
    // Estimate ID column still says exactly which estimate the line is on.
    estimate?.estimate_number,
    clientName(lookups, estimate?.client_id),
    ESTIMATE_LINE_TYPE_LABEL[row.line_type] ?? "",
    row.description,
    row.quantity,
    centsToDollarsString(row.unit_amount_cents),
    // amount_cents is GENERATED (quantity x unit amount) — exported as
    // stored, never recomputed here.
    centsToDollarsString(row.amount_cents),
    yesNo(row.taxable),
    row.sort_order,
    row.estimate_id,
  ];
}

export type OperatorQualificationExportRow = Pick<
  Tables["operator_qualifications"]["Row"],
  | "id"
  | "client_id"
  | "completed_on"
  | "expires_on"
  | "type_designator"
  | "notes"
  | "document_id"
  | "created_at"
> & {
  // requirement/status typed as plain strings: database.types.ts's Row
  // union predates 20260807110000_operator_qualification_reg_corrections.sql
  // (written_test_135_293a / competency_check_135_293b) — same "declared
  // locally" posture as InvoicePaymentExportRow above, so an export never
  // throws on a value the stale generated type doesn't know about; the
  // label lookups below fall back to the raw value either way.
  requirement: string;
  status: string;
};

export const OPERATOR_QUALIFICATION_HEADER = [
  "Client",
  "Requirement",
  "Type designator",
  "Status",
  "Completed on",
  "Expires on",
  "Notes",
  "Added on",
  "Qualification ID",
  "Document ID",
  "Client ID",
] as const;

export function operatorQualificationValues(
  row: OperatorQualificationExportRow,
  lookups: Lookups
): CsvValue[] {
  return [
    clientName(lookups, row.client_id),
    OPERATOR_QUALIFICATION_REQUIREMENT_LABEL[row.requirement] ?? row.requirement,
    row.type_designator,
    OPERATOR_QUALIFICATION_STATUS_LABEL[row.status] ?? row.status,
    row.completed_on,
    row.expires_on,
    row.notes,
    isoDate(row.created_at),
    row.id,
    row.document_id,
    row.client_id,
  ];
}

/**
 * pilot.aircraft (20260810110000_aircraft_registry.sql) predates the last
 * database.types.ts regeneration and has no Tables[...] entry at all —
 * declared locally in full, same posture as the requirement/status fields
 * above.
 */
export type AircraftExportRow = {
  id: string;
  tail_number: string;
  type_designator: string | null;
  type_rating: string | null;
  make_model: string | null;
  gear: string | null;
  category_class: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
};

export const AIRCRAFT_HEADER = [
  "Tail number",
  "Type designator",
  "Type rating",
  "Make/model",
  "Category/class",
  "Gear",
  "Notes",
  "Added on",
  "Archived on",
  "Aircraft ID",
] as const;

export function aircraftValues(row: AircraftExportRow): CsvValue[] {
  return [
    row.tail_number,
    row.type_designator,
    row.type_rating,
    row.make_model,
    row.category_class,
    row.gear ? AIRCRAFT_GEAR_LABEL[row.gear] ?? row.gear : "",
    row.notes,
    isoDate(row.created_at),
    isoDate(row.archived_at),
    row.id,
  ];
}

export type ClientRateExportRow = Pick<
  Tables["client_rates"]["Row"],
  "id" | "client_id" | "day_type_id" | "rate_cents" | "created_at"
>;

export const CLIENT_RATE_HEADER = [
  "Client",
  "Day type",
  "Rate",
  "Set on",
  "Client rate ID",
] as const;

export function clientRateValues(row: ClientRateExportRow, lookups: Lookups): CsvValue[] {
  return [
    clientName(lookups, row.client_id),
    (row.day_type_id && lookups.dayTypeLabelById.get(row.day_type_id)) || "Unknown day type",
    centsToDollarsString(row.rate_cents),
    isoDate(row.created_at),
    row.id,
  ];
}

/**
 * pilot.client_tax_forms (20260807080000_client_tax_forms.sql) has no
 * Tables[...] entry — declared locally, same reason as AircraftExportRow.
 */
export type ClientTaxFormExportRow = {
  id: string;
  client_id: string;
  tax_year: number;
  form_type: string;
  reported_amount_cents: number;
  received_on: string | null;
  document_id: string | null;
  notes: string | null;
  created_at: string;
};

export const CLIENT_TAX_FORM_HEADER = [
  "Client",
  "Tax year",
  "Form type",
  "Reported amount",
  "Received on",
  "Notes",
  "Document ID",
  "Client ID",
  "Tax form ID",
] as const;

export function clientTaxFormValues(
  row: ClientTaxFormExportRow,
  lookups: Lookups
): CsvValue[] {
  return [
    clientName(lookups, row.client_id),
    row.tax_year,
    row.form_type,
    centsToDollarsString(row.reported_amount_cents),
    row.received_on,
    row.notes,
    row.document_id,
    row.client_id,
    row.id,
  ];
}

export type GuaranteePeriodExportRow = Pick<
  Tables["guarantee_periods"]["Row"],
  "id" | "client_id" | "period_month" | "guaranteed_days" | "settled_invoice_id" | "created_at"
>;

export const GUARANTEE_PERIOD_HEADER = [
  "Client",
  "Period month",
  "Guaranteed days",
  "Settled invoice",
  "Settled invoice ID",
  "Guarantee period ID",
] as const;

export function guaranteePeriodValues(
  row: GuaranteePeriodExportRow,
  lookups: Lookups
): CsvValue[] {
  const settledInvoice = row.settled_invoice_id
    ? lookups.invoiceById.get(row.settled_invoice_id)
    : undefined;
  return [
    clientName(lookups, row.client_id),
    row.period_month,
    row.guaranteed_days,
    row.settled_invoice_id
      ? settledInvoice?.invoice_number ?? "Unknown invoice"
      : "",
    row.settled_invoice_id,
    row.id,
  ];
}

export type BankAccountExportRow = Pick<
  Tables["bank_accounts"]["Row"],
  "id" | "label" | "last4" | "kind" | "archived_at" | "created_at"
>;

export const BANK_ACCOUNT_HEADER = [
  "Label",
  "Last 4",
  "Kind",
  "Archived on",
  "Bank account ID",
] as const;

export function bankAccountValues(row: BankAccountExportRow): CsvValue[] {
  return [
    row.label,
    row.last4,
    BANK_ACCOUNT_KIND_LABEL[row.kind] ?? row.kind,
    isoDate(row.archived_at),
    row.id,
  ];
}

/**
 * source_row (the raw imported CSV/OFX line), import_batch_id, source_file_id,
 * source_row_number and fingerprint are deliberately NOT columns here: they
 * are import-machinery bookkeeping, not the pilot's own record. Everything
 * a pilot categorized or annotated is.
 */
export type BankTransactionExportRow = Pick<
  Tables["bank_transactions"]["Row"],
  | "id"
  | "bank_account_id"
  | "posted_on"
  | "description"
  | "amount_cents"
  | "review_state"
  | "suggested_category"
  | "category"
  | "treatment"
  | "trip_id"
  | "expense_id"
  | "notes"
>;

export const BANK_TRANSACTION_HEADER = [
  "Date",
  "Bank account",
  "Description",
  "Amount",
  "Review state",
  "Suggested category",
  "Category",
  "Treatment",
  "Client",
  "Tail number",
  "Notes",
  "Trip ID",
  "Expense ID",
  "Bank transaction ID",
] as const;

export function bankTransactionValues(
  row: BankTransactionExportRow,
  lookups: Lookups
): CsvValue[] {
  const trip = row.trip_id ? lookups.tripById.get(row.trip_id) : undefined;
  return [
    row.posted_on,
    row.bank_account_id
      ? lookups.bankAccountLabelById.get(row.bank_account_id) ?? "Unknown bank account"
      : "",
    row.description,
    centsToDollarsString(row.amount_cents),
    BANK_REVIEW_STATE_LABEL[row.review_state] ?? row.review_state,
    row.suggested_category ? CATEGORY_LABEL[row.suggested_category] ?? row.suggested_category : "",
    row.category ? CATEGORY_LABEL[row.category] ?? row.category : "",
    row.treatment ? TREATMENT_LABEL[row.treatment] ?? row.treatment : "",
    clientName(lookups, trip?.client_id),
    trip?.aircraft_ident,
    row.notes,
    row.trip_id,
    row.expense_id,
    row.id,
  ];
}

export type AccountsChartExportRow = Pick<
  Views["accounts_chart"]["Row"],
  "id" | "name" | "kind" | "system_key" | "archived_at" | "created_at"
>;

export const ACCOUNTS_CHART_HEADER = [
  "Account name",
  "Kind",
  "System account",
  "Archived on",
  "Chart account ID",
] as const;

export function accountsChartValues(row: AccountsChartExportRow): CsvValue[] {
  return [
    row.name,
    CHART_ACCOUNT_KIND_LABEL[row.kind] ?? row.kind,
    yesNo(Boolean(row.system_key)),
    isoDate(row.archived_at),
    row.id,
  ];
}

export type JournalEntryExportRow = Pick<
  Views["journal_entries"]["Row"],
  "id" | "entry_date" | "memo" | "source_type" | "source_id" | "created_at"
>;

export const JOURNAL_ENTRY_HEADER = [
  "Date",
  "Memo",
  "Source",
  "Source ID",
  "Journal entry ID",
] as const;

export function journalEntryValues(row: JournalEntryExportRow): CsvValue[] {
  return [
    row.entry_date,
    row.memo,
    JOURNAL_SOURCE_TYPE_LABEL[row.source_type] ?? row.source_type,
    row.source_id,
    row.id,
  ];
}

export type JournalLineExportRow = Pick<
  Views["journal_lines"]["Row"],
  "id" | "entry_id" | "chart_account_id" | "side" | "amount_cents" | "line_no"
>;

export const JOURNAL_LINE_HEADER = [
  "Journal entry ID",
  "Line #",
  "Account",
  "Side",
  "Amount",
  "Journal line ID",
] as const;

export function journalLineValues(row: JournalLineExportRow, lookups: Lookups): CsvValue[] {
  return [
    row.entry_id,
    row.line_no,
    row.chart_account_id
      ? lookups.chartAccountNameById.get(row.chart_account_id) ?? "Unknown account"
      : "",
    JOURNAL_SIDE_LABEL[row.side] ?? row.side,
    centsToDollarsString(row.amount_cents),
    row.id,
  ];
}

export type InvoiceLateFeeExportRow = Pick<
  Tables["invoice_late_fees"]["Row"],
  | "id"
  | "source_invoice_id"
  | "fee_invoice_id"
  | "period_start"
  | "amount_cents"
  | "basis"
  | "basis_bps"
  | "months_accrued"
  | "created_at"
>;

export const INVOICE_LATE_FEE_HEADER = [
  "Period",
  "Late invoice",
  "Fee invoice",
  "Amount",
  "Basis",
  "Basis (%/month)",
  "Months accrued",
  "Charged on",
  "Late invoice ID",
  "Fee invoice ID",
  "Late fee ID",
] as const;

export function invoiceLateFeeValues(
  row: InvoiceLateFeeExportRow,
  lookups: Lookups
): CsvValue[] {
  return [
    row.period_start,
    lookups.invoiceById.get(row.source_invoice_id)?.invoice_number ?? "Unknown invoice",
    lookups.invoiceById.get(row.fee_invoice_id)?.invoice_number ?? "Unknown invoice",
    centsToDollarsString(row.amount_cents),
    LATE_FEE_BASIS_LABEL[row.basis] ?? row.basis,
    row.basis_bps === null || row.basis_bps === undefined ? "" : bpsToPercentString(row.basis_bps),
    row.months_accrued,
    isoDate(row.created_at),
    row.source_invoice_id,
    row.fee_invoice_id,
    row.id,
  ];
}

export type RecurringInvoiceScheduleExportRow = Pick<
  Tables["recurring_invoice_schedules"]["Row"],
  | "id"
  | "client_id"
  | "cadence"
  | "anchor_date"
  | "end_date"
  | "description"
  | "amount_cents"
  | "tax_rate_bps"
  | "active"
  | "created_at"
>;

export const RECURRING_INVOICE_SCHEDULE_HEADER = [
  "Client",
  "Description",
  "Cadence",
  "Anchor date",
  "End date",
  "Amount",
  "Tax rate (%)",
  "Active",
  "Schedule ID",
] as const;

export function recurringInvoiceScheduleValues(
  row: RecurringInvoiceScheduleExportRow,
  lookups: Lookups
): CsvValue[] {
  return [
    clientName(lookups, row.client_id),
    row.description,
    RECURRING_CADENCE_LABEL[row.cadence] ?? row.cadence,
    row.anchor_date,
    row.end_date,
    centsToDollarsString(row.amount_cents),
    bpsToPercentString(row.tax_rate_bps),
    yesNo(row.active),
    row.id,
  ];
}

export type DayTypeExportRow = Pick<
  Tables["day_types"]["Row"],
  | "id"
  | "key"
  | "label"
  | "billable"
  | "counts_for_per_diem"
  | "default_rate_cents"
  | "default_units"
  | "invoice_line_type"
  | "sort_order"
  | "is_builtin"
  | "archived_at"
  | "created_at"
>;

export const DAY_TYPE_HEADER = [
  "Label",
  "Key",
  "Billable",
  "Counts for per diem",
  "Default rate",
  "Default rate fraction",
  "Invoice line type",
  "Sort order",
  "Built-in",
  "Archived on",
  "Day type ID",
] as const;

export function dayTypeValues(row: DayTypeExportRow): CsvValue[] {
  return [
    row.label,
    row.key,
    yesNo(row.billable),
    yesNo(row.counts_for_per_diem),
    centsToDollarsString(row.default_rate_cents),
    row.default_units,
    LINE_TYPE_LABEL[row.invoice_line_type] ?? row.invoice_line_type,
    row.sort_order,
    yesNo(row.is_builtin),
    isoDate(row.archived_at),
    row.id,
  ];
}

export type MileageRateExportRow = Pick<
  Tables["mileage_rates"]["Row"],
  "id" | "tax_year" | "rate_cents_per_mile" | "notes" | "created_at"
>;

export const MILEAGE_RATE_HEADER = [
  "Tax year",
  "Rate (cents/mile)",
  "Notes",
  "Mileage rate ID",
] as const;

export function mileageRateValues(row: MileageRateExportRow): CsvValue[] {
  return [row.tax_year, row.rate_cents_per_mile, row.notes, row.id];
}

// ---------------------------------------------------------------------------
// The registry the route and the page both read
// ---------------------------------------------------------------------------

export type ExportTable =
  | "clients"
  | "trips"
  | "trip_days"
  | "trip_legs"
  | "invoices"
  | "invoice_lines"
  | "invoice_payments"
  | "estimates"
  | "estimate_lines"
  | "expenses"
  | "mileage_entries"
  | "documents"
  | "operator_qualifications"
  | "aircraft"
  | "client_rates"
  | "client_tax_forms"
  | "guarantee_periods"
  | "bank_accounts"
  | "bank_transactions"
  | "accounts_chart"
  | "journal_entries"
  | "journal_lines"
  | "invoice_late_fees"
  | "recurring_invoice_schedules"
  | "day_types"
  | "mileage_rates";

/** Which cross-reference maps the route must fill before streaming. */
export type LookupNeeds = {
  clients?: true;
  trips?: true;
  invoices?: true;
  dayTypes?: true;
  invoiceTotals?: true;
  estimates?: true;
  estimateTotals?: true;
  bankAccounts?: true;
  chartAccounts?: true;
};

export type EntitySpec = {
  /** URL segment under /settings/export/ and the filename's first part. */
  key: string;
  table: ExportTable;
  /** Flat column list — no embeds (see Lookups above). */
  select: string;
  /**
   * A TOTAL order (unique `id` last) — .range() pagination is only
   * coherent when every page request agrees on one ordering, and a
   * non-total order lets the server break ties differently per page,
   * silently dropping or doubling boundary rows.
   */
  orderBy: readonly { column: string; ascending: boolean }[];
  header: readonly string[];
  needs: LookupNeeds;
  mapRow: (row: Record<string, unknown>, lookups: Lookups) => CsvValue[];
};

export const EXPORT_ENTITIES: Record<string, EntitySpec> = {
  clients: {
    key: "clients",
    table: "clients",
    select:
      "id, name, contact_name, contact_email, contact_phone, address_line1, address_line2, city, state, postal_code, country, operating_rule, default_day_rate_cents, default_travel_day_rate_cents, default_per_diem_cents, per_diem_mode, payment_terms_days, default_expense_treatment, minimum_days, minimum_basis, cancellation_policy_note, w9_status, w9_sent_at, w9_received_at, notes, archived_at",
    orderBy: [
      { column: "name", ascending: true },
      { column: "id", ascending: true },
    ],
    header: CLIENT_HEADER,
    needs: {},
    mapRow: (row) => clientValues(row as unknown as ClientExportRow),
  },
  trips: {
    key: "trips",
    table: "trips",
    select:
      "id, client_id, trip_kind, status, starts_on, ends_on, aircraft_ident, aircraft_type, operating_rule, day_rate_cents, day_count, travel_day_rate_cents, travel_day_count, billing_state, canceled_at, cancellation_notice_from, notes",
    orderBy: [
      { column: "starts_on", ascending: true },
      { column: "id", ascending: true },
    ],
    header: TRIP_HEADER,
    needs: { clients: true },
    mapRow: (row, lookups) => tripValues(row as unknown as TripExportRow, lookups),
  },
  "trip-days": {
    key: "trip-days",
    table: "trip_days",
    select: "id, trip_id, day_on, day_type_id, rate_cents, quantity, units, away, notes",
    orderBy: [
      { column: "day_on", ascending: true },
      { column: "id", ascending: true },
    ],
    header: TRIP_DAY_HEADER,
    needs: { clients: true, trips: true, dayTypes: true },
    mapRow: (row, lookups) => tripDayValues(row as unknown as TripDayExportRow, lookups),
  },
  "trip-legs": {
    key: "trip-legs",
    table: "trip_legs",
    select:
      "id, trip_id, leg_date, from_icao, to_icao, out_at, in_at, block_hours, night_hours, instrument_hours, instrument_actual_hours, instrument_simulated_hours, cross_country_hours, day_takeoffs, day_landings, day_landings_full_stop, night_takeoffs, night_landings_full_stop, night_landings_touch_go, approaches, holds",
    orderBy: [
      { column: "leg_date", ascending: true },
      { column: "id", ascending: true },
    ],
    header: TRIP_LEG_HEADER,
    needs: { trips: true },
    mapRow: (row, lookups) => tripLegValues(row as unknown as TripLegExportRow, lookups),
  },
  invoices: {
    key: "invoices",
    table: "invoices",
    select:
      "id, client_id, bill_to_name, bill_to_contact_name, bill_to_email, bill_to_address_line1, bill_to_address_line2, bill_to_city, bill_to_state, bill_to_postal_code, bill_to_country, invoice_number, status, issued_on, due_on, sent_at, tax_rate_bps, delivery_method, notes, created_at",
    orderBy: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    header: INVOICE_HEADER,
    needs: { clients: true, invoiceTotals: true },
    mapRow: (row, lookups) => invoiceValues(row as unknown as InvoiceExportRow, lookups),
  },
  "invoice-lines": {
    key: "invoice-lines",
    table: "invoice_lines",
    select:
      "id, invoice_id, line_type, description, quantity, unit_amount_cents, amount_cents, taxable, trip_id, expense_id, sort_order",
    orderBy: [
      { column: "invoice_id", ascending: true },
      { column: "sort_order", ascending: true },
      { column: "id", ascending: true },
    ],
    header: INVOICE_LINE_HEADER,
    needs: { clients: true, invoices: true },
    mapRow: (row, lookups) =>
      invoiceLineValues(row as unknown as InvoiceLineExportRow, lookups),
  },
  "invoice-payments": {
    key: "invoice-payments",
    table: "invoice_payments",
    select:
      "id, invoice_id, paid_on, amount_cents, method, notes, reverses_payment_id, reversal_reason",
    orderBy: [
      { column: "paid_on", ascending: true },
      { column: "id", ascending: true },
    ],
    header: INVOICE_PAYMENT_HEADER,
    needs: { clients: true, invoices: true },
    mapRow: (row, lookups) =>
      invoicePaymentValues(row as unknown as InvoicePaymentExportRow, lookups),
  },
  estimates: {
    key: "estimates",
    table: "estimates",
    select:
      "id, client_id, trip_id, estimate_number, status, issued_on, valid_until, sent_at, tax_rate_bps, terms, notes, converted_invoice_id, converted_at, created_at",
    orderBy: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    header: ESTIMATE_HEADER,
    // invoices: to print the number of the invoice a quote converted to.
    needs: { clients: true, invoices: true, estimateTotals: true },
    mapRow: (row, lookups) =>
      estimateValues(row as unknown as EstimateExportRow, lookups),
  },
  "estimate-lines": {
    key: "estimate-lines",
    table: "estimate_lines",
    select:
      "id, estimate_id, line_type, description, quantity, unit_amount_cents, amount_cents, taxable, sort_order",
    orderBy: [
      { column: "estimate_id", ascending: true },
      { column: "sort_order", ascending: true },
      { column: "id", ascending: true },
    ],
    header: ESTIMATE_LINE_HEADER,
    needs: { clients: true, estimates: true },
    mapRow: (row, lookups) =>
      estimateLineValues(row as unknown as EstimateLineExportRow, lookups),
  },
  expenses: {
    key: "expenses",
    table: "expenses",
    select:
      "id, trip_id, incurred_on, category, vendor, amount_cents, treatment, receipt_path, notes",
    orderBy: [
      { column: "incurred_on", ascending: true },
      { column: "id", ascending: true },
    ],
    header: EXPENSE_HEADER,
    needs: { clients: true, trips: true },
    mapRow: (row, lookups) => expenseValues(row as unknown as ExpenseExportRow, lookups),
  },
  mileage: {
    key: "mileage",
    table: "mileage_entries",
    select:
      "id, drove_on, miles, from_place, to_place, purpose, client_id, trip_id, rate_cents_per_mile, amount_cents, notes",
    orderBy: [
      { column: "drove_on", ascending: true },
      { column: "id", ascending: true },
    ],
    header: MILEAGE_HEADER,
    needs: { clients: true },
    mapRow: (row, lookups) => mileageValues(row as unknown as MileageExportRow, lookups),
  },
  documents: {
    key: "documents",
    table: "documents",
    select:
      "id, kind, label, issued_on, expires_on, client_id, file_path, notes, created_at",
    orderBy: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    header: DOCUMENT_HEADER,
    needs: { clients: true },
    mapRow: (row, lookups) => documentValues(row as unknown as DocumentExportRow, lookups),
  },
  "operator-qualifications": {
    key: "operator-qualifications",
    table: "operator_qualifications",
    select:
      "id, client_id, requirement, completed_on, status, expires_on, type_designator, notes, document_id, created_at",
    orderBy: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    header: OPERATOR_QUALIFICATION_HEADER,
    needs: { clients: true },
    mapRow: (row, lookups) =>
      operatorQualificationValues(row as unknown as OperatorQualificationExportRow, lookups),
  },
  aircraft: {
    key: "aircraft",
    table: "aircraft",
    select:
      "id, tail_number, type_designator, type_rating, make_model, category_class, gear, notes, archived_at, created_at",
    orderBy: [
      { column: "tail_number", ascending: true },
      { column: "id", ascending: true },
    ],
    header: AIRCRAFT_HEADER,
    needs: {},
    mapRow: (row) => aircraftValues(row as unknown as AircraftExportRow),
  },
  "client-rates": {
    key: "client-rates",
    table: "client_rates",
    select: "id, client_id, day_type_id, rate_cents, created_at",
    orderBy: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    header: CLIENT_RATE_HEADER,
    needs: { clients: true, dayTypes: true },
    mapRow: (row, lookups) => clientRateValues(row as unknown as ClientRateExportRow, lookups),
  },
  "client-tax-forms": {
    key: "client-tax-forms",
    table: "client_tax_forms",
    select:
      "id, client_id, tax_year, form_type, reported_amount_cents, received_on, document_id, notes, created_at",
    orderBy: [
      { column: "tax_year", ascending: true },
      { column: "id", ascending: true },
    ],
    header: CLIENT_TAX_FORM_HEADER,
    needs: { clients: true },
    mapRow: (row, lookups) =>
      clientTaxFormValues(row as unknown as ClientTaxFormExportRow, lookups),
  },
  "guarantee-periods": {
    key: "guarantee-periods",
    table: "guarantee_periods",
    select: "id, client_id, period_month, guaranteed_days, settled_invoice_id, created_at",
    orderBy: [
      { column: "period_month", ascending: true },
      { column: "id", ascending: true },
    ],
    header: GUARANTEE_PERIOD_HEADER,
    needs: { clients: true, invoices: true },
    mapRow: (row, lookups) =>
      guaranteePeriodValues(row as unknown as GuaranteePeriodExportRow, lookups),
  },
  "bank-accounts": {
    key: "bank-accounts",
    table: "bank_accounts",
    select: "id, label, last4, kind, archived_at, created_at",
    orderBy: [
      { column: "label", ascending: true },
      { column: "id", ascending: true },
    ],
    header: BANK_ACCOUNT_HEADER,
    needs: {},
    mapRow: (row) => bankAccountValues(row as unknown as BankAccountExportRow),
  },
  "bank-transactions": {
    key: "bank-transactions",
    table: "bank_transactions",
    select:
      "id, bank_account_id, posted_on, description, amount_cents, review_state, suggested_category, category, treatment, trip_id, expense_id, notes",
    orderBy: [
      { column: "posted_on", ascending: true },
      { column: "id", ascending: true },
    ],
    header: BANK_TRANSACTION_HEADER,
    needs: { clients: true, trips: true, bankAccounts: true },
    mapRow: (row, lookups) =>
      bankTransactionValues(row as unknown as BankTransactionExportRow, lookups),
  },
  "accounts-chart": {
    key: "accounts-chart",
    table: "accounts_chart",
    select: "id, name, kind, system_key, archived_at, created_at",
    orderBy: [
      { column: "name", ascending: true },
      { column: "id", ascending: true },
    ],
    header: ACCOUNTS_CHART_HEADER,
    needs: {},
    mapRow: (row) => accountsChartValues(row as unknown as AccountsChartExportRow),
  },
  "journal-entries": {
    key: "journal-entries",
    table: "journal_entries",
    select: "id, entry_date, memo, source_type, source_id, created_at",
    orderBy: [
      { column: "entry_date", ascending: true },
      { column: "id", ascending: true },
    ],
    header: JOURNAL_ENTRY_HEADER,
    needs: {},
    mapRow: (row) => journalEntryValues(row as unknown as JournalEntryExportRow),
  },
  "journal-lines": {
    key: "journal-lines",
    table: "journal_lines",
    select: "id, entry_id, chart_account_id, side, amount_cents, line_no",
    orderBy: [
      { column: "entry_id", ascending: true },
      { column: "line_no", ascending: true },
      { column: "id", ascending: true },
    ],
    header: JOURNAL_LINE_HEADER,
    needs: { chartAccounts: true },
    mapRow: (row, lookups) => journalLineValues(row as unknown as JournalLineExportRow, lookups),
  },
  "invoice-late-fees": {
    key: "invoice-late-fees",
    table: "invoice_late_fees",
    select:
      "id, source_invoice_id, fee_invoice_id, period_start, amount_cents, basis, basis_bps, months_accrued, created_at",
    orderBy: [
      { column: "period_start", ascending: true },
      { column: "id", ascending: true },
    ],
    header: INVOICE_LATE_FEE_HEADER,
    needs: { invoices: true },
    mapRow: (row, lookups) =>
      invoiceLateFeeValues(row as unknown as InvoiceLateFeeExportRow, lookups),
  },
  "recurring-invoice-schedules": {
    key: "recurring-invoice-schedules",
    table: "recurring_invoice_schedules",
    select:
      "id, client_id, cadence, anchor_date, end_date, description, amount_cents, tax_rate_bps, active, created_at",
    orderBy: [
      { column: "anchor_date", ascending: true },
      { column: "id", ascending: true },
    ],
    header: RECURRING_INVOICE_SCHEDULE_HEADER,
    needs: { clients: true },
    mapRow: (row, lookups) =>
      recurringInvoiceScheduleValues(row as unknown as RecurringInvoiceScheduleExportRow, lookups),
  },
  "day-types": {
    key: "day-types",
    table: "day_types",
    select:
      "id, key, label, billable, counts_for_per_diem, default_rate_cents, default_units, invoice_line_type, sort_order, is_builtin, archived_at, created_at",
    orderBy: [
      { column: "sort_order", ascending: true },
      { column: "id", ascending: true },
    ],
    header: DAY_TYPE_HEADER,
    needs: {},
    mapRow: (row) => dayTypeValues(row as unknown as DayTypeExportRow),
  },
  "mileage-rates": {
    key: "mileage-rates",
    table: "mileage_rates",
    select: "id, tax_year, rate_cents_per_mile, notes, created_at",
    orderBy: [
      { column: "tax_year", ascending: true },
      { column: "id", ascending: true },
    ],
    header: MILEAGE_RATE_HEADER,
    needs: {},
    mapRow: (row) => mileageRateValues(row as unknown as MileageRateExportRow),
  },
};

/**
 * Header/mapper agreement, checked at module load with a row of nothing —
 * the logbook export's own guard, applied to all twelve files at once. A
 * mismatch is a startup error; it can only fire if this file is already
 * wrong.
 */
for (const [key, spec] of Object.entries(EXPORT_ENTITIES)) {
  const probeLength = spec.mapRow({}, emptyLookups()).length;
  if (probeLength !== spec.header.length) {
    throw new Error(
      `account export "${key}" is broken: its header has ${spec.header.length} columns ` +
        `but each row emits ${probeLength}. A CSV with mismatched header and row ` +
        "lengths shifts every later column instead of failing."
    );
  }
  if (spec.key !== key) {
    throw new Error(
      `account export "${key}" is broken: its spec says key "${spec.key}" — the URL ` +
        "segment, the registry key and the filename must be the same word."
    );
  }
}
