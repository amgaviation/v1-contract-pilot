"use client";

import { useState } from "react";
import { lButtonClass } from "@/components/ledger";
import { LCheckbox } from "@/components/ledger/forms";

/**
 * The Preview/Download PDF button, now with the receipts toggle beside it
 * when — and only when — this invoice has rebill lines whose expenses carry
 * a receipt on file. An invoice with nothing attachable renders the same
 * lone button it always has; the control never appears where it can do
 * nothing.
 *
 * The toggle drives the pdf route's `?receipts=0` query parameter and
 * defaults ON (matching buildInvoiceDocument's own default and the send
 * dialog's checkbox in status-actions.tsx — the three surfaces must agree
 * or a previewed document and an emailed one silently differ, which is the
 * exact drift lib/invoice-document.tsx exists to prevent).
 *
 * CONTROLLED checkbox, not defaultChecked. Here there is no form action at
 * all, so there's no native form "reset" event to fight in the first
 * place — but controlled is still the house shape for Ledger checkboxes
 * precisely so nobody has to re-derive that analysis when a form later
 * grows around one.
 *
 * REIMBURSABLES PACKET (roadmap #1's remainder): a second, plain download
 * link, shown under the same gate as the receipts checkbox above — this
 * invoice carries rebill lines whose expense has a receipt on file. It is
 * NOT a toggle on the invoice PDF itself (that stays one document, priced
 * and laid out for the client); it is a second, separate document
 * (lib/reimbursables-packet-pdf.tsx) organized for an operator's AP desk —
 * category totals, itemized detail, then the same receipts, full-page.
 */
export default function PdfDownload({
  invoiceId,
  draft,
  receiptCount,
}: {
  invoiceId: string;
  draft: boolean;
  /** Rebill lines on this invoice whose expense has a receipt on file. */
  receiptCount: number;
}) {
  const [withReceipts, setWithReceipts] = useState(true);

  const label = draft ? "Preview PDF" : "Download PDF";
  const href = `/invoices/${invoiceId}/pdf${withReceipts ? "" : "?receipts=0"}`;

  if (receiptCount === 0) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={lButtonClass({ variant: "outline" })}>
        {label}
      </a>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <a href={href} target="_blank" rel="noopener noreferrer" className={lButtonClass({ variant: "outline" })}>
          {label}
        </a>
        <a
          href={`/invoices/${invoiceId}/reimbursables-packet`}
          target="_blank"
          rel="noopener noreferrer"
          className={lButtonClass({ variant: "outline" })}
        >
          Reimbursables packet
        </a>
      </div>
      <label className="flex items-center gap-1 text-caption text-ink-3">
        <LCheckbox
          checked={withReceipts}
          onChange={(e) => setWithReceipts(e.target.checked)}
        />
        Attach {receiptCount === 1 ? "the receipt" : `${receiptCount} receipts`} for
        rebilled expenses
      </label>
    </div>
  );
}
