import { LCard, LSkeleton } from "@/components/ledger";

/**
 * Estimate detail's segment-level fallback, rebuilt on Ledger — same
 * posture as ../loading.tsx and ../../overview/loading.tsx. Mirrors the
 * real page's order (./page.tsx):
 *
 *   1. Header — title + status pill row.
 *   2. Left column (lg:col-span-7): the quote-details card, then the
 *      lines card (table-shaped) with its totals block.
 *   3. Right column (lg:col-span-5): the status card, then the
 *      "What an estimate is" info card.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        Loading this estimate…
      </p>

      <div className="flex flex-col gap-2">
        <LSkeleton className="h-8 w-56 max-w-full" />
        <div className="flex items-center gap-2">
          <LSkeleton className="h-5 w-16 rounded-full" />
          <LSkeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <LCard>
            <LSkeleton className="mb-3 h-5 w-32" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              {["md:col-span-6", "md:col-span-3", "md:col-span-3", "md:col-span-6", "md:col-span-6"].map(
                (span, i) => (
                  <div key={i} className={`flex flex-col gap-2 ${span}`}>
                    <LSkeleton className="h-3 w-16" />
                    <LSkeleton className="h-9 w-full" />
                  </div>
                )
              )}
            </div>
          </LCard>

          <LCard>
            <LSkeleton className="mb-3 h-5 w-16" />
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                {[0, 1, 2, 3, 4, 5, 6].map((col) => (
                  <LSkeleton key={col} className="h-3 flex-1" />
                ))}
              </div>
              {[0, 1].map((row) => (
                <div key={row} className="flex items-center gap-3">
                  {[0, 1, 2, 3, 4, 5, 6].map((col) => (
                    <LSkeleton key={col} className="h-4 flex-1" />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-col items-end gap-1">
              <LSkeleton className="h-4 w-40" />
              <LSkeleton className="h-4 w-40" />
              <LSkeleton className="h-5 w-40" />
            </div>
          </LCard>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <LCard>
            <LSkeleton className="mb-3 h-5 w-16" />
            <LSkeleton className="h-9 w-full" />
          </LCard>
          <LCard>
            <LSkeleton className="mb-2 h-4 w-40" />
            <LSkeleton className="h-3 w-full" />
            <LSkeleton className="mt-1 h-3 w-3/4" />
          </LCard>
        </div>
      </div>
    </div>
  );
}
