#!/usr/bin/env node
/**
 * Platform-billing webhook verification (docs/PLAN.md: `npm run
 * billing:verify` — "trial creation, webhook idempotency (replay the same
 * event ID), out-of-order events, seat quantity sync, test/live mode
 * separation").
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
