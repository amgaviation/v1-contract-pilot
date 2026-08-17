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
 *
 * ===========================================================================
 * WHY THIS IS A GET (render) / POST (verify) PAIR, NOT ONE GET.
 *
 * A GET that verifies the token on load is exactly what a corporate mail
 * scanner or a mail client's own "safe links" prefetcher does too: those
 * issue a plain GET against every link in an email BEFORE a human clicks
 * it, to check it for malware. Supabase's own troubleshooting guidance
 * ("OTP Verification Failures: 'token has expired' or 'otp_expired'
 * errors") names this as the single most common cause of a link that
 * fails within seconds of being sent — the token is real and unexpired,
 * it has just already been spent by a scanner's GET, so the pilot's own
 * click is the SECOND use of a single-use token and is refused exactly
 * like a genuinely expired one. Confirmed against this project's own auth
 * logs: repeated `403 "Email link is invalid or has expired"` /
 * `"One-time token not found"` responses on Supabase's `/verify` endpoint,
 * seconds after the mail was sent.
 *
 * So GET below does nothing to the token — it only renders a page that
 * NAMES one, in hidden fields, behind a form whose submit event is the
 * one thing a prefetcher does not do. Only POST calls verifyOtp /
 * exchangeCodeForSession, which is the same body this file's GET used to
 * run inline. See docs/SETUP.md for the companion step this alone cannot
 * finish: while the project's "Confirm signup" email template still uses
 * `{{ .ConfirmationURL }}`, the link points at Supabase's own hosted
 * `/auth/v1/verify` endpoint and is spent THERE, before this route is ever
 * reached — this GET/POST split only protects a link that already points
 * at this route with `token_hash`/`code` in the query string.
 * ===========================================================================
 */

/** Minimal escaping for the hidden-input values below — see confirmPageHtml. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * THE INTERSTITIAL. Deliberately not built from this app's own component
 * library: a Route Handler response is not routed through Next's page
 * render pipeline, so it cannot resolve the app's compiled, hashed
 * stylesheet. Hand-styled, on brand, and legible on its own — the one job
 * this page has is to put a real click between "link opened" and "token
 * spent," which does not need the full design system to do.
 */
function confirmPageHtml(fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Confirm your email</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fcfcfd;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a2e;
    padding: 24px;
  }
  .card {
    max-width: 400px;
    width: 100%;
    background: #ffffff;
    border: 1px solid #e2e2e8;
    border-radius: 12px;
    padding: 32px;
    box-shadow: 0 1px 2px rgba(16, 16, 40, 0.04);
  }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { font-size: 14px; line-height: 1.5; color: #55556b; margin: 0 0 24px; }
  button {
    width: 100%;
    padding: 12px 16px;
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
    background: #2a2a72;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  button:hover { background: #22225e; }
</style>
</head>
<body>
  <div class="card">
    <h1>Confirm your email</h1>
    <p>One more click finishes this. Requiring a click here, rather than confirming as soon as the link opens, keeps the link from being used up by a mail scanner before you get to it.</p>
    <form method="POST">
      ${inputs}
      <button type="submit">Continue</button>
    </form>
  </div>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = url.searchParams.get("next");

  if (!code && !(tokenHash && type)) {
    // Nothing here to confirm — an already-stripped or malformed link. No
    // `flow` query param: /link-expired's own fallback is the signup
    // wording (the flow with a way forward from here), same default this
    // branch would otherwise have spelled out by hand.
    return NextResponse.redirect(new URL("/link-expired", url));
  }

  const fields: Record<string, string> = {};
  if (code) fields.code = code;
  if (tokenHash) fields.token_hash = tokenHash;
  if (type) fields.type = type;
  if (next) fields.next = next;

  return new NextResponse(confirmPageHtml(fields), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * THE ACTUAL VERIFICATION — reached only by the form's submit, never by a
 * link being opened. Everything below is unchanged from what used to run
 * inline in GET; only the trigger and the source of the four values moved
 * (formData instead of the URL's query string, since the browser now POSTs
 * the hidden fields the GET above rendered).
 */
export async function POST(request: NextRequest) {
  const url = request.nextUrl;
  const form = await request.formData();
  const code = (form.get("code") as string | null) ?? null;
  const tokenHash = (form.get("token_hash") as string | null) ?? null;
  const type = (form.get("type") as string | null) ?? null;

  // Same open-redirect rule as login's `next`, and now literally the same
  // code — see lib/safe-next.ts for why the hand-written prefix test these
  // three call sites each carried was wrong.
  const next = safeNextPath(form.get("next") as string | null);

  // HOISTED, NOT CHANGED. This is character for character the expression
  // that used to sit below the verification, and it is computed from the
  // same three values: `type` and `code` come straight off the posted
  // fields and are never reassigned, and `next` is the already-sanitised
  // path from safeNextPath. None of the three is touched by verifyOtp,
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
      return NextResponse.redirect(new URL("/forgot-password?expired=1", url), 303);
    }
    // email_change is not resendable without a session (see
    // ../resend-actions.ts), so /link-expired sends that case back to
    // Settings and the signup case to the resend control.
    const flow = type === "email_change" ? "email-change" : "signup";
    return NextResponse.redirect(new URL(`/link-expired?flow=${flow}`, url), 303);
  }

  // 303, not the default 307: this response is to a POST, and a 307
  // preserves the method, which would have the browser try to POST to
  // `next` (a page that renders on GET). 303 See Other is what turns a
  // POST-redirect into the GET every one of these destinations expects.
  const response = NextResponse.redirect(new URL(next, url), 303);

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
