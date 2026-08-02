import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Browser-side Supabase client. Reads/writes through this client are
 * subject to RLS on the `pilot` schema — see supabase/migrations for the
 * tenancy policies. There is deliberately no equivalent of an
 * "admin bypass" client exposed to the browser; the platform holds no
 * read path into a tenant's data other than the tenant's own session.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
