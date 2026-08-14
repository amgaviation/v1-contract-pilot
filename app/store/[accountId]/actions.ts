"use server";

import { redirect } from "next/navigation";
import { createStorefrontCheckout } from "@/lib/sample-connect/checkout";

/**
 * "Buy" on the public storefront.
 *
 * NO AUTH CHECK HERE, DELIBERATELY — and it is worth being explicit about why,
 * because every other server action in this codebase starts with one. The
 * buyer is the merchant's customer: a member of the public with no account on
 * this platform and no session to check. Requiring one would break the
 * feature.
 *
 * What protects this action instead:
 *
 *   - It takes NO AMOUNT. The price is re-read from Stripe inside
 *     `createStorefrontCheckout`, so a caller cannot name their own price.
 *   - It takes no destination for the money beyond the account id already in
 *     the public URL, so it cannot be pointed at a different merchant's
 *     balance than the page it was posted from.
 *   - The worst a hostile caller achieves is creating Checkout Sessions that
 *     nobody pays, which cost nothing and expire.
 *
 * Quantity is fixed at 1 for the sample. If you add a quantity field, validate
 * it here — an integer, greater than zero, with a sane ceiling — because a
 * negative or fractional quantity is a Stripe error at best and a free order
 * at worst.
 */
export async function buyProductAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const productId = String(formData.get("productId") ?? "");

  if (!accountId.startsWith("acct_") || !productId.startsWith("prod_")) {
    throw new Error("That product link looks wrong. Go back to the store and try again.");
  }

  const result = await createStorefrontCheckout({
    accountId,
    productId,
    quantity: 1,
  });

  if ("error" in result) throw new Error(result.error);

  // Off to Stripe's hosted checkout. Outside any try/catch: redirect() works
  // by throwing, and catching it here would swallow the navigation.
  redirect(result.url);
}
