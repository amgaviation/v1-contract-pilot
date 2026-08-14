#!/usr/bin/env node
/**
 * Platform-billing webhook verification (docs/PLAN.md names this script's
 * remit as "trial creation, webhook idempotency (replay the same event
 * ID), out-of-order events, seat quantity sync, test/live mode
 * separation" — WHAT ACTUALLY RUNS BELOW, so a green run states only
 * guarantees this file checks:
 *   - signature verification (section 1)
 *   - test/live mode separation (section 2)
 *   - idempotency: replayed event id (section 3)
 *   - out-of-order delivery (section 4)
 *   - retry safety: unfinished handler (section 5)
 *   - provisioning is webhook-only (section 6)
 *   - plan-tier mapping, price -> tier (section 7)
 *   - invoice.payment_failed reads the current API's subscription
 *     reference (section 9)
 *   - price drift: public copy vs live Stripe Price (section 10)
 *   - concurrent delivery / same-second watermark ties (section 8)
 * NOT COVERED (docs/PLAN.md's list names these; they are not exercised
 * here — see lib/stripe/provisioning.ts for where seat_count is written
 * today, and the "trial creation" gap tracked alongside it): TRIAL
 * CREATION (no section asserts a Checkout session actually carries
 * trial_end through provisioning) and SEAT QUANTITY SYNC (pilot.accounts
 * .seat_count is not written from a subscription's item quantity at all
 * yet, so there is nothing to assert).
 *

 * WHY IT SIGNS ITS OWN PAYLOADS rather than waiting on real deliveries:
 * the properties under test are properties of OUR handler, not of Stripe.
 * Signing locally with the same secret the route verifies against lets
 * every case run deterministically, in seconds, with no public tunnel and
 * no dependence on Stripe's retry timing — including the cases Stripe
 * will not produce on demand at all (a replayed event id, a stale event
 * arriving after a newer one, a test event hitting a live-keyed
 * deployment).
 *
 * It exercises the REAL route over HTTP against a REAL database, so a
 * passing run means the deployed code path works, not that a mock does.
 *
 *   BASE_URL=http://localhost:3000 npm run billing:verify
 *
 * Requires the server under test to be running with STRIPE_WEBHOOK_SECRET
 * set to the same value this script signs with (WEBHOOK_SECRET below).
 */

import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.NEXT_SUPABASE_URL;
const SERVICE_KEY = process.env.NEXT_SUPABASE_SECRET_KEY;

if (!WEBHOOK_SECRET) {
  console.error("billing:verify requires STRIPE_WEBHOOK_SECRET (the value the server verifies against).");
  process.exit(1);
}

const db =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        db: { schema: "pilot" },
        auth: { persistSession: false },
      })
    : null;

let passed = 0;
let failed = 0;
let skipped = 0;

/**
 * A SKIPPED CHECK IS NOT A PASSING CHECK.
 *
 * Sections 4 and 5 need a service-role client. Without one they used to
 * print SKIP and touch neither counter, so the run exited 0 having asserted
 * six things instead of nine — and "billing:verify passed" meant something
 * different depending on which environment variables happened to be set,
 * with nothing in the output saying so.
 *
 * That is the same class of defect as a check that treats a discarded error
 * as a pass, which this file's siblings already guard against: the failure
 * mode is not a wrong answer, it is a confident answer to a question nobody
 * asked. Skips are now counted and named, the summary states how many
 * assertions actually ran, and a run that skipped anything cannot be
 * mistaken for a full one.
 */
function skip(name, reason) {
  skipped++;
  console.log(`  SKIP  ${name} — ${reason}`);
}

function pass(name, detail = "") {
  passed++;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  failed++;
  console.error(`  FAIL  ${name} — ${detail}`);
}

/** Builds the Stripe-Signature header exactly as Stripe does. */
function sign(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function postEvent(event, { secret = WEBHOOK_SECRET, signature } = {}) {
  const payload = JSON.stringify(event);
  const header = signature ?? sign(payload, secret);
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  return { status: res.status, body };
}

function subscriptionEvent(type, { id, subId, customerId, status, created, livemode = false, trialEnd = null, priceId = null }) {
  return {
    id,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created,
    livemode,
    type,
    data: {
      object: {
        id: subId,
        object: "subscription",
        customer: customerId,
        status,
        trial_end: trialEnd,
        // priceId=null keeps the pre-plan-tier shape (no items), which
        // is itself part of the contract: an event carrying no price
        // must sync STATUS while leaving plan_tier alone — see section 7.
        items: {
          object: "list",
          data: priceId ? [{ id: `si_${subId}`, object: "subscription_item", price: { id: priceId, object: "price" } }] : [],
        },
      },
    },
  };
}

console.log(`\nbilling:verify — ${BASE_URL}\n`);

// ---------------------------------------------------------------------------
// 1. Signature verification. A forged or unsigned request must never reach
//    the handler — this endpoint has no other authentication.
// ---------------------------------------------------------------------------
console.log("Signature verification");
{
  const evt = subscriptionEvent("customer.subscription.updated", {
    id: `evt_test_${randomUUID()}`,
    subId: "sub_verify_sig",
    customerId: "cus_verify_sig",
    status: "active",
    created: Math.floor(Date.now() / 1000),
  });

  const noSig = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(evt),
  });
  noSig.status === 400
    ? pass("missing signature rejected", "400")
    : fail("missing signature rejected", `expected 400, got ${noSig.status}`);

  const wrongSecret = await postEvent(evt, { secret: "whsec_not_the_real_secret" });
  wrongSecret.status === 400
    ? pass("signature from wrong secret rejected", "400")
    : fail("signature from wrong secret rejected", `expected 400, got ${wrongSecret.status}`);

  const tampered = await postEvent(evt, { signature: "t=1,v1=deadbeef" });
  tampered.status === 400
    ? pass("malformed signature rejected", "400")
    : fail("malformed signature rejected", `expected 400, got ${tampered.status}`);
}

// ---------------------------------------------------------------------------
// 2. Test/live separation. A live-mode event must never be applied by a
//    test-keyed deployment (and vice versa) — that would mean real
//    customer state written into the wrong dataset.
// ---------------------------------------------------------------------------
console.log("\nTest/live mode separation");
{
  const evt = subscriptionEvent("customer.subscription.updated", {
    id: `evt_test_${randomUUID()}`,
    subId: "sub_verify_livemode",
    customerId: "cus_verify_livemode",
    status: "active",
    created: Math.floor(Date.now() / 1000),
    livemode: true, // this deployment is test-keyed
  });
  const res = await postEvent(evt);
  res.status === 200 && res.body?.ignored === "mode-mismatch"
    ? pass("live event rejected by test-keyed deployment", "ignored, not retried")
    : fail(
        "live event rejected by test-keyed deployment",
        `got ${res.status} ${JSON.stringify(res.body)}`
      );
}

// ---------------------------------------------------------------------------
// 3. Idempotency. Stripe retries for up to 3 days and can deliver the same
//    event more than once; applying it twice must be impossible.
// ---------------------------------------------------------------------------
console.log("\nIdempotency (replayed event id)");
{
  const eventId = `evt_test_${randomUUID()}`;
  const evt = subscriptionEvent("customer.subscription.updated", {
    id: eventId,
    subId: "sub_verify_idem",
    customerId: "cus_verify_idem",
    status: "active",
    created: Math.floor(Date.now() / 1000),
  });

  const first = await postEvent(evt);
  const second = await postEvent(evt);

  first.status === 200
    ? pass("first delivery accepted", "200")
    : fail("first delivery accepted", `got ${first.status}`);

  second.status === 200 && second.body?.duplicate === true
    ? pass("replayed event id short-circuits", "duplicate: true")
    : fail(
        "replayed event id short-circuits",
        `expected duplicate:true, got ${JSON.stringify(second.body)}`
      );

  if (db) {
    const { data } = await db.from("stripe_events").select("id").eq("id", eventId);
    Array.isArray(data) && data.length === 1
      ? pass("exactly one ledger row for the event", `${data.length} row`)
      : fail("exactly one ledger row for the event", `found ${data?.length ?? "none"}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Out-of-order delivery. Stripe does not guarantee ordering, so a stale
//    event arriving late must not overwrite newer state. Verified against
//    the account row, which is what the pilot actually sees.
// ---------------------------------------------------------------------------
console.log("\nOut-of-order delivery");
if (!db) {
  skip("out-of-order delivery", "needs NEXT_SUPABASE_URL + NEXT_SUPABASE_SECRET_KEY");
} else {
  const subId = `sub_verify_order_${randomUUID().slice(0, 8)}`;
  const customerId = `cus_verify_order_${randomUUID().slice(0, 8)}`;
  const now = Math.floor(Date.now() / 1000);

  // A stand-in account to observe. Created directly (not via checkout)
  // because this case is about ordering, not provisioning.
  const { data: acct, error: acctErr } = await db
    .from("accounts")
    .insert({
      kind: "solo",
      plan: "solo",
      legal_name: "billing:verify ordering fixture",
      stripe_customer_id: customerId,
      stripe_subscription_id: subId,
      status: "trialing",
    })
    .select("id")
    .single();

  if (acctErr) {
    fail("ordering fixture created", acctErr.message);
  } else {
    // Newer event first: subscription became active.
    await postEvent(
      subscriptionEvent("customer.subscription.updated", {
        id: `evt_test_${randomUUID()}`,
        subId,
        customerId,
        status: "active",
        created: now,
      })
    );
    // Then a STALE event (older timestamp) that says trialing.
    await postEvent(
      subscriptionEvent("customer.subscription.updated", {
        id: `evt_test_${randomUUID()}`,
        subId,
        customerId,
        status: "trialing",
        created: now - 600,
      })
    );

    const { data: after } = await db
      .from("accounts")
      .select("status")
      .eq("id", acct.id)
      .single();

    after?.status === "active"
      ? pass("stale event does not overwrite newer state", "status stayed active")
      : fail(
          "stale event does not overwrite newer state",
          `status is ${after?.status}, expected active`
        );

    // Clean up the fixture — this script must not leave rows behind.
    await db.from("stripe_events").delete().eq("object_id", subId);
    await db.from("accounts").delete().eq("id", acct.id);
  }
}

// ---------------------------------------------------------------------------
// 5. Retry safety. A handler that crashed mid-way leaves processed_at NULL,
//    and Stripe's retry MUST be allowed to run rather than being mistaken
//    for a duplicate — otherwise a transient failure permanently strands a
//    paying customer unprovisioned.
// ---------------------------------------------------------------------------
console.log("\nRetry safety (unfinished handler is retryable)");
if (!db) {
  skip("retry safety", "needs NEXT_SUPABASE_URL + NEXT_SUPABASE_SECRET_KEY");
} else {
  const eventId = `evt_test_${randomUUID()}`;
  const subId = `sub_verify_retry_${randomUUID().slice(0, 8)}`;
  const evt = subscriptionEvent("customer.subscription.updated", {
    id: eventId,
    subId,
    customerId: `cus_verify_retry_${randomUUID().slice(0, 8)}`,
    status: "active",
    created: Math.floor(Date.now() / 1000),
  });

  await postEvent(evt);
  // Simulate "seen but never finished".
  await db.from("stripe_events").update({ processed_at: null }).eq("id", eventId);

  const retry = await postEvent(evt);
  retry.status === 200 && retry.body?.duplicate !== true
    ? pass("unfinished event is retried, not skipped", "handler ran again")
    : fail(
        "unfinished event is retried, not skipped",
        `got ${JSON.stringify(retry.body)} — a crashed handler would never recover`
      );

  await db.from("stripe_events").delete().eq("id", eventId);
}

// ---------------------------------------------------------------------------
// 6. Provisioning is webhook-only. The tenant-creation path must not be
//    reachable by anything a browser can forge (decision #7).
// ---------------------------------------------------------------------------
console.log("\nProvisioning is webhook-only");
{
  const res = await fetch(`${BASE_URL}/welcome?checkout=complete`, {
    redirect: "manual",
  });
  // No session -> the gate bounces to /login. The success URL alone can
  // never mint an account.
  [307, 302, 303].includes(res.status)
    ? pass("checkout success URL alone provisions nothing", `gated (${res.status})`)
    : fail("checkout success URL alone provisions nothing", `got ${res.status}`);
}

// ---------------------------------------------------------------------------
// 7. Plan-tier mapping (three-tier plans). The subscription's PRICE is the
//    authority for pilot.accounts.plan_tier: the webhook maps it through
//    lib/entitlements.ts (tierForPriceId, env-name table). The contract:
//      - a recognised price moves plan_tier (upgrade AND downgrade),
//      - a stale event never overwrites a newer one (same isSuperseded
//        guard the status sync rides),
//      - an event with NO price, or an UNRECOGNISED price, syncs status
//        but leaves plan_tier standing — a malformed or misconfigured
//        event must never silently re-tier a paying account.
//    Requires the same STRIPE_PRICE_ID_SOLO / STRIPE_PRICE_ID_PRO values
//    the server under test reads (both normally come from .env.local).
// ---------------------------------------------------------------------------
console.log("\nPlan-tier mapping (price -> tier)");
{
  const SOLO_PRICE = process.env.STRIPE_PRICE_ID_SOLO;
  const PRO_PRICE = process.env.STRIPE_PRICE_ID_PRO;
  if (!db) {
    skip("plan-tier mapping", "needs NEXT_SUPABASE_URL + NEXT_SUPABASE_SECRET_KEY");
  } else if (!SOLO_PRICE || !PRO_PRICE) {
    skip(
      "plan-tier mapping",
      "needs STRIPE_PRICE_ID_SOLO + STRIPE_PRICE_ID_PRO (the values the server maps against)"
    );
  } else {
    const subId = `sub_verify_tier_${randomUUID().slice(0, 8)}`;
    const customerId = `cus_verify_tier_${randomUUID().slice(0, 8)}`;
    const now = Math.floor(Date.now() / 1000);

    const { data: acct, error: acctErr } = await db
      .from("accounts")
      .insert({
        kind: "solo",
        plan: "solo",
        legal_name: "billing:verify plan-tier fixture",
        stripe_customer_id: customerId,
        stripe_subscription_id: subId,
        status: "active",
      })
      .select("id, plan_tier")
      .single();

    if (acctErr) {
      fail("plan-tier fixture created", acctErr.message);
    } else {
      acct.plan_tier === "solo"
        ? pass("plan_tier defaults to solo", "migration default")
        : fail("plan_tier defaults to solo", `got ${acct.plan_tier}`);

      const tierOf = async () => {
        const { data } = await db
          .from("accounts")
          .select("plan_tier, status")
          .eq("id", acct.id)
          .single();
        return data;
      };

      // Upgrade: a subscription.updated carrying the PRO price.
      await postEvent(
        subscriptionEvent("customer.subscription.updated", {
          id: `evt_test_${randomUUID()}`,
          subId,
          customerId,
          status: "active",
          created: now - 300,
          priceId: PRO_PRICE,
        })
      );
      let row = await tierOf();
      row?.plan_tier === "pro"
        ? pass("recognised price upgrades plan_tier", "solo -> pro")
        : fail("recognised price upgrades plan_tier", `plan_tier is ${row?.plan_tier}`);

      // Out-of-order: a STALE event carrying the SOLO price arrives late.
      // It must not un-upgrade the account.
      await postEvent(
        subscriptionEvent("customer.subscription.updated", {
          id: `evt_test_${randomUUID()}`,
          subId,
          customerId,
          status: "active",
          created: now - 900,
          priceId: SOLO_PRICE,
        })
      );
      row = await tierOf();
      row?.plan_tier === "pro"
        ? pass("stale downgrade event does not overwrite newer tier", "stayed pro")
        : fail(
            "stale downgrade event does not overwrite newer tier",
            `plan_tier is ${row?.plan_tier}`
          );

      // Unrecognised price: status must still sync, tier must stand.
      await postEvent(
        subscriptionEvent("customer.subscription.updated", {
          id: `evt_test_${randomUUID()}`,
          subId,
          customerId,
          status: "past_due",
          created: now - 120,
          priceId: "price_not_in_any_env_var",
        })
      );
      row = await tierOf();
      row?.plan_tier === "pro" && row?.status === "past_due"
        ? pass("unmapped price syncs status but never re-tiers", "pro + past_due")
        : fail(
            "unmapped price syncs status but never re-tiers",
            `plan_tier=${row?.plan_tier} status=${row?.status}`
          );

      // No price at all (the pre-tier event shape): same posture.
      await postEvent(
        subscriptionEvent("customer.subscription.updated", {
          id: `evt_test_${randomUUID()}`,
          subId,
          customerId,
          status: "active",
          created: now - 60,
        })
      );
      row = await tierOf();
      row?.plan_tier === "pro" && row?.status === "active"
        ? pass("price-less event syncs status but never re-tiers", "pro + active")
        : fail(
            "price-less event syncs status but never re-tiers",
            `plan_tier=${row?.plan_tier} status=${row?.status}`
          );

      // Downgrade on Stripe's say-so: a NEWER event carrying SOLO.
      await postEvent(
        subscriptionEvent("customer.subscription.updated", {
          id: `evt_test_${randomUUID()}`,
          subId,
          customerId,
          status: "active",
          created: now,
          priceId: SOLO_PRICE,
        })
      );
      row = await tierOf();
      row?.plan_tier === "solo"
        ? pass("newer event downgrades plan_tier", "pro -> solo")
        : fail("newer event downgrades plan_tier", `plan_tier is ${row?.plan_tier}`);

      // Clean up the fixture — this script must not leave rows behind.
      await db.from("stripe_events").delete().eq("object_id", subId);
      await db.from("accounts").delete().eq("id", acct.id);
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Concurrent delivery (the watermark). The out-of-order section above
//    fires a stale event AFTER a newer one has fully finished, which the
//    processed_at-based isSuperseded guard already catches. This section is
//    the case that guard CANNOT catch on its own: two events for the same
//    subscription in flight AT ONCE, neither processed_at set when the
//    other checks. Correctness must come from the account write being
//    conditional on last_billing_event_at (migration 20260812310000), so
//    the newer event wins whichever order the two commit in — not the last
//    writer. Fired in both interleavings to exercise the race from both
//    sides; a pass means the account settled on the NEWER state every time.
// ---------------------------------------------------------------------------
console.log("\nConcurrent delivery (event watermark)");
if (!db) {
  skip("concurrent delivery", "needs NEXT_SUPABASE_URL + NEXT_SUPABASE_SECRET_KEY");
} else {
  const ROUNDS = 6;
  let newerWon = 0;
  let roundErr = null;

  for (let i = 0; i < ROUNDS && !roundErr; i++) {
    const subId = `sub_verify_conc_${randomUUID().slice(0, 8)}`;
    const customerId = `cus_verify_conc_${randomUUID().slice(0, 8)}`;
    const now = Math.floor(Date.now() / 1000);

    const { data: acct, error: acctErr } = await db
      .from("accounts")
      .insert({
        kind: "solo",
        plan: "solo",
        legal_name: "billing:verify concurrent fixture",
        stripe_customer_id: customerId,
        stripe_subscription_id: subId,
        status: "trialing",
      })
      .select("id")
      .single();

    if (acctErr) {
      roundErr = acctErr.message;
      break;
    }

    // The NEWER event says active; the STALE one says past_due. Fire them
    // together, alternating which is handed to the runtime first so both
    // commit orders are exercised across the rounds.
    const newerEvt = subscriptionEvent("customer.subscription.updated", {
      id: `evt_test_${randomUUID()}`,
      subId,
      customerId,
      status: "active",
      created: now,
    });
    const staleEvt = subscriptionEvent("customer.subscription.updated", {
      id: `evt_test_${randomUUID()}`,
      subId,
      customerId,
      status: "past_due",
      created: now - 600,
    });

    const ordered = i % 2 === 0 ? [newerEvt, staleEvt] : [staleEvt, newerEvt];
    await Promise.all(ordered.map((evt) => postEvent(evt)));

    const { data: after } = await db
      .from("accounts")
      .select("status")
      .eq("id", acct.id)
      .single();

    if (after?.status === "active") newerWon++;

    await db.from("stripe_events").delete().eq("object_id", subId);
    await db.from("accounts").delete().eq("id", acct.id);
  }

  if (roundErr) {
    fail("concurrent delivery resolves to the newer event", roundErr);
  } else {
    newerWon === ROUNDS
      ? pass(
          "concurrent events resolve to the newer state, not the last writer",
          `${newerWon}/${ROUNDS} rounds stayed active`
        )
      : fail(
          "concurrent events resolve to the newer state, not the last writer",
          `only ${newerWon}/${ROUNDS} rounds stayed active — a stale event overwrote a newer one`
        );
  }
}

// ---------------------------------------------------------------------------
// 9. invoice.payment_failed reads the CURRENT API's subscription reference.
//    Stripe API 2025-03-31.basil moved Invoice.subscription to
//    invoice.parent.subscription_details.subscription (see
//    node_modules/stripe/esm/resources/Invoices.d.ts and
//    app/api/stripe/webhook/route.ts). A payload shaped like the pinned API
//    version (2026-07-29.dahlia) — parent.subscription_details, NO
//    top-level `subscription` — must still reach the authoritative
//    subscriptions.retrieve() re-fetch this branch exists for; a handler
//    reading the removed top-level field would find `undefined` and
//    silently no-op instead (200, nothing synced, dunning re-check never
//    happens).
// ---------------------------------------------------------------------------
console.log("\ninvoice.payment_failed (current API shape)");
{
  const subId = `sub_verify_invoice_failed_${randomUUID().slice(0, 8)}`;
  const evt = {
    id: `evt_test_${randomUUID()}`,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "invoice.payment_failed",
    data: {
      object: {
        id: `in_verify_${randomUUID().slice(0, 8)}`,
        object: "invoice",
        // Deliberately NO top-level `subscription` — that field does not
        // exist on this API version's Invoice object.
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: subId, metadata: null },
          quote_details: null,
        },
      },
    },
  };

  const res = await postEvent(evt);
  // A fake subscription id makes the live subscriptions.retrieve() call
  // fail — which is the PROOF the handler extracted subId from the
  // current-API shape and tried to act on it. The old code's
  // `if (!subId) return;` on a nonexistent top-level field would instead
  // succeed with 200 and never call Stripe at all.
  res.status === 500
    ? pass(
        "subscription id read from parent.subscription_details",
        "handler attempted the authoritative re-fetch (500 on a fake id, as expected)"
      )
    : fail(
        "subscription id read from parent.subscription_details",
        `expected 500 (live retrieve attempted), got ${res.status} ${JSON.stringify(res.body)} — the handler may be silently no-op'ing on a field that no longer exists`
      );
}

// ---------------------------------------------------------------------------
// 10. Price drift — the public pricing page's copy vs the live Stripe
//     Price objects the six STRIPE_PRICE_ID_* env vars actually point at.
//     docs/PLAN-GATES.md records this happening once already: the public
//     page said Business was $39/seat ($78 at the two-seat floor) while
//     the configured test-mode Prices were still the placeholder ladder
//     ($29/$49/$89) — a $178 checkout behind a page that said $78, with
//     nothing anywhere catching the mismatch. This section is that catch.
//
//     TIER_PRICE_COPY below is a DELIBERATE DUPLICATE of
//     app/(marketing)/pricing/pricing-model.ts's export of the same name
//     (see lib/stripe/price-drift.ts for the in-app version of this same
//     check, which imports the real module directly) — this script runs
//     under plain `node`, without the TypeScript loader `npm run
//     billing:verify`'s sibling scripts use, so it cannot import a .ts
//     module. If the owner signs a new price, BOTH copies move together:
//     pricing-model.ts (what pilots read) and this table (what CI checks
//     it against). This section only compares numbers that already exist
//     — it never invents or writes a price.
// ---------------------------------------------------------------------------
console.log("\nPrice drift (public copy vs live Stripe Price)");
{
  const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!SECRET_KEY) {
    skip("price drift", "needs STRIPE_SECRET_KEY to read live Price objects");
  } else {
    // Mirrors lib/entitlements.ts's TIER_PRICE_ENV and
    // pricing-model.ts's TIER_PRICE_COPY (in cents). Keep both in sync by
    // hand if either source moves — see the section header.
    const TIER_PRICE_ENV = {
      solo: { monthly: "STRIPE_PRICE_ID_SOLO", annual: "STRIPE_PRICE_ID_SOLO_ANNUAL" },
      pro: { monthly: "STRIPE_PRICE_ID_PRO", annual: "STRIPE_PRICE_ID_PRO_ANNUAL" },
      business: { monthly: "STRIPE_PRICE_ID_BUSINESS", annual: "STRIPE_PRICE_ID_BUSINESS_ANNUAL" },
    };
    const TIER_PRICE_COPY_CENTS = {
      solo: { monthly: 2900, annual: 29000 },
      pro: { monthly: 4900, annual: 49000 },
      business: { monthly: 3900, annual: 39000 },
    };

    const stripe = new Stripe(SECRET_KEY, { apiVersion: "2026-07-29.dahlia" });
    let anyConfigured = false;
    let anyMismatch = false;

    for (const tier of Object.keys(TIER_PRICE_ENV)) {
      for (const interval of ["monthly", "annual"]) {
        const envVar = TIER_PRICE_ENV[tier][interval];
        const priceId = process.env[envVar];
        if (!priceId) continue; // unconfigured tier/interval — nothing to compare
        anyConfigured = true;
        const expectedCents = TIER_PRICE_COPY_CENTS[tier][interval];

        try {
          const price = await stripe.prices.retrieve(priceId);
          if (price.unit_amount === expectedCents) {
            pass(
              `${tier}/${interval} price matches public copy`,
              `${envVar}=${priceId} is ${(price.unit_amount / 100).toFixed(2)}`
            );
          } else {
            anyMismatch = true;
            fail(
              `${tier}/${interval} price matches public copy`,
              `pricing-model.ts says ${(expectedCents / 100).toFixed(2)}/unit, but ${envVar} ` +
                `(${priceId}) is actually ${
                  typeof price.unit_amount === "number"
                    ? (price.unit_amount / 100).toFixed(2)
                    : "not a flat unit_amount"
                } — checkout will charge a different figure than the public page shows`
            );
          }
        } catch (err) {
          anyMismatch = true;
          fail(
            `${tier}/${interval} price matches public copy`,
            `could not retrieve ${envVar} (${priceId}): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    }

    if (!anyConfigured) {
      skip("price drift", "none of the six STRIPE_PRICE_ID_* env vars are set");
    } else if (!anyMismatch) {
      console.log("  (every configured price agrees with pricing-model.ts)");
    }
  }
}

console.log(
  `\n${passed} passed, ${failed} failed` +
    (skipped ? `, ${skipped} SKIPPED (this run did NOT verify everything)` : "") +
    "\n"
);
if (skipped && !failed) {
  console.log(
    "billing:verify did not run to completion — set NEXT_SUPABASE_URL and\n" +
      "NEXT_SUPABASE_SECRET_KEY to exercise the out-of-order and retry-safety\n" +
      "sections, and STRIPE_PRICE_ID_SOLO + STRIPE_PRICE_ID_PRO for the\n" +
      "plan-tier mapping section. Do not read this run as a green suite.\n"
  );
}
process.exit(failed > 0 ? 1 : 0);
