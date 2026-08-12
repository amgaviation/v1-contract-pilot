import "server-only";
import { redirect } from "next/navigation";
import {
  FEATURES,
  featureForPath,
  isEntitled,
  type FeatureId,
} from "@/lib/entitlements";
import { requireAccount, type SessionContext } from "./account";
import type { Database } from "./database.types";

type AccountRow = Database["pilot"]["Tables"]["accounts"]["Row"];
type Role = Database["pilot"]["Tables"]["account_members"]["Row"]["role"];

/**
 * The entitlement gate, one step past requireAccount: "signed in, has a
 * tenant, AND the tenant's tier includes this feature."
 *
 * WHERE IT RUNS: server-side only, in the gated feature's page (and its
 * server actions — a form post must not slip past a gate its screen
 * enforces), immediately after the point requireAccount would be called.
 * It CALLS requireAccount itself so a gated page swaps one line for one
 * line and cannot end up entitlement-checked but auth-unchecked:
 *
 *   const ctx = await requireEntitlement("estimates", "/estimates");
 *
 * WHY NOT THE MIDDLEWARE (lib/supabase/proxy.ts): that layer runs before
 * the router on EVERY request and deliberately knows nothing but the
 * cookie — adding a tenant lookup there would put two extra queries on
 * every navigation, duplicate the tenant resolution that account.ts
 * owns, and could still only redirect, never render. Route gating
 * belongs where the tenant row is already in hand. The route→feature map
 * (featureForPath) still lives in ONE place — lib/entitlements.ts — so
 * if a middleware seam is ever wanted, the map is already built.
 *
 * AN OVER-TIER VISIT IS NOT AN ERROR. A pilot who downgraded, or who
 * follows a shared link to a Pro screen, gets the upgrade screen —
 * which explains what the feature is, that any existing records are
 * preserved, and how to upgrade — never a 404 and never a crash. That
 * screen lives at /settings/billing/upgrade (owned by the billing
 * surface, so it can never itself be gated).
 */
export async function requireEntitlement(
  feature: FeatureId,
  redirectTo?: string
): Promise<SessionContext & { account: AccountRow; role: Role }> {
  const ctx = await requireAccount(redirectTo);
  if (!isEntitled(ctx.account.plan_tier, feature)) {
    const params = new URLSearchParams({ feature });
    if (redirectTo) params.set("from", redirectTo);
    redirect(`/settings/billing/upgrade?${params.toString()}`);
  }
  return ctx;
}

/**
 * Path-based variant for callers that know their pathname but not their
 * feature (a layout, or a future middleware seam). Ungated paths pass
 * straight through with a plain requireAccount.
 */
export async function requireEntitlementForPath(
  pathname: string
): Promise<SessionContext & { account: AccountRow; role: Role }> {
  const feature = featureForPath(pathname);
  if (!feature) return requireAccount(pathname);
  return requireEntitlement(feature, pathname);
}

/** The gated feature's display label, for upgrade-screen copy. */
export function featureLabel(feature: FeatureId): string {
  return FEATURES[feature].label;
}
