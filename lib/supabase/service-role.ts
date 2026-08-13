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
 * It exists for exactly TWO entry points, and that list IS the control —
 * adding a third is a security decision, not a refactor.
 *
 *   1. THE STRIPE WEBHOOK that provisions a new tenant on checkout
 *      completion (Phase 2 — app/api/stripe/webhook/route.ts and
 *      lib/stripe/provisioning.ts), because that request has no user
 *      session yet to authenticate as.
 *
 *   2. RECEIPT BYTES FOR A SHARED INVOICE (lib/invoice-share-receipts.ts),
 *      because the caller is the pilot's CLIENT: a person with no account,
 *      no session and no Supabase identity, holding a share token. Receipt
 *      images live in the private `receipts` bucket, whose policies key on
 *      pilot.current_account_ids() — the empty set for anon — so no
 *      session-scoped client can read them, and no signed URL can be minted
 *      for them either (minting one requires already holding SELECT on the
 *      object). Read that module's header before touching it: the
 *      authorisation decision is made in the database, on every call, by
 *      pilot.invoice_share_receipts (20260813020000); this client reads NO
 *      TABLE through it; and the only thing the key does is download one
 *      storage object whose path that function returned and whose tenant
 *      prefix is re-checked before the download.
 *
 * It must never be imported into a Client Component, never used to read or
 * write tenant business data on a pilot's behalf, and never become a
 * general-purpose "admin" escape hatch — there is no support tooling in
 * this product that reads across tenants by design. Entry point 2 does not
 * soften that: it reads one BLOB, for one invoice, for a bearer the
 * database independently authorised, and it is not a precedent for reading
 * a table.
 *
 * app/packet/[token]/page.tsx's instruction — "serving the bytes needs its
 * own signed-URL design and its own security review; do not add it by
 * reaching for the service-role client" — concerns the credential packet's
 * documents (passport, medical certificate, W-9: standing personal data the
 * client has never been sent) and is UNCHANGED. A rebilled receipt is a
 * different case, and the difference is what the pilot agreed to: it is one
 * document, about one transaction the client is being billed for, on a link
 * the pilot minted for that invoice on purpose and can revoke in one press.
 *
 * DO NOT restate that difference as "the client was already emailed this
 * receipt anyway". An earlier version of this comment did, and it is false
 * whenever the send dialog's receipts checkbox was unticked (a per-send
 * choice stored nowhere), whenever delivery_method was 'manual_download'
 * (this product emailed nothing), and for every invoice sent before receipt
 * embedding existed. The authorisation here is the pilot's per-invoice
 * decision to create the share link, which holds only while the UI that
 * mints it says what it discloses — see the header of
 * supabase/migrations/20260813020000_invoice_share_receipts.sql.
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
