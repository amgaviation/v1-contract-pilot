import { LCard, LSkeleton } from "@/components/ledger";

/**
 * Overview's segment-level fallback, rebuilt on Ledger instead of the
 * INSTRUMENT shapes app/(app)/loading-panel.tsx renders for every
 * un-migrated screen. Before this file, a pilot navigating to the Ledger
 * Overview page saw an INSTRUMENT-shaped skeleton flash and then get
 * replaced by a Ledger screen — the known Phase-1 gap this closes.
 *
 * Mirrors the REAL page's section order (app/(app)/overview/page.tsx) so
 * the skeleton reserves roughly the height the arriving content actually
 * needs, same reasoning as loading-panel.tsx's own "dashboard" shape:
 *
 *   1. KPI row — the two named groups (Owed to you / This calendar year),
 *      each a card of stat pairs.
 *   2. The 3fr/2fr pair — unbilled-by-client (table-shaped, wider) beside
 *      ready-to-invoice (list-shaped, narrower).
 *   3. Document expirations — a card, table-shaped.
 *
 * "Needs attention" and "Getting started" are NOT skeletoned: both render
 * only when their content is nonempty (see page.tsx's own gates on
 * NEEDS_ATTENTION.length and showGettingStarted), so a skeleton reserving
 * space for either would promise a card that may not show up — exactly the
 * layout shift a skeleton exists to prevent, not cause.
 *
 * role="status" + a real, if visually hidden, sentence is what reaches a
 * screen reader; the skeleton blocks are `aria-hidden` inside LSkeleton so
 * they aren't announced as a wall of empty boxes — same split
 * loading-panel.tsx documents for the INSTRUMENT side.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        Loading overview…
      </p>

      {/* Header stand-in: title + subtitle line, no action buttons — the
          real header's buttons are static chrome, not data, so skeletoning
          them would reserve space for something that never shifts. */}
      <div className="flex flex-col gap-2">
        <LSkeleton className="h-8 w-40" />
        <LSkeleton className="h-4 w-72 max-w-full" />
      </div>

      {/* KPI row — two grouped cards, each a pair of stats. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {[0, 1].map((group) => (
          <LCard key={group} className="flex h-full flex-col gap-4">
            <LSkeleton className="h-3 w-28" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1].map((stat) => (
                <div key={stat} className="flex flex-col gap-2">
                  <LSkeleton className="h-3 w-24" />
                  <LSkeleton className="h-7 w-32" />
                  <LSkeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          </LCard>
        ))}
      </div>

      {/* Unbilled-by-client (3fr, table-shaped) beside ready-to-invoice
          (2fr, list-shaped) — same track split as the real pair. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
        <LCard>
          <div className="mb-3 flex flex-col gap-2">
            <LSkeleton className="h-5 w-52" />
            <LSkeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center justify-between gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <LSkeleton className="h-4 w-40 max-w-full" />
                  <LSkeleton className="h-3 w-56 max-w-full" />
                </div>
                <LSkeleton className="h-4 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </LCard>

        <LCard>
          <div className="mb-3 flex flex-col gap-2">
            <LSkeleton className="h-5 w-36" />
            <LSkeleton className="h-3 w-20" />
          </div>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-start justify-between gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <LSkeleton className="h-4 w-32 max-w-full" />
                  <LSkeleton className="h-3 w-44 max-w-full" />
                </div>
                <LSkeleton className="h-4 w-14 shrink-0" />
              </div>
            ))}
          </div>
        </LCard>
      </div>

      {/* Document expirations — table-shaped, three columns. */}
      <LCard>
        <div className="mb-3 flex flex-col gap-2">
          <LSkeleton className="h-5 w-48" />
          <LSkeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center justify-between gap-3">
              <LSkeleton className="h-4 w-40 max-w-full" />
              <LSkeleton className="h-4 w-24 shrink-0" />
              <LSkeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </LCard>
    </div>
  );
}
