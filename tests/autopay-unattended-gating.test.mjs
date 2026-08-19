import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { accountIsReadOnly, isEntitled, isPlanTier } from "../lib/entitlements.ts";

/**
 * WHAT STOPS THE UNATTENDED AUTOPAY PASS CHARGING SOMEONE IT SHOULD NOT.
 *
 * lib/autopay/run.ts is the first thing in this product that creates an
 * invoice and charges a saved card with nobody present. It does not invent
 * its own eligibility rules — it calls accountIsReadOnly() and isEntitled(),
 * the same pure functions the interactive path's requireEntitlement uses.
 * That reuse is deliberate, and it means the pass's safety is only as good
 * as those functions' behaviour, which is what this file pins.
 *
 * The interesting case is `past_due`, and it is the whole reason this file
 * exists. runAllDueReminders deliberately INCLUDES past_due — chasing an
 * unpaid invoice is still the right thing to do for a tenant whose own card
 * just failed. Autopay must not: past_due is absent from
 * ACCOUNT_WRITABLE_STATUSES, so the account is read-only, and creating and
 * charging an invoice on it is exactly the write that gate refuses.
 *
 * If someone ever adds "past_due" to ACCOUNT_WRITABLE_STATUSES to fix some
 * unrelated screen, this test is what says "and that would also start
 * charging cards on lapsed accounts."
 */

test("a past_due account is read-only, so the unattended pass must skip it", () => {
  assert.equal(
    accountIsReadOnly({ status: "past_due", deactivated_at: null, hold_started_at: null }),
    true,
    "past_due must be read-only — otherwise the autopay pass would generate and charge on a lapsed account"
  );
});

test("only trialing and active are writable, and both are eligible for unattended autopay", () => {
  assert.equal(accountIsReadOnly({ status: "trialing", deactivated_at: null, hold_started_at: null }), false);
  assert.equal(accountIsReadOnly({ status: "active", deactivated_at: null, hold_started_at: null }), false);
});

test("a deactivated account is read-only even while status still reads active", () => {
  // The window this covers is real: pilot.deactivate_account cannot write
  // `status` (the protect trigger reserves it for the webhook), so between
  // the owner's click and Stripe's event landing, status is still 'active'.
  assert.equal(
    accountIsReadOnly({ status: "active", deactivated_at: "2026-08-19T00:00:00Z", hold_started_at: null }),
    true,
    "a deactivated account must not be charged during the webhook's flight time"
  );
});

test("an account on hold is read-only even while status still reads active", () => {
  // Stripe's pause_collection keeps a subscription 'active' by design, so
  // the local column is the only thing that knows a hold is on.
  assert.equal(
    accountIsReadOnly({ status: "active", deactivated_at: null, hold_started_at: "2026-08-19T00:00:00Z" }),
    true,
    "an account on hold must not have its clients charged"
  );
});

test("recurring invoices are a pro feature, so a solo account never gets an unattended charge", () => {
  assert.ok(isPlanTier("solo"));
  assert.equal(isEntitled("solo", "recurring_invoices"), false);
  assert.equal(isEntitled("pro", "recurring_invoices"), true);
  assert.equal(isEntitled("business", "recurring_invoices"), true);
});

test("an unrecognised plan_tier is not entitled — the pass must fail closed", () => {
  // run.ts guards with `!isPlanTier(tier) || !isEntitled(...)`. A null or
  // garbage tier (a row written before tiers existed, a typo in a manual
  // fix) must skip the account rather than throw or default to entitled.
  assert.equal(isPlanTier(null), false);
  assert.equal(isPlanTier("enterprise"), false);
  assert.equal(isPlanTier(""), false);
});

/**
 * The SELECT in lib/autopay/run.ts is layer 1 of three (see that file's
 * header); the entitlement re-check above is layer 2 and the database
 * function is layer 3. Layers 2 and 3 are asserted by execution elsewhere —
 * this pins layer 1, because a WHERE clause is the one layer no unit test
 * reaches and the easiest to widen by accident while "fixing" the pass to
 * match the reminders one it sits beside.
 */
test("the unattended pass's account filter is narrower than the reminders pass's", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/autopay/run.ts", import.meta.url)),
    "utf8"
  );
  const select = src.slice(src.indexOf('.from("accounts")'), src.indexOf("if (error) {"));

  assert.ok(
    select.includes('"trialing"') && select.includes('"active"'),
    "the pass must consider trialing and active accounts"
  );
  assert.ok(
    !select.includes('"past_due"'),
    "past_due must NOT be selected for autopay — it is read-only, and charging it is the exact write accountIsReadOnly refuses"
  );
  assert.ok(
    select.includes('.is("deactivated_at", null)'),
    "deactivated accounts must be excluded in the query as well as in the re-check"
  );
  assert.ok(
    select.includes('.is("hold_started_at", null)'),
    "accounts on hold must be excluded in the query as well as in the re-check"
  );
});

/**
 * The two sqlstates the pass must never conflate. 23505 is the idempotency
 * ledger doing its job (somebody generated this period first) and is a
 * silent, normal outcome. 42501 means the EXECUTE grant is missing — the
 * mechanism cannot run at all — and folding it in with business refusals is
 * precisely how pilot.expire_hold's missing grant stayed invisible for a
 * whole release while reporting success every night.
 */
test("the pass distinguishes 23505 (already generated) from 42501 (broken grant)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/autopay/run.ts", import.meta.url)),
    "utf8"
  );
  assert.ok(src.includes('rpcError.code === "23505"'), "23505 must be handled as already-generated");
  assert.ok(src.includes('rpcError.code === "42501"'), "42501 must be handled as a broken grant, not a refusal");
  const at23505 = src.indexOf('rpcError.code === "23505"');
  const at42501 = src.indexOf('rpcError.code === "42501"');
  const atGenericRefusal = src.indexOf("summary.refusedByDatabase += 1");
  assert.ok(
    at23505 < atGenericRefusal && at42501 < atGenericRefusal,
    "both specific sqlstates must be checked BEFORE the generic business-refusal branch, or they fall into it"
  );
});
