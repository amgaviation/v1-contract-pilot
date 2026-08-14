import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, isLiveMode } from "@/lib/stripe/server";
import { createServiceClient } from "@/lib/supabase/service-role";
import {
  provisionAccountFromCheckout,
  syncSubscriptionState,
} from "@/lib/stripe/provisioning";

/**
 * Stripe platform-billing webhook — the only tenant-creation path in the
 * product (docs/PLAN.md decision #7).
 *
 * The plan's non-negotiables for this endpoint, and where each is met:
 *   - signature verification    -> constructEventAsync below, on the RAW body
 *   - event-ID idempotency      -> pilot.stripe_events, PK = Stripe event id
 *   - retry safety              -> a row with NULL processed_at is retryable;
 *                                  only processed_at set means "skip"
 *   - out-of-order safety       -> isSuperseded skips a stale event whose
 *                                  newer sibling ALREADY finished (a cheap
 *                                  early-out), and the account write itself
 *                                  is conditional on a per-account event
 *                                  watermark (syncSubscriptionState's
 *                                  `last_billing_event_at < incoming`), so
 *                                  two CONCURRENT events — which can both
 *                                  clear isSuperseded before either sets
 *                                  processed_at — still resolve to the
 *                                  newer one, not the last writer.
 *   - test/live separation      -> event.livemode must match our key mode
 *
 * Runs on Node (not Edge): the Stripe SDK's signature verification and the
 * service-role Supabase client both expect Node APIs.
 */
export const runtime = "nodejs";
// Never cache or statically analyse this route — it must execute per call.
export const dynamic = "force-dynamic";

/** Events this endpoint acts on. Anything else is recorded and ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // A deployment without this secret cannot verify anything, so it must
    // refuse rather than trust the payload. 500 (not 400) so Stripe retries
    // once it is configured, instead of treating it as permanently bad.
    console.error("STRIPE_WEBHOOK_SECRET is unset — refusing webhook.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // The RAW body is required: any parsing/re-serialisation changes bytes
  // and the signature no longer matches.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`Stripe signature verification failed: ${message}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Test/live separation: a test event must never mutate live data, and a
  // live event must never be applied by a test-keyed deployment. 200 so
  // Stripe stops retrying — this is a routing mistake, not a transient
  // failure, and retrying it will never help.
  if (event.livemode !== isLiveMode()) {
    console.error(
      `Rejected event ${event.id}: livemode=${event.livemode} but this deployment is ${
        isLiveMode() ? "live" : "test"
      }-keyed.`
    );
    return NextResponse.json({ received: true, ignored: "mode-mismatch" });
  }

  const supabase = createServiceClient();
  const objectId = extractObjectId(event);

  // Idempotency: the insert IS the check. A duplicate delivery collides on
  // the primary key, and we then look at whether the first attempt actually
  // finished — if it did not (processed_at NULL, e.g. it crashed midway),
  // this retry is allowed to proceed.
  const { error: insertError } = await supabase
    .from("stripe_events")
    .insert({
      id: event.id,
      type: event.type,
      stripe_created_at: new Date(event.created * 1000).toISOString(),
      object_id: objectId,
      livemode: event.livemode,
    } as never);

  if (insertError) {
    // 23505 IS THE ONLY ERROR THAT MEANS "SEEN BEFORE" (the Connect
    // webhook's insertError block names this exact defect class). Any
    // OTHER error — a statement timeout, a connection blip, pool
    // exhaustion — must NOT fall through to the prior-row check: that
    // check would find nothing, the handler would run with no ledger row
    // in existence, and markProcessed below would then update zero rows
    // and answer 200 to Stripe anyway. So: anything that is not a
    // collision is a 500 and a Stripe retry.
    if (insertError.code !== "23505") {
      console.error(
        `[db] stripe_events.insert(${event.id}) ${insertError.message} (code ${
          insertError.code ?? "none"
        }) — refusing to run the handler with no delivery row to mark.`
      );
      return NextResponse.json({ error: "Delivery ledger unavailable" }, { status: 500 });
    }

    const { data: prior, error: priorError } = await supabase
      .from("stripe_events")
      .select("processed_at")
      .eq("id", event.id)
      .maybeSingle();

    if (priorError) {
      // Not knowing whether the first attempt finished is not a licence
      // to assume it did — same reasoning as the insert branch above.
      console.error(
        `[db] stripe_events.select(${event.id}) after a collision: ${priorError.message}`
      );
      return NextResponse.json({ error: "Delivery ledger unavailable" }, { status: 500 });
    }

    if ((prior as { processed_at: string | null } | null)?.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Seen but unfinished — fall through and retry the handler.
  }

  if (!HANDLED.has(event.type)) {
    const failure = await markProcessedOrFailureResponse(event.id);
    if (failure) return failure;
    return NextResponse.json({ received: true, handled: false });
  }

  try {
    await handleEvent(event, objectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`Handler failed for ${event.type} (${event.id}): ${message}`);
    // Leave processed_at NULL and return 500 so Stripe retries. Returning
    // 200 here would silently drop a paid customer's provisioning.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  const failure = await markProcessedOrFailureResponse(event.id);
  if (failure) return failure;
  return NextResponse.json({ received: true });
}

/**
 * Marks a delivery row finished. THROWS on a failed or zero-row update —
 * it used to swallow both, so a failed UPDATE matched zero rows,
 * PostgREST answered 200, and this route answered 200 to Stripe with no
 * row ever marked finished: the event was never recorded, never marked,
 * and (because we told Stripe it was fine) never redelivered either. The
 * caller turns this into a 500, which is safe — every handler above is
 * idempotent, so a redelivery costs nothing but time.
 */
async function markProcessed(eventId: string) {
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString() } as never, { count: "exact" })
    .eq("id", eventId);
  if (error) {
    throw new Error(`stripe_events.update(${eventId}): ${error.message}`);
  }
  if (count === 0) {
    throw new Error(`stripe_events.update(${eventId}) matched 0 rows — not marked processed.`);
  }
}

/** markProcessed, turned into a 500 JSON response on failure, or null on success. */
async function markProcessedOrFailureResponse(eventId: string): Promise<NextResponse | null> {
  try {
    await markProcessed(eventId);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`markProcessed failed for ${eventId}: ${message}`);
    return NextResponse.json({ error: "Could not record delivery" }, { status: 500 });
  }
}

/** The Stripe object this event concerns, for the ordering check. */
function extractObjectId(event: Stripe.Event): string | null {
  const obj = event.data.object as { id?: string; subscription?: unknown };
  if (event.type === "checkout.session.completed") {
    const sub = (obj as Stripe.Checkout.Session).subscription;
    return typeof sub === "string" ? sub : (sub?.id ?? obj.id ?? null);
  }
  return obj.id ?? null;
}

/**
 * True when an event NEWER than this one has already been applied to the
 * same object. Stripe does not guarantee delivery order, so without this a
 * late-arriving "trialing" could overwrite a current "active".
 */
async function isSuperseded(
  eventId: string,
  objectId: string | null,
  createdAt: number
): Promise<boolean> {
  if (!objectId) return false;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("stripe_events")
    .select("id")
    .eq("object_id", objectId)
    .not("processed_at", "is", null)
    .gt("stripe_created_at", new Date(createdAt * 1000).toISOString())
    .neq("id", eventId)
    .limit(1);
  const rows = data as { id: string }[] | null;
  return Array.isArray(rows) && rows.length > 0;
}

async function handleEvent(event: Stripe.Event, objectId: string | null) {
  const stripe = getStripe();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Only subscription checkouts provision a tenant.
      if (session.mode !== "subscription") return;
      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subId) {
        throw new Error(`Checkout ${session.id} completed with no subscription.`);
      }
      // Re-fetch rather than trusting the embedded copy: the session's
      // nested subscription can be stale relative to the live object.
      const subscription = await stripe.subscriptions.retrieve(subId);
      await provisionAccountFromCheckout(session, subscription, event.created);
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      if (await isSuperseded(event.id, objectId, event.created)) {
        // A newer state for this subscription already FINISHED. Cheap
        // early-out; the watermark in syncSubscriptionState is what makes
        // the concurrent case (neither finished yet) safe.
        return;
      }
      const applied = await syncSubscriptionState(subscription, event.created);
      // `applied: false` means no account matched yet — normally because
      // this event raced ahead of the checkout.session.completed that
      // provisions the tenant (provisionAccountFromCheckout re-fetches the
      // live subscription, so the pre-provisioning state this event
      // carried is safely superseded once that lands). Throwing turns
      // this into a 500 so STRIPE actually redelivers it, rather than the
      // event being acked and dropped on the (usually false) assumption
      // that it would be. Bounded to ~1 hour so a subscription that will
      // NEVER match an account (a dashboard-created test object, an event
      // for another Stripe account entirely) does not retry for the full
      // 3-day window Stripe allows.
      if (!applied) {
        const ageSeconds = Date.now() / 1000 - event.created;
        if (ageSeconds < 60 * 60) {
          throw new Error(
            `${event.type} (${event.id}): no account matched subscription ${subscription.id} / customer ${
              typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id
            } yet — retrying while the event is still recent.`
          );
        }
        console.error(
          `${event.type} (${event.id}): no account matched subscription ${subscription.id} after 1 hour — giving up on redelivery.`
        );
      }
      return;
    }

    case "invoice.payment_failed": {
      // VERIFIED AGAINST THE INSTALLED SDK (stripe 22.4.0, API version
      // 2026-07-29.dahlia — see lib/stripe/server.ts), same as
      // billing-facts.ts's header: `Invoice.subscription` does not exist
      // in this API version (it moved in Stripe API 2025-03-31.basil).
      // The subscription id now lives at
      // `invoice.parent.subscription_details.subscription`, which is
      // `string | Stripe.Subscription | null` per
      // node_modules/stripe/esm/resources/Invoices.d.ts. The legacy
      // top-level field is kept as a fallback ONLY for a webhook endpoint
      // still registered on an old API version in the Stripe dashboard,
      // where the payload would still carry it.
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string | Stripe.Subscription | null;
      };
      const parentSub = invoice.parent?.subscription_details?.subscription;
      const legacySub = invoice.subscription;
      const subRef = parentSub ?? legacySub;
      const subId = typeof subRef === "string" ? subRef : subRef?.id;
      if (!subId) return;
      // Read the authoritative status rather than inferring "past_due"
      // ourselves — Stripe's dunning settings decide what a failed payment
      // actually means for the subscription.
      const subscription = await stripe.subscriptions.retrieve(subId);
      await syncSubscriptionState(subscription, event.created);
      return;
    }
  }
}
