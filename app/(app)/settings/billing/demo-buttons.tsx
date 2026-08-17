"use client";

import { useActionState } from "react";
import { LButton } from "@/components/ledger";
import type { PlanTier } from "@/lib/entitlements";
import type { BillingActionState } from "./actions";
import { demoChangePlan, demoSetCancelAtPeriodEnd } from "./demo-actions";

const initialState: BillingActionState = { error: null };

/**
 * The demo equivalent of ChangePlanButtons (billing-buttons.tsx) — one
 * button, not two. A comped account has no Stripe subscription and
 * therefore no monthly/annual interval to pick between; there is nothing
 * for a second button to mean here.
 */
export function DemoChangePlanButton({
  tier,
  direction,
  label,
  disabled,
}: {
  tier: PlanTier;
  direction: "Upgrade" | "Downgrade";
  label: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(demoChangePlan, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="tier" value={tier} />
      <div className="flex flex-col gap-1">
        <LButton
          type="submit"
          disabled={disabled || pending}
          variant={direction === "Upgrade" ? "primary" : "outline"}
        >
          {pending ? "Switching…" : label}
        </LButton>
        {state.error ? (
          <p className="text-caption font-medium text-crit">{state.error}</p>
        ) : null}
      </div>
    </form>
  );
}

/** Demo equivalent of CancelResumeButton — same one-field-two-directions
 *  shape, flipping demo_cancel_at_period_end instead of a Stripe field. */
export function DemoCancelResumeButton({
  cancelling,
  disabled,
}: {
  cancelling: boolean;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    demoSetCancelAtPeriodEnd,
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
            ? "Updating…"
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
