"use client";

import NextLink from "next/link";
import { LButton, LCard, lButtonClass } from "@/components/ledger";
import { DASHBOARD_PATH } from "@/lib/nav";

/**
 * Root error boundary. An unhandled throw anywhere below the root layout
 * lands here, replacing the group layouts (and their dashboard chrome),
 * so it brings its own theme-only shell rather than the (app) shell,
 * which needs requireAccount() and tenant data that may be exactly what
 * threw. Next.js requires error.tsx to be a Client Component.
 *
 * Ledger port: same canvas-behind-card composition as the pre-Ledger
 * version, on Ledger's own tokens and primitives.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 font-ledger text-body text-ink">
      <LCard className="w-full max-w-md p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-h2 font-bold text-ink">Something went wrong</h1>
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
    </div>
  );
}
