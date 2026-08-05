import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Refreshes the Supabase auth session on every matched request. Required
 * so Server Components always see a valid session — see proxy.ts (repo
 * root) for the route matcher.
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // No Supabase project exists yet in Phase 0, so this is expected in
    // development and preview right now. It must NOT stay silent once an
    // auth gate exists: this is exactly the code path a real deployment's
    // auth check hangs off (see the comment at the bottom of this
    // function), so a misconfigured env var here — a renamed key, a
    // Preview-vs-Production scoping mistake — would otherwise make every
    // route render unauthenticated with no error and no log line. Fail
    // loudly everywhere except local development, where an unconfigured
    // Supabase project is the normal starting state.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_SUPABASE_URL / NEXT_SUPABASE_PUBLISHABLE_KEY are unset in production — refusing to serve requests without a working auth gate."
      );
    }
    return response;
  }

  return refreshSession(request, response, supabaseUrl, supabaseAnonKey);
}

async function refreshSession(
  request: NextRequest,
  initialResponse: NextResponse,
  supabaseUrl: string,
  supabaseAnonKey: string
) {
  let response = initialResponse;

  const supabase = createServerClient<Database, "pilot">(
    supabaseUrl,
    supabaseAnonKey,
    {
      db: { schema: "pilot" },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touch the session so an expired token gets refreshed before it
  // reaches a Server Component. Auth gating on specific routes is a
  // Phase 1 follow-up once pilot.accounts / pilot.account_members exist —
  // when it lands, the redirect-to-login belongs right after this call,
  // which is exactly why the missing-env case above must fail loudly
  // rather than silently pass every request through ungated.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The auth gate that comment earmarked now lives here. A signed-out
  // request to any gated path is redirected to /login (carrying the
  // requested path as ?next so login can bounce back). /login and
  // /welcome are the signed-out surface itself and pass through —
  // /welcome's own page handles the no-session case, so there is no
  // loop. app/(app)/layout.tsx re-checks server-side, so this is defense
  // in depth, not the sole gate.
  const path = request.nextUrl.pathname;
  const isAuthSurface = path === "/login" || path.startsWith("/welcome");
  if (!user && !isAuthSurface) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
