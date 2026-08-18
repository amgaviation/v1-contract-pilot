import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LTable, LTd, LTh } from "@/components/ledger";

import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import {
  ESTIMATE_STATUS_BADGE,
  ESTIMATE_STATUS_FALLBACK,
  type EstimateBadge,
} from "../../estimates/estimate-lib";
import type {
  ClientHistory,
  HistoryEstimateRow,
  HistoryInvoiceRow,
  HistoryPaymentRow,
  HistoryTab,
  HistoryTripRow,
} from "./history-queries";
import HistoryTabs from "./history-tabs";

/**
 * THE HISTORY PANEL — "add a section for users to see client history and
 * logs" (the owner's own words for this plan). Everywhere else on this page
 * a list is a QUEUE: Unbilled trips and Outstanding invoices above (H8b)
 * deliberately show only what still needs action. This is the other half —
 * the complete record, every status, nothing filtered out — so a pilot who
 * needs to answer "did I ever invoice this client for that March trip" or
 * "when did they last pay me" does not have to leave this screen and
 * refilter /trips or /invoices by hand.
 *
 * Reads live in history-queries.ts (loadClientHistory, called once from
 * page.tsx) and arrive here already assembled — this file is rendering
 * only. Four tabs, one quiet "aircraft flown for this client" line above
 * them (client_id landed on pilot.aircraft in the same batch as this plan —
 * see app/(app)/aircraft/db.ts).
 */

const ROW_HEADER_CLASS =
  "border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0";

export default function HistoryPanel({
  clientId,
  history,
}: {
  clientId: string;
  history: ClientHistory;
}) {
  return (
    <LCard>
      <div className="mb-1 text-h3 font-semibold">History</div>
      <p className="mb-3 text-body-s text-ink-3">
        Every trip, invoice, payment and estimate on file for this client,
        newest first.
      </p>

      {history.aircraftTails.ok && history.aircraftTails.tails.length > 0 ? (
        <p className="mb-4 text-body-s text-ink-2">
          <span className="text-ink-3">Aircraft flown for this client: </span>
          {/* aircraft/page.tsx's own ?client= filter (added alongside the
              client_id column this line reads) — a plain /aircraft link
              would show the whole fleet instead of answering the line's
              own question. */}
          <NextLink
            href={`/aircraft?client=${clientId}`}
            className="text-accent hover:underline"
          >
            {history.aircraftTails.tails.join(", ")}
          </NextLink>
          {history.aircraftTails.truncated ? " and more" : ""}.
        </p>
      ) : !history.aircraftTails.ok ? (
        <LAlert tone="warn" className="mb-4 flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>Couldn&rsquo;t load which aircraft have flown for this client.</span>
        </LAlert>
      ) : null}

      <HistoryTabs
        trips={<TripsTable trips={history.trips} valuesFailed={history.tripValuesFailed} />}
        invoices={<InvoicesTable invoices={history.invoices} />}
        payments={<PaymentsTable payments={history.payments} />}
        estimates={<EstimatesTable estimates={history.estimates} />}
      />
    </LCard>
  );
}

/* ── Trips ─────────────────────────────────────────────────────────────
 * Identity column, status and value match /trips exactly — dates ARE the
 * identity column there (trip.starts_on/ends_on through formatDateRange,
 * linked), not a separate "trip name" field, since trips carry none. */

// Duplicated from app/(app)/trips/page.tsx's own STATUS_BADGE/STATUS_FALLBACK
// rather than imported — that file is another agent's surface this session,
// same posture app/(app)/estimates/page.tsx already documents for its own
// duplicate of this exact dictionary shape. Keep in lockstep if trips ever
// grows a new status.
type TripBadge = { tone: "neutral" | "accent" | "good" | "warn" | "crit"; label: string };
const TRIP_STATUS_FALLBACK: TripBadge = { tone: "neutral", label: "Scheduled" };
const TRIP_STATUS_BADGE: Record<string, TripBadge> = {
  scheduled: TRIP_STATUS_FALLBACK,
  in_progress: { tone: "accent", label: "In progress" },
  completed: { tone: "good", label: "Completed" },
  canceled: { tone: "neutral", label: "Canceled" },
  hold: { tone: "warn", label: "Hold" },
};

function TripsTable({
  trips,
  valuesFailed,
}: {
  trips: HistoryTab<HistoryTripRow>;
  valuesFailed: boolean;
}) {
  if (!trips.ok) {
    return (
      <LAlert tone="crit" className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 shrink-0 text-crit" />
        <span>Couldn&rsquo;t load this client&rsquo;s trips. Try reloading the page.</span>
      </LAlert>
    );
  }
  if (trips.rows.length === 0) {
    return (
      <LEmpty title="No trips for this client yet">
        Trips logged for this client will appear here.
      </LEmpty>
    );
  }
  return (
    <div>
      {valuesFailed ? (
        <LAlert tone="warn" className="mb-3 flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            Couldn&rsquo;t load trip values, so the Value column is hidden
            rather than show a wrong number.
          </span>
        </LAlert>
      ) : null}
      <LTable>
        <caption>
          <span className="sr-only">Trips</span>
        </caption>
        <thead>
          <tr>
            <LTh>Dates</LTh>
            <LTh>Status</LTh>
            {valuesFailed ? null : <LTh numeric>Value</LTh>}
          </tr>
        </thead>
        <tbody>
          {trips.rows.map((trip) => {
            const status = TRIP_STATUS_BADGE[trip.status] ?? TRIP_STATUS_FALLBACK;
            return (
              <tr key={trip.id}>
                <th scope="row" className={ROW_HEADER_CLASS}>
                  <NextLink href={`/trips/${trip.id}`} className="text-accent hover:underline">
                    {formatDateRange(trip.starts_on, trip.ends_on)}
                  </NextLink>
                </th>
                <LTd>
                  <LPill tone={status.tone}>{status.label}</LPill>
                </LTd>
                {valuesFailed ? null : (
                  <LTd numeric>
                    {/* formatCents(null) already prints "—" — no separate
                        branch needed here the way the money cells below
                        need one: those distinguish "$0.00" from "couldn't
                        load" with a visibly different (crit) style, while
                        a single missing trip in an otherwise-successful
                        read is rare enough to read as "not available"
                        rather than "this read failed." */}
                    <span className="font-medium">{formatCents(trip.valueCents)}</span>
                  </LTd>
                )}
              </tr>
            );
          })}
        </tbody>
      </LTable>
      {trips.truncated ? <TruncatedCaption /> : null}
    </div>
  );
}

/* ── Invoices ──────────────────────────────────────────────────────────
 * Same tone vocabulary as app/(app)/invoices/[id]/page.tsx's own
 * STATUS_BADGE (tone-direct, not the list screen's color-then-translate
 * shape) — duplicated for the same reason as the trips dictionary above;
 * that file's own header comment records this is already a 2-copy
 * dictionary before this made it three. */
type InvoiceBadge = { tone: "neutral" | "accent" | "good" | "warn" | "crit"; label: string };
const INVOICE_STATUS_FALLBACK: InvoiceBadge = { tone: "neutral", label: "Draft" };
const INVOICE_STATUS_BADGE: Record<string, InvoiceBadge> = {
  draft: INVOICE_STATUS_FALLBACK,
  sent: { tone: "accent", label: "Sent" },
  partial: { tone: "warn", label: "Partially paid" },
  paid: { tone: "good", label: "Paid" },
  void: { tone: "neutral", label: "Void" },
};

function InvoicesTable({ invoices }: { invoices: HistoryTab<HistoryInvoiceRow> }) {
  if (!invoices.ok) {
    return (
      <LAlert tone="crit" className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 shrink-0 text-crit" />
        <span>Couldn&rsquo;t load this client&rsquo;s invoices. Try reloading the page.</span>
      </LAlert>
    );
  }
  if (invoices.rows.length === 0) {
    return (
      <LEmpty title="No invoices for this client yet">
        Invoices billed to this client will appear here.
      </LEmpty>
    );
  }
  return (
    <div>
      <LTable>
        <caption>
          <span className="sr-only">Invoices</span>
        </caption>
        <thead>
          <tr>
            <LTh>Number</LTh>
            <LTh>Issued</LTh>
            <LTh>Status</LTh>
            <LTh numeric>Total</LTh>
            <LTh numeric>Balance due</LTh>
          </tr>
        </thead>
        <tbody>
          {invoices.rows.map((invoice) => {
            const badge = INVOICE_STATUS_BADGE[invoice.status] ?? INVOICE_STATUS_FALLBACK;
            return (
              <tr key={invoice.id}>
                <th scope="row" className={ROW_HEADER_CLASS}>
                  <NextLink href={`/invoices/${invoice.id}`} className="text-accent hover:underline">
                    {invoice.invoice_number ?? "Draft"}
                  </NextLink>
                </th>
                <LTd>
                  <span className="text-ink-2">{formatDate(invoice.issued_on)}</span>
                </LTd>
                <LTd>
                  <LPill tone={badge.tone}>{badge.label}</LPill>
                </LTd>
                <LTd numeric>
                  {invoice.totalCents === null ? (
                    <span className="text-caption text-crit">Couldn&rsquo;t load</span>
                  ) : (
                    <span className="font-medium">{formatCents(invoice.totalCents)}</span>
                  )}
                </LTd>
                <LTd numeric>
                  {invoice.balanceDueCents === null ? (
                    <span className="text-caption text-crit">Couldn&rsquo;t load</span>
                  ) : (
                    <span className="font-medium">{formatCents(invoice.balanceDueCents)}</span>
                  )}
                </LTd>
              </tr>
            );
          })}
        </tbody>
      </LTable>
      {invoices.truncated ? <TruncatedCaption /> : null}
    </div>
  );
}

/* ── Payments ──────────────────────────────────────────────────────────
 * Invoice is the row's own identity column (the linked th scope="row"),
 * matching every other table in this file: a payment has no page of its
 * own, the invoice it landed on does. Method labels duplicated from
 * app/(app)/invoices/[id]/payment-panel.tsx's own METHOD_LABEL — that file
 * is a "use client" form surface and not something this read-only panel
 * should import from. */
const METHOD_LABEL: Record<string, string> = {
  ach: "ACH",
  check: "Check",
  wire: "Wire",
  card: "Card",
  cash: "Cash",
  other: "Other",
};

function PaymentsTable({ payments }: { payments: HistoryTab<HistoryPaymentRow> }) {
  if (!payments.ok) {
    return (
      <LAlert tone="crit" className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 shrink-0 text-crit" />
        <span>Couldn&rsquo;t load this client&rsquo;s payments. Try reloading the page.</span>
      </LAlert>
    );
  }
  if (payments.rows.length === 0) {
    return (
      <LEmpty title="No payments recorded yet">
        Payments received on this client&rsquo;s invoices will appear here.
      </LEmpty>
    );
  }
  return (
    <div>
      <LTable>
        <caption>
          <span className="sr-only">Payments</span>
        </caption>
        <thead>
          <tr>
            <LTh>Invoice</LTh>
            <LTh>Received</LTh>
            <LTh>Method</LTh>
            <LTh numeric>Amount</LTh>
          </tr>
        </thead>
        <tbody>
          {payments.rows.map((payment) => (
            <tr key={payment.id}>
              <th scope="row" className={ROW_HEADER_CLASS}>
                <NextLink
                  href={`/invoices/${payment.invoice_id}`}
                  className="text-accent hover:underline"
                >
                  {payment.invoiceNumber ?? "Invoice"}
                </NextLink>
              </th>
              <LTd>
                <span className="text-ink-2">{formatDate(payment.paid_on)}</span>
              </LTd>
              <LTd>
                <span className="text-ink-2">
                  {payment.method ? (METHOD_LABEL[payment.method] ?? payment.method) : "—"}
                </span>
              </LTd>
              <LTd numeric>
                <span className="font-medium">{formatCents(payment.amount_cents)}</span>
              </LTd>
            </tr>
          ))}
        </tbody>
      </LTable>
      {payments.truncated ? <TruncatedCaption /> : null}
    </div>
  );
}

/* ── Estimates ─────────────────────────────────────────────────────────
 * ESTIMATE_STATUS_BADGE is exported from estimate-lib.ts and imported
 * directly (that file is a shared, read-only logic file by design — see
 * its own header). Only the tone conversion is duplicated, the same
 * estimateBadgeTone shape app/(app)/estimates/page.tsx already carries a
 * copy of under an identical comment. */
function estimateBadgeTone(
  color: EstimateBadge["color"]
): "crit" | "warn" | "good" | "neutral" | "accent" {
  switch (color) {
    case "red":
      return "crit";
    case "amber":
      return "warn";
    case "green":
      return "good";
    case "blue":
      return "accent";
    default:
      return "neutral";
  }
}

function EstimatesTable({ estimates }: { estimates: HistoryTab<HistoryEstimateRow> }) {
  if (!estimates.ok) {
    return (
      <LAlert tone="crit" className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 shrink-0 text-crit" />
        <span>Couldn&rsquo;t load this client&rsquo;s estimates. Try reloading the page.</span>
      </LAlert>
    );
  }
  if (estimates.rows.length === 0) {
    return (
      <LEmpty title="No estimates for this client yet">
        Estimates written for this client will appear here.
      </LEmpty>
    );
  }
  return (
    <div>
      <LTable>
        <caption>
          <span className="sr-only">Estimates</span>
        </caption>
        <thead>
          <tr>
            <LTh>Number</LTh>
            <LTh>Issued</LTh>
            <LTh>Status</LTh>
            <LTh numeric>Total</LTh>
          </tr>
        </thead>
        <tbody>
          {estimates.rows.map((estimate) => {
            const badge = ESTIMATE_STATUS_BADGE[estimate.status] ?? ESTIMATE_STATUS_FALLBACK;
            return (
              <tr key={estimate.id}>
                <th scope="row" className={ROW_HEADER_CLASS}>
                  <NextLink
                    href={`/estimates/${estimate.id}`}
                    className="text-accent hover:underline"
                  >
                    {estimate.estimate_number ?? "Draft"}
                  </NextLink>
                </th>
                <LTd>
                  <span className="text-ink-2">{formatDate(estimate.issued_on)}</span>
                </LTd>
                <LTd>
                  <LPill tone={estimateBadgeTone(badge.color)}>{badge.label}</LPill>
                </LTd>
                <LTd numeric>
                  {estimate.totalCents === null ? (
                    <span className="text-caption text-crit">Couldn&rsquo;t load</span>
                  ) : (
                    <span className="font-medium">{formatCents(estimate.totalCents)}</span>
                  )}
                </LTd>
              </tr>
            );
          })}
        </tbody>
      </LTable>
      {estimates.truncated ? <TruncatedCaption /> : null}
    </div>
  );
}

/* ── Shared bits ───────────────────────────────────────────────────────
 * The house cap wording, one place: every tab above hits the same 25-row
 * limit (history-queries.ts's HISTORY_LIST_LIMIT) and says so the same
 * way. */
function TruncatedCaption() {
  return <p className="mt-2 text-caption text-ink-3">Latest 25 shown.</p>;
}

/* Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as this directory's other panels' own
 * WarningIcon (page.tsx, cost-panel.tsx, payment-insight-panel.tsx). */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
