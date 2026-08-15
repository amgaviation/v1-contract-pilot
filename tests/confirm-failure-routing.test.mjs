import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const source = read("app/auth/confirm/route.ts");

/**
 * WHERE A DEAD EMAILED LINK LANDS.
 *
 * Every failure used to go to /forgot-password?expired=1, which put a pilot
 * whose SIGNUP link had expired on a password-reset form for an account
 * they had never confirmed. The reset mail either never arrives or lands
 * them in a second dead end, and nothing on the screen relates to what they
 * were doing.
 *
 * The routing is now per flow, and this file exists mostly to prove that
 * splitting it did NOT loosen the recovery-proof gate next to it. That gate
 * is the reason a stolen session cannot set a new password
 * (lib/supabase/reauth.ts), and it is derived from the same `type` / `code`
 * / `next` values the routing now reads.
 *
 * Source-scanned rather than executed, for the reason
 * tests/reset-password-recovery-proof.test.mjs states: this is a Next
 * server module and cannot be imported by node:test.
 */

test("recovery keeps the destination that can issue it a new link", () => {
  assert.match(source, /"\/forgot-password\?expired=1"/);
  const recoveryGate = source.indexOf("if (isRecovery) {");
  // The redirect CALL, not the first mention of the path: the comment above
  // the branch names it too.
  const recoveryRedirect = source.indexOf(
    'NextResponse.redirect(new URL("/forgot-password?expired=1"'
  );
  assert.notEqual(recoveryRedirect, -1, "the recovery failure no longer redirects there");
  assert.notEqual(recoveryGate, -1, "the failure branch no longer gates on the flow");
  assert.ok(
    recoveryGate < recoveryRedirect,
    "/forgot-password must be reachable only for a recovery failure"
  );
});

test("a signup or email-change failure gets its own destination", () => {
  const failedIdx = source.indexOf("if (failed) {");
  const expiredIdx = source.indexOf("/link-expired?flow=");
  assert.notEqual(failedIdx, -1);
  assert.notEqual(
    expiredIdx,
    -1,
    "a non-recovery failure still falls through to the password-reset form"
  );
  assert.ok(expiredIdx > failedIdx, "the routing must happen in the failure branch");
  assert.match(
    source,
    /type === "email_change" \? "email-change" : "signup"/,
    "the two non-recovery flows need different copy: an email change cannot " +
      "be resent from a signed-out screen"
  );
});

test("THE RECOVERY-PROOF DERIVATION IS UNCHANGED, only moved", () => {
  // The whole risk of this edit is that hoisting the derivation above the
  // verification quietly widened it. It is pinned character for character.
  const matches = source.match(/const isRecovery =[\s\S]*?;/g) ?? [];
  assert.equal(matches.length, 1, "isRecovery must be derived exactly once");
  const normalized = matches[0].replace(/\s+/g, " ");
  assert.equal(
    normalized,
    'const isRecovery = type === "recovery" || (Boolean(code) && next === "/reset-password");',
    "the recovery gate's expression changed. A code from a non-recovery " +
      "flow must never be able to set the recovery-proof cookie: the " +
      "token_hash shape must say type=recovery outright, and the PKCE code " +
      "shape qualifies only when it resolves to next=/reset-password, which " +
      "only forgot-password/actions.ts ever sets."
  );
});

test("the proof cookie is still written only after a verification that succeeded", () => {
  const failedIdx = source.indexOf("if (failed) {");
  const cookieIdx = source.indexOf("response.cookies.set(RECOVERY_PROOF_COOKIE");
  assert.notEqual(cookieIdx, -1, "the recovery-proof cookie is never set");
  assert.ok(
    cookieIdx > failedIdx,
    "the cookie must be set below the failure return, on the success path only"
  );
  // And it must still be inside a gate, not on every success.
  const gateBefore = source.lastIndexOf("if (isRecovery) {", cookieIdx);
  assert.ok(
    gateBefore !== -1 && gateBefore < cookieIdx,
    "the cookie is no longer gated on isRecovery, so a signup or magic-link " +
      "session would mint the proof"
  );
});

test("signup and email-change destinations cannot collide with the recovery one", () => {
  // The PKCE half of the gate is "next === '/reset-password'", so the two
  // flows that now also arrive here must never be sent to that path.
  const signup = read("app/(auth)/signup/actions.ts");
  const profile = read("app/(app)/settings/profile-actions.ts");
  assert.doesNotMatch(signup, /next=.{0,4}\/reset-password/);
  assert.doesNotMatch(profile, /next=.{0,4}\/reset-password/);
  assert.match(signup, /encodeURIComponent\("\/welcome"\)/);
});
