"use client";

import { useActionState } from "react";
import { Box, Button, Flex, Text } from "@/components/ui";
import { startCheckout, type CheckoutState } from "./actions";

const initialState: CheckoutState = { error: null };

export function StartTrialButton({ priceLabel }: { priceLabel: string }) {
  const [state, formAction, pending] = useActionState(
    startCheckout,
    initialState
  );

  return (
    <Box width="100%">
      <form action={formAction}>
        <Button type="submit" disabled={pending} style={{ width: "100%" }}>
          {pending ? "Opening checkout…" : "Start your 7-day trial"}
        </Button>
      </form>
      {/*
        "cancel anytime" was removed, not softened. There is no self-serve
        cancellation anywhere in this product — no Stripe billing-portal call,
        no cancel action, no settings control — so the sentence promised a
        capability that does not exist, on the one screen where a pilot is
        deciding whether to hand over a card. That is the worst place in the
        product to be optimistic. It goes back the day a cancel path ships.
      */}
      <Text as="div" size="1" color="gray" mt="1">
        {priceLabel} after the trial. Card required now.
      </Text>
      {state.error ? (
        <Flex mt="2">
          <Text size="1" color="red">
            {state.error}
          </Text>
        </Flex>
      ) : null}
    </Box>
  );
}
