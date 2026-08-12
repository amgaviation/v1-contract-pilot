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
