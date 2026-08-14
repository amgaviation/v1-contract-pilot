import "server-only";
import type Stripe from "stripe";
import { getSampleStripe } from "./client";

/**
 * ===========================================================================
 * SAMPLE CONNECT — products on the connected account
 * ===========================================================================
 *
 * THE ONE IDEA IN THIS FILE: the `Stripe-Account` header.
 *
 * Every call here is a NORMAL v1 API call, with one extra request option that
 * says "run this as the connected account, not as the platform". In
 * stripe-node that option is `{ stripeAccount: 'acct_…' }`, passed as the
 * SECOND argument, after the params:
 *
 *     stripeClient.products.create(params, { stripeAccount: accountId })
 *
 * Get this wrong and nothing errors loudly — the product is simply created on
 * YOUR platform account instead of the merchant's, and their storefront comes
 * back empty. That is the single most common Connect mistake.
 *
 * The option is named differently per language (`stripe_account` in Ruby and
 * Python, `SetStripeAccount` in Go, `StripeAccount` on RequestOptions in Java
 * and .NET). See https://docs.stripe.com/connect/authentication
 */

export type SampleProduct = {
  id: string;
  name: string;
  description: string | null;
  /** Smallest currency unit, e.g. cents. Null if the price is not a simple one-off. */
  unitAmount: number | null;
  currency: string;
  priceId: string | null;
};

/**
 * Create a product, with its price, on the MERCHANT's account.
 *
 * `default_price_data` creates the Price inline, in the same call. The
 * alternative — create a Product, then a Price referencing it — is two round
 * trips and leaves a product with no price if the second call fails.
 */
export async function createSampleProduct(params: {
  accountId: string;
  name: string;
  description: string;
  /** Smallest currency unit. $12.50 is 1250, never 12.5. */
  priceInCents: number;
  currency: string;
}): Promise<Stripe.Product> {
  const stripeClient = getSampleStripe();

  return stripeClient.products.create(
    {
      name: params.name,
      description: params.description,
      default_price_data: {
        unit_amount: params.priceInCents,
        currency: params.currency,
      },
    },
    // ← THE CONNECTED ACCOUNT HEADER. Without this the product lands on the
    //   platform account and the merchant's storefront stays empty.
    { stripeAccount: params.accountId }
  );
}

/**
 * List a merchant's products for their storefront.
 *
 * `expand: ['data.default_price']` matters: without it `default_price` comes
 * back as a bare id string and you cannot render a price without N further
 * requests. With it, the Price object is inlined.
 *
 * `active: true` hides archived products — a merchant who archives something
 * expects it gone from their storefront immediately.
 */
export async function listSampleProducts(accountId: string): Promise<SampleProduct[]> {
  const stripeClient = getSampleStripe();

  const products = await stripeClient.products.list(
    {
      limit: 20,
      active: true,
      expand: ["data.default_price"],
    },
    // ← Same header again, on the read side.
    { stripeAccount: accountId }
  );

  return products.data.map((product) => {
    // `default_price` is `string | Price | null`. Expanded above, so it is an
    // object here — but the union is real and worth narrowing rather than
    // casting, because an unexpanded string would otherwise render as
    // "[object Object]" or crash on `.unit_amount`.
    const price =
      product.default_price && typeof product.default_price !== "string"
        ? product.default_price
        : null;

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      unitAmount: price?.unit_amount ?? null,
      currency: price?.currency ?? "usd",
      priceId: price?.id ?? null,
    };
  });
}

/**
 * Fetch one product for the "buy" action, so the server can price the
 * purchase from Stripe's own data.
 *
 * WHY THIS EXISTS AT ALL: the storefront could post the price back to us, but
 * a price that arrives from the browser is a price a customer can edit. Every
 * amount that ends up in a charge is re-read here, server-side, from the
 * merchant's account.
 */
export async function getSampleProduct(
  accountId: string,
  productId: string
): Promise<SampleProduct | null> {
  const stripeClient = getSampleStripe();

  try {
    const product = await stripeClient.products.retrieve(
      productId,
      { expand: ["default_price"] },
      { stripeAccount: accountId }
    );

    if (!product.active) return null;

    const price =
      product.default_price && typeof product.default_price !== "string"
        ? product.default_price
        : null;

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      unitAmount: price?.unit_amount ?? null,
      currency: price?.currency ?? "usd",
      priceId: price?.id ?? null,
    };
  } catch {
    // A missing or inaccessible product is a 404 for the storefront, not a
    // 500 — a customer following a stale link should see "not available".
    return null;
  }
}

/** Formats a smallest-unit amount for display: 1250, "usd" → "$12.50". */
export function formatAmount(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}
