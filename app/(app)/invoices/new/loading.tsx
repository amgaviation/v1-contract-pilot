import { LCard, LSkeleton } from "@/components/ledger";

/**
 * New-invoice's segment-level fallback, rebuilt on Ledger — see
 * app/(app)/overview/loading.tsx's own header for the pattern this follows:
 * mirror the real page's section order so the skeleton reserves roughly the
 * height the arriving content needs.
 *
 * app/(app)/invoices/new/page.tsx's own card is:
 *   1. Bill-to picker (wide) beside the tax-rate field (narrow).
 *   2. Unbilled trips — a table, shown once a client is picked.
 *
 * The trip table is skeletoned here even though it is conditional on
 * `?client=` being present, unlike Overview's own conditional panels: the
 * single most common path to this screen is the "bill this trip" CTA on a
 * trip page, which always arrives with a client preselected, so the trip
 * table is the common case rather than the exception on this particular
 * screen.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        Loading your clients and trips…
      </p>

      {/* Header stand-in: title + subtitle line. */}
      <div className="flex flex-col gap-2">
        <LSkeleton className="h-8 w-40" />
        <LSkeleton className="h-4 w-full max-w-2xl" />
      </div>

      <LCard>
        {/* Bill-to picker (wide) + tax rate (narrow) — same 2/1 track split
            as the real form. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2 md:col-span-2">
            <LSkeleton className="h-3 w-16" />
            <LSkeleton className="h-9 w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <LSkeleton className="h-3 w-24" />
            <LSkeleton className="h-9 w-full" />
          </div>
        </div>

        {/* Unbilled trips table. */}
        <div className="mt-6 flex flex-col gap-3">
          <LSkeleton className="h-5 w-32" />
          <div className="flex flex-col divide-y divide-hair">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 py-2.5">
                <LSkeleton className="h-4 w-4 shrink-0 rounded-sm" />
                <LSkeleton className="h-4 w-32 flex-1" />
                <LSkeleton className="h-4 w-20 shrink-0" />
                <LSkeleton className="h-4 w-20 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </LCard>
    </div>
  );
}
