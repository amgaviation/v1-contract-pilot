import { LSpinner } from "@/components/ledger";

/**
 * The auth group's route-transition state. /welcome awaits the live Stripe
 * price lookup and every page here awaits a session check, so a slow
 * network used to leave the form column blank. It renders inside
 * ../layout.tsx's centered column, so it needs no chrome of its own — the
 * mark is already on screen above it.
 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-16">
      {/* LSpinner carries its own role="status" + aria-label — the
          accessible announcement. The text beside it is the sighted half
          of the same statement, so it is aria-hidden rather than a second
          live region for one wait. */}
      <LSpinner />
      <span aria-hidden className="text-body-s text-ink-2">
        Loading…
      </span>
    </div>
  );
}
