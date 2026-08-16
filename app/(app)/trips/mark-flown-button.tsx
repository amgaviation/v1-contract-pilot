"use client";

import { useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { markTripCompleted } from "./actions";

/**
 * "Mark flown" — the one tap that connects a trip to everything
 * downstream of it.
 *
 * Until this existed, a trip sat at status='scheduled' forever, and the
 * invoice picker, the logbook drafts queue and Overview all filter on
 * 'completed'. A pilot who flew ten trips and came back to bill them was
 * told by three separate screens that they had nothing. See
 * markTripCompleted's comment in actions.ts.
 *
 * Deliberately NOT a confirmation dialog. The pilot is asserting a fact
 * they know better than the software does, the action is reversible from
 * the Status field on the trip form, and a modal between a tired pilot and
 * the thing they came here to do is friction for its own sake.
 */
export default function MarkFlownButton({
  id,
  size = "md",
  variant = "primary",
}: {
  id: string;
  size?: "sm" | "md";
  variant?: "primary" | "outline";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <LButton
        type="button"
        size={size}
        variant={variant}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await markTripCompleted(id);
            // No success state to render: the server revalidates and the
            // row re-renders as Completed, which IS the feedback. A
            // "Saved!" that then disappears under a re-render says less.
            if (result.error) setError(result.error);
          })
        }
      >
        {pending ? "Marking…" : "Mark flown"}
      </LButton>
      {error ? (
        <p className="text-caption font-medium text-crit" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
