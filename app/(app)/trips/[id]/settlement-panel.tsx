import NextLink from "next/link";
import { LAlert, LCard, LPill } from "@/components/ledger";
import { formatCents } from "@/lib/format";
import type { TripSettlement } from "@/lib/trip-settlement";

/**
 * Expected vs invoiced vs paid, for THIS trip's flight and travel days —
 * roadmap #5's remainder. Server component: everything here is a read
 * already assembled by lib/trip-settlement.ts, so there is nothing for a
 * client bundle to do.
 *
 * SCOPE, STATED ON SCREEN, NOT JUST IN A CODE COMMENT: this panel prices
 * day money only (flight_day + travel_day) — the same money
 * lib/trip-value.ts's tripValueCents prices for every other screen. Per
 * diem, a cancellation fee, and rebilled receipts can also ride on this
 * trip's invoice, and are deliberately left out of these three figures so
 * "unbilled remainder" keeps meaning one thing: day money not yet on an
 * invoice. Saying nothing about that scope would let a pilot read
 * "Invoiced $0" as "this trip billed nothing" when it may have billed a
 * cancellation fee and nothing else.
 */
export default function SettlementPanel({
  settlement,
  loadError,
}: {
  settlement: TripSettlement | null;
  /** A failed read of this trip's invoice lines, invoices, or payments —
   *  never rendered as a healthy $0.00, matching the moneyError pattern on
   *  the invoice detail screen. */
  loadError: string | null;
}) {
  return (
    <LCard>
      <div className="text-h3 font-semibold">Settlement</div>
      <p className="mb-3 text-body-s text-ink-2">
        What this trip&rsquo;s flight and travel days are worth, what has
        been invoiced for them, and what has been paid. Per diem,
        cancellation fees, and rebilled expenses bill separately and
        aren&rsquo;t counted here.
      </p>

      {loadError ? (
        <LAlert tone="crit">{loadError}</LAlert>
      ) : settlement ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Figure label="Expected" cents={settlement.expectedCents} />
            <Figure
              label="Invoiced"
              cents={settlement.invoicedCents}
              note={
                settlement.hasDraftMoney
                  ? `${formatCents(settlement.draftInvoicedCents)} of that sits on a draft, not yet sent`
                  : null
              }
            />
            <Figure
              label="Paid"
              cents={settlement.paidCents}
              note={
                settlement.invoiceHasOtherCharges
                  ? "the invoice this pays also carries other charges"
                  : null
              }
            />
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <DeltaRow
              label="Unbilled remainder"
              cents={settlement.unbilledRemainderCents}
              zeroWord="fully invoiced"
            />
            <DeltaRow
              label="Unpaid balance"
              cents={settlement.unpaidBalanceCents}
              zeroWord={settlement.invoicedCents > 0 ? "fully paid" : "nothing invoiced yet"}
            />
          </div>

          {/* Naming the invoice without linking to it left the pilot to
              find it by eye in the Invoices list — and a draft carrier has
              no number to look for at all. Same href the freeze card on
              this page uses. */}
          <p className="mt-3 text-caption text-ink-3">
            {settlement.billedInvoices.length > 0 ? (
              <>
                Billed on{" "}
                {settlement.billedInvoices.map((invoice, index) => (
                  <span key={invoice.id}>
                    {index > 0 ? ", " : ""}
                    <NextLink
                      href={`/invoices/${invoice.id}`}
                      className="text-accent underline"
                    >
                      {invoice.invoice_number ?? "a draft invoice"}
                    </NextLink>
                  </span>
                ))}
                .
              </>
            ) : (
              "Not yet on an invoice."
            )}
          </p>
        </>
      ) : null}
    </LCard>
  );
}

function Figure({
  label,
  cents,
  note,
}: {
  label: string;
  cents: number;
  note?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-ink-3">{label}</span>
      <span className="tnum-l text-h2 font-bold">{formatCents(cents)}</span>
      {note ? <span className="text-caption text-ink-3">{note}</span> : null}
    </div>
  );
}

function DeltaRow({
  label,
  cents,
  zeroWord,
}: {
  label: string;
  cents: number;
  zeroWord: string;
}) {
  const isZero = cents === 0;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body-s text-ink-2">{label}</span>
      {isZero ? (
        <LPill tone="good">{zeroWord}</LPill>
      ) : (
        <span className="tnum-l text-lead font-bold">{formatCents(cents)}</span>
      )}
    </div>
  );
}
