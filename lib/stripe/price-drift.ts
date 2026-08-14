import "server-only";
import { getStripe } from "./server";
import { parseDollarsToCents } from "@/lib/format";
import {
  BILLING_INTERVALS,
  PLAN_TIERS,
  TIER_PRICE_ENV,
  seatsForTier,
  type BillingInterval,
  type PlanTier,
} from "@/lib/entitlements";
import { TIER_PRICE_COPY } from "@/app/(marketing)/pricing/pricing-model";

/**
 * THE PRICE-DRIFT GUARD.
 *
 * app/(marketing)/pricing/pricing-model.ts prints TIER_PRICE_COPY as
 * static text — it has to, since the public pricing page renders at build
 * time with no Stripe key available. Nothing before this file compared
 * that printed copy against the live Stripe Price objects the six
 * STRIPE_PRICE_ID_* env vars actually point at, so a Price recreated at a
 * different amount (a placeholder test-mode ladder left in place past
 * launch, or a fat-fingered dashboard edit) could silently diverge from
 * the public page forever: the pilot reads one number on the pricing page
 * and Stripe charges another at checkout, with nothing in the repo ever
 * catching it (docs/PLAN-GATES.md records exactly this happening once,
 * with the placeholder $29/$49/$89 ladder).
 *
 * THIS FILE NEVER CHOOSES A NUMBER. It only compares two numbers that
 * already exist — TIER_PRICE_COPY (the public claim) and the live Price's
 * unit_amount (what Stripe actually bills) — and reports where they
 * disagree. Nothing here may change a price; that is the owner's call
 * (docs/PRICING.md §7: "a price change is a new Price object").
 *
 * Used by scripts/billing-verify.mjs (a CI/local check with Stripe
 * credentials) and by the settings/billing owner banner (a live check on
 * every render, since a misconfigured env var is exactly the kind of
 * mistake that ships to production and sits there unnoticed).
 */

export type PriceDriftMismatch = {
  tier: PlanTier;
  interval: BillingInterval;
  envVar: string;
  priceId: string;
  /** What TIER_PRICE_COPY claims, in cents, per unit (per seat for Business). */
  publicCents: number;
  /** What the live Stripe Price actually charges per unit, in cents. */
  liveCents: number;
};

export type PriceDriftResult = {
  /** False when nothing could be checked at all (no Stripe key). */
  checked: boolean;
  /** True when every configured price agrees with the public copy. */
  ok: boolean;
  mismatches: PriceDriftMismatch[];
  /** Tier/interval pairs with no configured price — not a mismatch, nothing to compare. */
  unconfigured: { tier: PlanTier; interval: BillingInterval; envVar: string }[];
  /** Price ids that could not be retrieved from Stripe at all. */
  unreachable: { tier: PlanTier; interval: BillingInterval; envVar: string; priceId: string }[];
};

/** TIER_PRICE_COPY's dollar string, in cents, for one tier+interval. */
function publicCentsFor(tier: PlanTier, interval: BillingInterval): number | null {
  const copy = TIER_PRICE_COPY[tier];
  const dollars = interval === "monthly" ? copy.monthly : copy.annual;
  const cents = parseDollarsToCents(dollars);
  return typeof cents === "number" ? cents : null;
}

/**
 * Compares every configured Stripe Price against TIER_PRICE_COPY. Safe to
 * call with no Stripe key configured (checked: false) — this is a guard
 * against drift, not a hard dependency the rest of billing needs to run.
 */
export async function checkPriceDrift(): Promise<PriceDriftResult> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { checked: false, ok: true, mismatches: [], unconfigured: [], unreachable: [] };
  }

  const stripe = getStripe();
  const mismatches: PriceDriftMismatch[] = [];
  const unconfigured: PriceDriftResult["unconfigured"] = [];
  const unreachable: PriceDriftResult["unreachable"] = [];

  await Promise.all(
    PLAN_TIERS.flatMap((tier) =>
      BILLING_INTERVALS.map(async (interval) => {
        const envVar = TIER_PRICE_ENV[tier][interval];
        const priceId = process.env[envVar];
        if (!priceId) {
          unconfigured.push({ tier, interval, envVar });
          return;
        }

        const publicCents = publicCentsFor(tier, interval);
        if (publicCents === null) return; // malformed TIER_PRICE_COPY entry — not this guard's job

        try {
          const price = await stripe.prices.retrieve(priceId);
          if (typeof price.unit_amount !== "number") {
            unreachable.push({ tier, interval, envVar, priceId });
            return;
          }
          if (price.unit_amount !== publicCents) {
            mismatches.push({
              tier,
              interval,
              envVar,
              priceId,
              publicCents,
              liveCents: price.unit_amount,
            });
          }
        } catch (err) {
          console.error(
            `[stripe] price-drift check could not retrieve ${envVar} (${priceId})`,
            err instanceof Error ? err.message : String(err)
          );
          unreachable.push({ tier, interval, envVar, priceId });
        }
      })
    )
  );

  return {
    checked: true,
    ok: mismatches.length === 0,
    mismatches,
    unconfigured,
    unreachable,
  };
}

/** One human-readable line per mismatch, for a log line or a banner list. */
export function describeMismatch(m: PriceDriftMismatch): string {
  const seats = seatsForTier(m.tier);
  const publicTotal = m.publicCents * seats;
  const liveTotal = m.liveCents * seats;
  return (
    `${m.tier}/${m.interval} (${m.envVar}): public copy says ${(m.publicCents / 100).toFixed(2)}` +
    `/unit (${(publicTotal / 100).toFixed(2)} at ${seats} seat${seats > 1 ? "s" : ""}), ` +
    `Stripe Price ${m.priceId} actually charges ${(m.liveCents / 100).toFixed(2)}/unit ` +
    `(${(liveTotal / 100).toFixed(2)} at ${seats} seats)`
  );
}
