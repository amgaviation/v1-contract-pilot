import { LCard, LSkeleton } from "@/components/ledger";

/**
 * New-estimate form's segment-level fallback, rebuilt on Ledger — same
 * posture as ../loading.tsx and ../../overview/loading.tsx. Mirrors the
 * real form's order (./new-form.tsx): the three-column header grid, one
 * line-item row, then the terms/notes grid. The submit/cancel row is
 * static chrome, not data, so it isn't skeletoned (same argument
 * overview/loading.tsx makes for its header's action buttons).
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <p role="status" aria-live="polite" className="sr-only">
        Loading your clients…
      </p>

      <div className="flex flex-col gap-2">
        <LSkeleton className="h-8 w-40" />
        <LSkeleton className="h-4 w-96 max-w-full" />
      </div>

      <LCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((col) => (
            <div key={col} className="flex flex-col gap-2">
              <LSkeleton className="h-3 w-20" />
              <LSkeleton className="h-9 w-full" />
              <LSkeleton className="h-3 w-40 max-w-full" />
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <LSkeleton className="h-5 w-28" />
          <div className="flex flex-wrap items-end gap-3">
            <LSkeleton className="h-9 w-44" />
            <LSkeleton className="h-9 min-w-56 flex-1" />
            <LSkeleton className="h-9 w-24" />
            <LSkeleton className="h-9 w-28" />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1].map((col) => (
            <div key={col} className="flex flex-col gap-2">
              <LSkeleton className="h-3 w-16" />
              <LSkeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      </LCard>
    </div>
  );
}
