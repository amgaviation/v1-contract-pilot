/**
 * Per-trip money completeness: expected vs invoiced vs paid, for the
 * settlement panel on app/(app)/trips/[id].
 *
 * ONE PRICING DEFINITION. "Expected" is computed by handing this trip's day
 * grid straight to lib/trip-value.ts's tripValueCents — the exact function
 * every other screen uses to price an unbilled trip — never a second
 * arithmetic path. See that file's own header for why forking it is the
 * defect this whole product keeps re-discovering.
 *
 * SCOPE: DAY MONEY ONLY (flight_day + travel_day), matching exactly what
 * tripValueCents prices. createInvoiceDraft also writes per_diem,
 * cancellation_fee, contract-minimum ("other") and reimbursable_expense
 * lines against a trip, and pilot.trip_pl folds most of those into its own
 * "invoiced day money" figure (see that migration's header) — but doing the
 * same here would compare Expected (day money only) against Invoiced (day
 * money plus other charges), and the delta would not mean "unbilled day
 * money" anymore. Restricting both sides to flight_day/travel_day keeps the
 * comparison apples-to-apples, at the cost of the panel saying nothing
 * about per diem, fees, or rebills — which is why the panel's own copy
 * discloses that scope rather than implying completeness.
 *
 * WHY "PAID" DOES NOT ALLOCATE ACROSS LINES. pilot.invoice_payments is
 * invoice-level, not line-level — the same fact
 * app/(app)/reports/trip-pl/report-lib.ts's "THE BASIS DECISION" documents
 * at length: there is no column recording which line of an invoice a
 * payment satisfied. Inventing a per-trip slice of a payment (pro-rata by
 * line amount, oldest-line-first, or anything else) would be presenting an
 * invented allocation as fact. So `paidCents` here is exactly what the
 * function name says: the sum of payments recorded against the invoice(s)
 * that carry this trip's day-money lines — a real, unallocated figure. When
 * that invoice bills only this trip's day money (the common case — the
 * double-bill guard in trip_committed_invoice prevents a second live
 * invoice from ever billing the same trip's days while the first is still
 * live), paidCents and the derived unpaidBalanceCents describe this trip
 * exactly. When the invoice also carries other charges, they still describe
 * real money, just money that is not exclusively this trip's — the panel's
 * copy says so rather than silently narrowing the claim.
 *
 * CLAMPED AT ZERO, DELIBERATELY, unlike report-lib.ts's signed
 * rebillGapCents. That gap is signed because both of its inputs
 * (rebilled cost, rebill invoiced) are exact, trip-attributed facts, so a
 * negative gap is real information ("billed back more than it cost").
 * Here `paidCents` can exceed `invoicedCents` purely as an artifact of the
 * invoice-level (not line-level) payment figure — e.g. a payment covering
 * this trip's day money plus a per-diem line the panel does not count. A
 * negative "unpaid balance" in that case would not mean the trip was
 * overpaid; it would mean the question doesn't decompose that finely. Zero
 * is the honest floor: this trip's day money is not carrying an unpaid
 * balance, full stop, rather than a fabricated credit.
 */

import {
  tripValueCents,
  type TripDayValueRow,
  type TripValueScalar,
} from "./trip-value";

/** The only two line types tripValueCents prices — see the file header. */
const DAY_MONEY_LINE_TYPES = new Set(["flight_day", "travel_day"]);

export type TripSettlementLineRow = {
  invoice_id: string;
  line_type: string;
  amount_cents: number;
};

export type TripSettlementInvoiceRow = {
  id: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  invoice_number: string | null;
};

export type TripSettlementPaymentRow = {
  invoice_id: string;
  amount_cents: number;
};

/** One carrying invoice, id included so a screen naming it can link to it. */
export type TripSettlementBilledInvoice = {
  id: string;
  invoice_number: string | null;
};

export type TripSettlement = {
  /** What the day grid (or the pre-grid scalars) says this trip's flight +
   *  travel days are worth, today — lib/trip-value.ts's own figure. */
  expectedCents: number;
  /** Live (non-void) flight_day/travel_day line money attributed to this
   *  trip. Zero means nothing has been drafted against this trip's days
   *  yet. */
  invoicedCents: number;
  /** The subset of invoicedCents sitting on a draft (unsent) invoice —
   *  same "of which draft" convention as trip_pl's draftDayMoneyCents. */
  draftInvoicedCents: number;
  hasDraftMoney: boolean;
  /** Day money not yet on any live invoice. Never negative — see header. */
  unbilledRemainderCents: number;
  /** Sum of payments recorded against the invoice(s) below. Invoice-level,
   *  not a per-line allocation — see header. */
  paidCents: number;
  /** invoicedCents minus paidCents, floored at zero — see header. */
  unpaidBalanceCents: number;
  /** The live invoice(s) carrying this trip's day money. At most one in
   *  practice (the double-bill guard), kept as a list for honesty about
   *  what the query can actually return. */
  invoiceIds: string[];
  /** true when any invoice in invoiceIds bills line items belonging to
   *  someone or something other than this trip's own day money — i.e. the
   *  paid/balance figures above are invoice-level facts that are not
   *  exclusively this trip's. */
  invoiceHasOtherCharges: boolean;
  /** The same invoices as invoiceIds, carrying their numbers and ordered
   *  sent-first (a numbered invoice before a still-unnumbered draft), so a
   *  screen that names the invoice this trip is billed on can also link to
   *  it rather than sending the pilot to hunt the number down. */
  billedInvoices: TripSettlementBilledInvoice[];
  /** A label for the invoice this trip is billed on — the head of
   *  billedInvoices, i.e. the sent invoice's number when one exists, else
   *  "a draft invoice" — mirroring pilot.trip_committed_invoice's own
   *  preference order. Null when nothing has been invoiced. */
  invoiceLabel: string | null;
};

export function computeTripSettlement(input: {
  trip: TripValueScalar;
  dayRows: TripDayValueRow[] | undefined;
  billableByDayType: Map<string, boolean>;
  /** Every invoice_lines row with trip_id = this trip, any line_type —
   *  used both to price the day-money figures and to detect other
   *  charges on the same invoice (per_diem, cancellation_fee, "other",
   *  and rebill lines resolved via expense_id are NOT included here by
   *  the caller's query, so invoiceHasOtherCharges is a lower bound —
   *  see the panel component's own note on this). */
  lines: TripSettlementLineRow[];
  invoices: TripSettlementInvoiceRow[];
  payments: TripSettlementPaymentRow[];
}): TripSettlement {
  const expectedCents = tripValueCents(
    input.trip,
    input.dayRows,
    input.billableByDayType
  );

  const invoicesById = new Map(input.invoices.map((inv) => [inv.id, inv]));

  let invoicedCents = 0;
  let draftInvoicedCents = 0;
  let otherChargeCents = 0;
  const invoiceIdSet = new Set<string>();

  for (const line of input.lines) {
    const invoice = invoicesById.get(line.invoice_id);
    if (!invoice || invoice.status === "void") continue; // not live money

    if (DAY_MONEY_LINE_TYPES.has(line.line_type)) {
      invoicedCents += line.amount_cents;
      invoiceIdSet.add(invoice.id);
      if (invoice.status === "draft") draftInvoicedCents += line.amount_cents;
    } else {
      // per_diem, cancellation_fee, "other" — real money on this trip's
      // invoice, just not day money. Tracked only to flag the caveat
      // below, never added into invoicedCents (see file header).
      otherChargeCents += line.amount_cents;
      invoiceIdSet.add(invoice.id);
    }
  }

  const unbilledRemainderCents = Math.max(expectedCents - invoicedCents, 0);

  let paidCents = 0;
  for (const payment of input.payments) {
    if (invoiceIdSet.has(payment.invoice_id)) paidCents += payment.amount_cents;
  }
  const unpaidBalanceCents = Math.max(invoicedCents - paidCents, 0);

  const invoiceIds = [...invoiceIdSet];
  // Prefer a sent invoice's number, same order trip_committed_invoice
  // orders by (`order by (i.invoice_number is null)`). Sorted once, so the
  // label below and any link a screen builds from this list name the same
  // invoice rather than two independently-picked ones.
  const billedInvoices: TripSettlementBilledInvoice[] = invoiceIds
    .map((id) => invoicesById.get(id))
    .filter((inv): inv is TripSettlementInvoiceRow => inv !== undefined)
    .sort(
      (a, b) =>
        Number(a.invoice_number === null) - Number(b.invoice_number === null)
    )
    .map((inv) => ({ id: inv.id, invoice_number: inv.invoice_number }));
  // The generic draft label when every carrying invoice is still a draft.
  const [primaryInvoice] = billedInvoices;
  const invoiceLabel = primaryInvoice
    ? primaryInvoice.invoice_number ?? "a draft invoice"
    : null;

  return {
    expectedCents,
    invoicedCents,
    draftInvoicedCents,
    hasDraftMoney: draftInvoicedCents !== 0,
    unbilledRemainderCents,
    paidCents,
    unpaidBalanceCents,
    invoiceIds,
    invoiceHasOtherCharges: otherChargeCents !== 0,
    billedInvoices,
    invoiceLabel,
  };
}
