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
      "The working core: trips, invoices, expenses, logbook, and documents.",
  },
  pro: {
    name: "Pro",
    blurb:
      "The business office: recurring invoices, estimates, client statements, bank statement import, and the sales tax report.",
  },
  business: {
    name: "Business",
    // The blurb used to close "…plus priority support". A blurb is prose the
    // matrix cannot annotate, so it asserted as live the one row that is now
    // comingSoon (see priority_support in FEATURES below) — the flag would
    // mark the row honestly while the card above it still promised the
    // thing. It comes back when the channel does.
    blurb:
      "The full back office: double-entry accounting with reconciliation and financial statements.",
  },
};

export type BillingInterval = "monthly" | "annual";

export const BILLING_INTERVALS = ["monthly", "annual"] as const;

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === "monthly" || value === "annual";
}

/**
 * The seat quantity a NEW subscription for `tier` starts at — the ONE
 * source both billing paths read so the checkout quantity and the
 * plan-change quantity can never disagree about the floor.
 *
 * Business is licensed per seat with a two-seat minimum (docs/PRICING.md
 * §3.2 and §7: "Business is one Price with quantity = seats, minimum 2
 * enforced in the checkout code, not by trusting the widget"); the flat
 * tiers are a single unit. Before this helper the checkout path spelled
 * `tier === "business" ? 2 : 1` inline while settings/billing's
 * changePlan omitted quantity entirely and left Business at 1 — a real
 * $39-instead-of-$78 underbill on every Solo/Pro→Business upgrade. A
 * plan-change that must not REDUCE an existing multi-seat account takes
 * `Math.max(seatsForTier(tier), currentQuantity)` for Business; a fresh
 * checkout takes this value directly.
 */
export function seatsForTier(tier: PlanTier): number {
  return tier === "business" ? 2 : 1;
}

/**
 * The `pilot.accounts.status` values under which an account may still
 * WRITE. This is the read-only-on-lapse policy stated in code so
 * requireAccount (lib/supabase/account.ts) and the account-status notice
 * read the same fact — the product's promise (docs/PRICING.md §5) is that
 * a canceled or lapsed account goes READ-ONLY with export retained, never
 * that its records are deleted or that it keeps creating new ones.
 *
 * It is an ALLOW-LIST on purpose (fail closed): only a live trial or an
 * active subscription may write. Everything else in the status CHECK
 * (`past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`,
 * `paused` — the full Stripe enum the Phase-1 migration pins) is
 * read-only, so a status this file has not thought about is refused a
 * write rather than granted one by omission. `past_due` is included in
 * the read-only set deliberately (Finding 2/3's brief): a failed renewal
 * stops new work and nudges the owner to the billing portal, while every
 * record stays readable and exportable.
 *
 * ONE PATH IN THIS PRODUCT DOES DELETE, and it is not this one: an expired,
 * unpaid HOLD clears the account's commercial records (20260818200000). It
 * is never reached by a lapse, a failed card or a cancellation — only by a
 * pilot who deliberately parked the account and then let the window close —
 * and it is bounded in kind as well as in cause: no logbook, document,
 * aircraft or qualification record is reachable from it on any code path.
 * Read-only-on-lapse is still exactly what this allow-list means.
 */
export const ACCOUNT_WRITABLE_STATUSES = ["trialing", "active"] as const;

export function isWritableStatus(status: string): boolean {
  return (ACCOUNT_WRITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether an account is closed for writes.
 *
 * TWO INDEPENDENT REASONS, and the second is not redundant.
 *
 *   `status`          Stripe's subscription state, mirrored by the webhook.
 *   `deactivated_at`  the OWNER said stop, in this product, just now.
 *
 * The second exists because pilot.deactivate_account CANNOT write `status`:
 * pilot.protect_account_billing_columns() reserves that column for the
 * service role, so the webhook is its only writer. (The first version of
 * that function tried anyway and failed on every call — see
 * 20260818140000_deactivate_without_status_write.sql.) The server action
 * cancels at Stripe, stamps deactivated_at and returns; the resulting
 * customer.subscription.deleted lands some time later. Between those two
 * moments `status` still reads 'active', and consulting it alone would keep
 * a deactivated account writable for the length of that window.
 *
 * Lives here rather than in lib/supabase/account.ts so it is a pure
 * function over a row shape, unit-testable without next/navigation and
 * server-only in the import graph. account.ts re-exports it.
 */
export function accountIsReadOnly(account: {
  status: string;
  deactivated_at?: string | null;
  hold_started_at?: string | null;
}): boolean {
  if (account.deactivated_at) return true;

  // A HOLD IS READ-ONLY, and Stripe cannot say so on its behalf. The pinned
  // SDK has no subscriptions.pause(); the available mechanism is
  // pause_collection, which deliberately keeps the subscription `active` and
  // the customer's access intact ("stop charging them, keep serving them").
  // A hold is the opposite bargain — the pilot stops paying and stops
  // writing — so `status` reads 'active' for its entire duration and the
  // local column is the only thing that knows.
  //
  // Any non-null hold_started_at counts, deliberately, without comparing
  // hold_ends_at to now(). A hold whose window has closed but whose
  // scheduled pass has not run yet is still a hold; treating it as writable
  // for those hours would let a lapsed account create records that the very
  // next pass deletes.
  if (account.hold_started_at) return true;

  return !isWritableStatus(account.status);
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
    label: "Logbook: entries, import & export",
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
      "Accounting: chart of accounts, ledger, reconciliation, balance sheet & cash flow",
    minTier: "business",
    // The balance-sheet and cash-flow reports (plus their CSV exports)
    // live under /reports/*, not /accounting — they are gated today only
    // by their own inline requireEntitlement('accounting', …) calls, but
    // featureForPath is documented as THE one route→feature map (the seam
    // any future path-based enforcement reads), so it must claim them too.
    routePatterns: ["/accounting", "/reports/balance-sheet", "/reports/cash-flow"],
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
    // comingSoon BECAUSE THERE IS NO CHANNEL AT ALL — not "the queue is not
    // prioritised yet". There is no support address, no contact route and no
    // help link anywhere in the product or in the marketing footer, so a
    // Business subscriber has nowhere to send a request, prioritised or
    // otherwise. Without this flag the pricing matrix rendered a bare ✓ under
    // Business while that page's own subtitle told the reader everything
    // unmarked is live today. Clear it when a support channel ships and is
    // routed, and not before; the Business blurb above loses its "plus
    // priority support" clause for the same reason.
    comingSoon: true,
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
  "Downgrading never deletes anything. Records from features outside your new plan are preserved, and those screens come straight back the moment you upgrade again. They are your records, not ours. Your logbook, currency board, and documents are never gated on any plan.";
