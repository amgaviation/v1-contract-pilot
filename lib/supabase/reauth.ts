import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/**
 * RE-AUTHENTICATION: proving the person at the keyboard is the account
 * holder, not just the holder of a session cookie.
 *
 * WHY THIS EXISTS AT ALL. A stolen or borrowed session is the threat the
 * profile screen has to answer. Without a re-auth step, anyone who reaches
 * an unlocked laptop can set a new password and lock the pilot out of
 * their own logbook and invoices permanently. Supabase's own
 * "Secure password change" (GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_-
 * REAUTHENTICATION) does this server-side, but it is a PROJECT SETTING
 * this repo does not control and cannot detect: if it is off,
 * `updateUser({ password })` succeeds against a bare session with nothing
 * challenged. So the challenge is performed here, unconditionally, and the
 * product's guarantee no longer depends on a dashboard toggle.
 *
 * WHY A THROWAWAY CLIENT RATHER THAN THE REQUEST'S OWN. The obvious
 * spelling — call `supabase.auth.signInWithPassword()` on the cookie-bound
 * client from lib/supabase/server.ts — works, but it has a side effect
 * that is wrong for a CHECK: a successful call issues a NEW session and
 * writes new auth cookies, silently rotating the caller's session as a
 * side effect of verifying a password. Worse, some failure modes clear the
 * stored session on the way through. A verification must not be able to
 * change what it is verifying.
 *
 * So this builds a second `createServerClient` whose cookie adapter reads
 * nothing and writes nothing: `getAll()` returns an empty array, so the
 * client starts with no session at all and the request's cookies are never
 * consulted; `setAll()` discards, so the freshly minted session dies with
 * the function call and never reaches the browser. The only thing that
 * escapes is the boolean.
 *
 * VERIFIED against the installed packages, not from memory:
 *   - @supabase/ssr 0.12.4 — `createServerClient(url, key, { cookies: {
 *     getAll, setAll } })` is the documented adapter shape and is exactly
 *     what lib/supabase/server.ts already passes.
 *   - @supabase/supabase-js / @supabase/auth-js 2.111.0 — `AuthError`
 *     carries `status?: number` and `code?: string`
 *     (node_modules/@supabase/auth-js/dist/module/lib/errors.d.ts), which
 *     is what lets a wrong password (400 / "invalid_credentials") be told
 *     apart from a rate limit (429) and from the service being unreachable
 *     (no status at all). Guessing between those three would produce the
 *     "silent failure" this wave exists to remove.
 *
 * `db.schema` is pinned for the same reason server.ts pins it, even though
 * this client only ever touches /auth: an unpinned client is a footgun
 * waiting for the next person who reaches for it.
 */
export type ReauthResult =
  /** The password matched. */
  | "ok"
  /** The password did not match. */
  | "rejected"
  /** Supabase is rate-limiting this address; try again shortly. */
  | "rate_limited"
  /** Supabase could not be reached, or is misconfigured. NOT a wrong password. */
  | "unavailable";

export async function verifyPassword(
  email: string,
  password: string
): Promise<ReauthResult> {
  const url = process.env.NEXT_SUPABASE_URL;
  const key = process.env.NEXT_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error("[auth] re-authentication skipped: Supabase env vars are unset.");
    return "unavailable";
  }

  const probe = createServerClient<Database, "pilot">(url, key, {
    db: { schema: "pilot" },
    cookies: {
      // Reads nothing. This client must not inherit — or be able to
      // invalidate — the caller's session.
      getAll() {
        return [];
      },
      // Writes nothing. The session this sign-in mints is discarded here,
      // deliberately: the caller keeps the session they already had.
      setAll() {},
    },
  });

  try {
    const { error } = await probe.auth.signInWithPassword({ email, password });
    if (!error) return "ok";
    if (error.status === 429) return "rate_limited";
    // 400/401/403 from GoTrue on this endpoint means the credentials did
    // not match. An error with NO status never reached Supabase at all
    // (DNS, TLS, timeout) and must NOT be reported to the pilot as a wrong
    // password — that is precisely the silent-failure lie this wave removes.
    if (typeof error.status === "number" && error.status >= 400 && error.status < 500) {
      return "rejected";
    }
    console.error(
      "[auth] re-authentication could not complete",
      error.status ?? "no status",
      error.message
    );
    return "unavailable";
  } catch (err) {
    console.error(
      "[auth] re-authentication threw",
      err instanceof Error ? err.message : String(err)
    );
    return "unavailable";
  }
}

/**
 * The sentence for a non-"ok" result. Kept next to the codes so a new
 * result can never be added without an answer for it, and so all three
 * profile actions say the same thing about the same failure.
 *
 * "Rejected" is deliberately NOT generic here, unlike the login form's
 * message. Login must not become an account-enumeration oracle, so it
 * refuses to say which half was wrong. This form is different: the caller
 * is already signed in as this exact user, so "that isn't your current
 * password" discloses nothing an attacker with the session does not
 * already have, and vagueness here would only make a typo unfixable.
 */
export function reauthMessage(result: Exclude<ReauthResult, "ok">): string {
  switch (result) {
    case "rejected":
      return "That isn't your current password. Check it and try again.";
    case "rate_limited":
      return "Too many attempts in a row. Wait a minute and try again.";
    case "unavailable":
      return "We couldn't check your password just now, so nothing was changed. Try again in a moment.";
  }
}
