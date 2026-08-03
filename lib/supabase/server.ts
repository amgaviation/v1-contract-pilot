import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Request-scoped Supabase client bound to the user's auth cookies. All
 * reads through this client are subject to Row Level Security on the
 * `pilot` schema.
 *
 * `db.schema` is pinned explicitly: PostgREST's default schema is the
 * first entry in supabase/config.toml's `[api] schemas`, and leaving it
 * unpinned means every query silently targets `public` — which has no
 * tables — while database.types.ts's Database type resolves to `'pilot'`
 * at the type level. Without this option that mismatch is invisible to
 * `tsc` and shows up only as a runtime "table not found."
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database, "pilot">(
    process.env.NEXT_SUPABASE_URL!,
    process.env.NEXT_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: { schema: "pilot" },
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
            // session refresh happens in proxy.ts.
          }
        },
      },
    }
  );
}
