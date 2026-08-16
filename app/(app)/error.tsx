"use client";

import NextLink from "next/link";
import { LButton, LCard, lButtonClass } from "@/components/ledger";
import { DASHBOARD_PATH } from "@/lib/nav";

/**
 * Group-level error boundary for the authenticated surface. Without this
 * file, a throw anywhere under /overview, /invoices, /trips, etc. was
 * caught by the ROOT boundary (app/error.tsx), which replaces everything
 * down to the html body — the dark nav rail and the rest of the (app)
 * shell vanished along with whatever page actually failed, and "try
 * again" from there meant re-navigating from a blank screen, not
 * recovering in place.
 *
 * This one renders INSIDE app/(app)/layout.tsx, in the page slot AppShell
 * already lays out — so it only replaces the one broken page, and the
 * rail stays clickable. That is also why it is safe to keep this boundary
 * this thin: the root boundary is the one that has to assume
 * requireAccount() or a tenant read is what threw, so it cannot lean on
 * any app chrome or nav data existing. By the time a throw reaches here,
 * this layout's own requireAccount() already succeeded — the shell is
 * already on screen — so recovery only has to get the page's own content
 * to render again, which is what reset() is for.
 */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LCard className="p-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-h3 font-bold text-ink">Something went wrong</h1>
        <p className="text-body-s text-ink-2">
          That didn&rsquo;t load. Try again, or head back to the overview.
        </p>
        <div className="flex gap-3">
          <LButton onClick={reset}>Try again</LButton>
          <NextLink href={DASHBOARD_PATH} className={lButtonClass({ variant: "outline" })}>
            Back to overview
          </NextLink>
        </div>
      </div>
    </LCard>
  );
}
