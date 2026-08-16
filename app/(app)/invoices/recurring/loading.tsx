import { LCard, LSkeleton } from "@/components/ledger";

/**
 * Recurring invoices' segment-level fallback, rebuilt on Ledger — see
 * app/(app)/overview/loading.tsx's own header for the pattern this follows:
 * mirror the real page's section order so the skeleton reserves roughly the
 * height the arriving content needs.
 *
 *   1. Due queue — header row (count + "Create all due") plus a table.
 *   2. Schedule manager — the info banner, the add-schedule form, and the
 *      schedules table.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        Loading your recurring invoices…
      </p>

      {/* Header stand-in: title + subtitle line. */}
      <div className="flex flex-col gap-2">
        <LSkeleton className="h-8 w-56 max-w-full" />
        <LSkeleton className="h-4 w-32" />
      </div>

      {/* Due queue. */}
      <LCard>
        <div className="mb-3 flex items-center justify-between gap-3">
          <LSkeleton className="h-4 w-28" />
          <LSkeleton className="h-8 w-28 rounded-control" />
        </div>
        <div className="flex flex-col divide-y divide-hair">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center justify-between gap-3 py-2.5">
              <LSkeleton className="h-4 w-28 flex-1" />
              <LSkeleton className="h-4 w-24 shrink-0" />
              <LSkeleton className="h-4 w-20 shrink-0" />
              <LSkeleton className="h-8 w-16 shrink-0 rounded-control" />
            </div>
          ))}
        </div>
      </LCard>

      {/* Schedule manager: info banner, add-schedule form, schedules table. */}
      <LSkeleton className="h-11 w-full" />

      <LCard>
        <LSkeleton className="mb-3 h-5 w-48" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((field) => (
            <div key={field} className="flex flex-col gap-2">
              <LSkeleton className="h-3 w-20" />
              <LSkeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <LSkeleton className="mt-3 h-9 w-32" />
      </LCard>

      <LCard>
        <div className="flex flex-col divide-y divide-hair">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center justify-between gap-3 py-2.5">
              <LSkeleton className="h-4 w-28 flex-1" />
              <LSkeleton className="h-4 w-16 shrink-0" />
              <LSkeleton className="h-4 w-20 shrink-0" />
              <LSkeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </LCard>
    </div>
  );
}
