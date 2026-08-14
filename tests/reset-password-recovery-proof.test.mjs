import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

/**
 * THE RECOVERY-PROOF GATE.
 *
 * `supabase.auth.getUser()` proves a session exists; it does not prove the
 * session was minted by completing an emailed recovery link rather than by
 * riding one that was already open. Without a second check, anyone holding
 * a live session — a stolen cookie, an unattended laptop — could navigate
 * straight to /reset-password and set a new password with zero challenge,
 * which is the account-takeover path lib/supabase/reauth.ts's header
 * describes and this gate closes.
 *
 * WHY THIS TEST SCANS SOURCE RATHER THAN CALLING THE CODE. Every file in
 * this gate is a Next.js server module: app/auth/confirm/route.ts and
 * app/(auth)/reset-password/actions.ts both call next/headers' cookies(),
 * which throws outside a request scope, and lib/supabase/reauth.ts imports
 * "server-only", whose package.json unconditionally throws under a plain
 * Node import (it relies on a bundler's "react-server" export condition to
 * swap in the no-op build — see node_modules/server-only/package.json).
 * None of the three can be imported by node:test directly. Mechanical
 * source-scanning is the same shape tests/dashboard-path.test.mjs already
 * uses for the same reason, and it still fails the moment either file's
 * logic is edited out from under it.
 */

const reauthSource = read("lib/supabase/reauth.ts");
const confirmSource = read("app/auth/confirm/route.ts");
const actionsSource = read("app/(auth)/reset-password/actions.ts");

const cookieNameMatch = reauthSource.match(
  /RECOVERY_PROOF_COOKIE\s*=\s*"([^"]+)"/
);
assert.ok(
  cookieNameMatch,
  "lib/supabase/reauth.ts no longer exports RECOVERY_PROOF_COOKIE as a " +
    "string literal — update this test if it was intentionally restructured"
);
const COOKIE_NAME = cookieNameMatch[1];

test("the recovery-proof cookie is a real, named marker — not an empty string", () => {
  assert.ok(COOKIE_NAME.length > 0);
});

test("app/auth/confirm/route.ts sets the cookie, and only on an actual recovery flow", async (t) => {
  await t.test("imports the shared constant rather than a hand-typed cookie name", () => {
    assert.match(
      confirmSource,
      /import\s*\{[^}]*RECOVERY_PROOF_COOKIE[^}]*\}\s*from\s*["']@\/lib\/supabase\/reauth["']/,
      "a hand-typed cookie name here can drift from what reset-password/actions.ts checks for"
    );
  });

  await t.test("sets it httpOnly, on the redirect response, gated on the recovery token type", () => {
    assert.match(
      confirmSource,
      /response\.cookies\.set\(\s*RECOVERY_PROOF_COOKIE/,
      "the cookie is never set on the response"
    );
    assert.match(confirmSource, /httpOnly:\s*true/);
    assert.match(
      confirmSource,
      /type === "recovery"/,
      "must gate on the token_hash flow's type==='recovery', not on any " +
        "successful verifyOtp/exchangeCodeForSession (signup confirmation " +
        "and magic-link would also succeed here)"
    );
  });

  await t.test("the code (PKCE) branch is scoped to the reset-password destination, not any successful exchange", () => {
    assert.match(
      confirmSource,
      /next === "\/reset-password"/,
      "the PKCE `code` shape carries no token type at all — without " +
        "checking `next`, a code from ANY flow (signup, magic link) would " +
        "mint the recovery proof"
    );
  });
});

test("app/(auth)/reset-password/actions.ts requires and then clears the cookie", async (t) => {
  await t.test("imports the shared constant", () => {
    assert.match(
      actionsSource,
      /import\s*\{[^}]*RECOVERY_PROOF_COOKIE[^}]*\}\s*from\s*["']@\/lib\/supabase\/reauth["']/
    );
  });

  await t.test("checks the cookie BEFORE calling updateUser — the actual gate", () => {
    const cookieCheckIdx = actionsSource.search(
      /cookieStore\.get\(RECOVERY_PROOF_COOKIE\)/
    );
    const updateUserIdx = actionsSource.indexOf("updateUser({ password }");
    assert.notEqual(
      cookieCheckIdx,
      -1,
      "setNewPassword never reads the recovery-proof cookie — a live " +
        "session with no proof of a recovery flow could still set a new " +
        "password"
    );
    assert.notEqual(updateUserIdx, -1, "setNewPassword no longer calls updateUser({ password })");
    assert.ok(
      cookieCheckIdx < updateUserIdx,
      "the recovery-proof cookie must be checked BEFORE updateUser runs, " +
        "or the password gets changed before the gate has a say"
    );
  });

  await t.test("clears the cookie AFTER a successful update — single use", () => {
    const updateUserIdx = actionsSource.indexOf("updateUser({ password }");
    const deleteIdx = actionsSource.indexOf(
      "cookieStore.delete(RECOVERY_PROOF_COOKIE)"
    );
    assert.notEqual(
      deleteIdx,
      -1,
      "the recovery-proof cookie is never cleared — the same recovery " +
        "session could set more than one password within its window"
    );
    assert.ok(deleteIdx > updateUserIdx, "the cookie must be cleared after the update it authorized, not before");
  });

  await t.test("the no-session branch is unchanged: still an error return, not a throw or redirect", () => {
    assert.match(
      actionsSource,
      /if\s*\(!user\)\s*\{\s*return\s*\{/,
      "the page's redirect-to-/forgot-password for a cold, no-session " +
        "visitor is a separate guard in page.tsx; this action's own " +
        "no-session case must keep returning a form error, not throwing"
    );
  });
});

test("password rules come from the single source of truth, not a hand-rolled floor", () => {
  assert.match(
    actionsSource,
    /import\s*\{\s*passwordProblem\s*\}\s*from\s*["']@\/lib\/password-policy["']/,
    "reset-password/actions.ts must call lib/password-policy.ts's " +
      "passwordProblem() — a hand-rolled `password.length < 8` here (as " +
      "this file used to have) silently misses the 72-byte bcrypt-" +
      "truncation guard and goes stale the moment the floor changes " +
      "anywhere else"
  );
  assert.doesNotMatch(
    actionsSource,
    /if\s*\(\s*password\.length\s*<\s*8\s*\)/,
    "a hand-rolled length check has crept back in alongside passwordProblem()"
  );
});
