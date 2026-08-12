"use client";

import { useActionState } from "react";
import { Button, Flex, Text } from "@/components/ui";
import { recomputeCurrency, type RecomputeState } from "./actions";
import { formatZulu } from "./presentation";

/**
 * The recompute form — the React 19 useActionState round trip the rest of
 * this product's forms use: the action's whole result is echoed back as
 * state, so success renders a receipt (how many snapshot rows, at what
 * Zulu time) and failure renders the action's own sentence. There are no
 * text inputs here to re-echo; the state IS the echo.
 *
 * role="status" / role="alert" make the outcome reach a screen reader —
 * the button's label change while pending is the sighted half only.
 */
export default function RecomputeButton() {
  const [state, formAction, pending] = useActionState<RecomputeState, FormData>(
    recomputeCurrency,
    null
  );

  return (
    <form action={formAction}>
      <Flex direction="column" align={{ initial: "start", sm: "end" }} gap="1">
        <Button type="submit" disabled={pending}>
          {pending ? "Recomputing…" : "Recompute and record snapshot"}
        </Button>
        {state?.ok ? (
          <Text size="1" color="green" role="status">
            {`Recorded ${state.recordedCount} snapshot row${state.recordedCount === 1 ? "" : "s"} at ${
              formatZulu(state.recordedAtIso) ?? state.recordedAtIso
            }.`}
          </Text>
        ) : state && !state.ok ? (
          <Text size="1" color="red" role="alert">
            {state.error}
          </Text>
        ) : null}
      </Flex>
    </form>
  );
}
