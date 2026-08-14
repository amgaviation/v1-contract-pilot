"use client";

import { useActionState } from "react";
import { Button, Flex, Text } from "@/components/ui";
import type { PlanTier } from "@/lib/entitlements";
import {
  changePlan,
  openBillingPortal,
  resubscribe,
  setCancelAtPeriodEnd,
  type BillingActionState,
} from "./actions";

const initialState: BillingActionState = { error: null };

/**
 * The switch-plan control for ONE target tier. Two submit buttons share
 * one form: the clicked button's own name/value pair ("interval") rides
 * the FormData, so the server action knows which price was chosen
 * without any client-side state to get stale. Labels arrive from the
 * server, already read from the live Stripe Price — this component
 * never states an amount of its own.
 */
export function ChangePlanButtons({
  tier,
  direction,
  monthlyLabel,
  annualLabel,
  disabled,
}: {
  tier: PlanTier;
  /** Upgrade vs downgrade wording, decided server-side from TIER_RANK. */
  direction: "Upgrade" | "Downgrade";
  monthlyLabel: string | null;
  annualLabel: string | null;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(changePlan, initialState);

  if (monthlyLabel === null && annualLabel === null) {
    return (
      <Text size="1" color="gray">
        Not available yet.
      </Text>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="tier" value={tier} />
      <Flex direction="column" gap="2">
        {monthlyLabel !== null ? (
          <Button
            type="submit"
            name="interval"
            value="monthly"
            disabled={disabled || pending}
            variant={direction === "Upgrade" ? "solid" : "soft"}
            color={direction === "Upgrade" ? undefined : "gray"}
          >
            {pending ? "Confirming with Stripe…" : `${direction} — ${monthlyLabel}`}
          </Button>
        ) : null}
        {annualLabel !== null ? (
          <Button
            type="submit"
            name="interval"
            value="annual"
            disabled={disabled || pending}
            variant="soft"
            color={direction === "Upgrade" ? undefined : "gray"}
          >
            {pending ? "Confirming with Stripe…" : `${direction} — ${annualLabel}`}
          </Button>
        ) : null}
        {state.error ? (
          <Text size="1" color="red">
            {state.error}
          </Text>
        ) : null}
      </Flex>
    </form>
  );
}

/**
 * The resubscribe control for ONE target tier — what a canceled or
 * incomplete_expired account sees in place of ChangePlanButtons, because
 * changePlan's stripe.subscriptions.update() hard-fails on a subscription
 * Stripe considers dead. Same two-button-one-form shape as
 * ChangePlanButtons; the server action starts a brand-new Checkout session
 * for the SAME Stripe customer instead of updating the old subscription.
 */
export function ResubscribeButtons({
  tier,
  monthlyLabel,
  annualLabel,
  disabled,
}: {
  tier: PlanTier;
  monthlyLabel: string | null;
  annualLabel: string | null;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(resubscribe, initialState);

  if (monthlyLabel === null && annualLabel === null) {
    return (
      <Text size="1" color="gray">
        Not available yet.
      </Text>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="tier" value={tier} />
      <Flex direction="column" gap="2">
        {monthlyLabel !== null ? (
          <Button
            type="submit"
            name="interval"
            value="monthly"
            disabled={disabled || pending}
            variant="solid"
          >
            {pending ? "Starting checkout…" : `Resubscribe — ${monthlyLabel}`}
          </Button>
        ) : null}
        {annualLabel !== null ? (
          <Button
            type="submit"
            name="interval"
            value="annual"
            disabled={disabled || pending}
            variant="soft"
          >
            {pending ? "Starting checkout…" : `Resubscribe — ${annualLabel}`}
          </Button>
        ) : null}
        {state.error ? (
          <Text size="1" color="red">
            {state.error}
          </Text>
        ) : null}
      </Flex>
    </form>
  );
}

/** Switch billing interval without changing tier (monthly ⇄ annual). */
export function SwitchIntervalButton({
  tier,
  targetInterval,
  label,
  disabled,
}: {
  tier: PlanTier;
  targetInterval: "monthly" | "annual";
  label: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(changePlan, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="tier" value={tier} />
      <input type="hidden" name="interval" value={targetInterval} />
      <Flex direction="column" gap="1">
        <Button type="submit" variant="soft" size="1" disabled={disabled || pending}>
          {pending ? "Confirming with Stripe…" : label}
        </Button>
        {state.error ? (
          <Text size="1" color="red">
            {state.error}
          </Text>
        ) : null}
      </Flex>
    </form>
  );
}

/**
 * Cancel-at-period-end and its exact inverse, Resume. One component for
 * both because they are one Stripe field (see setCancelAtPeriodEnd), and
 * rendering them as separate controls would invite the state where both
 * are on screen at once.
 *
 * The destructive direction is `variant="outline" color="red"` rather than
 * a solid red button: it is a scheduled, fully reversible flag flip, not a
 * delete, and dressing it as a delete would misstate what it does. The
 * copy under it — supplied by the caller, which knows the period end —
 * carries the actual consequence.
 */
export function CancelResumeButton({
  cancelling,
  disabled,
}: {
  /** True when the subscription is ALREADY set to cancel. */
  cancelling: boolean;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setCancelAtPeriodEnd,
    initialState
  );

  return (
    <form action={formAction}>
      <Flex direction="column" gap="1" align="start">
        <Button
          type="submit"
          name="intent"
          value={cancelling ? "resume" : "cancel"}
          variant={cancelling ? "solid" : "outline"}
          color={cancelling ? undefined : "red"}
          size="2"
          disabled={disabled || pending}
        >
          {pending
            ? "Confirming with Stripe…"
            : cancelling
              ? "Resume my subscription"
              : "Cancel at period end"}
        </Button>
        {state.error ? (
          <Text size="1" color="red">
            {state.error}
          </Text>
        ) : null}
      </Flex>
    </form>
  );
}

/**
 * Opens Stripe's hosted billing portal (payment method, the full invoice
 * archive, tax and address details). A full-page redirect to Stripe and
 * back.
 */
export function BillingPortalButton({ disabled }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(
    openBillingPortal,
    initialState
  );

  return (
    <form action={formAction}>
      <Flex direction="column" gap="1">
        <Button type="submit" variant="outline" disabled={disabled || pending}>
          {pending ? "Opening…" : "Manage billing in Stripe"}
        </Button>
        {state.error ? (
          <Text size="1" color="red">
            {state.error}
          </Text>
        ) : null}
      </Flex>
    </form>
  );
}
