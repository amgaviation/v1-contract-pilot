"use client";

import { useState } from "react";
import { useActionState } from "react";
import { LInput, LSelect } from "@/components/ledger/forms";
import { PLAN_TIERS, TIER_DISPLAY } from "@/lib/entitlements";
import { FormError, SubmitButton } from "../auth-parts";
import { startTestBypass, type BypassState } from "./test-bypass-actions";

const initialState: BypassState = { error: null };

/**
 * The discreet trigger for the PIN-gated test bypass
 * (test-bypass-actions.ts owns the gates; this renders nothing unless the
 * server said the env var is set). A small unlabelled dot under the
 * footer: invisible to anyone not looking for it, findable by the owner
 * who is. The PIN is the actual protection — the obscurity is only there
 * to keep the trial screen clean.
 */
export function TestBypass() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(startTestBypass, initialState);

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Internal testing"
          onClick={() => setOpen(true)}
          className="px-2 py-1 text-caption text-ink-3 opacity-30 hover:opacity-100"
        >
          &middot;
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-card border border-hair bg-sunk p-4"
    >
      <p className="text-caption text-ink-3">
        Internal testing: creates a comped account with no card and no
        subscription. PIN required.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <LInput
          type="password"
          name="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="PIN"
          required
          disabled={pending}
          className="w-28"
        />
        <LSelect name="tier" defaultValue="solo" disabled={pending} className="w-36">
          {PLAN_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {TIER_DISPLAY[tier].name}
            </option>
          ))}
        </LSelect>
      </div>
      <FormError message={state.error} />
      <SubmitButton
        pending={pending}
        idle="Continue without card"
        busy="Creating test account…"
        variant="quiet"
      />
    </form>
  );
}
