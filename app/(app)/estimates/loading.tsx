import { LCard, LSkeleton } from "@/components/ledger";

/**
 * Estimates list's segment-level fallback, rebuilt on Ledger instead of the
 * INSTRUMENT shapes app/(app)/loading-panel.tsx renders for every
 * un-migrated screen — same reasoning as overview/loading.tsx's own header.
 *
 * Mirrors the REAL page's order (./page.tsx): header, filter chips, then
 * the table card. The filter chips are static chrome, not data — same
 * argument overview/loading.tsx makes for skipping its header's action
 * buttons — so they render for real here rather than as skeleton blocks.
 *
 * role="status" + a real, if visually hidden, sentence is what reaches a
 * screen reader; the skeleton blocks are `aria-hidden` inside LSkeleton so
 * they aren't announced as a wall of empty boxes.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        Loading your estimates…
      </p>

      {/* Header stand-in: title + subtitle line. No action skeleton — the
          real header's "New estimate" button is static chrome, not data. */}
      <div className="flex flex-col gap-2">
        <LSkeleton className="h-8 w-40" />
        <LSkeleton className="h-4 w-64 max-w-full" />
      </div>

      {/* Table card — six columns, matching the real table's header row. */}
      <LCard>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {[0, 1, 2, 3, 4, 5].map((col) => (
              <LSkeleton key={col} className="h-3 flex-1" />
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3">
              {[0, 1, 2, 3, 4, 5].map((col) => (
                <LSkeleton key={col} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </LCard>
    </div>
  );
}
