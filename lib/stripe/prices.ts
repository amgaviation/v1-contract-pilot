import "server-only";
import { getStripe } from "./server";
import { formatCents } from "@/lib/format";
import {
  BILLING_INTERVALS,
  PLAN_TIERS,
  TIER_PRICE_ENV,
  seatsForTier,
  type BillingInterval,
  type PlanTier,
} from "@/lib/entitlements";

/**
 * Platform-billing price lookup — the ONLY bridge between the tier
 * vocabulary (lib/entitlements.ts, env-var NAMES) and actual Stripe
 * Price objects (env-var VALUES plus the amounts Stripe holds).
 *
 * No amount and no price ID appears in code anywhere in this product
 * (docs/PRICING.md §7). The three welcome/billing surfaces that show a
 * dollar figure get it from HERE, which reads it from the live Price
 * object — the thing that actually charges the card — so the label a
 * pilot reads and the amount Stripe bills are the same fact, not two
 * hand-synced copies. That replaces the old PRICE_LABEL constant, which
 * was exactly such a hand-synced copy and said so in its own comment.
 */

/**
 * The configured price ID for a tier+interval, or null. An EMPTY env
 * value reads as unconfigured — docs/BILLING.md's rule that an unset
 * variable must never pass for a configured one.
 */
export function priceIdFor(tier: PlanTier, interval: BillingInterval): string | null {
  const value = process.env[TIER_PRICE_ENV[tier][interval]];
  return value ? value : null;
}

export type PriceDisplay = {
  /**
   * The PER-UNIT label — e.g. "$29/month", "$290/year", "$39/month" for
   * one Business seat. Whole dollars drop the ".00". Kept for callers
   * that want the unit figure, but a pre-purchase surface must show
   * `chargeLabel` (the actual first charge), never this, for a per-seat
   * tier — see below.
   */
  label: string;
  /** Per-unit amount in cents (immutable on the Stripe Price). */
  amountCents: number;
  /**
   * Seats a new subscription for this tier starts at (seatsForTier): 1
   * for the flat tiers, 2 for Business's two-seat minimum.
   */
  seats: number;
  /** amountCents × seats — the amount Stripe actually bills up front. */
  totalCents: number;
  /**
   * The label a PRE-PURCHASE screen must show, because it equals what
   * Stripe will charge: the unit label for a flat tier ("$29/month"), the
   * ×seats total for a per-seat tier ("$78/month" for Business at two
   * seats). Finding 1 was welcome showing this tier's "$39/month" unit
   * label while checkout submitted quantity 2 → a $78 subscription; the
   * number the customer read did not equal the charge. This is that fix,
   * in the one place every dollar figure on the welcome/billing surfaces
   * comes from.
   */
  chargeLabel: string;
  /**
   * The per-seat + minimum note for a per-seat tier ("$39/seat · 2-seat
   * minimum"), or null for a flat tier — so a card can spell the total
   * AND how it is composed.
   */
  seatNote: string | null;
};

/**
 * Stripe Price amounts are immutable (a price change is a NEW Price
 * object pointed at by the env var), so a by-ID cache can never serve a
 * stale amount — a changed amount arrives as a changed ID and misses.
 * Failures are deliberately NOT cached: a Stripe blip should heal on the
 * next render, not stick until redeploy.
 */
const cache = new Map<string, PriceDisplay>();

async function displayFor(
  tier: PlanTier,
  interval: BillingInterval
): Promise<PriceDisplay | null> {
  const id = priceIdFor(tier, interval);
  if (!id) return null;
  const hit = cache.get(id);
  if (hit) return hit;

  try {
    const price = await getStripe().prices.retrieve(id);
    if (typeof price.unit_amount !== "number") {
      // Tiered/metered prices have no single unit_amount. Nothing this
      // product sells is shaped that way, so treat it as unconfigured
      // rather than invent a figure.
      console.error(`[stripe] price ${id} has no unit_amount — not displayable.`);
      return null;
    }
    const per = interval === "monthly" ? "month" : "year";
    const unitDollars = formatCents(price.unit_amount).replace(/\.00$/, "");
    const seats = seatsForTier(tier);
    const totalCents = price.unit_amount * seats;
    const totalDollars = formatCents(totalCents).replace(/\.00$/, "");
    const display: PriceDisplay = {
      label: `${unitDollars}/${per}`,
      amountCents: price.unit_amount,
      seats,
      totalCents,
      // Flat tiers: the total IS the unit, so chargeLabel === label and
      // seatNote is null. Per-seat tiers (Business): chargeLabel is the
      // ×seats total and seatNote spells the composition.
      chargeLabel: seats > 1 ? `${totalDollars}/${per}` : `${unitDollars}/${per}`,
      seatNote: seats > 1 ? `${unitDollars}/seat · ${seats}-seat minimum` : null,
    };
    cache.set(id, display);
    return display;
  } catch (err) {
    // Same posture as startCheckout: the raw Stripe message is a
    // configuration disclosure ("No such price: 'price_…'"), logged
    // server-side where it diagnoses, never rendered.
    console.error(
      `[stripe] could not retrieve price for ${tier}/${interval}`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

export type TierPriceLabels = Record<
  PlanTier,
  Record<BillingInterval, PriceDisplay | null>
>;

/**
 * Every configured tier price's display label, fetched concurrently.
 * A null slot means "not configured or not reachable right now" — the
 * caller renders that tier without an amount (or unavailable), never a
 * made-up number and never a crash.
 */
export async function tierPriceLabels(): Promise<TierPriceLabels> {
  const entries = await Promise.all(
    PLAN_TIERS.map(async (tier) => {
      const [monthly, annual] = await Promise.all(
        BILLING_INTERVALS.map((interval) => displayFor(tier, interval))
      );
      return [tier, { monthly, annual }] as const;
    })
  );
  return Object.fromEntries(entries) as TierPriceLabels;
}
