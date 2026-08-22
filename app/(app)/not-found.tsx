import NextLink from "next/link";
import { LCard, lButtonClass } from "@/components/ledger";
import { DASHBOARD_PATH } from "@/lib/nav";

/**
 * Segment-level 404 for the authenticated surface. Without this file, every
 * notFound() call under app/(app) — invoices/[id], trips/[id], clients/[id],
 * expenses/[id], logbook/[id], documents/[id], estimates/[id], crew/[id],
 * clients/[id]/statement, and any other record-detail page — fell through
 * to the ROOT not-found.tsx (app/not-found.tsx), which renders outside the
 * (app) layout entirely: the nav rail and the rest of the shell unmount
 * along with the one page that failed. That's the same failure mode
 * app/(app)/error.tsx exists to fix for throws — see its header — and this
 * is the notFound() half of it.
 *
 * A `not-found.tsx` placed in a route segment renders inside that segment's
 * layout (Next's component hierarchy: layout -> loading -> not-found/error
 * -> page), so this one renders in the page slot AppShell already lays
 * out — the rail stays up and clickable, same as AppError.
 *
 * By the time any of the nine notFound() calls above fires, this layout's
 * own requireAccount() already succeeded and the shell is already on
 * screen, so — same reasoning as AppError's header — this needs no data
 * read of its own: a stale bookmark, a deleted record, or another tenant's
 * id (which RLS makes indistinguishable from "doesn't exist") all land
 * here with nothing left to fetch.
 */
export default function AppNotFound() {
  return (
    <LCard className="p-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-h3 font-bold text-ink">Record not found</h1>
        <p className="text-body-s text-ink-2">
          This record doesn&rsquo;t exist, or it was deleted.
        </p>
        <div className="flex gap-3">
          <NextLink href={DASHBOARD_PATH} className={lButtonClass({ variant: "outline" })}>
            Back to overview
          </NextLink>
        </div>
      </div>
    </LCard>
  );
}
