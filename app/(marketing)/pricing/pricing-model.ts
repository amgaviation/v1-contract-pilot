import {
  FEATURES,
  PLAN_TIERS,
  TIER_DISPLAY,
  featuresAddedByTier,
  marketingMatrix,
  type FeatureId,
  type MatrixRow,
  type PlanTier,
} from "@/lib/entitlements";

/**
 * The public pricing page's view-model — a thin, PURE layer over
 * lib/entitlements.ts, which is the single source for tiers, display
 * names, and the feature matrix. This file adds exactly two things the
 * entitlements module deliberately does not carry:
 *
 * 1. THE PUBLIC-CLAIM FILTER. Features that exist in the entitlement
 *    tables but may not appear on a public page yet are removed here, in
 *    one named list, rather than by each page remembering. Today that is
 *    the currency board: it ships dark behind a deployment flag until its
 *    counsel gate clears (docs/PRICING.md §4: "until then it appears on
 *    no public page" — and no "coming soon" either; it is simply absent).
 *    tests/marketing-pricing-model.test.mjs pins the filter.
 *
 * 2. THE DISPLAYED AMOUNTS. lib/entitlements.ts holds no dollar figures,
 *    and the in-app surfaces (welcome picker, billing) read theirs live
 *    from the Stripe Price objects via lib/stripe/prices.ts. The public
 *    page cannot: it must render at build time, on preview deployments,
 *    and on a local machine where no Stripe key exists — so it prints the
 *    owner-confirmed numbers from docs/PRICING.md §3.2 as copy, defined
 *    ONCE here and imported by both marketing pages (landing + pricing).
 *    The Stripe Price object remains what actually charges the card; if
 *    the owner signs different numbers, this table is the only marketing
 *    file that moves. (Solo's $29 is also exactly what the live Price has
 *    charged since launch — docs/PRICING.md §1.)
 *
 * Kept import-pure (no server-only modules, no I/O) so the unit suite
 * can exercise it directly.
 */

/**
 * Features that must not appear on any public page yet. ONLY the
 * counsel-gated currency board today — everything else in the matrix is
 * shipped code (the unit test walks each row's routePatterns against the
 * app tree to prove it). Exported so the test derives its expectations
 * from the same list the pages filter with; "currency" may never leave
 * this list until its gate clears, and the test pins that separately.
 */
export const PUBLIC_CLAIM_FILTER: readonly FeatureId[] = ["currency"];

export function isPubliclyClaimable(feature: FeatureId): boolean {
  return !PUBLIC_CLAIM_FILTER.includes(feature);
}

/** The matrix the pricing page renders — entitlements' rows, filtered. */
export function publicMatrix(): MatrixRow[] {
  return marketingMatrix().filter((row) => isPubliclyClaimable(row.feature));
}

export type PublicFeatureItem = {
  id: FeatureId;
  label: string;
  /** True while entitlements sells the feature as coming, not shipped —
   *  the page must render it as such, never as live software. */
  comingSoon: boolean;
};

function toItem(id: FeatureId): PublicFeatureItem {
  return {
    id,
    label: FEATURES[id].label,
    comingSoon: FEATURES[id].comingSoon ?? false,
  };
}

/** What a tier ADDS over the one below it, as publishable items. */
export function publicTierAdds(tier: PlanTier): PublicFeatureItem[] {
  return featuresAddedByTier(tier).filter(isPubliclyClaimable).map(toItem);
}

/** Everything every tier includes, as publishable items. */
export function publicCoreFeatures(): PublicFeatureItem[] {
  return featuresAddedByTier("solo").filter(isPubliclyClaimable).map(toItem);
}

export const TIER_ORDER: readonly PlanTier[] = PLAN_TIERS;

export { TIER_DISPLAY };
export type { PlanTier, MatrixRow };

/**
 * Displayed amounts — docs/PRICING.md §3.2, the numbers the owner's
 * three-tier order is wired against (integer-dollar copy; the authoritative
 * amounts live on the Stripe Price objects the TIER_PRICE_ENV vars point
 * at). Annual is two months free on every tier.
 */
export type TierPriceCopy = {
  /** e.g. "$29" — the monthly figure. */
  monthly: string;
  /** e.g. "$290" — the annual figure. */
  annual: string;
  /** The unit the figures bill against. */
  unit: "flat" | "per seat";
  /** Business only: the seat floor enforced at checkout. */
  seatMinimum: number | null;
};

export const TIER_PRICE_COPY: Record<PlanTier, TierPriceCopy> = {
  solo: { monthly: "$29", annual: "$290", unit: "flat", seatMinimum: null },
  pro: { monthly: "$49", annual: "$490", unit: "flat", seatMinimum: null },
  business: { monthly: "$39", annual: "$390", unit: "per seat", seatMinimum: 2 },
};

/** The Business floor at the two-seat minimum, spelled once. */
export const BUSINESS_MINIMUM_MONTHLY = "$78";
export const BUSINESS_MINIMUM_ANNUAL = "$780";
