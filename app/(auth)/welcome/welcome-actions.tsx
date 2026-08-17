"use client";

import { useState } from "react";
import { useActionState } from "react";
import { cn } from "@/lib/ledger/cn";
import { LSegmented } from "@/components/ledger/segmented";
import type { BillingInterval, PlanTier } from "@/lib/entitlements";
import { FormError, SubmitButton } from "../auth-parts";
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

/**
 * THE 2026-08 PASS OVER THIS FILE WAS VISUAL ONLY. Every branch below —
 * the first-available default, the interval switch that re-homes an
 * illegal selection, the disabled unavailable card, the hidden tier and
 * interval fields the server action re-validates — is unchanged. The
 * "Unavailable" state in particular is load-bearing: it is what a tier
 * with no configured Stripe price renders as, and the alternative is a
 * made-up number on the screen where a card gets entered.
 */
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
    <div className="flex flex-col gap-4">
      {anyAnnual ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-body-s font-medium text-ink">Billing</span>
          <LSegmented
            value={interval}
            ariaLabel="Billing interval"
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "annual", label: "Annual" },
            ]}
            onChange={(value) => {
              setInterval(value);
              // Keep the selection legal: if the current tier has no
              // price at the new interval, move to the first that does.
              const current = options.find((o) => o.tier === tier);
              if (current && current.price[value] === null) {
                const fallback = options.find((o) => o.price[value] !== null);
                if (fallback) setTier(fallback.tier);
              }
            }}
          />
        </div>
      ) : null}

      <div role="radiogroup" aria-label="Plan" className="flex flex-col gap-2">
        {options.map((option) => {
          const label = option.price[interval];
          const seatNote = option.seatNote[interval];
          const unavailable = label === null;
          const active = tier === option.tier;
          return (
            <label
              key={option.tier}
              className={cn(
                "flex flex-col gap-1 rounded-card border p-4 transition-colors",
                unavailable
                  ? "cursor-not-allowed border-hair bg-sunk opacity-60"
                  : "cursor-pointer bg-card hover:border-hair-strong",
                active && !unavailable ? "border-accent bg-accent-soft" : "border-hair-strong"
              )}
            >
              <input
                type="radio"
                name="tier-choice"
                value={option.tier}
                checked={active}
                disabled={unavailable}
                onChange={() => {
                  if (!unavailable) setTier(option.tier);
                }}
                className="sr-only"
              />
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-lead font-bold text-ink">{option.name}</span>
                <div className="flex shrink-0 flex-col items-end gap-0">
                  <span className="tnum-l text-body font-medium text-ink">
                    {unavailable ? "Unavailable" : label}
                  </span>
                  {/* The per-seat breakdown for a per-seat tier, so the
                      "$78/month" total above is shown WITH how it is
                      composed — never a bare "$39/month" that checkout
                      would then double (Finding 1). */}
                  {!unavailable && seatNote ? (
                    <span className="text-caption text-ink-3">{seatNote}</span>
                  ) : null}
                </div>
              </div>
              <span className="text-caption text-ink-3">{option.blurb}</span>
            </label>
          );
        })}
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        {/* The chosen tier/interval ride as hidden fields; the server
            action re-validates both and resolves the PRICE itself, so a
            tampered value can only change what gets paid for — the
            webhook maps the tier from the price, never from the form. */}
        <input type="hidden" name="tier" value={tier} />
        <input type="hidden" name="interval" value={interval} />

        <FormError message={state.error} />

        <SubmitButton
          pending={pending}
          idle={`Start your ${trialDays}-day trial`}
          busy="Opening checkout…"
          disabled={pending || selectedLabel === null}
        />

        {/*
          "cancel anytime" stays out of this copy on purpose (see the git
          history of this file): the cancel path lives in Stripe's billing
          portal via Settings → Billing, which exists only once the account
          does — this screen belongs to someone who doesn't have one yet.
        */}
        <p className="text-center text-caption text-ink-3">
          {selectedLabel
            ? `${selectedLabel}${
                selectedSeatNote ? ` (${selectedSeatNote})` : ""
              } after the trial. Card required now.`
            : "Card required now."}
        </p>
      </form>
    </div>
  );
}
