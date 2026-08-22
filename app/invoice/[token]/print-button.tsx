"use client";

import { LButton } from "@/components/ledger";

/**
 * "Print / save PDF" for the two client-facing money documents — the invoice
 * portal and the estimate portal, which imports this file rather than
 * carrying a second copy of eleven lines.
 *
 * WHY IT EXISTS. An AP desk files an invoice as a PDF. The pilot's own PDF
 * route (app/(app)/invoices/[id]/pdf) is authenticated and unreachable from
 * here by design, so the client's only option was Ctrl+P — which most people
 * do not think to try on something that looks like a web page, and which
 * printed the app chrome and a full-width accent Pay button until the
 * @media print block in app/design/ledger.css existed.
 *
 * OUTLINE, NEVER PRIMARY: on the invoice the one filled accent action is the
 * Pay button, and Ledger allows exactly one per view (LEDGER.md). On the
 * estimate it is Accept. Printing is a convenience next to either.
 *
 * `print:hidden` because a control that only works on screen has no business
 * on the paper it produces. The button is also the only interactive element
 * on these pages that needs a browser API at all, which is why this one
 * small client component exists and the pages stay server components.
 */
export default function PrintButton() {
  return (
    <LButton
      type="button"
      variant="outline"
      size="sm"
      className="print:hidden"
      onClick={() => window.print()}
    >
      Print / save PDF
    </LButton>
  );
}
