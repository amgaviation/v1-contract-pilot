import test from "node:test";
import assert from "node:assert/strict";

const {
  PLAN_TIERS,
  seatsForTier,
  ACCOUNT_WRITABLE_STATUSES,
  isWritableStatus,
} = await import("../lib/entitlements.ts");

/**
 * The two pure helpers Findings 1–3 hang on. Both live in the entitlement
 * vocabulary source so the checkout path, the plan-change path, and the
 * read-only gate read the same fact rather than three hand-synced copies —
 * which is exactly what drifted (welcome showed $39, checkout billed $78;
 * changePlan omitted the seat minimum entirely). All fixtures synthetic.
 */

test("seatsForTier: Business starts at its two-seat minimum, flat tiers at one", () => {
  // docs/PRICING.md §3.2/§7 — the floor that makes the welcome price, the
  // checkout quantity, and the plan-change quantity agree.
  assert.equal(seatsForTier("business"), 2);
  assert.equal(seatsForTier("solo"), 1);
  assert.equal(seatsForTier("pro"), 1);
  // Every tier resolves to a whole seat count >= 1 — a checkout quantity
  // can never be zero or fractional.
  for (const tier of PLAN_TIERS) {
    const seats = seatsForTier(tier);
    assert.ok(Number.isInteger(seats) && seats >= 1, `${tier} seats >= 1`);
  }
});

test("seatsForTier models the actual first charge (unit x seats)", () => {
  // The bug Finding 1 fixed: the number shown must equal what Stripe bills.
  // At $39/seat, Business bills 39 * 2 = $78; the flat tiers bill their unit.
  const unitCents = 3900;
  assert.equal(unitCents * seatsForTier("business"), 7800);
  assert.equal(2900 * seatsForTier("solo"), 2900);
});

test("isWritableStatus: only a live trial or active subscription may write", () => {
  assert.deepEqual([...ACCOUNT_WRITABLE_STATUSES], ["trialing", "active"]);
  assert.equal(isWritableStatus("trialing"), true);
  assert.equal(isWritableStatus("active"), true);
});

test("isWritableStatus: every lapsed/terminal status is read-only (fail closed)", () => {
  // The full Stripe status enum the Phase-1 CHECK pins, minus the two
  // writable ones. past_due is deliberately read-only (Finding 3's brief):
  // a failed renewal stops new work while records stay readable.
  const readOnly = [
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
  ];
  for (const status of readOnly) {
    assert.equal(isWritableStatus(status), false, `${status} must be read-only`);
  }
  // An unknown/future status defaults to read-only, never to writable by
  // omission — the whole point of an allow-list.
  assert.equal(isWritableStatus("some_future_status"), false);
  assert.equal(isWritableStatus(""), false);
});

/**
 * THE DEACTIVATION WINDOW.
 *
 * pilot.deactivate_account cannot write `status`: that column mirrors
 * Stripe's subscription state and pilot.protect_account_billing_columns()
 * reserves it for the service role, so the webhook is its only writer
 * (20260818140000_deactivate_without_status_write.sql — the first version
 * of that function tried to write it and failed on every call).
 *
 * The consequence is a window. The server action cancels at Stripe, stamps
 * deactivated_at, and returns; customer.subscription.deleted arrives some
 * time later. Until it does, `status` still reads 'active' or 'trialing'.
 * If the read-only gate consulted status alone, a deactivated account would
 * keep accepting writes for the length of that window.
 */
const { accountIsReadOnly } = await import("../lib/entitlements.ts");

test("a deactivated account is read-only immediately, before Stripe's webhook lands", () => {
  // The exact shape of the window: the owner has deactivated, Stripe has
  // not told us yet, and the account must already be closed for writes.
  assert.equal(
    accountIsReadOnly({ status: "active", deactivated_at: "2026-08-18T03:20:06Z" }),
    true
  );
  assert.equal(
    accountIsReadOnly({ status: "trialing", deactivated_at: "2026-08-18T03:20:06Z" }),
    true
  );
});

test("deactivated_at does not make a live account read-only when it is null", () => {
  assert.equal(accountIsReadOnly({ status: "active", deactivated_at: null }), false);
  assert.equal(accountIsReadOnly({ status: "trialing", deactivated_at: null }), false);
  // And the pre-existing status rule is untouched.
  assert.equal(accountIsReadOnly({ status: "canceled", deactivated_at: null }), true);
  assert.equal(accountIsReadOnly({ status: "past_due", deactivated_at: null }), true);
});
