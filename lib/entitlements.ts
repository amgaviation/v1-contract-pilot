/**
 * THE single source for plan-tier logic — tiers, display names, Stripe
 * price env-var NAMES, the feature map, per-route gating, and the
 * marketing-facing matrix. Every surface that mentions a tier reads from
 * here: the welcome plan picker, settings/billing, the upgrade screen,
 * the webhook's price→tier mapping, and (when the design wave rebuilds
 * it) the public pricing page. Renaming a tier for launch is a one-line
 * change to TIER_DISPLAY below and nowhere else.
 *
 * DELIBERATELY PURE. No imports, no "server-only", no I/O — so the unit
 * suite (tests/entitlements.test.mjs) exercises the real module, client
 * components can receive its values as props without dragging server
 * code across the boundary, and the marketing pages can render the
 * matrix at build time. The one function that touches the environment
 * (tierForPriceId) takes the env as a parameter for exactly that reason.
 *
 * WHAT THIS FILE NEVER CONTAINS: a Stripe price ID value, a dollar
 * amount, or a secret. Prices live on the Stripe Price objects the env
 * vars point at (docs/PRICING.md §7: "Price IDs come from env config, by
 * name, never from a literal in code"), and displayed amounts are read
 * from Stripe at render time — see lib/stripe/prices.ts.
 *
 * THE GATING PRINCIPLE (owner's brief, and it is a safety posture, not
 * just packaging): tiers gate BUSINESS DEPTH, never safety records. The
 * logbook, the currency board, and the documents wallet are a pilot's
 * professional records — 14 CFR 61.51 makes the logbook the pilot's own
 * record-keeping duty, and currency facts feed go/no-go decisions. A
 * product that holds those hostage to a billing tier is not one a
 * professional should trust. tests/entitlements.test.mjs pins this: the
 * safety features must stay minTier "solo" forever.
 */

export type PlanTier = "solo" | "pro" | "business";

export const PLAN_TIERS = ["solo", "pro", "business"] as const;

export function isPlanTier(value: unknown): value is PlanTier {
  return value === "solo" || value === "pro" || value === "business";
}

/**
 * Tier comparison: a higher rank includes everything below it. This is a
 * strict ladder on purpose — no à-la-carte add-ons, no feature that a
 * lower tier has and a higher tier lacks.
 */
export const TIER_RANK: Record<PlanTier, number> = {
  solo: 0,
  pro: 1,
  business: 2,
};

/**
 * Display names and one-line pitches. THE one place a tier is named —
 * the owner may rename these before launch and nothing else moves.
 * Copy rules: peer-to-peer, no luxury-jet clichés, no compliance claims
 * (docs/PLAN.md standing gates bind marketing as hard as UI).
 */
export const TIER_DISPLAY: Record<PlanTier, { name: string; blurb: string }> = {
  solo: {
    name: "Solo",
    blurb:
      "The working core: trips, invoices, expenses, logbook, and documents. Log the trip once.",
  },
  pro: {
    name: "Pro",
    blurb:
      "The business office: recurring invoices, estimates, client statements, bank statement import, and the sales tax report.",
  },
  business: {
    name: "Business",
    blurb:
      "The full back office: double-entry accounting with reconciliation and financial statements, plus priority support.",
  },
};

export type BillingInterval = "monthly" | "annual";

export const BILLING_INTERVALS = ["monthly", "annual"] as const;

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === "monthly" || value === "annual";
}

/**
 * The env-var NAME that holds each tier's Stripe price ID. Names only —
 * values live in the Vercel project and .env.local, never in code, and
 * an EMPTY value must be treated as unset (docs/BILLING.md: "an unset
 * variable can't be mistaken for a configured one"). The webhook maps a
 * subscription's price back to a tier through this same table, so a
 * checkout and its provisioning can never disagree about what was sold.
 */
export const TIER_PRICE_ENV: Record<PlanTier, Record<BillingInterval, string>> = {
  solo: {
    monthly: "STRIPE_PRICE_ID_SOLO",
    annual: "STRIPE_PRICE_ID_SOLO_ANNUAL",
  },
  pro: {
    monthly: "STRIPE_PRICE_ID_PRO",
    annual: "STRIPE_PRICE_ID_PRO_ANNUAL",
  },
  business: {
    monthly: "STRIPE_PRICE_ID_BUSINESS",
    annual: "STRIPE_PRICE_ID_BUSINESS_ANNUAL",
  },
};

/**
 * Reverse-maps a Stripe price ID onto the tier and interval it sells.
 * This is how the webhook decides plan_tier: the subscription's price is
 * Stripe's own record of what the customer is paying for, so upgrades
 * and downgrades take effect on Stripe's say-so, never on a UI claim.
 *
 * `env` is a parameter (defaulting to process.env) so the mapping is
 * unit-testable without mutating global state. A falsy env VALUE never
 * matches: an unset or empty variable must not equate to any price id,
 * and `null`/`""` price ids must never match each other.
 */
export function tierForPriceId(
  priceId: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): { tier: PlanTier; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const tier of PLAN_TIERS) {
    for (const interval of BILLING_INTERVALS) {
      const configured = env[TIER_PRICE_ENV[tier][interval]];
      if (configured && configured === priceId) {
        return { tier, interval };
      }
    }
  }
  return null;
}

/**
 * Every feature the tiers are described by, gated or not.
 *
 * `minTier` is the lowest tier that includes the feature. "solo" means
 * every account has it — those rows exist so the marketing matrix and
 * the billing screen can describe the whole product from one source,
 * and so the never-gate-safety-records rule is pinned in data a test
 * can read rather than in prose.
 *
 * `routePatterns` are the app paths the feature lives at, for
 * enforcement by route (featureForPath below). Segments are literal
 * except "*", which matches exactly one path segment (for /clients/:id/
 * statement). A pattern gates itself and everything nested under it.
 * Empty array = the feature has no route of its own (a flag, or a
 * placeholder like multi-seat).
 */
export type FeatureId =
  | "clients"
  | "trips"
  | "invoices"
  | "expenses"
  | "documents"
  | "logbook"
  | "currency"
  | "reports_core"
  | "recurring_invoices"
  | "estimates"
  | "client_statements"
  | "bank_import"
  | "sales_tax_report"
  | "account_export"
  | "accounting"
  | "multi_seat"
  | "priority_support";

export type FeatureDef = {
  /** Marketing/UI label. Pilot-correct vocabulary; no overclaiming. */
  label: string;
  /** Lowest tier that includes the feature. */
  minTier: PlanTier;
  /** App routes this feature lives at (see routePatterns doc above). */
  routePatterns: readonly string[];
  /**
   * True while the feature is sold as "coming" rather than shipped —
   * the matrix must render it honestly (docs/PRICING.md §6: nothing on
   * the pricing page may imply unshipped features exist).
   */
  comingSoon?: boolean;
};

export const FEATURES: Record<FeatureId, FeatureDef> = {
  // --------------------------------------------------------------- every tier
  // The working core plus every safety-record surface. NEVER gate the
  // logbook, currency, or documents — see the file header.
  clients: {
    label: "Clients, day rates & per-operator records",
    minTier: "solo",
    routePatterns: [],
  },
  trips: {
    label: "Trips with day types & rate cards",
    minTier: "solo",
    routePatterns: [],
  },
  invoices: {
    label: "Invoices with PDF & payment links",
    minTier: "solo",
    routePatterns: [],
  },
  expenses: {
    label: "Expenses, receipts & mileage",
    minTier: "solo",
    routePatterns: [],
  },
  documents: {
    label: "Documents wallet with expiry tracking",
    minTier: "solo",
    routePatterns: [],
  },
  logbook: {
    label: "Logbook — entries, import & export",
    minTier: "solo",
    routePatterns: [],
  },
  currency: {
    label: "Currency board",
    minTier: "solo",
    routePatterns: [],
  },
  reports_core: {
    label: "Profit & loss, quarterly & year-end reports",
    minTier: "solo",
    routePatterns: [],
  },

  // ---------------------------------------------------------------- Pro adds
  recurring_invoices: {
    label: "Recurring invoices",
    minTier: "pro",
    routePatterns: ["/invoices/recurring"],
  },
  estimates: {
    label: "Estimates",
    minTier: "pro",
    routePatterns: ["/estimates"],
  },
  client_statements: {
    label: "Client statements",
    minTier: "pro",
    routePatterns: ["/clients/*/statement"],
  },
  bank_import: {
    label: "Bank statement import (CSV & OFX)",
    minTier: "pro",
    routePatterns: ["/expenses/import", "/expenses/transactions"],
  },
  sales_tax_report: {
    label: "Sales tax report",
    minTier: "pro",
    routePatterns: ["/reports/sales-tax"],
  },
  account_export: {
    // EVERY tier, deliberately, and this line has been moved once already —
    // it shipped as minTier "pro" and a reviewer caught the contradiction:
    // the downgrade promise everywhere in this product is "your data is
    // never held hostage — read-only plus export", and the quality bar's
    // full-data-exit rule says the same. An export you must pay to reach is
    // neither. Gating export is the one upsell this product refuses.
    label: "Account-wide CSV export",
    minTier: "solo",
    routePatterns: ["/settings/export"],
  },

  // ----------------------------------------------------------- Business adds
  accounting: {
    label:
      "Accounting — chart of accounts, ledger, reconciliation, balance sheet & cash flow",
    minTier: "business",
    routePatterns: ["/accounting"],
  },
  multi_seat: {
    // Placeholder: pilot.account_members already carries owner/member/
    // bookkeeper roles, but there is no invite UI yet. Sold honestly.
    label: "Additional seats for a bookkeeper or second pilot",
    minTier: "business",
    routePatterns: [],
    comingSoon: true,
  },
  priority_support: {
    label: "Priority support",
    minTier: "business",
    routePatterns: [],
  },
};

export function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === "string" && value in FEATURES;
}

/** True when `tier` includes `feature`. */
export function isEntitled(tier: PlanTier, feature: FeatureId): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURES[feature].minTier];
}

/** Every feature whose minTier is exactly `tier` (what this tier ADDS). */
export function featuresAddedByTier(tier: PlanTier): FeatureId[] {
  return (Object.keys(FEATURES) as FeatureId[]).filter(
    (id) => FEATURES[id].minTier === tier
  );
}

/**
 * Matches one route pattern against a concrete pathname. The pattern's
 * segments must prefix the path's segments; "*" matches any single
 * segment. So the client-statement pattern gates /clients/123/statement
 * and /clients/123/statement/print, and "/estimates" gates /estimates
 * and everything under it — but never /estimates-somethingelse, because
 * matching is per-segment, not per-character.
 */
function patternMatchesPath(pattern: string, pathname: string): boolean {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (pathSegments.length < patternSegments.length) return false;
  return patternSegments.every(
    (seg, i) => seg === "*" || seg === pathSegments[i]
  );
}

/**
 * The gated feature (if any) that owns a pathname. Returns null for
 * ungated paths — including every solo-tier feature's routes, which
 * deliberately do not appear in any routePatterns list, so a bug here
 * can only ever over-ask for a tier, never lock a safety record.
 *
 * The most specific (longest) matching pattern wins, so a gated child
 * (/invoices/recurring) is found even though its parent (/invoices) is
 * ungated.
 */
export function featureForPath(pathname: string): FeatureId | null {
  let best: { id: FeatureId; segments: number } | null = null;
  for (const id of Object.keys(FEATURES) as FeatureId[]) {
    for (const pattern of FEATURES[id].routePatterns) {
      if (!patternMatchesPath(pattern, pathname)) continue;
      const segments = pattern.split("/").filter(Boolean).length;
      if (!best || segments > best.segments) best = { id, segments };
    }
  }
  return best?.id ?? null;
}

/**
 * The marketing-facing matrix: one row per feature, in display order,
 * with per-tier availability. The public pricing page renders from THIS
 * — not from its own hand-maintained list — so the pricing copy and the
 * enforcement can never disagree about what a tier includes.
 */
export type MatrixRow = {
  feature: FeatureId;
  label: string;
  comingSoon: boolean;
  /** availability[tier] — true when the tier includes the feature. */
  availability: Record<PlanTier, boolean>;
};

const MATRIX_ORDER: readonly FeatureId[] = [
  "trips",
  "invoices",
  "expenses",
  "clients",
  "logbook",
  "currency",
  "documents",
  "reports_core",
  "recurring_invoices",
  "estimates",
  "client_statements",
  "bank_import",
  "sales_tax_report",
  "account_export",
  "accounting",
  "multi_seat",
  "priority_support",
];

export function marketingMatrix(): MatrixRow[] {
  return MATRIX_ORDER.map((feature) => ({
    feature,
    label: FEATURES[feature].label,
    comingSoon: FEATURES[feature].comingSoon ?? false,
    availability: {
      solo: isEntitled("solo", feature),
      pro: isEntitled("pro", feature),
      business: isEntitled("business", feature),
    },
  }));
}

/**
 * The downgrade promise, stated once so the billing screen and the
 * upgrade screen say the same thing: nothing is deleted on a downgrade —
 * the screens a lower tier doesn't include stop accepting new work and
 * offer the upgrade instead, and everything already recorded stays
 * readable in exports and reports and comes straight back on upgrade.
 */
export const DOWNGRADE_NOTE =
  "Downgrading never deletes anything. Records from features outside your new plan are preserved, and those screens come straight back the moment you upgrade again — they are your records, not ours. Your logbook, currency board, and documents are never gated on any plan.";
