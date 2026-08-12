"use client";

import { useState } from "react";
import { Button, Checkbox, Flex, Text } from "@/components/ui";

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
 * all so the React-19 reset-event trap lines-editor.tsx documents (Radix's
 * Checkbox restoring its first-mount value on the post-action form reset)
 * cannot fire — but controlled is still the house shape for Radix
 * checkboxes precisely so nobody has to re-derive that analysis when a
 * form later grows around one.
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
      <Button asChild variant="outline">
        <a href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      </Button>
    );
  }

  return (
    <Flex direction="column" gap="1" align="end">
      <Button asChild variant="outline">
        <a href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      </Button>
      <Text as="label" size="1" color="gray">
        <Flex gap="1" align="center">
          <Checkbox
            size="1"
            checked={withReceipts}
            onCheckedChange={(value) => setWithReceipts(value === true)}
          />
          Attach {receiptCount === 1 ? "the receipt" : `${receiptCount} receipts`} for
          rebilled expenses
        </Flex>
      </Text>
    </Flex>
  );
}
