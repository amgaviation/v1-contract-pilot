"use client";

import { useState, useTransition } from "react";
import { Button, Flex, Text } from "@/components/ui";
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
  size = "2",
  variant = "solid",
}: {
  id: string;
  size?: "1" | "2";
  variant?: "solid" | "soft";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Flex direction="column" gap="1">
      <Button
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
      </Button>
      {error ? (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      ) : null}
    </Flex>
  );
}
