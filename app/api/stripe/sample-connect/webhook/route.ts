import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getSampleStripe } from "@/lib/sample-connect/client";

/**
 * ===========================================================================
 * SAMPLE CONNECT — subscription webhooks (SNAPSHOT events)
 * ===========================================================================
 *
 * The platform subscription: a merchant paying YOU. When that subscription is
 * upgraded, downgraded, paused or cancelled, this is how you find out, and it
 * is the only reliable way — a merchant who cancels from the billing portal
 * never touches your UI.
 *
 * ── SNAPSHOT, NOT THIN ────────────────────────────────────────────────────
 * These are classic V1 events and they carry the full object in the payload,
 * so there is no second fetch: `event.data.object` IS the subscription. Parse
 * with `webhooks.constructEvent`, not `parseEventNotification` — see the
 * sibling route in ../webhook-thin for the V2 side and why the two differ.
 *
 * ── SETTING THIS UP ───────────────────────────────────────────────────────
 * Dashboard → Developers → Webhooks → Add destination:
 *   1. Events from:  **Your account** (these are YOUR charges, not the
 *                    merchant's — this is the opposite choice from the thin
 *                    endpoint, and getting it backwards means no deliveries)
 *   2. Payload style: Snapshot (the default)
 *   3. Events: the ones in the switch below
 *   4. URL: https://your-domain.com/api/stripe/sample-connect/webhook
 *   5. Signing secret → SAMPLE_CONNECT_WEBHOOK_SECRET
 *
 * Locally:
 *     stripe listen --forward-to localhost:3000/api/stripe/sample-connect/webhook
 *
 * ── ON STORING SUBSCRIPTION STATE ─────────────────────────────────────────
 * This sample reads subscription status live from Stripe for its dashboard,
 * so the handlers below only log and carry TODOs. A production integration
 * stores it, because entitlement checks happen on every request and must not
 * depend on Stripe being reachable. Each TODO marks exactly where.
 *
 * ── THE V2 GOTCHA WORTH REMEMBERING ───────────────────────────────────────
 * For a subscription billed to a V2 account, `subscription.customer` is NOT
 * the id you want — read `subscription.customer_account`, which is the
 * `acct_…`. `customerAccountOf()` below encapsulates that.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // ── FILL THIS IN ────────────────────────────────────────────────────────
  //     SAMPLE_CONNECT_WEBHOOK_SECRET=whsec_...
  // Distinct from SAMPLE_CONNECT_THIN_WEBHOOK_SECRET and from the production
  // integration's STRIPE_WEBHOOK_SECRET. One secret per destination.
  // ────────────────────────────────────────────────────────────────────────
  const webhookSecret = process.env.SAMPLE_CONNECT_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error(
      "[sample-connect] SAMPLE_CONNECT_WEBHOOK_SECRET is not set — refusing the delivery. " +
        "Set it from your webhook destination's signing secret (or from `stripe listen`)."
    );
    return NextResponse.json(
      { error: "Webhook endpoint is not configured (SAMPLE_CONNECT_WEBHOOK_SECRET)." },
      { status: 503 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  // Raw bytes — see the thin route's note.
  const rawBody = await request.text();

  const stripeClient = getSampleStripe();

  let event: Stripe.Event;
  try {
    // Snapshot parsing. Verifies the signature AND gives you the whole object.
    event = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    console.error(`[sample-connect] signature verification failed: ${message}`);
    return NextResponse.json({ error: "Signature verification failed." }, { status: 400 });
  }

  try {
    switch (event.type) {
      // ── SUBSCRIPTION LIFECYCLE ────────────────────────────────────────
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = customerAccountOf(subscription);
        const priceId = subscription.items.data[0]?.price?.id ?? null;
        const quantity = subscription.items.data[0]?.quantity ?? null;

        // ONE EVENT, SEVERAL MEANINGS. `customer.subscription.updated` covers
        // upgrades, downgrades, quantity changes, pauses, resumes, and
        // scheduled cancellations. Read the fields to tell them apart.

        if (subscription.cancel_at_period_end) {
          // Scheduled to cancel at period end — still active until then.
          // A merchant who changes their mind produces another `updated`
          // with this back to false.
          console.info(`[sample-connect] ${accountId} scheduled cancellation at period end`);
          // TODO(production): flag the account as ending, keep access on.
        }

        if (subscription.pause_collection) {
          // Paused. `pause_collection.behavior` is always 'void' when paused
          // from the customer portal; `resumes_at` says when it comes back.
          console.info(
            `[sample-connect] ${accountId} collection paused, resumes ${subscription.pause_collection.resumes_at ?? "unknown"}`
          );
          // TODO(production): suspend access while paused.
        }

        console.info(
          `[sample-connect] subscription ${subscription.status} for ${accountId} (price ${priceId}, qty ${quantity})`
        );

        // TODO(production): upsert the subscription state, e.g.
        //   await db.subscriptions.upsert({
        //     where:  { stripeAccountId: accountId },
        //     update: { status: subscription.status, priceId, quantity,
        //               cancelAtPeriodEnd: subscription.cancel_at_period_end },
        //     create: { stripeAccountId: accountId, status: subscription.status, priceId, quantity },
        //   });
        // Then grant or revoke entitlements from the stored row, never from
        // the event directly — events can arrive out of order.
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = customerAccountOf(subscription);
        console.info(`[sample-connect] subscription ended for ${accountId}`);
        // TODO(production): revoke access. This fires when the subscription
        // actually ends, which for a cancel-at-period-end is at the END of
        // the period, not when the merchant clicked cancel.
        break;
      }

      // ── INVOICES ──────────────────────────────────────────────────────
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        console.info(`[sample-connect] invoice ${invoice.id} paid`);
        // TODO(production): record the payment and extend the service period.
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.warn(`[sample-connect] invoice ${invoice.id} payment FAILED`);
        // TODO(production): notify the merchant and start your dunning
        // process. Stripe retries on its own schedule; this is your chance to
        // ask them to fix the card before the subscription lapses.
        break;
      }

      // ── PAYMENT METHODS AND CUSTOMER RECORD ───────────────────────────
      case "payment_method.attached":
      case "payment_method.detached": {
        const paymentMethod = event.data.object as Stripe.PaymentMethod;
        console.info(`[sample-connect] ${event.type}: ${paymentMethod.id}`);
        // TODO(production): refresh any cached "card on file" display.
        break;
      }

      case "customer.updated": {
        const customer = event.data.object as Stripe.Customer;
        console.info(
          `[sample-connect] customer updated, default payment method ${customer.invoice_settings?.default_payment_method ?? "none"}`
        );
        // TODO(production): update billing info you mirror locally.
        //
        // Treat everything here as BILLING information only. In particular
        // never use the customer's billing email as a login credential — it
        // is editable by the customer in the portal and is not an identity.
        break;
      }

      // ── TAX IDS ───────────────────────────────────────────────────────
      case "customer.tax_id.created":
      case "customer.tax_id.deleted":
      case "customer.tax_id.updated": {
        console.info(`[sample-connect] ${event.type}`);
        // TODO(production): mirror the tax id and its validation state; some
        // types are validated asynchronously, which is why `updated` matters.
        break;
      }

      // ── PORTAL CONFIGURATION ──────────────────────────────────────────
      case "billing_portal.configuration.created":
      case "billing_portal.configuration.updated":
      case "billing_portal.session.created": {
        console.info(`[sample-connect] ${event.type}`);
        // Informational — useful in an audit log of who opened the portal.
        break;
      }

      default: {
        console.info(`[sample-connect] ignoring unhandled type ${event.type}`);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    console.error(`[sample-connect] handler failed: ${message}`);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}

/**
 * The connected account a subscription belongs to.
 *
 * For V2 accounts the id lives on `customer_account` (an `acct_…`), not on
 * `customer` (a `cus_…`). The SDK's types still describe the V1 shape, hence
 * the narrow cast here rather than at every call site.
 */
function customerAccountOf(subscription: Stripe.Subscription): string | null {
  const withAccount = subscription as unknown as { customer_account?: string | null };
  if (withAccount.customer_account) return withAccount.customer_account;

  // Fallback for a V1-style customer, so the log line is never empty.
  return typeof subscription.customer === "string"
    ? subscription.customer
    : (subscription.customer?.id ?? null);
}
