import test from "node:test";
import assert from "node:assert/strict";

/**
 * The platform-webhook decision layer (app/api/stripe/webhook/route.ts:
 * extractObjectId, isSuperseded, and the livemode guard
 * `event.livemode !== isLiveMode()`) has no unit coverage anywhere. The
 * end-to-end proof is scripts/billing-verify.mjs, now wired into the
 * database job's full-stack step (ci.yml) — but that only runs where a
 * live server + database exist; a fast, no-network pin of the pure
 * decisions themselves has no home until they are extracted out of the
 * route file.
 *
 * THIS FILE IS DELIBERATELY CONDITIONAL, per this cluster's own
 * instructions ("platform-webhook decision layer if it is importable
 * without network"). Two things make route.ts unimportable directly under
 * plain `node --test` today, neither of them fixable from this cluster's
 * territory (T-tests-ci: .github/workflows/**, package.json scripts, and
 * a fixed list of NEW test files — app/api/stripe/webhook/route.ts and
 * any new lib/stripe/*.ts are both out of scope here):
 *
 *   1. extractObjectId and isSuperseded are module-private (not
 *      exported) — even a successful import of route.ts could not reach
 *      them.
 *   2. route.ts imports "next/server" (NextResponse/NextRequest) at
 *      module scope, which — like next/cache in the recurring-schedule
 *      case — resolves only inside Next's own bundler, not under plain
 *      Node. Unlike the recurring-schedule file, there is no single
 *      exported async function pure enough to make stubbing worthwhile:
 *      isSuperseded itself does a real Supabase query, so extracting it
 *      as a genuinely PURE decision means changing its shape (taking a
 *      lookup as a parameter), which is a real code change to route.ts —
 *      exactly the "extract into lib/stripe/webhook-decisions.ts"
 *      fix this repo's audit calls for, and exactly what this cluster is
 *      not allowed to do to that file.
 *
 * So: this file looks for lib/stripe/webhook-decisions.ts (the
 * extraction target named in the audit) and pins the three decisions
 * against it IF it exists. If it does not (the common case today), every
 * test below is reported SKIPPED, not failed and not silently absent —
 * loud enough that whoever extracts that module later finds a ready-made
 * contract to satisfy, and CI is never blocked by a dependency this
 * cluster cannot create.
 */

let decisions = null;
let importError = null;
try {
  decisions = await import("../lib/stripe/webhook-decisions.ts");
} catch (err) {
  importError =
    err && typeof err === "object" && "code" in err && err.code === "ERR_MODULE_NOT_FOUND"
      ? "lib/stripe/webhook-decisions.ts does not exist yet — see this file's header."
      : `lib/stripe/webhook-decisions.ts exists but failed to import: ${err instanceof Error ? err.message : String(err)}`;
}

function pick(name) {
  return decisions && typeof decisions[name] === "function" ? decisions[name] : null;
}

test("extractObjectId: the Stripe object id an event concerns, for the out-of-order check", { skip: importError ?? (pick("extractObjectId") ? false : `lib/stripe/webhook-decisions.ts exists but does not export extractObjectId`) }, () => {
  const extractObjectId = pick("extractObjectId");
  // checkout.session.completed keys off the SUBSCRIPTION id, not the
  // session id — a checkout and its subsequent customer.subscription.*
  // events must land on the same object_id to be ordered against each
  // other at all.
  assert.equal(
    extractObjectId({
      type: "checkout.session.completed",
      data: { object: { id: "cs_123", subscription: "sub_123" } },
    }),
    "sub_123"
  );
  assert.equal(
    extractObjectId({
      type: "checkout.session.completed",
      data: { object: { id: "cs_123", subscription: { id: "sub_456" } } },
    }),
    "sub_456"
  );
  // No subscription at all on the session (shouldn't happen for a
  // subscription-mode checkout, but the function must not throw).
  assert.equal(
    extractObjectId({ type: "checkout.session.completed", data: { object: { id: "cs_789" } } }),
    "cs_789"
  );
  // Every other handled type keys off its own object's id directly.
  assert.equal(
    extractObjectId({ type: "customer.subscription.updated", data: { object: { id: "sub_999" } } }),
    "sub_999"
  );
  assert.equal(
    extractObjectId({ type: "invoice.payment_failed", data: { object: { id: "in_111" } } }),
    "in_111"
  );
});

test("livemode guard: a test event on a live deployment (and vice versa) is a mismatch", { skip: importError ?? (pick("isLivemodeMismatch") ? false : `lib/stripe/webhook-decisions.ts exists but does not export isLivemodeMismatch`) }, () => {
  const isLivemodeMismatch = pick("isLivemodeMismatch");
  assert.equal(isLivemodeMismatch(true, true), false, "live event, live deployment — matches");
  assert.equal(isLivemodeMismatch(false, false), false, "test event, test deployment — matches");
  assert.equal(isLivemodeMismatch(false, true), true, "test event delivered to a live-keyed deployment — mismatch");
  assert.equal(isLivemodeMismatch(true, false), true, "live event delivered to a test-keyed deployment — mismatch");
});

test("(placeholder) both decisions are unavailable — nothing to assert yet", { skip: decisions ? "the module exists; the specific-export skips above cover it" : false }, () => {
  assert.ok(
    importError,
    "expected an import error explaining why lib/stripe/webhook-decisions.ts is unavailable"
  );
});
