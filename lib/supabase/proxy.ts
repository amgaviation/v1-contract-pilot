import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Refreshes the Supabase auth session on every matched request. Required
 * so Server Components always see a valid session — see proxy.ts for the
 * route matcher.
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // No Supabase project exists yet in Phase 0 — every request would
  // otherwise 500 here. Once the project is provisioned and
  // NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are set, this proxy starts doing
  // its real job automatically; nothing else changes.
  if (!supabaseUrl || !supabaseAnonKey) {
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

  const supabase = createServerClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
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
  // Phase 1 follow-up once pilot.accounts / pilot.account_members exist.
  await supabase.auth.getUser();

  return response;
}
