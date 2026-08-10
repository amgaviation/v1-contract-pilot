import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

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
    // Expired, already used, or absent. Send them back to ask for a fresh
    // one rather than to a form that would fail confusingly on submit.
    return NextResponse.redirect(new URL("/forgot-password?expired=1", url));
  }

  return NextResponse.redirect(new URL(next, url));
}
