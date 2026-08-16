import { LCard, LSkeleton } from "@/components/ledger";

/**
 * Invoices list's segment-level fallback, rebuilt on Ledger — see
 * app/(app)/overview/loading.tsx's own header for the pattern this follows:
 * mirror the real page's section order so the skeleton reserves roughly the
 * height the arriving content needs.
 *
 *   1. Filter chips — always rendered, unlike the "Owed to you" aging card
 *      below it on the real page, which only renders when
 *      `outstandingCents > 0`. Same reasoning as Overview's own
 *      "Needs attention"/"Getting started" panels: a skeleton reserving
 *      space for a card that may not show up is the layout shift a
 *      skeleton exists to prevent, not cause — so that card is skipped
 *      here too.
 *   2. The invoice table itself.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        Loading your invoices…
      </p>

      {/* Header stand-in: title + subtitle line, no action buttons — the
          real header's buttons are static chrome, not data. */}
      <div className="flex flex-col gap-2">
        <LSkeleton className="h-8 w-28" />
        <LSkeleton className="h-4 w-56 max-w-full" />
      </div>

      {/* Filter chips. */}
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((chip) => (
          <LSkeleton key={chip} className="h-8 w-24 rounded-control" />
        ))}
      </div>

      <LCard>
        <div className="flex flex-col divide-y divide-hair">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center justify-between gap-3 py-2.5">
              <LSkeleton className="h-4 w-16 shrink-0" />
              <LSkeleton className="h-4 w-32 flex-1" />
              <LSkeleton className="h-4 w-16 shrink-0" />
              <LSkeleton className="h-5 w-20 shrink-0 rounded-full" />
              <LSkeleton className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </LCard>
    </div>
  );
}
