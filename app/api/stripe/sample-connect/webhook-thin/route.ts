import { NextResponse, type NextRequest } from "next/server";
import { getSampleStripe } from "@/lib/sample-connect/client";

/**
 * ===========================================================================
 * SAMPLE CONNECT — V2 account webhooks (THIN events)
 * ===========================================================================
 *
 * Account requirements change without anyone here doing anything: regulators,
 * card networks and Stripe's own risk review all add them. This endpoint is
 * how you find out, instead of discovering it when a merchant's payment fails.
 *
 * ── THIN vs SNAPSHOT — the thing to understand ────────────────────────────
 * V2 events are delivered as THIN events: a small notification containing an
 * id and a type, and NOT the object that changed. You then fetch the event to
 * get its data. The older V1 style ("snapshot") embeds a full object in the
 * payload — that is what the sibling route in ../webhook handles for
 * subscriptions.
 *
 * Two payload styles, two parsing methods, and they are not interchangeable:
 *
 *     thin      stripeClient.parseEventNotification(body, sig, secret)
 *     snapshot  stripeClient.webhooks.constructEvent(body, sig, secret)
 *
 * (`parseEventNotification` is what stripe-node v22 calls the method older
 * docs and samples call `parseThinEvent`. Same job, current name.)
 *
 * ── SETTING THIS UP ───────────────────────────────────────────────────────
 * Dashboard → Developers → Webhooks → Add destination:
 *   1. Events from:      **Connected accounts**
 *   2. Show advanced options → Payload style: **Thin**
 *   3. Events: type "v2" to filter, then select
 *        v2.core.account[requirements].updated
 *        v2.core.account[configuration.merchant].capability_status_updated
 *        v2.core.account[configuration.customer].capability_status_updated
 *   4. URL: https://your-domain.com/api/stripe/sample-connect/webhook-thin
 *   5. Copy the signing secret into SAMPLE_CONNECT_THIN_WEBHOOK_SECRET
 *
 * Locally, skip the dashboard and use the CLI:
 *
 *     stripe listen \
 *       --thin-events 'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated' \
 *       --forward-thin-to localhost:3000/api/stripe/sample-connect/webhook-thin
 *
 * The CLI prints a whsec_… on startup — that is the secret to use in dev.
 */

/** Node runtime: signature verification needs the raw body, not an edge stream. */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // ── FILL THIS IN ────────────────────────────────────────────────────────
  //     SAMPLE_CONNECT_THIN_WEBHOOK_SECRET=whsec_...
  // From the destination you created above, or from `stripe listen`.
  //
  // This is NOT the same value as the snapshot endpoint's secret, and not the
  // same as the production integration's STRIPE_WEBHOOK_SECRET: Stripe mints
  // a distinct secret per destination, and one cannot verify another's
  // deliveries.
  // ────────────────────────────────────────────────────────────────────────
  const webhookSecret = process.env.SAMPLE_CONNECT_THIN_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error(
      "[sample-connect/thin] SAMPLE_CONNECT_THIN_WEBHOOK_SECRET is not set — refusing the delivery. " +
        "Set it from your webhook destination's signing secret (or from `stripe listen`)."
    );
    // 503, not 200: a silently-swallowed delivery is a bug you find weeks
    // later. This way Stripe records the failure and retries.
    return NextResponse.json(
      { error: "Thin webhook endpoint is not configured (SAMPLE_CONNECT_THIN_WEBHOOK_SECRET)." },
      { status: 503 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  // RAW BODY, ALWAYS. Signature verification runs over the exact bytes Stripe
  // sent; parsing to JSON first and re-serialising changes them and every
  // signature check fails.
  const rawBody = await request.text();

  const stripeClient = getSampleStripe();

  let notification: ReturnType<typeof stripeClient.parseEventNotification>;
  try {
    // STEP 1: verify and parse the thin notification. This is cheap and does
    // not call Stripe — everything needed to authenticate the request is in
    // the payload and the signature.
    notification = stripeClient.parseEventNotification(rawBody, signature, webhookSecret);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    console.error(`[sample-connect/thin] signature verification failed: ${message}`);
    // 400 and no retry: a bad signature will never become a good one.
    return NextResponse.json({ error: "Signature verification failed." }, { status: 400 });
  }

  try {
    // STEP 2: fetch the full event. A thin notification tells you WHAT
    // happened and to WHICH account, not the new state — so this call is
    // required, not optional.
    const event = await stripeClient.v2.core.events.retrieve(notification.id);

    // The account this event is about. V2 events carry it in `related_object`.
    //
    // Read through a helper rather than `event.related_object` directly: the
    // SDK types this as a union of every event shape it knew about when it
    // was generated, and the `v2.core.account[…]` variants this endpoint
    // subscribes to are not all in it yet. Reaching for the field directly is
    // a compile error on the variants that lack it, and casting the whole
    // event to `any` would throw away the type checking on everything else.
    const accountId = relatedObjectId(event);

    // Same reasoning for the discriminant: compare a plain string rather than
    // relying on the union's literal types to include these members.
    const eventType: string = event.type;

    // STEP 3: dispatch on type.
    switch (eventType) {
      case "v2.core.account[requirements].updated": {
        // Stripe wants something new from this merchant (or has stopped
        // wanting something). Re-read the account to see what.
        console.info(`[sample-connect/thin] requirements updated for ${accountId}`);
        await handleRequirementsUpdated(accountId);
        break;
      }

      case "v2.core.account[configuration.merchant].capability_status_updated": {
        // A merchant capability changed — most importantly `card_payments`
        // going active (they can now be paid) or inactive (they cannot).
        console.info(`[sample-connect/thin] merchant capability updated for ${accountId}`);
        await handleMerchantCapabilityUpdated(accountId);
        break;
      }

      case "v2.core.account[configuration.customer].capability_status_updated": {
        // A customer-configuration capability changed. This is the side that
        // lets us bill THEM for the platform subscription.
        console.info(`[sample-connect/thin] customer capability updated for ${accountId}`);
        await handleCustomerCapabilityUpdated(accountId);
        break;
      }

      default: {
        // Not an error. Stripe may deliver types this build predates, and
        // acknowledging them stops pointless retries.
        console.info(`[sample-connect/thin] ignoring unhandled type ${eventType}`);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    console.error(`[sample-connect/thin] handler failed: ${message}`);
    // 500 so Stripe retries — the delivery was genuine, we just could not
    // finish with it.
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}

/**
 * The id of the object a V2 event is about — `related_object.id`.
 *
 * Written as a structural read instead of a property access for the reason
 * given at the call site: the SDK's event union does not yet carry every
 * `v2.core.account[…]` variant, and this keeps the rest of the handler
 * type-checked rather than casting the event to `any`. Returns null rather
 * than throwing, so a shape the SDK does not model degrades to "logged and
 * acknowledged" instead of a retry storm.
 */
function relatedObjectId(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null;
  const related = (event as { related_object?: unknown }).related_object;
  if (typeof related !== "object" || related === null) return null;
  const id = (related as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * Requirements changed on an account.
 *
 * This sample only logs, because its dashboard reads status live from the API
 * on every load and therefore never needs a cached copy. In a real
 * integration this is where you would act:
 */
async function handleRequirementsUpdated(accountId: string | null) {
  if (!accountId) return;

  // TODO(production): re-read the account and persist the summary, e.g.
  //   const status = await getSampleAccountStatus(accountId);
  //   await db.merchants.update({ where: { stripeAccountId: accountId }, data: {
  //     onboardingComplete: status.onboardingComplete,
  //     requirementsStatus: status.requirementsStatus,
  //   }});
  //
  // TODO(production): if the status is 'past_due', email the merchant. This
  // is the event that gives you warning BEFORE payouts or charges are
  // disabled, and it is the whole reason to subscribe to it.
}

/** A merchant capability (e.g. card_payments) changed status. */
async function handleMerchantCapabilityUpdated(accountId: string | null) {
  if (!accountId) return;

  // TODO(production): persist whether card_payments is 'active' and use the
  // stored flag to show or hide the merchant's storefront, rather than
  // calling Stripe on every storefront render.
  //
  // TODO(production): if it went from active to inactive, take their
  // storefront offline — a customer paying into an account that cannot settle
  // is the failure this event exists to prevent.
}

/** A customer-configuration capability changed status. */
async function handleCustomerCapabilityUpdated(accountId: string | null) {
  if (!accountId) return;

  // TODO(production): persist it. If the account can no longer be billed as a
  // customer, your platform subscription for them will start failing, and
  // this is the earliest warning you get.
}
