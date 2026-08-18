"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { looksLikeEmail } from "@/lib/email/address";
import {
  PENDING_SIGNUP_COOKIE,
  RESEND_HISTORY_COOKIE,
  RESEND_WINDOW_SECONDS,
  SEND_FAILED_COOKIE,
  encodeSendHistory,
  parseSendHistory,
  recordSend,
  resendDecision,
  resendWaitMessage,
} from "@/lib/auth/confirmation";

export type ResendState = { error: string | null; sent: boolean };

/**
 * ACCOUNT ENUMERATION, DECIDED DELIBERATELY. The one sentence this action
 * ever reports on the way out is RESEND_SENT_MESSAGE, whatever actually
 * happened. A resend endpoint is the
 * classic oracle: send it an address, read the difference between "sent"
 * and "no such account" or between "sent" and "already confirmed", and you
 * have a membership test against every address you can think of. On THIS
 * product that list is a list of working pilots, which is worth money to
 * whoever is assembling it.
 *
 * Two things close it here:
 *
 *   1. The address is taken from the httpOnly pending-signup cookie
 *      whenever there is one, so the ordinary path through this action
 *      cannot be pointed at an address of the caller's choosing at all.
 *   2. When there is no cookie (the emailed link was opened on a different
 *      device, which is common) a typed address is accepted, and every
 *      outcome from that point on returns THIS string: sent, unknown
 *      address, already confirmed, Supabase down. Supabase's own
 *      `error.message` is logged and never rendered.
 *
 * The throttle response is the one deliberate exception, and it discloses
 * nothing about the address: it is a fact about this BROWSER's recent
 * behaviour, decided before Supabase is consulted, and it reads identically
 * for an address that has no account.
 *
 * Same reasoning and very nearly the same sentence as
 * forgot-password/actions.ts, on purpose: two adjacent screens that leak at
 * different rates are worse than either.
 */

/**
 * RESEND A SIGNUP CONFIRMATION LINK.
 *
 * Signup only. An email-change confirmation is NOT resendable from here:
 * `resend({ type: "email_change" })` acts on the signed-in user's pending
 * address, and the person looking at an expired email-change link may not
 * be signed in at all. /link-expired sends that case back to Settings,
 * where the change is started again under re-authentication, which is the
 * gate profile-actions.ts's changeEmail exists to enforce.
 *
 * Signature verified against the installed @supabase/auth-js 2.111.0 rather
 * than recalled: `ResendParams` is
 * `{ type: 'signup' | 'email_change'; email: string; options?: {
 * emailRedirectTo?: string; captchaToken?: string } }`
 * (node_modules/@supabase/auth-js/dist/module/lib/types.d.ts), and
 * `resend(credentials: ResendParams): Promise<AuthOtpResponse>`
 * (GoTrueClient.d.ts).
 */
export async function resendConfirmation(
  _prev: ResendState,
  formData: FormData
): Promise<ResendState> {
  const cookieStore = await cookies();

  // The cookie first, and the typed field only as a fallback. See
  // GENERIC_SENT above: this ordering is half of the enumeration answer.
  const pending = cookieStore.get(PENDING_SIGNUP_COOKIE)?.value?.trim();
  const typed = String(formData.get("email") ?? "").trim();
  const email = pending || typed;

  if (!email) {
    return { error: "Enter the email address you signed up with.", sent: false };
  }
  if (!looksLikeEmail(email)) {
    // A shape complaint about what the caller just typed. It says nothing
    // about whether any account exists.
    return {
      error: "That doesn't look like an email address. Check it and try again.",
      sent: false,
    };
  }

  // THE THROTTLE, before Supabase is touched. Decided on this browser's own
  // send history so a refusal costs no email and reveals nothing about the
  // address. See lib/auth/confirmation.ts for what this is and is not.
  const now = Math.floor(Date.now() / 1000);
  const history = parseSendHistory(cookieStore.get(RESEND_HISTORY_COOKIE)?.value);
  const decision = resendDecision(history, now);
  if (!decision.allowed) {
    return { error: resendWaitMessage(decision.retryAfterSeconds), sent: false };
  }

  // Same construction as profile-actions.ts's changeEmail, deliberately:
  // one way of building this absolute URL in the codebase, not two. When
  // the Origin header is absent Supabase falls back to the project's Site
  // URL, which still reaches a working confirm route, and that is better
  // than fabricating an origin.
  const origin = (await headers()).get("origin");
  const emailRedirectTo = origin
    ? `${origin}/auth/confirm?next=${encodeURIComponent("/welcome")}`
    : undefined;

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    ...(emailRedirectTo ? { options: { emailRedirectTo } } : {}),
  });

  // Per-address outcomes (unknown address, already confirmed) are logged
  // and never rendered; see the header. An INFRASTRUCTURE failure is the
  // one class this action may admit to: a 5xx / "unexpected_failure" from
  // the mail step is a systemic fact, identical for every address hit
  // during the incident, so saying "we couldn't send it" discloses nothing
  // about this address. And the unconditional `sent: true` this branch
  // used to return told a pilot, during a real outage, that "a new link is
  // on its way" every single time they clicked, forever.
  //
  // STATUS 0 COUNTS, and missing it was a real hole in the first version of
  // this branch. The installed @supabase/auth-js throws
  // AuthRetryableFetchError(message, 0) for anything that is not an HTTP
  // response at all (src/lib/fetch.ts handleError): DNS failure, connection
  // refused, TLS error, request abort. Those carry no `code` and a status of
  // 0, so a `status >= 500` test alone let the most ordinary transient
  // failure of all fall through to `sent: true`, which is the exact false
  // success this branch exists to stop. A fetch that never reached Supabase
  // says even less about the address than a 500 does, so admitting it is
  // enumeration-safe for the same reason.
  const infraFailure =
    !!error &&
    (error.name === "AuthRetryableFetchError" ||
      error.code === "unexpected_failure" ||
      (error.status ?? 0) >= 500 ||
      error.status === 0);

  if (error) {
    console.error("[auth] confirmation resend failed", error.status ?? "no status", error.message);
  }

  // Recorded whether or not Supabase accepted it. Counting only successes
  // would leave a failing address free to be hammered at full speed, which
  // is precisely the shape a probe takes.
  cookieStore.set(RESEND_HISTORY_COOKIE, encodeSendHistory(recordSend(history, now)), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: RESEND_WINDOW_SECONDS,
    path: "/",
  });

  if (infraFailure) {
    return {
      error:
        "We couldn't send the email just now. The failure is on our side, not a problem with the address; wait a few minutes and try again.",
      sent: false,
    };
  }

  // Supabase accepted the send (or refused for a per-address reason this
  // action deliberately does not distinguish). Either way the "the signup
  // mail failed" flag no longer describes the latest attempt.
  cookieStore.delete(SEND_FAILED_COOKIE);

  return { error: null, sent: true };
}
