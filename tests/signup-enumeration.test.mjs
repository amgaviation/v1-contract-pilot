import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { classifySignUpError } = await import("../lib/auth/signup-outcome.ts");

const ROOT = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

/**
 * SIGNUP MUST NOT ANSWER "DOES THIS PERSON HAVE AN ACCOUNT HERE?".
 *
 * The action used to return Supabase's `error.message` verbatim, so an
 * address that already had an account came back as "User already
 * registered" and a public form became a membership test against every
 * pilot's email. login/actions.ts and forgot-password/actions.ts both
 * already refuse to answer that question; this pins the third.
 *
 * The other half of the job is that the fix must not have flattened
 * everything into a cheerful success, which would hide a real outage behind
 * a "check your email" screen nobody will ever get mail from.
 */

test("a taken address produces exactly the outcome a new address does", async (t) => {
  await t.test("every wording and code that means 'taken' lands on the same branch", () => {
    const taken = [
      ["user_already_exists", 422, "User already registered"],
      ["email_exists", 422, "Email address already registered by another user"],
      ["identity_already_exists", 422, "Identity is already linked"],
      // No code at all: older and self-hosted GoTrue send only a message,
      // and matching on the code alone would let the leak straight back in.
      [undefined, 400, "User already registered"],
      [null, 400, "A user with this email address has already been registered"],
    ];
    for (const [code, status, message] of taken) {
      assert.deepEqual(
        classifySignUpError(code, status, message),
        { kind: "pending-confirmation" },
        `${code ?? "no code"} / ${message} still discloses that the address is taken`
      );
    }
  });

  await t.test("and the action sends both cases to the same screen, by the same code path", () => {
    const source = read("app/(auth)/signup/actions.ts");

    assert.doesNotMatch(
      source,
      /return\s*\{\s*error:\s*error\.message\s*\}/,
      "signUp is returning Supabase's own error text again, which is the " +
        "defect this test exists for"
    );

    // One helper, called from both the taken path and the ordinary
    // no-session path. Two hand-written copies is how the two drift into
    // being distinguishable again.
    const calls = source.match(/toCheckEmail\(email\)/g) ?? [];
    assert.equal(
      calls.length,
      2,
      "the taken-address path and the new-signup path must both land on the " +
        "shared /check-email helper, so neither can drift"
    );
    assert.match(
      source,
      /redirect\("\/check-email"\)/,
      "the shared landing must be /check-email"
    );
  });
});

test("real failures stay visible and specific", async (t) => {
  await t.test("a failed confirmation SEND is its own outcome, not 'nothing was saved'", () => {
    // The exact case this product hit in production: the confirmation email
    // could not be sent. GoTrue creates the user row BEFORE the mail step,
    // so the old "nothing was saved" retry sentence was false here — and a
    // retry with the same address then classified as pending-confirmation
    // and landed on a screen claiming a link had been sent. The contract
    // now: this shape is "mail-failed", and the caller routes to
    // /check-email with copy that says the send failed and offers the
    // resend. (The earlier version of this test asserted the retry
    // sentence, guarding against a cheerful "check your email" — the
    // mail-failed path keeps that guarantee by arriving there flagged,
    // never with the link-is-on-its-way copy.)
    const outcome = classifySignUpError(
      "unexpected_failure",
      500,
      "Error sending confirmation email"
    );
    assert.equal(outcome.kind, "mail-failed");

    // Only the mail-send wording gets that treatment: an unrelated 500 and
    // a network fault keep the visible, generic retry sentence, because for
    // those "nothing was saved" is the likely truth.
    const network = classifySignUpError(undefined, undefined, "fetch failed");
    assert.equal(network.kind, "retry");
  });

  await t.test("Supabase's own words never reach the pilot", () => {
    const outcome = classifySignUpError(
      "unexpected_failure",
      500,
      "Database error saving new user: relation pilot.accounts does not exist"
    );
    assert.equal(outcome.kind, "retry");
    assert.doesNotMatch(outcome.message, /relation|database|pilot\./i);
  });

  await t.test("a weak password and a rejected address stay actionable", () => {
    const weak = classifySignUpError("weak_password", 422, "Password is known to be weak");
    assert.equal(weak.kind, "retry");
    assert.match(weak.message, /password/i);

    const bad = classifySignUpError("email_address_invalid", 400, "Email address is invalid");
    assert.equal(bad.kind, "retry");
    assert.match(bad.message, /email address/i);

    const limited = classifySignUpError("over_email_send_rate_limit", 429, "rate limit");
    assert.equal(limited.kind, "retry");
    assert.match(limited.message, /wait/i);
  });

  await t.test("none of the visible sentences names the account's existence", () => {
    const messages = [
      classifySignUpError("weak_password", 422, "weak"),
      classifySignUpError("unexpected_failure", 500, "boom"),
      classifySignUpError("over_request_rate_limit", 429, "slow down"),
      classifySignUpError("signup_disabled", 422, "signups disabled"),
    ].map((o) => o.message);
    for (const message of messages) {
      assert.doesNotMatch(
        message,
        /already|registered|exists|account with/i,
        `"${message}" hints at whether the address is taken`
      );
    }
  });
});

test("input validation is not flattened along with the disclosure", () => {
  // A malformed address and a short password are facts about what the
  // caller just typed. Refusing to explain those helps nobody and is not
  // what the enumeration rule is protecting.
  const source = read("app/(auth)/signup/actions.ts");
  assert.match(
    source,
    /looksLikeEmail\(email\)/,
    "the address shape check was removed along with the leak"
  );
  assert.match(
    source,
    /passwordProblem\(password, password\)/,
    "signup must read the floor from lib/password-policy.ts, not a " +
      "hand-rolled length check that misses the 72-byte bcrypt guard"
  );
  assert.doesNotMatch(
    source,
    /if\s*\(\s*password\.length\s*<\s*8\s*\)/,
    "the hand-rolled length check has crept back in"
  );
});

test("signup names where the confirmation link lands", () => {
  const source = read("app/(auth)/signup/actions.ts");
  assert.match(
    source,
    /emailRedirectTo/,
    "without emailRedirectTo the link lands on the project's Site URL, not " +
      "/auth/confirm, and the token is never exchanged"
  );
  assert.match(
    source,
    /\/auth\/confirm\?next=/,
    "the link must land on the confirm route and forward from there"
  );
  assert.match(
    source,
    /encodeURIComponent\("\/welcome"\)/,
    "a confirmed signup ends at /welcome, which offers the trial checkout"
  );
});
