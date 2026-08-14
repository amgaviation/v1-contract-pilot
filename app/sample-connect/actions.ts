"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/account";
import { createSampleConnectedAccount, createSampleAccountLink } from "@/lib/sample-connect/accounts";
import { getSampleAccountId, saveSampleAccountId } from "@/lib/sample-connect/store";
import { createSampleProduct } from "@/lib/sample-connect/products";
import {
  createPlatformSubscriptionCheckout,
  createBillingPortalSession,
} from "@/lib/sample-connect/checkout";

/**
 * ===========================================================================
 * SAMPLE CONNECT — server actions for the merchant dashboard
 * ===========================================================================
 *
 * Every action here starts by identifying the signed-in user, because each
 * one either creates something on their Stripe account or spends money. A
 * server action is a public HTTP endpoint: anything that skips the auth check
 * is callable by anyone who can guess its name.
 */

/**
 * "Onboard to collect payments".
 *
 * Does two things in one click, which is the flow Stripe recommends:
 *   1. creates the V2 account if this user does not have one yet;
 *   2. mints a fresh Account Link and redirects them into hosted onboarding.
 *
 * Step 2 runs every time. Account Links are single-use and short-lived, so a
 * merchant coming back to finish gets a NEW link rather than a stale one.
 */
export async function startSampleOnboarding() {
  const { user } = await requireAccount("/sample-connect");

  let accountId = await getSampleAccountId(user.id);

  if (!accountId) {
    // A merchant's display name and contact email. Taken from the signed-in
    // user here; a real integration would collect the business name (and the
    // country, which cannot be changed later) on a form first.
    accountId = await createSampleConnectedAccount({
      displayName: user.email ?? "Sample merchant",
      contactEmail: user.email ?? "",
    });

    // Persist the mapping BEFORE redirecting. If the redirect happened first
    // and the write failed, the next click would create a SECOND Stripe
    // account for the same user — orphaning the first with no way back to it.
    // The mode is derived inside saveSampleAccountId from the key that just
    // created the account, so it cannot disagree with reality.
    const saved = await saveSampleAccountId({
      userId: user.id,
      stripeAccountId: accountId,
    });
    if (saved.error) throw new Error(saved.error);
  }

  const url = await createSampleAccountLink(accountId);

  // `redirect()` throws internally — it must be the last thing, and outside
  // any try/catch that would swallow it.
  redirect(url);
}

export type ProductFormState = { error: string | null; created?: string };

/**
 * Create a product on the merchant's connected account.
 *
 * Validation happens here rather than in the browser because the browser's
 * copy is a courtesy: this function is reachable directly.
 */
export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const { user } = await requireAccount("/sample-connect");

  const accountId = await getSampleAccountId(user.id);
  if (!accountId) {
    return { error: "Connect a Stripe account first — there is nowhere to put a product yet." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim();

  if (!name) return { error: "Give the product a name." };

  // Dollars in the form, cents to Stripe. Every Stripe amount is in the
  // smallest currency unit — $12.50 is 1250. Sending 12.5 charges 12 cents.
  const priceValue = Number(priceRaw);
  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    return { error: "Give the product a price greater than zero, like 12.50." };
  }
  const priceInCents = Math.round(priceValue * 100);

  try {
    await createSampleProduct({
      accountId,
      name,
      description,
      priceInCents,
      currency: "usd",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    return { error: `Stripe refused the product: ${message}` };
  }

  revalidatePath("/sample-connect");
  return { error: null, created: name };
}

/** Start the platform subscription — the merchant paying us. */
export async function subscribeToPlatformAction() {
  const { user } = await requireAccount("/sample-connect");

  const accountId = await getSampleAccountId(user.id);
  if (!accountId) throw new Error("Connect a Stripe account before subscribing.");

  const result = await createPlatformSubscriptionCheckout({ accountId });
  if ("error" in result) throw new Error(result.error);

  redirect(result.url);
}

/** Open Stripe's hosted billing portal so they can manage that subscription. */
export async function openBillingPortalAction() {
  const { user } = await requireAccount("/sample-connect");

  const accountId = await getSampleAccountId(user.id);
  if (!accountId) throw new Error("Connect a Stripe account first.");

  const result = await createBillingPortalSession({ accountId });
  if ("error" in result) throw new Error(result.error);

  redirect(result.url);
}
