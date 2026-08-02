import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Request-scoped Supabase client bound to the user's auth cookies. All
 * reads through this client are subject to Row Level Security on the
 * `pilot` schema.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — safe to ignore;
            // session refresh happens in middleware.ts.
          }
        },
      },
    }
  );
}

/**
 * Service-role client. BYPASSES Row Level Security.
 *
 * This is the single most sensitive line in the codebase. It exists for
 * exactly ONE caller today: the Stripe webhook handler that provisions a
 * new tenant on checkout completion (Phase 2), because that request has
 * no user session yet to authenticate as. It must never be imported into
 * a Client Component, never used to read or write tenant business data
 * on a pilot's behalf, and never become a general-purpose "admin" escape
 * hatch — there is no support tooling in this product that reads across
 * tenants. That absence is the product's trust story (see docs/PLAN.md
 * §2, §Architecture: "no admin bypass policy and no AMG-facing read path
 * into tenant data"). If you're reaching for this client, stop and check
 * whether a properly-scoped user-session client would do instead.
 */
export async function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set for privileged operations."
    );
  }

  return createServerClient<Database>(url, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
