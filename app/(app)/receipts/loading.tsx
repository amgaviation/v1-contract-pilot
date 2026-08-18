import { LCard, LSkeleton } from "@/components/ledger";

/**
 * Receipts list's segment-level fallback, built on Ledger directly —
 * same reasoning as app/(app)/estimates/loading.tsx's own header, not the
 * INSTRUMENT-era app/(app)/loading-panel.tsx shapes older screens use.
 *
 * Mirrors the real page's order (./page.tsx): header, view chips, then the
 * table card. The view chips are static chrome, not data (their counts
 * aren't known until the read resolves), so they render as plain text here
 * rather than as skeleton blocks — same argument estimates/loading.tsx
 * makes for its own filter row.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        Loading your receipts…
      </p>

      {/* Header stand-in: title + subtitle line. No action skeleton — the
          real header's "Add expense" button is static chrome, not data. */}
      <div className="flex flex-col gap-2">
        <LSkeleton className="h-8 w-32" />
        <LSkeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="flex gap-2" aria-hidden="true">
        <div className="h-8 w-24 rounded-control bg-sunk" />
        <div className="h-8 w-24 rounded-control bg-sunk" />
      </div>

      {/* Table card — seven columns, matching the real table's header row. */}
      <LCard>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {[0, 1, 2, 3, 4, 5, 6].map((col) => (
              <LSkeleton key={col} className="h-3 flex-1" />
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3">
              {[0, 1, 2, 3, 4, 5, 6].map((col) => (
                <LSkeleton key={col} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </LCard>
    </div>
  );
}
