"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  Box,
  Button,
  Flex,
  RadioCards,
  SegmentedControl,
  Text,
} from "@/components/ui";
import type { BillingInterval, PlanTier } from "@/lib/entitlements";
import { startCheckout, type CheckoutState } from "./actions";

const initialState: CheckoutState = { error: null };

/**
 * One plan option as the SERVER prepared it — names and blurbs from
 * lib/entitlements.ts, price labels read from the live Stripe Price
 * objects (lib/stripe/prices.ts). This component adds no copy of its
 * own about money: a null label means the tier is not configured, and
 * it renders as unavailable rather than inventing a figure.
 */
export type PlanOption = {
  tier: PlanTier;
  name: string;
  blurb: string;
  /**
   * The actual first charge per interval — for Business this is the ×2
   * total ("$78/month"), so the number shown equals what Stripe bills
   * (Finding 1). A null means the tier is not configured and renders as
   * unavailable.
   */
  price: Record<BillingInterval, string | null>;
  /**
   * The per-seat + minimum note for a per-seat tier ("$39/seat · 2-seat
   * minimum"), or null for a flat tier. Prepared by the server from the
   * live Stripe Price; this component adds no money copy of its own.
   */
  seatNote: Record<BillingInterval, string | null>;
};

export function PlanPicker({
  options,
  trialDays,
}: {
  options: PlanOption[];
  trialDays: number;
}) {
  const [state, formAction, pending] = useActionState(startCheckout, initialState);

  const firstAvailable =
    options.find((o) => o.price.monthly !== null)?.tier ?? options[0]?.tier ?? "solo";
  const [tier, setTier] = useState<PlanTier>(firstAvailable);
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  const selected = options.find((o) => o.tier === tier);
  const selectedLabel = selected?.price[interval] ?? null;
  const selectedSeatNote = selected?.seatNote[interval] ?? null;
  const anyAnnual = options.some((o) => o.price.annual !== null);

  return (
    <Box width="100%">
      {anyAnnual ? (
        <Flex justify="center" mb="3">
          <SegmentedControl.Root
            value={interval}
            onValueChange={(value) => {
              if (value !== "monthly" && value !== "annual") return;
              setInterval(value);
              // Keep the selection legal: if the current tier has no
              // price at the new interval, move to the first that does.
              const current = options.find((o) => o.tier === tier);
              if (current && current.price[value] === null) {
                const fallback = options.find((o) => o.price[value] !== null);
                if (fallback) setTier(fallback.tier);
              }
            }}
            size="1"
          >
            <SegmentedControl.Item value="monthly">Monthly</SegmentedControl.Item>
            <SegmentedControl.Item value="annual">Annual</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
      ) : null}

      <RadioCards.Root
        value={tier}
        onValueChange={(value) => {
          const next = options.find((o) => o.tier === value);
          if (next && next.price[interval] !== null) setTier(next.tier);
        }}
        columns="1"
        gap="2"
      >
        {options.map((option) => {
          const label = option.price[interval];
          const seatNote = option.seatNote[interval];
          const unavailable = label === null;
          return (
            <RadioCards.Item
              key={option.tier}
              value={option.tier}
              disabled={unavailable}
            >
              <Flex direction="column" width="100%" gap="1" style={{ textAlign: "left" }}>
                <Flex justify="between" gap="2" align="center">
                  <Text weight="bold">{option.name}</Text>
                  <Flex direction="column" align="end" gap="0">
                    <Text size="2" color="gray">
                      {unavailable ? "Unavailable" : label}
                    </Text>
                    {/* The per-seat breakdown for a per-seat tier, so the
                        "$78/month" total above is shown WITH how it is
                        composed — never a bare "$39/month" that checkout
                        would then double (Finding 1). */}
                    {!unavailable && seatNote ? (
                      <Text size="1" color="gray">
                        {seatNote}
                      </Text>
                    ) : null}
                  </Flex>
                </Flex>
                <Text size="1" color="gray">
                  {option.blurb}
                </Text>
              </Flex>
            </RadioCards.Item>
          );
        })}
      </RadioCards.Root>

      <form action={formAction}>
        {/* The chosen tier/interval ride as hidden fields; the server
            action re-validates both and resolves the PRICE itself, so a
            tampered value can only change what gets paid for — the
            webhook maps the tier from the price, never from the form. */}
        <input type="hidden" name="tier" value={tier} />
        <input type="hidden" name="interval" value={interval} />
        <Button
          type="submit"
          disabled={pending || selectedLabel === null}
          mt="3"
          style={{ width: "100%" }}
        >
          {pending ? "Opening checkout…" : `Start your ${trialDays}-day trial`}
        </Button>
      </form>
      {/*
        "cancel anytime" stays out of this copy on purpose (see the git
        history of this file): the cancel path lives in Stripe's billing
        portal via Settings → Billing, which exists only once the account
        does — this screen belongs to someone who doesn't have one yet.
      */}
      <Text as="div" size="1" color="gray" mt="1">
        {selectedLabel
          ? `${selectedLabel}${
              selectedSeatNote ? ` (${selectedSeatNote})` : ""
            } after the trial. Card required now.`
          : "Card required now."}
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
