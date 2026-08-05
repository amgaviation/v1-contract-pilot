import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Service-role client. BYPASSES Row Level Security.
 *
 * This is the single most sensitive line in the codebase — more sensitive
 * than anything the design-token verify script checks, and unlike that
 * script this one has no automated backstop yet (see docs/PLAN.md
 * "tenancy:verify" — it's meant to assert this module's caller set is
 * exactly the Stripe webhook route, and doesn't exist yet because there's
 * no live database to test it against). Until that exists, the only
 * control is: read this comment before you import this function.
 *
 * It exists for exactly ONE entry point: the Stripe webhook handler that
 * provisions a new tenant on checkout completion (Phase 2), because that
 * request has no user session yet to authenticate as. It must never be
 * imported into a Client Component, never used to read or write tenant
 * business data on a pilot's behalf, and never become a general-purpose
 * "admin" escape hatch — there is no support tooling in this product that
 * reads across tenants by design.
 *
 * Read docs/PLAN.md's note on the trust story before treating "no admin
 * bypass" as a stronger claim than it is: this client, in the hands of
 * whoever holds NEXT_SUPABASE_SECRET_KEY, is exactly that bypass. The
 * product's real guarantee is that no RLS policy and no OTHER application
 * code path grants tenant A anything about tenant B — this file is the
 * one deliberate, narrowly-scoped exception, not a demonstration that no
 * exception exists.
 *
 * If you're reaching for this function, stop and check whether a
 * properly-scoped user-session client (lib/supabase/client.ts or
 * lib/supabase/server.ts) would do instead. It almost always would.
 *
 * Deliberately built on @supabase/supabase-js's createClient rather than
 * @supabase/ssr's createServerClient: the ssr package's cookie-session
 * machinery has nothing to do here (this client has no user session,
 * cookie-based or otherwise), and stubbing it out with empty cookie
 * handlers — the previous implementation — is unobvious and easy to
 * "fix" by someone copying real cookie handlers in from server.ts,
 * silently changing what this client's authority is scoped to.
 */
export function createServiceClient() {
  const url = process.env.NEXT_SUPABASE_URL;
  const serviceKey = process.env.NEXT_SUPABASE_SECRET_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_SUPABASE_SECRET_KEY (and NEXT_SUPABASE_URL) must be set for privileged operations."
    );
  }

  return createSupabaseClient<Database, "pilot">(url, serviceKey, {
    db: { schema: "pilot" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
