/**
 * ===========================================================================
 * WHAT A FAILED signUp IS ALLOWED TO SAY
 * ===========================================================================
 *
 * THE DEFECT THIS CLOSES. app/(auth)/signup/actions.ts used to return
 * `error.message` straight from Supabase. On a PUBLIC form that turns
 * signup into a membership test: type an address, read the answer, learn
 * whether that person has an account here. The list this product would be
 * answering questions about is a list of working pilots, and it is worth
 * money to whoever is assembling it. login/actions.ts and
 * forgot-password/actions.ts both already refuse to answer that question;
 * signup was the hole in the same wall.
 *
 * WHAT SUPABASE ACTUALLY DOES, checked before deciding the mapping rather
 * than assumed:
 *
 *   - With "Confirm email" ENABLED (this project's configuration), signUp
 *     for an address that already has an account returns NO error. It
 *     returns an obfuscated user object and no session, which is the same
 *     shape a brand new signup returns. The JS reference for signUp states
 *     the intent plainly: "if a user account exists in the system you may
 *     get back an error message that attempts to hide this information from
 *     the user"
 *     (https://supabase.com/docs/reference/javascript/auth-signup).
 *   - With confirmations DISABLED, the same call returns the error "User
 *     already registered" instead, and the obfuscation is gone. That is a
 *     project-level dashboard setting this repo cannot read, exactly like
 *     the Secure password change setting lib/supabase/reauth.ts describes,
 *     so the code must not assume it stays on.
 *   - An existing but UNCONFIRMED address gets its confirmation email
 *     resent, again with no error.
 *
 * SO THE MAPPING IS: anything that means "this address is taken" becomes
 * the SAME outcome a new signup produces, and the caller lands on
 * /check-email either way. Everything else keeps a specific, useful
 * sentence, because refusing to explain a weak password or a Supabase
 * outage helps nobody and hides real failures.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED. Two observable differences remain and
 * neither is fixable from this file:
 *   1. TIMING. A taken address sends no mail, so Supabase answers faster
 *      than it does for a new one. Closing that would mean holding every
 *      signup at a fixed latency floor, which slows the honest path to
 *      match the worst case for a defence that a noisy network already
 *      blurs. Recorded rather than papered over.
 *   2. With confirmations switched OFF at the project, a NEW signup gets a
 *      session and lands on /welcome while a taken one lands on
 *      /check-email. That difference is Supabase's, not this code's, and
 *      the product does not run in that configuration.
 *
 * DELIBERATELY PURE, like lib/password-policy.ts: no imports, so
 * tests/signup-enumeration.test.mjs exercises the real module.
 */

export type SignUpOutcome =
  /**
   * Indistinguishable path. A confirmation link is either on its way or the
   * address already has an account, and this product does not say which.
   */
  | { kind: "pending-confirmation" }
  /**
   * The account row was (very likely) created but the confirmation mail
   * failed to SEND. Distinct from "retry" because "nothing was saved" is
   * false here: GoTrue creates the user before it attempts the send, and a
   * mail-step failure surfaces as a 500/unexpected_failure AFTER the row
   * exists (observed live during the Resend domain outage; also
   * supabase/auth#1388). The caller routes to /check-email with honest
   * copy and lets the resend control carry the recovery. Saying "the email
   * couldn't be sent" is enumeration-safe: an SMTP/relay failure is a
   * systemic signal identical for every address attempted during the
   * incident, not a fact about any one address.
   */
  | { kind: "mail-failed" }
  /** A real, actionable failure. The sentence is safe to show. */
  | { kind: "retry"; message: string };

/**
 * Error codes that mean "that address is taken". `error.code` is typed as
 * ErrorCode in the installed @supabase/auth-js 2.111.0
 * (dist/module/lib/error-codes.d.ts), which carries all three of these.
 */
const TAKEN_CODES = new Set(["user_already_exists", "email_exists", "identity_already_exists"]);

/**
 * The wording GoTrue uses when it sends no code at all. Older releases and
 * some self-hosted versions return only a message, so matching the code
 * alone would let the leak back in the day the project's confirmations are
 * toggled off.
 */
const TAKEN_MESSAGE = /already\s+(registered|exists|in use)|already been registered/i;

/**
 * Classify what came back from `supabase.auth.signUp`.
 *
 * Takes the three fields off AuthError rather than the error object, so
 * this module stays import-free and testable.
 */
export function classifySignUpError(
  code: string | null | undefined,
  status: number | null | undefined,
  message: string | null | undefined
): SignUpOutcome {
  const text = message ?? "";

  if ((code && TAKEN_CODES.has(code)) || TAKEN_MESSAGE.test(text)) {
    return { kind: "pending-confirmation" };
  }

  // A fact about the password the caller just typed. Saying so discloses
  // nothing about who exists and is the only way they can fix it. The
  // product's own floor is checked before Supabase is called at all
  // (lib/password-policy.ts); this is the project's leaked-password and
  // strength policy, which only Supabase knows about.
  if (code === "weak_password") {
    return {
      kind: "retry",
      message:
        "That password was rejected as too weak or too common. Pick a different one.",
    };
  }

  // A fact about the address the caller just typed, and it is returned for
  // an address that has no account just as readily as for one that does.
  if (code === "email_address_invalid" || code === "email_address_not_authorized") {
    return {
      kind: "retry",
      message: "That email address was rejected. Check it and try again.",
    };
  }

  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    status === 429
  ) {
    return {
      kind: "retry",
      message: "Too many attempts just now. Wait a few minutes and try again.",
    };
  }

  if (code === "signup_disabled" || code === "email_provider_disabled") {
    return {
      kind: "retry",
      message:
        "New accounts are turned off on this project right now. Nothing was created.",
    };
  }

  // THE MAIL STEP FAILED AFTER THE ROW WAS CREATED. GoTrue's wording for
  // this is "Error sending confirmation email" (or "...invite email" /
  // "...recovery email" for the sibling flows), returned as a 500 with
  // code "unexpected_failure". The old fallback below told this pilot
  // "nothing was saved", which is false for exactly this shape (the
  // account exists, unconfirmed), and a retry with the same address then
  // silently classified as pending-confirmation, sending them to a screen
  // claiming a link was sent when none ever was. Both the message match
  // and the code+status pair are required, so an unrelated 500 keeps the
  // honest generic sentence below.
  if (
    code === "unexpected_failure" &&
    (status == null || status >= 500) &&
    /error sending|sending [a-z]* ?email/i.test(text)
  ) {
    return { kind: "mail-failed" };
  }

  // EVERYTHING ELSE STAYS VISIBLE. A 500, a network fault: these are real
  // failures the person can act on by trying again, and turning them into
  // a cheerful "check your email" would leave a pilot waiting for a
  // message that is never coming. The caller logs the raw Supabase text;
  // this is what the pilot reads.
  return {
    kind: "retry",
    message:
      "We couldn't create your account just now, and nothing was saved. Try again in a moment.",
  };
}
