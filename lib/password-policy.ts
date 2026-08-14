/**
 * The password rules, stated once.
 *
 * Three surfaces set a password — signup, the emailed reset link, and (as
 * of the account-depth wave) the signed-in change-password form in
 * Settings → Profile & security. Before this file the 8-character floor
 * was spelled out twice in prose ("Same floor as signup/actions.ts — a
 * reset must not be a way around it" is a real comment in
 * app/(auth)/reset-password/actions.ts), which is exactly the shape that
 * goes stale: raise the floor in one place and the other two quietly keep
 * accepting what the first now refuses.
 *
 * DELIBERATELY PURE. No imports, no "server-only" — the unit suite
 * (tests/password-policy.test.mjs) exercises the real module, and a client
 * component may show the same sentence before the round trip if it ever
 * wants to.
 *
 * The messages are the product's own voice, not a validator's: they say
 * what to do, never "invalid input".
 */

/**
 * Supabase's own floor is 6 characters by default; this product's is 8 and
 * has been since signup shipped. Raising it here raises it everywhere.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * bcrypt — which is what GoTrue hashes with — silently truncates at 72
 * BYTES. A pilot who pastes a 90-character passphrase and later types the
 * first 72 would be let in, which is a confusing enough behaviour to be
 * worth refusing up front rather than inheriting. Measured in bytes, not
 * characters, because a passphrase with an accented letter or an emoji in
 * it costs more than one byte per character and would otherwise pass this
 * check and still be truncated.
 */
export const MAX_PASSWORD_BYTES = 72;

function byteLength(value: string): number {
  // TextEncoder is in every runtime this product targets (Node 20+, the
  // browser, the edge). Counting `value.length` instead would measure UTF-16
  // code units and undercount exactly the passphrases this guard is for.
  return new TextEncoder().encode(value).length;
}

/**
 * The first problem with a proposed new password, as a sentence to show —
 * or null when there is none.
 *
 * `confirm` is the second field every one of these forms carries; pass the
 * same string twice if a caller genuinely has only one field.
 *
 * `current` is the password being replaced, when the caller knows it (the
 * signed-in change form does; the emailed-reset form does not). Refusing a
 * no-op change is not pedantry — a pilot who believes they have rotated a
 * password that in fact never changed is worse off than one told to pick a
 * different one.
 */
export function passwordProblem(
  password: string,
  confirm: string,
  current?: string
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  }
  if (byteLength(password) > MAX_PASSWORD_BYTES) {
    return `That password is too long. Keep it to ${MAX_PASSWORD_BYTES} characters or fewer.`;
  }
  if (password !== confirm) {
    return "Those two passwords don't match.";
  }
  if (current !== undefined && current !== "" && current === password) {
    return "That's the password you already have. Pick a different one.";
  }
  return null;
}
