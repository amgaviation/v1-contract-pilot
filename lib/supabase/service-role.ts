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
 * It exists for exactly NINE entry points across TEN call sites (entry
 * points 1 and 2 each cover a route plus the helper module it calls this
 * client from, counted as one operation — see their paragraphs), and that
 * list IS the control — adding one is a security decision, not a refactor.
 * (It said TWO until 20260813130000 added the scheduled reminder pass,
 * written up as entry point 3 below with the argument for why it earns its
 * place, and FOUR until the hold-expiry pass was added as entry point 5.
 * Adding one is meant to feel like this: a paragraph, not a line.)
 *
 * THE LIST DRIFTED, AND THIS IS THE RECORD OF IT, BECAUSE THE NEXT DRIFT
 * SHOULD NOT NEED AN AUDIT TO FIND. The commit that added entry point 5
 * (3c32eae, 2026-08-18 03:57 UTC) called this list's count FOUR-becoming-
 * FIVE. It was wrong when it was written: THREE other files had already
 * been calling this function, unregistered, for up to a day —
 * demo-actions.ts (a9da1b8, 2026-08-17 07:54 UTC), the autopay start/stop
 * routes (05280e4, 2026-08-17 16:09 UTC) and test-bypass-actions.ts
 * (e8d4a83, 2026-08-17 19:54 UTC). Two of those files even said otherwise:
 * demo-actions.ts's own header called itself "a fifth entry point," and
 * test-bypass-actions.ts's repeated the claim — both false, because the
 * paragraph they meant to join here was never written. The true count was
 * never five; it was six before entry point 5 existed, and eight by the
 * time the third of those three files landed. They are entry points 6
 * through 9 below, added on this pass (2026-08-19).
 *
 * A CI CHECK SHOULD MAKE THIS SELF-ENFORCING. The exhaustive list of
 * callers, re-derived by grep rather than trusted from this comment:
 *
 *   grep -rln 'createServiceClient(' --include='*.ts' --include='*.tsx' \
 *     app lib | grep -v '^lib/supabase/service-role\.ts$' | sort
 *
 * That must return exactly the ten paths named in entry points 1-9 below,
 * byte for byte. A path appearing that isn't named here, or named here
 * that no longer appears, is this exact failure mode happening again —
 * fail the build on the diff, don't wait for the next person to read this
 * comment before they trust it.
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
 *   3. THE DAILY DUE-REMINDER PASS (app/api/reminders/run/route.ts and
 *      lib/reminders/run.ts), because a scheduled run has no session to
 *      authenticate as — the same reason as entry point 1, arriving from a
 *      cron runner instead of from Stripe.
 *
 *      THIS ONE IS A GENUINE WIDENING AND IS RECORDED AS SUCH. It is the
 *      first entry point that reads a tenant's ordinary business data —
 *      clients, invoices, share stamps — which the paragraph below otherwise
 *      forbids outright. What makes it acceptable rather than an exception
 *      that swallows the rule:
 *        * it is reachable through ONE route, which refuses every request
 *          with no CRON_SECRET configured (503) or the wrong one (401)
 *          before this client is ever constructed;
 *        * it performs one fixed operation — decide whether a reminder is
 *          due, send it, record the outcome — with NO caller-supplied
 *          account id, invoice id or filter anywhere in it. There is no
 *          input by which it could be pointed at a chosen tenant;
 *        * the SAME code runs from the Settings button under the pilot's own
 *          session client with RLS fully in force — lib/reminders/run.ts
 *          takes the client as a parameter precisely so that is possible —
 *          so the privileged client buys the absence of a session and
 *          nothing else;
 *        * nothing it reads leaves the account it belongs to: the one
 *          outbound message goes to that account's own client, composed from
 *          that account's own invoice, replying to that account's own owner.
 *      A future change wanting this client for a report, a backfill or a
 *      support lookup is a NEW decision, not an extension of this one.
 *
 *   4. THE STRIPE CONNECT WEBHOOK (app/api/stripe/connect-webhook/route.ts)
 *      — a client paying a pilot's invoice payment link. No user session,
 *      because the person paying is not a user of this product at all:
 *      they are the pilot's client, on Stripe's own checkout page. Like
 *      entry point 3 this WRITES tenant business data (a
 *      pilot.invoice_payments row and the invoice's status) — the line
 *      20260809040000_connect_payments.sql originally declined to cross,
 *      crossed on purpose by 20260813100000 with the reasoning in its
 *      header. It is narrowed by construction rather than by promise:
 *      Stripe must have signed the delivery, the tenant is derived from
 *      the signed `event.account` and never from link metadata (which the
 *      connected account's own owner can type), and the only rows it may
 *      touch belong to that account's own invoice.
 *
 *   5. THE HOLD-EXPIRY PASS (app/api/holds/run/route.ts), because a pilot
 *      whose hold has run out is, by definition, not present to authenticate
 *      as. Same shape as entry point 3, arriving from the same cron runner.
 *
 *      THIS IS THE MOST DANGEROUS ENTRY POINT IN THE LIST AND MUST BE READ
 *      AS SUCH. Every other one reads, or writes a row. This one DELETES a
 *      tenant's commercial records — clients, trips, invoices, estimates,
 *      expenses, the ledger — unattended, on a schedule, with no human
 *      confirming anything. Entry point 3's argument ("one route, one fixed
 *      operation, no caller-supplied account id") is necessary here and is
 *      not sufficient on its own, so it carries three more guards that the
 *      others do not:
 *        * A FLAG, HOLD_EXPIRY_PURGE_ENABLED (lib/holds/gate.ts), unset on
 *          every deployment until someone types it exactly. With it off the
 *          pass still runs and still reports precisely which accounts it
 *          WOULD have purged, and deletes nothing — so the selection can be
 *          watched against real expiries, in production, before anything is
 *          destroyed. No staging tenant has a real pilot's records in it,
 *          which is why a dry run against the real thing is the only test
 *          that proves the query.
 *        * A CAP on accounts purged per run. A pass finding more than a
 *          handful due has more likely met a clock or query fault than a
 *          real cohort; it refuses the whole run rather than working
 *          through the list.
 *        * THE DATABASE REFUSES INDEPENDENTLY. pilot.expire_hold re-derives
 *          due-ness from the row and rejects an account that is not on hold,
 *          whose window has not closed, or whose retention is paid. So the
 *          route's SELECT is not the last word on who gets purged — which
 *          matters because a wrong WHERE clause is the realistic way this
 *          product destroys a paying customer's data.
 *      And the blast radius is bounded in kind as well as in number: the
 *      purge cannot reach a logbook, a documents wallet, an aircraft or a
 *      qualification record on any code path, and
 *      scripts/account-lifecycle-db-verify.mjs asserts that by executing it.
 *
 *   6. DEMO BILLING FOR COMPED ACCOUNTS
 *      (app/(app)/settings/billing/demo-actions.ts), because
 *      pilot.accounts.plan_tier and demo_cancel_at_period_end are both in
 *      accounts_protect_billing_columns' protected list
 *      (20260817090000_comp_account_demo_billing.sql) — a normal session
 *      client cannot write either, full stop, regardless of RLS. That
 *      protection exists so entitlement state can only ever arrive from
 *      Stripe's own webhook (entry point 1); this is the one narrow,
 *      named exception, for the one case Stripe never bills: an account
 *      with no Stripe customer at all. Narrowed the same way entry point 3
 *      is: every write first re-reads the account through requireAccount
 *      (a session client, RLS-scoped to the caller) and refuses unless
 *      stripe_customer_id IS NULL on THAT read, never on client-supplied
 *      input — a real subscriber's row always has a Stripe customer id, so
 *      this can never reach one. This client is constructed only after
 *      that check passes, and only to write the two columns this file
 *      owns.
 *
 *   7. AUTOPAY CONSENT — START (app/api/autopay/start/route.ts), because
 *      the caller is the pilot's CLIENT's AP desk: someone with no
 *      account, no session and no Supabase identity here, holding a
 *      vendor-link token instead. The anon Postgres role has no read on
 *      pilot.client_vendor_links (only the SECURITY DEFINER page
 *      functions do), and this route additionally needs
 *      accounts.connect_account_id and the client's existing autopay
 *      customer id — neither belongs in an anon-executable SQL function's
 *      return value. The token is validated (unrevoked, unexpired) FIRST,
 *      before this client reads anything, and every read after that is
 *      scoped to the account/client ids the token itself resolved to —
 *      there is no caller-supplied account or client id anywhere in the
 *      route.
 *
 *   8. AUTOPAY CONSENT — STOP (app/api/autopay/stop/route.ts), the mirror
 *      of entry point 7: same anonymous caller, same vendor-link token
 *      boundary, same reason a session client cannot do this — there is no
 *      session to scope one to. A client who cannot revoke a mandate they
 *      gave is not a feature but a dispute waiting to happen (card-network
 *      rules require a cancellation path for saved-card charging), so
 *      revoking consent needed the same access granting it did.
 *
 *   9. THE ONBOARDING TEST BYPASS (app/(auth)/welcome/test-bypass-actions.ts),
 *      because it provisions a comped account — the same NULL-
 *      stripe_customer_id shape entry point 6 manages — for a signed-in
 *      user who has no account yet, and tenant creation has no
 *      session-scoped path at all (decision #7: only the webhook creates
 *      one). Three gates keep this from being entry point 1 with a side
 *      door, detailed in that file's own header: dormant unless
 *      ONBOARDING_TEST_PIN is set to a long, non-numeric value; a hard
 *      `NODE_ENV !== "development"` refusal that runs before any of that
 *      is even checked, so it cannot fire on any deployed environment —
 *      production or preview — no matter what the var is set to; and a
 *      timing-safe PIN comparison. Like entry point 6, every write here
 *      only ever INSERTS a brand-new account and membership row for the
 *      caller's own user id — it has no path to an account that already
 *      exists.
 *
 * It must never be imported into a Client Component, never used to read or
 * write tenant business data on a pilot's behalf outside the narrow, fixed
 * operations described in entry points 3 through 8, and never become a
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
