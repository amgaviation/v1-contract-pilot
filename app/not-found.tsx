import NextLink from "next/link";
import { LCard, lButtonClass } from "@/components/ledger";

/**
 * Root 404 — reached for any unmatched path, signed in or out. It renders
 * outside the (app) dashboard chrome, so it brings its own theme-only
 * shell rather than the (app) shell, which needs requireAccount() and a
 * resolved route this page doesn't have.
 *
 * Ledger port: same canvas-behind-card composition as the pre-Ledger
 * version, on Ledger's own tokens and primitives.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 font-ledger text-body text-ink">
      <LCard className="w-full max-w-md p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-h2 font-bold text-ink">Not found</h1>
          <p className="text-body-s text-ink-2">There&rsquo;s nothing at this address.</p>
          <NextLink href="/" className={lButtonClass({ variant: "primary" })}>
            Back home
          </NextLink>
        </div>
      </LCard>
    </div>
  );
}
