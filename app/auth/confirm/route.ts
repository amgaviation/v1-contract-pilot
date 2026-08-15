import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";
import {
  RECOVERY_PROOF_COOKIE,
  RECOVERY_PROOF_MAX_AGE_SECONDS,
} from "@/lib/supabase/reauth";

export const dynamic = "force-dynamic";

/**
 * Landing point for every link Supabase emails (password recovery today,
 * signup confirmation and email-change if those templates are pointed
 * here later). It turns the one-time token in the URL into a real session
 * cookie and then forwards to `next`.
 *
 * TWO TOKEN SHAPES, because which one arrives depends on the project's
 * email templates and is not ours to control:
 *   - `code`: the PKCE flow. @supabase/ssr uses PKCE, and the default
 *     `{{ .ConfirmationURL }}` template redirects here with this.
 *   - `token_hash` + `type`: the newer templates that build the link out
 *     of `{{ .TokenHash }}` directly.
 * Handling only one would silently break the flow the day a template is
 * edited in the Supabase dashboard, with no error anywhere in this repo.
 *
 * The token NEVER survives into the redirect: we forward to a clean path,
 * so it can't leak through a Referer header or the browser history of the
 * page that ultimately renders.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  // Same open-redirect rule as login's `next`, and now literally the same
  // code — see lib/safe-next.ts for why the hand-written prefix test these
  // three call sites each carried was wrong.
  const next = safeNextPath(url.searchParams.get("next"));

  // HOISTED, NOT CHANGED. This is character for character the expression
  // that used to sit below the verification, and it is computed from the
  // same three values: `type` and `code` come straight off the URL and are
  // never reassigned, and `next` is the already-sanitised path from
  // safeNextPath. None of the three is touched by verifyOtp,
  // exchangeCodeForSession or anything else between here and its use, so
  // hoisting it cannot change what it evaluates to. It is up here only so
  // that the FAILURE branch can route by the same flow the success branch
  // gates the cookie on, instead of a second, drifting derivation.
  //
  // WHY IT IS SAFE, restated because this is the security gate:
  //   - `type === "recovery"` is the token_hash shape saying so directly.
  //   - the PKCE `code` shape carries no type, so it qualifies only when it
  //     resolves to next === "/reset-password", a destination that ONLY
  //     forgot-password/actions.ts's resetPasswordForEmail ever sets.
  // Signup and email-change now both set next=/welcome and next=/settings
  // respectively (signup/actions.ts, settings/profile-actions.ts), neither
  // of which is "/reset-password", so a code from either still cannot mint
  // the proof. Nothing below widens this: the cookie is still written on
  // `isRecovery` alone, and only after a verification that actually
  // succeeded.
  const isRecovery =
    type === "recovery" || (Boolean(code) && next === "/reset-password");

  const supabase = await createClient();

  let failed = true;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "recovery" | "signup" | "email_change" | "invite" | "magiclink",
      token_hash: tokenHash,
    });
    failed = Boolean(error);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  }

  if (failed) {
    // Expired, already used, or absent. Send them somewhere they can get a
    // fresh one, rather than to a form that would fail confusingly on
    // submit, AND somewhere that matches the flow they were actually in.
    //
    // This used to be /forgot-password?expired=1 for every failure, which
    // put a pilot whose SIGNUP link had expired on a password-reset form
    // for an account they have not confirmed: the reset mail either never
    // arrives or lands them in a second dead end, and nothing on the screen
    // relates to what they were doing.
    if (isRecovery) {
      return NextResponse.redirect(new URL("/forgot-password?expired=1", url));
    }
    // email_change is not resendable without a session (see
    // ../resend-actions.ts), so /link-expired sends that case back to
    // Settings and the signup case to the resend control.
    const flow = type === "email_change" ? "email-change" : "signup";
    return NextResponse.redirect(new URL(`/link-expired?flow=${flow}`, url));
  }

  const response = NextResponse.redirect(new URL(next, url));

  // PROOF THIS SESSION CAME FROM A RECOVERY LINK, not from a session that
  // was already open. app/(auth)/reset-password/actions.ts requires this
  // cookie before it will set a new password — see
  // lib/supabase/reauth.ts's RECOVERY_PROOF_COOKIE doc for why that gate
  // has to exist at all.
  //
  // Two ways to know this was a recovery: the `token_hash` shape carries
  // `type=recovery` directly. The `code` (PKCE) shape carries no type at
  // all — but `next` was only ever set to "/reset-password" by
  // forgot-password/actions.ts's `resetPasswordForEmail` call, so a code
  // that resolves to that destination is the same proof by construction.
  // A code from any OTHER flow (signup confirmation, magic link, email
  // change) never carries next=/reset-password, so this cannot be used to
  // smuggle a non-recovery session past the gate.
  //
  // `isRecovery` itself is declared above, before the verification, purely
  // so the failure branch can route by the same flow. See the comment at
  // its declaration for why moving it cannot change its value.
  if (isRecovery) {
    response.cookies.set(RECOVERY_PROOF_COOKIE, "1", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: RECOVERY_PROOF_MAX_AGE_SECONDS,
      path: "/",
    });
  }

  return response;
}
