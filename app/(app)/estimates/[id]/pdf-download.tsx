import { lButtonClass } from "@/components/ledger";

/**
 * The Preview/Download PDF button — mirrors
 * app/(app)/invoices/[id]/pdf-download.tsx, minus the receipts toggle: an
 * estimate has no rebilled-expense receipts to attach, so there is nothing
 * for a checkbox to govern. A plain server component, not a client one,
 * for the same reason: no state to hold.
 */
export default function EstimatePdfDownload({
  estimateId,
  draft,
}: {
  estimateId: string;
  draft: boolean;
}) {
  const label = draft ? "Preview PDF" : "Download PDF";
  return (
    <a
      href={`/estimates/${estimateId}/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className={lButtonClass({ variant: "outline" })}
    >
      {label}
    </a>
  );
}
