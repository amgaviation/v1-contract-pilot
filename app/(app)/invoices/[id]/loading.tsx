import { LCard, LSkeleton } from "@/components/ledger";

/**
 * Segment-level fallback for the invoice detail screen, rebuilt on Ledger
 * primitives rather than the shared app/(app)/loading-panel.tsx this
 * replaces — that file is INSTRUMENT-styled (components/ui's Card/Flex/
 * Text) and this route no longer renders through it once its own page.tsx
 * is Ledger.
 *
 * NOT LPageShell: that primitive takes a real `title` string, and there is
 * none yet — the invoice number is exactly what this render is waiting on.
 * The header row below mirrors LPageShell's own layout (title, subtitle,
 * action, all skeletons) by hand instead, so the page doesn't jump when
 * the real header replaces it.
 *
 * SECTION ORDER MATCHES page.tsx EXACTLY: header, then the left column
 * (billing details, lines + totals), then the right column (status,
 * reminders, share, payments) — a skeleton in a different order than the
 * content it stands in for reads as a layout bug for the one frame it's
 * visible.
 *
 * THE ACCESSIBLE HALF IS A REAL SENTENCE, once, per
 * app/(app)/loading-panel.tsx's own header on the same split: `role="status"`
 * + `aria-live="polite"` on visible text is what reaches a screen reader;
 * the skeletons are `aria-hidden` (LSkeleton's own default) so they are not
 * announced as a wall of empty boxes.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 font-ledger text-body text-ink">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <LSkeleton className="h-8 w-48" />
          <LSkeleton className="h-5 w-64" />
        </div>
        <LSkeleton className="h-9 w-32 shrink-0" />
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Loading this invoice…
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          {/* Billing details */}
          <LCard>
            <LSkeleton className="mb-3 h-5 w-36" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <LSkeleton className="h-9 md:col-span-12" />
              <LSkeleton className="h-9 md:col-span-3" />
              <LSkeleton className="h-9 md:col-span-3" />
              <LSkeleton className="h-9 md:col-span-4" />
              <LSkeleton className="h-9 md:col-span-8" />
            </div>
          </LCard>

          {/* Lines + totals */}
          <LCard>
            <LSkeleton className="mb-3 h-5 w-16" />
            <div className="flex flex-col gap-2">
              <LSkeleton className="h-9 w-full" />
              <LSkeleton className="h-9 w-full" />
              <LSkeleton className="h-9 w-full" />
            </div>
            <div className="my-4 border-t border-hair" />
            <div className="flex flex-col items-end gap-2">
              <LSkeleton className="h-4 w-40" />
              <LSkeleton className="h-4 w-40" />
              <LSkeleton className="h-4 w-40" />
            </div>
          </LCard>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          {/* Status */}
          <LCard>
            <LSkeleton className="mb-2 h-5 w-16" />
            <LSkeleton className="h-9 w-full" />
          </LCard>

          {/* Reminders */}
          <LCard>
            <LSkeleton className="mb-2 h-5 w-28" />
            <LSkeleton className="h-4 w-full" />
            <LSkeleton className="mt-2 h-4 w-3/4" />
          </LCard>

          {/* Share with client */}
          <LCard>
            <LSkeleton className="mb-2 h-5 w-36" />
            <LSkeleton className="h-4 w-full" />
            <LSkeleton className="mt-3 h-9 w-40" />
          </LCard>

          {/* Payments */}
          <LCard>
            <LSkeleton className="mb-2 h-5 w-24" />
            <LSkeleton className="h-4 w-full" />
            <LSkeleton className="mt-3 h-9 w-full" />
          </LCard>
        </div>
      </div>
    </div>
  );
}
