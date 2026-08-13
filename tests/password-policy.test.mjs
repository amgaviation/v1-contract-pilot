import test from "node:test";
import assert from "node:assert/strict";

const { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordProblem } = await import(
  "../lib/password-policy.ts"
);

/**
 * lib/password-policy.ts is the ONE place the password rules live, and it
 * is pure precisely so this file can exercise the real module rather than
 * a copy of it. Three surfaces set a password (signup, the emailed reset,
 * and the signed-in change form); a rule that only holds in two of them is
 * a way around the third.
 */

test("the floor is 8 and is enforced", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  assert.match(passwordProblem(short, short) ?? "", /at least 8 characters/);
  const exact = "a".repeat(MIN_PASSWORD_LENGTH);
  assert.equal(passwordProblem(exact, exact), null);
});

test("length is checked BEFORE the match, so a short typo reports the useful problem", () => {
  // Both are wrong; the one worth saying first is the rule, not the typo.
  assert.match(passwordProblem("short", "different") ?? "", /at least 8 characters/);
});

test("mismatched confirmation is refused", () => {
  assert.match(
    passwordProblem("correct horse", "correct hose") ?? "",
    /don't match/
  );
});

test("a no-op change is refused when the current password is known", () => {
  const same = "same-password";
  assert.match(passwordProblem(same, same, same) ?? "", /already have/);
  // …and permitted when it is not known — the emailed-reset flow has no
  // current password to compare against and must not be blocked.
  assert.equal(passwordProblem(same, same), null);
  assert.equal(passwordProblem(same, same, ""), null);
});

test("the bcrypt ceiling is measured in BYTES, not characters", () => {
  assert.equal(MAX_PASSWORD_BYTES, 72);

  const at72 = "a".repeat(72);
  assert.equal(passwordProblem(at72, at72), null);

  const at73 = "a".repeat(73);
  assert.match(passwordProblem(at73, at73) ?? "", /too long/);

  // 40 four-byte emoji = 160 bytes but only 80 UTF-16 code units. A
  // character count would let this through and bcrypt would silently
  // truncate it — the exact bug the byte measurement exists to prevent.
  const emoji = "\u{1F681}".repeat(40);
  assert.ok(emoji.length < 160, "sanity: JS length undercounts astral chars");
  assert.match(passwordProblem(emoji, emoji) ?? "", /too long/);
});

test("every message is a sentence a pilot can act on, not a validator code", () => {
  const messages = [
    passwordProblem("x", "x"),
    passwordProblem("longenough", "longenoughX"),
    passwordProblem("longenough", "longenough", "longenough"),
    passwordProblem("a".repeat(999), "a".repeat(999)),
  ];
  for (const message of messages) {
    assert.ok(message, "expected a problem");
    assert.match(message, /[.!]$/, `not a sentence: ${message}`);
    assert.doesNotMatch(message, /invalid|error|failed/i, `validator-speak: ${message}`);
  }
});
