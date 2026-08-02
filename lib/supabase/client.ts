import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Browser-side Supabase client. Reads/writes through this client are
 * subject to RLS on the `pilot` schema — see supabase/migrations for the
 * tenancy policies.
 *
 * `db.schema` is pinned explicitly — see the matching comment in
 * server.ts for why an unpinned client silently targets `public` instead.
 */
export function createClient() {
  return createBrowserClient<Database, "pilot">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "pilot" } }
  );
}
