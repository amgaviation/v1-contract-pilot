import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  PENDING_SIGNUP_COOKIE,
  RESEND_COOLDOWN_SECONDS,
  RESEND_MAX_PER_WINDOW,
  RESEND_SENT_MESSAGE,
  RESEND_WINDOW_SECONDS,
  encodeSendHistory,
  parseSendHistory,
  recordSend,
  resendDecision,
  resendWaitMessage,
} = await import("../lib/auth/confirmation.ts");

const ROOT = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

/**
 * THE RESEND CONTROL on /check-email and /link-expired.
 *
 * Two things are worth pinning. The throttle, because a resend with no
 * ceiling is a way to have this product send mail to an address on demand,
 * and because a throttle that can be tripped into refusing forever is a
 * feature that quietly stops existing. And the enumeration behaviour, for
 * the reason forgot-password already refuses to answer the same question.
 *
 * The decision logic is pure and exercised directly. The action itself is a
 * Next server module (next/headers throws outside a request scope), so the
 * parts of it that matter are checked by scanning source, the same shape
 * tests/reset-password-recovery-proof.test.mjs uses for the same reason.
 */

const NOW = 1_770_000_000;

test("the throttle allows a first send and then holds the cooldown", async (t) => {
  await t.test("no history means go", () => {
    assert.deepEqual(resendDecision([], NOW), { allowed: true });
  });

  await t.test("a send one second ago is refused for the rest of the cooldown", () => {
    const decision = resendDecision([NOW - 1], NOW);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "cooldown");
    assert.equal(decision.retryAfterSeconds, RESEND_COOLDOWN_SECONDS - 1);
  });

  await t.test("the cooldown ends exactly when it says it does", () => {
    assert.deepEqual(
      resendDecision([NOW - RESEND_COOLDOWN_SECONDS], NOW),
      { allowed: true }
    );
  });
});

test("the hourly ceiling is real and the wait it reports is the longer of the two", () => {
  // Three sends, spread out enough that the cooldown has long since passed.
  const history = [NOW - 100, NOW - 1000, NOW - 2000];
  assert.equal(history.length, RESEND_MAX_PER_WINDOW);

  const decision = resendDecision(history, NOW);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "window");
  // The oldest of the three ages out at NOW - 2000 + RESEND_WINDOW_SECONDS.
  assert.equal(decision.retryAfterSeconds, RESEND_WINDOW_SECONDS - 2000);
});

test("sends that have aged out of the window stop counting", () => {
  const stale = [
    NOW - RESEND_WINDOW_SECONDS - 1,
    NOW - RESEND_WINDOW_SECONDS - 500,
    NOW - RESEND_WINDOW_SECONDS - 900,
  ];
  assert.deepEqual(resendDecision(stale, NOW), { allowed: true });
});

test("a cookie from a skewed or hostile clock cannot lock the control shut", () => {
  // A timestamp in the future would otherwise produce a negative elapsed
  // time, a cooldown that never expires, and a resend button that is dead
  // for as long as the cookie lives.
  assert.deepEqual(resendDecision([NOW + 86_400], NOW), { allowed: true });
});

test("the cookie value round-trips, and a malformed one is survivable", async (t) => {
  await t.test("round trip", () => {
    const history = recordSend([], NOW);
    assert.deepEqual(parseSendHistory(encodeSendHistory(history)), [NOW]);
  });

  await t.test("junk parses to nothing rather than throwing", () => {
    // This string arrives from a browser. Every one of these must be
    // survivable, because the alternative is a 500 on a page a pilot
    // reaches by clicking a link in their email.
    for (const junk of ["", "abc", ",,,", "NaN", "-5", "Infinity", "1;2"]) {
      assert.doesNotThrow(() => parseSendHistory(junk));
    }
    assert.deepEqual(parseSendHistory("abc"), []);
    assert.deepEqual(parseSendHistory("-5"), []);
    assert.deepEqual(parseSendHistory(undefined), []);
  });

  await t.test("the history cannot grow without a ceiling", () => {
    let history = [];
    for (let i = 0; i < 50; i += 1) {
      history = recordSend(history, NOW + i);
    }
    assert.ok(
      history.length <= RESEND_MAX_PER_WINDOW + 1,
      "an unbounded history cookie is a request-header-size bug waiting to happen"
    );
  });
});

test("the wait message is a number a person can act on", () => {
  assert.match(resendWaitMessage(1), /1 second\b/);
  assert.match(resendWaitMessage(45), /45 seconds/);
  assert.match(resendWaitMessage(2400), /40 minutes/);
  // Never zero, and never a fraction.
  assert.match(resendWaitMessage(0.4), /1 second\b/);
});

test("the resend action answers every outcome with one sentence", async (t) => {
  const source = read("app/(auth)/resend-actions.ts");

  await t.test("the address is taken from the httpOnly cookie first", () => {
    assert.ok(PENDING_SIGNUP_COOKIE.length > 0, "the cookie name is empty");
    assert.match(
      source,
      /cookieStore\.get\(PENDING_SIGNUP_COOKIE\)/,
      "the action must prefer the cookie over anything the caller posted, or " +
        "it becomes a resend-to-any-address endpoint"
    );
    assert.match(
      source,
      /const email = pending \|\| typed/,
      "the cookie must win over the posted field"
    );
  });

  await t.test("Supabase's error text is logged, never returned", () => {
    assert.match(source, /console\.error\("\[auth\] confirmation resend failed"/);
    assert.doesNotMatch(
      source,
      /return\s*\{\s*error:\s*error\.message/,
      "returning Supabase's own wording is how a resend becomes an " +
        "account-enumeration oracle"
    );
  });

  await t.test("the throttle is consulted before Supabase is", () => {
    const decisionIdx = source.indexOf("resendDecision(");
    const resendIdx = source.indexOf("supabase.auth.resend(");
    assert.notEqual(decisionIdx, -1, "the action no longer throttles at all");
    assert.notEqual(resendIdx, -1);
    assert.ok(
      decisionIdx < resendIdx,
      "a throttle checked after the send has already sent the email it was " +
        "meant to prevent"
    );
  });

  await t.test("a failed send is still counted", () => {
    const errorIdx = source.indexOf("if (error) {");
    const recordIdx = source.indexOf("recordSend(history, now)");
    assert.notEqual(recordIdx, -1);
    assert.ok(
      recordIdx > errorIdx,
      "counting only successful sends leaves a failing address free to be " +
        "probed at full speed"
    );
  });

  await t.test("the sentence says nothing about whether the account exists", () => {
    assert.match(RESEND_SENT_MESSAGE, /^If that address/);
    assert.doesNotMatch(RESEND_SENT_MESSAGE, /\bwe sent\b/i);
  });
});

test("both confirmation screens are on the proxy allow-list", () => {
  // Without this, a pilot who has just signed up (and therefore has no
  // session, which is the entire point of a confirmation link) is redirected
  // to /login and the flow has no visible middle.
  const proxy = read("lib/supabase/proxy.ts");
  assert.match(proxy, /normalizedPath === "\/check-email"/);
  assert.match(proxy, /normalizedPath === "\/link-expired"/);
});

test("no dash characters crept into the new confirmation copy", () => {
  // House rule: no em dash or en dash anywhere in this product's writing.
  for (const file of [
    "lib/auth/confirmation.ts",
    "lib/auth/signup-outcome.ts",
    "app/(auth)/resend-actions.ts",
    "app/(auth)/check-email/page.tsx",
    "app/(auth)/check-email/check-email-view.tsx",
    "app/(auth)/link-expired/page.tsx",
    "app/(auth)/link-expired/link-expired-view.tsx",
  ]) {
    const source = read(file);
    assert.ok(!source.includes("—"), `${file} contains an em dash`);
    assert.ok(!source.includes("–"), `${file} contains an en dash`);
  }
});
