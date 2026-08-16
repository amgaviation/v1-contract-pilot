"use client";

import { useActionState } from "react";
import { LButton } from "@/components/ledger";
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
    return <p className="text-caption text-ink-3">Not available yet.</p>;
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="tier" value={tier} />
      <div className="flex flex-col gap-2">
        {monthlyLabel !== null ? (
          <LButton
            type="submit"
            name="interval"
            value="monthly"
            disabled={disabled || pending}
            variant={direction === "Upgrade" ? "primary" : "outline"}
          >
            {pending ? "Confirming with Stripe…" : `${direction}: ${monthlyLabel}`}
          </LButton>
        ) : null}
        {annualLabel !== null ? (
          <LButton
            type="submit"
            name="interval"
            value="annual"
            disabled={disabled || pending}
            variant="outline"
          >
            {pending ? "Confirming with Stripe…" : `${direction}: ${annualLabel}`}
          </LButton>
        ) : null}
        {state.error ? (
          <p className="text-caption font-medium text-crit">{state.error}</p>
        ) : null}
      </div>
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
    return <p className="text-caption text-ink-3">Not available yet.</p>;
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="tier" value={tier} />
      <div className="flex flex-col gap-2">
        {monthlyLabel !== null ? (
          <LButton
            type="submit"
            name="interval"
            value="monthly"
            disabled={disabled || pending}
            variant="primary"
          >
            {pending ? "Starting checkout…" : `Resubscribe: ${monthlyLabel}`}
          </LButton>
        ) : null}
        {annualLabel !== null ? (
          <LButton
            type="submit"
            name="interval"
            value="annual"
            disabled={disabled || pending}
            variant="outline"
          >
            {pending ? "Starting checkout…" : `Resubscribe: ${annualLabel}`}
          </LButton>
        ) : null}
        {state.error ? (
          <p className="text-caption font-medium text-crit">{state.error}</p>
        ) : null}
      </div>
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
      <div className="flex flex-col gap-1">
        <LButton type="submit" variant="outline" size="sm" disabled={disabled || pending}>
          {pending ? "Confirming with Stripe…" : label}
        </LButton>
        {state.error ? (
          <p className="text-caption font-medium text-crit">{state.error}</p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Cancel-at-period-end and its exact inverse, Resume. One component for
 * both because they are one Stripe field (see setCancelAtPeriodEnd), and
 * rendering them as separate controls would invite the state where both
 * are on screen at once.
 *
 * The destructive direction is the `danger` variant rather than a
 * neutral outline: it is a scheduled, fully reversible flag flip, not a
 * delete, but it still needs to read as the one action on this card that
 * changes what happens to the subscription. The copy under it — supplied
 * by the caller, which knows the period end — carries the actual
 * consequence.
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
      <div className="flex flex-col items-start gap-1">
        <LButton
          type="submit"
          name="intent"
          value={cancelling ? "resume" : "cancel"}
          variant={cancelling ? "primary" : "danger"}
          disabled={disabled || pending}
        >
          {pending
            ? "Confirming with Stripe…"
            : cancelling
              ? "Resume my subscription"
              : "Cancel at period end"}
        </LButton>
        {state.error ? (
          <p className="text-caption font-medium text-crit">{state.error}</p>
        ) : null}
      </div>
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
      <div className="flex flex-col gap-1">
        <LButton type="submit" variant="outline" disabled={disabled || pending}>
          {pending ? "Opening…" : "Manage billing in Stripe"}
        </LButton>
        {state.error ? (
          <p className="text-caption font-medium text-crit">{state.error}</p>
        ) : null}
      </div>
    </form>
  );
}
