import { LCard, LPill, LSeparator } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { formatDate } from "@/lib/format";
import HeaderForm from "../../(app)/invoices/[id]/header-form";
import LinesEditor from "../../(app)/invoices/[id]/lines-editor";
import PaymentPanel from "../../(app)/invoices/[id]/payment-panel";
import PdfDownload from "../../(app)/invoices/[id]/pdf-download";
import SharePanel from "../../(app)/invoices/[id]/share-panel";
import StatusActions from "../../(app)/invoices/[id]/status-actions";
import { InvoiceTotals } from "../../(app)/invoices/[id]/totals";
import {
  INVOICE_CLIENTS,
  INVOICE_HEADER,
  INVOICE_ID,
  INVOICE_LINES,
  INVOICE_NUMBER,
  INVOICE_RECEIPT_COUNT,
  INVOICE_TOTALS,
} from "./fixtures";

/**
 * THE INVOICE SCREEN, RENDERED FROM ITS REAL COMPONENTS.
 *
 * This is the first of the two options in the harness header — extraction,
 * not re-composition — and it needed almost none, because the real screen
 * (app/(app)/invoices/[id]/page.tsx) was already assembled from
 * props-driven components. Every panel below is the SAME module that page
 * renders, handed fabricated props instead of query results:
 *
 *   HeaderForm     the bill-to block, locked exactly as it is on an issued
 *                  invoice (invoices_protect_issued's own rule)
 *   LinesEditor    the line table, read-only for the same reason
 *   InvoiceTotals  the money block — the one piece that DID need
 *                  extracting, out of page.tsx into invoices/[id]/totals.tsx,
 *                  which that page now renders too
 *   StatusActions  send / share / void, gated on the same status
 *   SharePanel     the client link and its view stamps
 *   PaymentPanel   the payment link, the methods, and the ledger
 *
 * So a column, a label or a control that changes on the invoice screen
 * changes in this picture the next time it is captured. It cannot drift.
 *
 * ONE COMPOSITION CHOICE IS THIS FILE'S OWN, and is named rather than left
 * to be noticed: the reminder ladder (ReminderPanel) is not rendered. It is
 * a per-client chase schedule and it makes the screen a good deal taller
 * than a page-width figure can carry. Everything else is the real screen's
 * own arrangement, in its own order.
 *
 * Every form below is inert: the server actions these components import
 * are never submitted here, and nothing on this route reads a session, a
 * tenant or the database. All data comes from ./fixtures.ts, which is
 * entirely invented — see its header.
 */
export default function InvoiceScreen() {
  return (
    <LPageShell
      title={INVOICE_NUMBER}
      subtitle={
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <LPill tone="accent">Sent</LPill>
          <span className="text-ink-3">
            {`Issued ${formatDate(INVOICE_HEADER.issued_on)} · Due ${formatDate(
              INVOICE_HEADER.due_on
            )}`}
          </span>
        </span>
      }
      action={
        <PdfDownload
          invoiceId={INVOICE_ID}
          draft={false}
          receiptCount={INVOICE_RECEIPT_COUNT}
        />
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <HeaderForm invoice={INVOICE_HEADER} clients={INVOICE_CLIENTS} locked />

          <LCard>
            <div className="mb-3 text-h3 font-semibold">Lines</div>
            <LinesEditor
              invoiceId={INVOICE_ID}
              lines={INVOICE_LINES}
              editable={false}
              rebillable={[]}
              categoryLabels={{}}
            />
            <LSeparator className="my-4" />
            <InvoiceTotals totals={INVOICE_TOTALS} />
          </LCard>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <StatusActions
            invoice={{ id: INVOICE_ID, status: "sent" }}
            hasLines
            canEmail
            clientEmail={INVOICE_HEADER.bill_to_email}
            clientName={INVOICE_HEADER.bill_to_name}
            hasClient
            receiptCount={INVOICE_RECEIPT_COUNT}
            hasInvoiceTemplate={false}
            automaticChase="live"
            hasDueDate
          />
          {/* NO SHARE ROW AND NO PAYMENT LINK, DELIBERATELY — this is the
              state of an issued invoice before either has been created,
              and it is the only state of these two panels a screenshot can
              show honestly.

              SharePanel builds its URL from window.location.origin (see its
              own comment on why), which on a harness capture is the dev
              server — putting "http://localhost:3000/invoice/…" in a
              marketing image. And a Stripe payment-link URL is an opaque
              buy.stripe.com path; fabricating one would put a plausible,
              typeable link to somebody else's checkout on the public site.
              Neither is worth doctoring the picture for, and both panels
              read perfectly well showing the control that creates the
              thing rather than the thing. */}
          <SharePanel invoiceId={INVOICE_ID} share={null} receiptCount={INVOICE_RECEIPT_COUNT} />
          <PaymentPanel
            invoiceId={INVOICE_ID}
            status="sent"
            payments={[]}
            connectAccountConnected
            existingPaymentLinkUrl={null}
            existingPaymentLinkAmountCents={null}
            balanceDueCents={INVOICE_TOTALS.balance_due_cents}
            defaultPaymentMethods="card_ach"
          />
        </div>
      </div>
    </LPageShell>
  );
}
