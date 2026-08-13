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
 * exactly the two Stripe webhook routes named below, and doesn't exist yet
 * because there's no live database to test it against). Until that exists,
 * the only control is: read this comment before you import this function.
 *
 * IT EXISTS FOR EXACTLY TWO ENTRY POINTS. This said ONE until
 * supabase/migrations/20260813100000_connect_auto_payments.sql, and the
 * change is written out rather than quietly absorbed, because a count
 * going from one to two is precisely the thing a reader of a file like
 * this needs to notice:
 *
 *   1. app/api/stripe/webhook/route.ts — platform billing. Provisions a
 *      new tenant on checkout completion (Phase 2). No user session,
 *      because the tenant does not exist yet.
 *
 *   2. app/api/stripe/connect-webhook/route.ts — a client paying a pilot's
 *      invoice payment link. No user session, because the person paying is
 *      not a user of this product at all: they are the pilot's client, on
 *      Stripe's own checkout page. There is nobody to authenticate as.
 *
 * The second is a genuinely different CATEGORY of write from the first —
 * tenant BUSINESS data (a pilot.invoice_payments row, and the invoice's
 * status) rather than tenant provisioning. That is exactly the line
 * 20260809040000_connect_payments.sql originally declined to cross, and
 * 20260813100000 crossed it on purpose with the reasoning in its header.
 * It is narrowed by construction rather than by promise: Stripe must have
 * signed the delivery, the tenant is derived from the signed
 * `event.account` and never from link metadata (which the connected
 * account's own owner can type), and the only rows it may touch belong to
 * that account's own invoice.
 *
 * THERE IS NO THIRD. This client must never be imported into a Client
 * Component, never used to serve a request that HAS a session (the
 * session-scoped client will do — see below), and never become a
 * general-purpose "admin" escape hatch: there is no support tooling in
 * this product that reads across tenants by design.
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
