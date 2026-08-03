import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Browser-side Supabase client. Reads/writes through this client are
 * subject to RLS on the `pilot` schema — see supabase/migrations for the
 * tenancy policies.
 *
 * `db.schema` is pinned explicitly — see the matching comment in
 * server.ts for why an unpinned client silently targets `public` instead.
 *
 * Reads NEXT_SUPABASE_URL / NEXT_SUPABASE_PUBLISHABLE_KEY rather than the
 * NEXT_PUBLIC_-prefixed names Next.js would auto-inline — see the `env`
 * block in next.config.ts for why these two specific vars still reach the
 * browser bundle despite the non-standard prefix.
 */
export function createClient() {
  return createBrowserClient<Database, "pilot">(
    process.env.NEXT_SUPABASE_URL!,
    process.env.NEXT_SUPABASE_PUBLISHABLE_KEY!,
    { db: { schema: "pilot" } }
  );
}
