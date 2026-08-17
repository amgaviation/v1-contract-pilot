import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, isLiveMode } from "@/lib/stripe/server";
import { deactivatePaymentLink, readAutopaySetupResult } from "@/lib/stripe/connect";
import { createServiceClient } from "@/lib/supabase/service-role";
import { looksLikeEmail, sendEmail } from "@/lib/email/send";
import { ownerEmail } from "@/lib/email/owner-email";
import { buildClientReceipt } from "@/lib/email/payment-receipt";
import { billToEmail } from "@/lib/invoice-bill-to";
import {
  AUTOPAY_INTENT_EVENT_TYPE,
  formatCentsPlain,
  nextInvoiceStatus,
  readAutopayIntentEvent,
  readConnectPaymentEvent,
  resolveAutoPayment,
  type AsyncSettlement,
  type ConnectIntentEvent,
  type ConnectSessionEvent,
  type DeclaredScope,
  type LedgerRow,
  type PaymentInsert,
  type ResolvedAccount,
  type ResolvedInvoice,
} from "@/lib/stripe/connect-payments";

/**
 * Stripe CONNECT webhook — a client paying one of a pilot's invoice
 * payment links (supabase/migrations/20260813100000_connect_auto_payments.sql).
 *
 * THIS IS THE SECOND SERVICE-ROLE ENTRY POINT IN THE PRODUCT, and the
 * first one to write tenant BUSINESS data rather than provision a tenant.
 * lib/supabase/service-role.ts names both and says why; the migration
 * header carries the full argument. Do not add a third without going
 * through the same exercise.
 *
 * A SEPARATE ENDPOINT, NOT A BRANCH IN app/api/stripe/webhook/route.ts.
 * Stripe delivers direct charges on connected accounts to a webhook
 * registered with the "connected accounts" scope, and every endpoint gets
 * its OWN signing secret — the platform-billing secret will not verify
 * these deliveries. Sharing one route would mean one handler holding two
 * secrets and guessing which to try, which is how a signature check
 * becomes decorative.
 *
 * WHAT IT PROMISES, and where each promise is kept:
 *   - signature verification  -> constructEventAsync on the RAW body, with
 *                                STRIPE_CONNECT_WEBHOOK_SECRET
 *   - dormant when unset      -> 503 before touching Stripe or Postgres
 *   - test/live separation    -> event.livemode must match our key mode
 *   - delivery idempotency    -> pilot.stripe_connect_events, PK
 *                                (connected_account_id, event id)
 *   - MONEY idempotency       -> the unique index on
 *                                invoice_payments.stripe_payment_intent_id.
 *                                This is the one that matters: a row with a
 *                                NULL processed_at is deliberately
 *                                retryable, so the events ledger alone
 *                                would double-credit a client on a crash
 *                                between the insert and the mark.
 *   - tenancy                 -> derived from event.account only; metadata
 *                                is attacker-controlled and is checked
 *                                against it, never trusted as it
 *   - VISIBILITY              -> every outcome that means "real money
 *                                arrived and this product did not record
 *                                it" is written with account_id AND
 *                                invoice_id resolved, because
 *                                app/(app)/invoices/[id]/page.tsx renders
 *                                'needs_review' AND 'refused' rows for
 *                                that invoice. A row with a null
 *                                account_id is invisible to every tenant
 *                                by RLS, which for a money-bearing refusal
 *                                is the same as never having written it.
 *
 * ASYNCHRONOUS PAYMENTS ARE VISIBLE WITHOUT BEING RECORDED. A bank debit
 * (ACH) completes its Checkout Session at mandate acceptance, days before
 * the money moves, and can still fail. The gate that stops it being
 * recorded early lives in the pure layer and always has; what this route
 * adds is the two outcomes that make the wait honest —
 * 'payment_pending' while it settles and 'payment_failed' when it does
 * not (20260813120000). Neither writes a pilot.invoice_payments row,
 * neither moves the invoice's status, and the pending one is superseded
 * automatically when its own settlement or failure arrives. If that
 * distinction ever blurs, this feature has become a way to mark invoices
 * paid with money that does not exist.
 *
 * MONEY GOING BACK OUT IS NOT HANDLED HERE, and that is a decision rather
 * than an omission. Refunds and disputes (charge.refunded,
 * charge.dispute.*) are deliberately NOT subscribed to (.env.example lists
 * the event types to register — CONNECT_ENDPOINT_EVENT_TYPES, and note
 * that an ACH debit which SETTLES can still be disputed for up to 60 days
 * afterwards, which arrives on that same unsubscribed path) and are NOT
 * acted on: a pilot who
 * refunds a client in their Stripe dashboard corrects the payment on the
 * invoice themselves. See lib/stripe/connect-payments.ts's header for the
 * argument — reversing money automatically is a larger claim than
 * recording it, with no equivalent of the payment-intent unique index to
 * make a retry safe.
 *
 * The decisions themselves are NOT in this file. They live in
 * lib/stripe/connect-payments.ts, which is pure and unit-tested
 * (tests/connect-auto-payment.test.mjs) — this route is the I/O around
 * them, deliberately kept boring enough to read in one sitting.
 *
 * Runs on Node: Stripe's signature verification and the service-role
 * client both want Node APIs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EventsInsert = {
  id: string;
  connected_account_id: string;
  type: string;
  stripe_created_at: string;
  object_id: string | null;
  payment_intent_id: string | null;
  livemode: boolean;
};

/**
 * Outcomes that mean "this Checkout Session has had its final answer".
 *
 * Used in one place only — the out-of-order guard in resolveAsyncSettlement
 * — and the two omissions are the point. 'ignored' is NOT here: it is what
 * an unrelated checkout on the pilot's own Stripe account gets, and what
 * this very guard returns, so treating it as an answer would make the check
 * self-satisfying. 'payment_pending' is NOT here either: it is the question,
 * not the answer, and a redelivery of the event that raised it must still be
 * allowed to re-raise it (finish() writes the outcome and processed_at
 * together, so a pending row only exists where its own delivery completed).
 */
const SESSION_ANSWERED_OUTCOMES = [
  "recorded",
  "duplicate",
  "needs_review",
  "refused",
  "payment_failed",
] as const;

type EventsPatch = {
  account_id?: string | null;
  invoice_id?: string | null;
  outcome?: string;
  detail?: string;
  processed_at?: string;
};

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // DORMANT WITHOUT ITS OWN SECRET. Until the owner registers the Connect
  // endpoint in the Stripe dashboard and puts its whsec_ here, this route
  // verifies nothing and therefore does nothing — no Stripe call, no
  // database connection, no row. Nothing else in the product changes: the
  // pilot generates links and records payments exactly as they did before.
  // 503 rather than the platform webhook's 500 because this is a
  // configuration state, not a fault, and it reads that way in a log.
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "STRIPE_CONNECT_WEBHOOK_SECRET is unset. Automatic payment recording is off, refusing this Connect delivery. Set it from the connected-accounts webhook endpoint's signing secret (dashboard.stripe.com/webhooks)."
    );
    return NextResponse.json(
      { error: "Connect webhook not configured" },
      { status: 503 }
    );
  }

  // RAW body — any parse/re-serialise changes bytes and the HMAC no longer
  // matches. Same rule as the platform webhook.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`Connect signature verification failed: ${message}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.livemode !== isLiveMode()) {
    console.error(
      `Rejected Connect event ${event.id}: livemode=${event.livemode} but this deployment is ${
        isLiveMode() ? "live" : "test"
      }-keyed.`
    );
    return NextResponse.json({ received: true, ignored: "mode-mismatch" });
  }

  // No event.account means Stripe sent this on the PLATFORM's scope, not a
  // connected account's — an endpoint registered with the wrong "listen
  // to" setting. There is no tenancy fact in such a delivery, so there is
  // nothing to record against and no row is written (the ledger is keyed
  // by the connected account). readConnectPaymentEvent refuses it too;
  // this is the earlier of the two guards, not a replacement for it.
  const connectedAccountId = event.account ?? null;
  if (!connectedAccountId) {
    console.error(
      `Connect endpoint received platform-scope event ${event.id} (${event.type}) with no event.account. Check that the webhook endpoint is registered to listen on CONNECTED ACCOUNTS.`
    );
    return NextResponse.json({ received: true, ignored: "not-a-connect-event" });
  }

  const supabase = createServiceClient();
  const session = sessionFrom(event);
  const intent = intentFrom(event);

  // Insert-first idempotency, copied from the platform webhook: the insert
  // IS the check. A redelivery collides on the primary key and we then ask
  // whether the first attempt actually finished.
  const insertRow: EventsInsert = {
    id: event.id,
    connected_account_id: connectedAccountId,
    type: event.type,
    stripe_created_at: new Date(event.created * 1000).toISOString(),
    object_id: session?.id ?? intent?.id ?? null,
    payment_intent_id: idOf(session?.payment_intent) ?? intent?.id ?? null,
    livemode: event.livemode,
  };

  const { error: insertError } = await supabase
    .from("stripe_connect_events")
    .insert(insertRow as never);

  if (insertError) {
    // 23505 IS THE ONLY ERROR THAT MEANS "SEEN BEFORE", and discriminating
    // on it is not pedantry. This block used to treat every insert failure
    // as a primary-key collision: a transient failure (statement timeout,
    // connection blip, pool exhaustion) therefore fell through to the
    // prior-row check, found nothing, and ran the whole handler WITH NO
    // LEDGER ROW IN EXISTENCE — after which every outcome write matched
    // zero rows, PostgREST answered 200 to all of them, and the route
    // answered 200 to Stripe. A 'needs_review' or 'refused' outcome
    // computed on that run is the visible half of the double-record guard,
    // and it vanished: no row, no notice on the invoice, and no redelivery
    // because Stripe had been told everything was fine.
    //
    // So: anything that is not a collision is a 500 and a Stripe retry.
    // Safe by the same index the money relies on — a retry cannot record
    // the payment twice — and a retry that has a ledger row is strictly
    // better than a run that has none.
    if (insertError.code !== "23505") {
      console.error(
        `[db] stripe_connect_events.insert(${event.id}) ${insertError.message} (code ${
          insertError.code ?? "none"
        }). Refusing to run the handler with no delivery row to record its outcome on.`
      );
      return NextResponse.json({ error: "Delivery ledger unavailable" }, { status: 500 });
    }
    const { data: prior, error: priorError } = await supabase
      .from("stripe_connect_events")
      .select("processed_at")
      .eq("id", event.id)
      .eq("connected_account_id", connectedAccountId)
      .maybeSingle();
    if (priorError) {
      // Same reasoning: not knowing whether the first attempt finished is
      // not a licence to assume it did not.
      console.error(
        `[db] stripe_connect_events.select(${event.id}) after a collision: ${priorError.message}`
      );
      return NextResponse.json({ error: "Delivery ledger unavailable" }, { status: 500 });
    }
    if ((prior as { processed_at: string | null } | null)?.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Seen but unfinished — fall through and run the handler again. Safe
    // because the money-level dedupe is a unique index, not this row.
  }

  /**
   * Writes the outcome onto the delivery row and marks it finished.
   *
   * THROWS rather than logs, which is the second half of the fix above:
   * count:"exact" for the house reason (PostgREST answers 200 for an
   * UPDATE that matched nothing), and a zero-row match here means the one
   * sentence written for the pilot went nowhere. Turning that into a 500
   * costs a Stripe redelivery — harmless, the payment-intent index refuses
   * a second row — and buys the guarantee that an outcome either exists or
   * is retried, never silently evaporates.
   */
  const finish = async (patch: EventsPatch) => {
    const { error, count } = await supabase
      .from("stripe_connect_events")
      .update({ ...patch, processed_at: new Date().toISOString() } as never, { count: "exact" })
      .eq("id", event.id)
      .eq("connected_account_id", connectedAccountId);
    if (error) {
      throw new Error(`stripe_connect_events.update(${event.id}): ${error.message}`);
    }
    if (count === 0) {
      throw new Error(
        `stripe_connect_events.update(${event.id}) matched 0 rows. Outcome "${
          patch.outcome ?? "unset"
        }" was not recorded anywhere.`
      );
    }
  };

  try {
    // TENANCY, from the only authenticated fact in the delivery.
    // connect_account_id is UNIQUE on pilot.accounts (20260802190437), so
    // this is at most one row.
    //
    // RESOLVED BEFORE THE EVENT IS EVEN READ, so that EVERY outcome row
    // this handler writes can be attributed to the tenant it concerns.
    // It used to sit after the read, which meant a stage-one refusal — a
    // client paying in the wrong currency, a session Stripe sent with no
    // payment_intent, both of them real money that this product then did
    // not record — was written with a null account_id, and a null
    // account_id is invisible to every tenant under this table's SELECT
    // policy. The handler wrote a careful sentence into a row nobody on
    // earth could read.
    const { data: accountData, error: accountError } = await supabase
      .from("accounts")
      .select("id, connect_account_id, legal_name")
      .eq("connect_account_id", connectedAccountId)
      .maybeSingle();
    if (accountError) throw new Error(`accounts.select: ${accountError.message}`);
    const account = (accountData ?? null) as
      | { id: string; connect_account_id: string | null; legal_name: string | null }
      | null;

    // DEAUTHORIZATION. A pilot can revoke the platform's OAuth grant from
    // their OWN Stripe dashboard at any time, outside this product
    // entirely. Nothing about that action fails loudly: connect_account_id
    // stays set, Settings keeps saying Stripe is connected, and link
    // generation starts failing with the generic "Couldn't create a
    // Stripe payment link. Try again." — a condition no retry fixes.
    // Handled here, before the payment-decision path below, because this
    // event carries no checkout session at all.
    if (event.type === "account.application.deauthorized") {
      if (!account) {
        // Already detached — a duplicate delivery, or the pilot unlinked
        // through Settings (connect_account_unlink) first. Nothing to do.
        await finish({ outcome: "ignored", detail: "deauthorized: no account attached to this connected account" });
        return NextResponse.json({ received: true, outcome: "ignored" });
      }

      // Mirrors pilot.connect_account_unlink's writes exactly
      // (supabase/migrations/20260810010000_connect_link_hardening.sql) —
      // that RPC cannot be called from here: it is SECURITY DEFINER,
      // owner-gated on auth.uid(), and this route has no user session,
      // only the service-role client. protect_account_billing_columns
      // (the trigger that owns connect_account_id) explicitly allows any
      // write from current_user = 'service_role' unconditionally, so no
      // pilot.allow_connect_write flag needs setting here.
      const { error: unlinkError } = await supabase
        .from("accounts")
        .update({ connect_account_id: null } as never)
        .eq("id", account.id);
      if (unlinkError) {
        throw new Error(`accounts.update (deauthorize ${account.id}): ${unlinkError.message}`);
      }

      const { error: linksError } = await supabase
        .from("invoices")
        .update({
          stripe_payment_link_id: null,
          stripe_payment_link_url: null,
          stripe_payment_link_livemode: null,
          stripe_payment_link_amount_cents: null,
        } as never)
        .eq("account_id", account.id)
        .not("stripe_payment_link_id", "is", null);
      if (linksError) {
        throw new Error(`invoices.update (deauthorize ${account.id}): ${linksError.message}`);
      }

      // Any half-finished onboarding is meaningless once the grant is
      // gone — same reasoning as connect_account_unlink's own cleanup.
      const { error: oauthError } = await supabase
        .from("connect_oauth_states")
        .delete()
        .eq("account_id", account.id);
      if (oauthError) {
        throw new Error(`connect_oauth_states.delete (deauthorize ${account.id}): ${oauthError.message}`);
      }

      // Autopay enrollments die with the grant: the Customer and
      // PaymentMethod ids live ON the deauthorized account, so every
      // saved mandate is unreachable from here the moment the grant is
      // gone. Clearing them is what keeps the vendor page and the
      // schedules honest ("autopay is not set up") instead of promising
      // charges that can never be made.
      const { error: autopayError } = await supabase
        .from("clients")
        .update({
          autopay_stripe_customer_id: null,
          autopay_stripe_payment_method_id: null,
          autopay_method_label: null,
          autopay_consented_at: null,
          autopay_livemode: null,
        } as never)
        .eq("account_id", account.id)
        .not("autopay_stripe_customer_id", "is", null);
      if (autopayError) {
        throw new Error(`clients.update (deauthorize autopay ${account.id}): ${autopayError.message}`);
      }

      console.error(
        `Connect event ${event.id}: account ${account.id} deauthorized the platform's Stripe grant from their own dashboard. connect_account_id cleared, payment links retired, oauth state cleared. Settings will show "not connected" on next load.`
      );
      // 'ignored' is the closest of the CHECK-constrained outcomes — this
      // event carries no money and none of the other four values fit
      // ('recorded'/'duplicate'/'needs_review'/'refused' are all about a
      // specific payment). `detail` carries the real story for anyone
      // reading the ledger. account_id is set so the row is visible to
      // the tenant it concerns, same rule as every other outcome here.
      await finish({
        account_id: account.id,
        outcome: "ignored",
        detail: "Stripe grant deauthorized from the connected account's own dashboard. Disconnected here too.",
      });
      return NextResponse.json({ received: true, outcome: "deauthorized" });
    }

    // AUTOPAY ENROLLMENT — a Checkout Session in `setup` mode completing.
    // Handled before the payment readers because a setup session moves no
    // money and must never be fed to a path that could: it has no
    // payment_intent and payment_status 'no_payment_required', so the
    // session reader would land it 'ignored' anyway — this branch exists
    // to act on it, not merely to skip it.
    if (
      event.type === "checkout.session.completed" &&
      session?.mode === "setup"
    ) {
      const outcome = await handleAutopaySetup({
        supabase,
        connectedAccountId,
        account,
        session,
      });
      await finish({
        account_id: account?.id ?? null,
        outcome: "ignored",
        detail: outcome,
      });
      return NextResponse.json({ received: true, outcome: "autopay-setup" });
    }

    const read =
      event.type === AUTOPAY_INTENT_EVENT_TYPE
        ? readAutopayIntentEvent(toConnectIntentEvent(event, connectedAccountId, intent))
        : readConnectPaymentEvent(
            toConnectSessionEvent(event, connectedAccountId, session)
          );
    if (read.kind !== "claim") {
      // 'ignored' is the ordinary path for every event type this endpoint
      // is not interested in, and for links minted before metadata
      // existed. 'refused' is louder: something was wrong with a payment
      // that did happen. Both are recorded and answered 200 — retrying
      // either would produce the same answer three days running.
      const scope = await scopeForDeclared(supabase, account, read.declared ?? null);

      // THE ASYNC LIFECYCLE. An ACH debit that has been authorised but not
      // settled, or one that failed. Neither writes a payment row — the
      // read already decided that, and this branch cannot change it — but
      // both have to reach the pilot's invoice screen, which means an
      // outcome that screen queries for and a resolved invoice_id (a row
      // with a null account_id is invisible to every tenant under RLS, and
      // a pending notice nobody can see is the same as no notice).
      //
      // Gated on the invoice resolving to THIS tenant, not merely on the
      // metadata claiming it: scopeForDeclared returns a null invoice_id
      // for a link whose metadata names a stranger's invoice, and such a
      // delivery falls through to the plain 'ignored' below rather than
      // hanging a notice on somebody else's screen.
      if (read.kind === "ignored" && read.async && scope.account_id && scope.invoice_id) {
        const resolved = await resolveAsyncSettlement({
          supabase,
          eventId: event.id,
          connectedAccountId,
          accountId: scope.account_id,
          invoiceId: scope.invoice_id,
          settlement: read.async,
          detail: read.detail,
        });
        if (resolved.outcome === "payment_failed") {
          console.error(
            `Connect event ${event.id}: asynchronous payment failed on invoice ${scope.invoice_id} (session ${read.async.sessionId}).`
          );
        }
        await finish({ ...scope, outcome: resolved.outcome, detail: resolved.detail });
        return NextResponse.json({ received: true, outcome: resolved.outcome });
      }

      if (read.kind === "refused") {
        console.error(`Connect event ${event.id} refused: ${read.detail}`);
        // A STAGE-ONE REFUSAL IS ALSO AN ANSWER TO A PENDING NOTICE. The
        // settlement of a debit this invoice already advertises as "on its
        // way" can be refused before it ever becomes a claim — Stripe sent
        // no payment_intent, or the session settled in another currency —
        // and the pilot then reads "nothing to do, it lands automatically"
        // beside "check your Stripe balance and record it by hand" about
        // the same money, with only the second one true. Same supersede as
        // the claim path below, and it never throws.
        if (account && session?.id) {
          await supersedePendingNotice({
            supabase,
            connectedAccountId,
            accountId: account.id,
            sessionId: session.id,
          });
        }
      }
      await finish({ ...scope, outcome: read.kind, detail: read.detail });
      return NextResponse.json({ received: true, outcome: read.kind });
    }

    const claim = read.claim;

    // Fetched by id ALONE, deliberately without an account_id filter. The
    // filter would turn a cross-tenant forgery into an indistinguishable
    // "invoice not found"; reading the row and comparing its own
    // account_id is what lets resolveAutoPayment say which of the two
    // happened, and log it as the attempt it was.
    const { data: invoiceData, error: invoiceError } = await supabase
      .from("invoices")
      // The last four columns are for the client's receipt only; the
      // decision layer sees the same four fields it always has.
      .select(
        "id, account_id, status, stripe_payment_link_id, invoice_number, client_id, bill_to_email, bill_to_name, bill_to_contact_name"
      )
      .eq("id", claim.declaredInvoiceId)
      .maybeSingle();
    if (invoiceError) throw new Error(`invoices.select: ${invoiceError.message}`);
    const invoice = (invoiceData ?? null) as
      | (NonNullable<ResolvedInvoice> & {
          invoice_number: string | null;
          client_id: string | null;
          bill_to_email: string | null;
          bill_to_name: string | null;
          bill_to_contact_name: string | null;
        })
      | null;

    let ledger: LedgerRow[] = [];
    if (account && invoice && invoice.account_id === account.id) {
      const { data: ledgerData, error: ledgerError } = await supabase
        .from("invoice_payments")
        .select("id, amount_cents, paid_on, source, stripe_payment_intent_id, reverses_payment_id")
        .eq("account_id", account.id)
        .eq("invoice_id", invoice.id);
      // A failed read here must NOT become "no payments recorded" — that
      // would turn the double-record guard off at exactly the moment it is
      // needed. Throw, 500, let Stripe retry.
      if (ledgerError) throw new Error(`invoice_payments.select: ${ledgerError.message}`);
      ledger = (ledgerData ?? []) as LedgerRow[];
    }

    const decision = resolveAutoPayment({ claim, account, invoice, ledger });
    const scope = {
      account_id: account?.id ?? null,
      invoice_id: invoice && account && invoice.account_id === account.id ? invoice.id : null,
    };

    // THE PENDING NOTICE IS SUPERSEDED BY ITS OWN ANSWER, WHATEVER THAT
    // ANSWER TURNS OUT TO BE — which is why this sits ABOVE the branching
    // rather than beside the recording. If this session was an ACH debit, an
    // earlier delivery wrote "bank payment initiated … marked paid
    // automatically when it settles … nothing to do and nothing to chase"
    // onto this invoice. That sentence is answered by the settlement
    // arriving, not by the settlement being RECORDED: a debit that settles
    // and is then refused (the invoice was voided while it was in flight) or
    // held for review (the pilot typed it in by hand on Wednesday) has had
    // its answer just as much as one that lands on the ledger, and leaving
    // the blue notice up means a pilot reads "nothing to do, it resolves
    // itself" directly beside "money arrived and was not recorded — look at
    // this", indefinitely, about the same money. The promise the pending
    // notice makes is that it takes ITSELF off the screen; every terminal
    // resolution of the session has to keep it.
    //
    // Runs on the 'duplicate' path too: a redelivery of the settlement is
    // exactly when a previous attempt may have died between the payment
    // insert and this stamp.
    //
    // Guarded on `account` alone. The pending row was written with
    // account_id = this account (a row with a null account_id is invisible
    // under RLS and is never written for a pending notice), and the update
    // is keyed on connected account + account + session id, so it cannot
    // reach another tenant's row whatever the invoice lookup did. Never
    // throws — see supersedePendingNotice.
    if (account) {
      await supersedePendingNotice({
        supabase,
        connectedAccountId,
        accountId: account.id,
        sessionId: claim.sessionId,
      });
    }

    if (decision.kind === "refused") {
      // logDetail when the decision has one: the precise which-case
      // sentence goes to the PLATFORM's log, while the row this tenant can
      // read carries the collapsed one. See resolveAutoPayment's note on
      // the invoice checks — the distinction between "no such invoice" and
      // "someone else's invoice" is an existence oracle if it is written
      // where the forger can read it back.
      console.error(`Connect event ${event.id} refused: ${decision.logDetail ?? decision.detail}`);
      await finish({ ...scope, outcome: "refused", detail: decision.detail });
      return NextResponse.json({ received: true, outcome: "refused" });
    }

    if (decision.kind === "needs_review") {
      // Deliberately NOT an error: nothing is broken, a human has to look.
      // The pilot sees this sentence on the invoice screen.
      await finish({ ...scope, outcome: "needs_review", detail: decision.detail });
      return NextResponse.json({ received: true, outcome: "needs_review" });
    }

    let outcome: "recorded" | "duplicate" = "duplicate";
    let detail = decision.kind === "duplicate" ? decision.detail : "";

    if (decision.kind === "record") {
      const inserted = await insertPayment(supabase, decision.insert);
      outcome = inserted ? "recorded" : "duplicate";
      detail = inserted
        ? decision.detail
        : `Payment ${claim.paymentIntentId} was already on the ledger. Recorded once, not twice.`;
    }

    // STATUS SYNC RUNS ON BOTH PATHS, including 'duplicate'. That is what
    // makes a retry self-healing: if a previous attempt inserted the row
    // and then died before advancing the status, the redelivery lands here
    // with nothing to insert and still finishes the job. Everything below
    // is what recordPayment does, in the same order, because the triggers
    // wave service_role straight through and enforce none of it.
    //
    // It can also come back with something the pilot has to see — the
    // invoice was voided while this payment was landing, or the invoice is
    // now overpaid because a hand-typed row committed in the same second.
    // Those raise the review prompt rather than passing silently.
    let reviewNote: string | null = null;
    if (invoice && account) {
      reviewNote = await syncInvoiceStatus(supabase, account.id, invoice.id);
    }

    // Retire the link last, after the money and the status — a Stripe
    // outage here must never cost a payment that has actually arrived.
    if (decision.kind === "record" && decision.retireLinkId && account && invoice) {
      const note = await retirePaymentLink({
        supabase,
        accountId: account.id,
        connectAccountId: connectedAccountId,
        invoiceId: invoice.id,
        paymentLinkId: decision.retireLinkId,
      });
      if (note) detail = `${detail} ${note}`;
    }

    // THE CLIENT'S RECEIPT — only on the run whose insert actually landed
    // ('recorded'; a redelivery lands 'duplicate' above and sends nothing,
    // which is the receipt's idempotency), and only for the two ONLINE
    // sources this route records. lib/email/payment-receipt.ts's header
    // says why manual payments are never receipted. Best-effort and after
    // everything that matters: a mail failure must not 500 a delivery
    // whose money is already on the ledger.
    if (decision.kind === "record" && outcome === "recorded" && account && invoice) {
      await sendClientReceipt({
        supabase,
        accountName: account.legal_name ?? "",
        invoice,
        insert: decision.insert,
      });
    }

    // A review note OUTRANKS 'recorded'/'duplicate' as the outcome, because
    // outcome is what decides whether a human is shown this row, and both
    // notes mean a human has to look. The recording sentence is kept in
    // front of it — the pilot needs to know what was written as well as
    // what is wrong with it.
    const finalOutcome = reviewNote ? "needs_review" : outcome;
    const finalDetail = reviewNote ? `${detail} ${reviewNote}`.trim() : detail;
    await finish({ ...scope, outcome: finalOutcome, detail: finalDetail });
    return NextResponse.json({ received: true, outcome: finalOutcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`Connect handler failed for ${event.type} (${event.id}): ${message}`);
    // processed_at stays NULL, so Stripe's retry is allowed to run the
    // handler again. Safe by construction: the payment-intent unique index
    // makes a second insert impossible.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Inserts the payment row. Returns false when this PaymentIntent was
 * already on the ledger.
 *
 * 23505 IS A SUCCESS, NOT A FAILURE. It means a previous delivery of this
 * same payment already wrote the row — which is exactly the outcome
 * wanted, arrived at by the database rather than by a read-then-write race
 * this handler could lose. Any other error is real and is thrown so Stripe
 * retries.
 */
async function insertPayment(supabase: ServiceClient, payload: PaymentInsert): Promise<boolean> {
  const { error } = await supabase.from("invoice_payments").insert(payload as never);
  if (!error) return true;
  if (error.code === "23505") {
    console.warn(
      `invoice_payments insert for ${payload.stripe_payment_intent_id} hit the payment-intent unique index. Already recorded.`
    );
    return false;
  }
  throw new Error(`invoice_payments.insert: ${error.message}`);
}

/**
 * What to write for an asynchronous payment that has been AUTHORISED but
 * not settled, or that has FAILED. Never inserts, updates or deletes a
 * pilot.invoice_payments row — this whole function is about what a pilot
 * is shown, and the read layer has already established that no money moved.
 *
 * Three jobs, in this order:
 *
 *   1. PENDING, BUT ALREADY ANSWERED. Stripe does not guarantee delivery
 *      order, so a first delivery of `completed` can arrive AFTER the
 *      settlement event it precedes (a retry of the former after the latter
 *      has been processed). Writing a pending notice then would leave
 *      "settles in a few business days" sitting permanently on an invoice
 *      whose debit has already succeeded — or already FAILED — and it can
 *      never be superseded, because the event that would supersede it has
 *      been and gone. Two cheap reads close that: the ledger for a payment
 *      that already settled, and this session's own earlier deliveries for
 *      any other terminal answer.
 *   2. FAILED: retire the spent link, so the invoice screen stops offering
 *      a URL that can no longer take a payment and starts offering to
 *      generate a new one.
 *   3. Either way, supersede an earlier pending notice for the same
 *      Checkout Session.
 */
async function resolveAsyncSettlement(params: {
  supabase: ServiceClient;
  /** This delivery's own event id, so check #1 cannot match its own row. */
  eventId: string;
  connectedAccountId: string;
  accountId: string;
  invoiceId: string;
  settlement: AsyncSettlement;
  detail: string;
}): Promise<{
  outcome: "payment_pending" | "payment_failed" | "needs_review" | "ignored";
  detail: string;
}> {
  const { supabase, settlement } = params;

  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .select("status, stripe_payment_link_id")
    .eq("id", params.invoiceId)
    .eq("account_id", params.accountId)
    .maybeSingle();
  if (invoiceError) throw new Error(`invoices.select(async): ${invoiceError.message}`);
  const invoice = (invoiceData ?? null) as {
    status: string;
    stripe_payment_link_id: string | null;
  } | null;
  const deadInvoice = invoice?.status === "void" || invoice?.status === "draft";

  if (settlement.state === "initiated") {
    if (settlement.paymentIntentId) {
      const { data, error } = await supabase
        .from("invoice_payments")
        .select("id")
        .eq("account_id", params.accountId)
        .eq("invoice_id", params.invoiceId)
        .eq("stripe_payment_intent_id", settlement.paymentIntentId)
        .maybeSingle();
      // A FAILED READ MUST NOT BECOME "not recorded yet". Throwing gets a
      // Stripe retry, which is free here — nothing has been written.
      if (error) throw new Error(`invoice_payments.select(async pending): ${error.message}`);
      if (data) {
        return {
          outcome: "ignored",
          detail: `Session ${settlement.sessionId} reported an authorised payment that has already settled and been recorded on this invoice. Nothing to show.`,
        };
      }
    }

    // THE SAME HOLE, ON THE SIDE WHERE NO MONEY EVER MOVED. The ledger read
    // above closes "completed arrives after the debit settled and was
    // recorded". It cannot close "completed arrives after the debit FAILED",
    // because a failure leaves no invoice_payments row to find — nor
    // "completed arrives after the settlement was refused or held for
    // review", where the money arrived and deliberately did not reach the
    // ledger. In every one of those the question this session asked has
    // already been answered, the answering event will not be delivered
    // again, and writing "not paid yet … marked paid automatically when it
    // settles" now would park that promise on the invoice permanently,
    // beside the amber notice that contradicts it. The pending notice's
    // whole claim is that it clears itself; one that is born after its own
    // answer never can.
    //
    // Keyed (connected account, session id) — the pair
    // stripe_connect_events_object_idx serves and the only handle these
    // deliveries share — and excluding THIS event's own row, which is still
    // unprocessed at this point but would otherwise match on a redelivery.
    const { data: answered, error: answeredError } = await supabase
      .from("stripe_connect_events")
      .select("type, outcome")
      .eq("connected_account_id", params.connectedAccountId)
      .eq("object_id", settlement.sessionId)
      .neq("id", params.eventId)
      .in("outcome", [...SESSION_ANSWERED_OUTCOMES])
      .not("processed_at", "is", null)
      .limit(1);
    // A FAILED READ MUST NOT BECOME "not answered yet", for the same reason
    // as the ledger read above: the direction it fails in writes a promise.
    // Throwing gets a Stripe retry, and nothing has been written.
    if (answeredError) {
      throw new Error(`stripe_connect_events.select(async pending): ${answeredError.message}`);
    }
    const prior = ((answered ?? []) as { type: string; outcome: string }[])[0];
    if (prior) {
      return {
        outcome: "ignored",
        detail: `Session ${settlement.sessionId} reported an authorised payment, but this session has already been resolved by ${prior.type} (${prior.outcome}). That answer arrived first and stands. No pending notice was raised.`,
      };
    }

    // THE PENDING SENTENCE PROMISES SOMETHING THIS INVOICE CANNOT KEEP.
    // Its last clause is "this invoice is marked paid automatically when it
    // settles" — true for a sent or partly-paid invoice, and false for a
    // void or draft one, where resolveAutoPayment will refuse the money
    // when it arrives and tell the pilot to refund it. Reachable because
    // voiding an invoice can only ASK Stripe to deactivate its link, and
    // 20260809040000's header is explicit that the request can fail,
    // leaving a payable link on the pilot's own account.
    //
    // So it is raised as 'needs_review' instead: amber, and a sentence
    // saying what is actually about to happen. A client's money is about
    // to land against a cancelled document, and four days' warning is
    // worth considerably more than the notice after the fact.
    if (deadInvoice) {
      const amount =
        settlement.amountCents === null ? "a bank payment" : formatCentsPlain(settlement.amountCents);
      return {
        outcome: "needs_review",
        detail: `A client has authorised ${amount} for this invoice through a payment link that should have been deactivated, and it is due to settle in a few business days. This invoice is ${invoice?.status ?? "not payable"}, so the money will NOT be recorded against it when it lands. It will simply arrive in your Stripe balance. Refund it in Stripe once it settles, or reissue the invoice.`,
      };
    }

    return { outcome: "payment_pending", detail: params.detail };
  }

  await supersedePendingNotice({
    supabase,
    connectedAccountId: params.connectedAccountId,
    accountId: params.accountId,
    sessionId: settlement.sessionId,
  });

  // RETIRE THE SPENT LINK, but only if it is still the one this invoice
  // stores. A newer link may have been generated while the debit was in
  // flight — the pilot got impatient, or corrected a payment — and clearing
  // THAT one would take a live, payable URL off the invoice because an
  // older debit failed.
  let detail = params.detail;
  if (settlement.paymentLinkId) {
    const storedLinkId = invoice?.stripe_payment_link_id ?? null;
    if (storedLinkId && storedLinkId === settlement.paymentLinkId) {
      // Stripe should already have deactivated it at session completion
      // (restrictions.completed_sessions.limit = 1), so this call is
      // belt-and-braces rather than the load-bearing part — but "that link
      // has been used up" is a sentence this product is about to put in
      // front of a pilot, and making it true costs one idempotent call.
      const note = await retirePaymentLink({
        supabase,
        accountId: params.accountId,
        connectAccountId: params.connectedAccountId,
        invoiceId: params.invoiceId,
        paymentLinkId: settlement.paymentLinkId,
      });
      if (note) detail = `${detail} ${note}`;
    }
  }

  return { outcome: "payment_failed", detail };
}

/**
 * Takes an earlier "bank payment initiated" notice off the invoice screen,
 * now that the same Checkout Session's real answer has arrived.
 *
 * Matched on (connected account, Checkout Session id) — object_id is where
 * the cs_... is stored, and it is the only handle the pending row and its
 * resolution share. Scoped to account_id as well, so this can only ever
 * touch a row already attributed to the tenant this delivery concerns.
 *
 * NEVER THROWS. A failure here leaves a stale-but-harmless informational
 * notice that the pilot can dismiss themselves, and turning that into a 500
 * would re-run a handler that has just recorded money in order to retry a
 * banner. The wrong trade: log it and move on.
 */
async function supersedePendingNotice(params: {
  supabase: ServiceClient;
  connectedAccountId: string;
  accountId: string;
  sessionId: string;
}): Promise<void> {
  if (!params.sessionId) return;
  const { error } = await params.supabase
    .from("stripe_connect_events")
    .update({ reviewed_at: new Date().toISOString() } as never)
    .eq("connected_account_id", params.connectedAccountId)
    .eq("account_id", params.accountId)
    .eq("object_id", params.sessionId)
    .eq("outcome", "payment_pending")
    .is("reviewed_at", null);
  if (error) {
    console.error(
      `[db] stripe_connect_events.update(supersede pending ${params.sessionId}): ${error.message}`
    );
  }
}

/**
 * Resolves the ledger row's account_id/invoice_id for a delivery that
 * never became a claim.
 *
 * The invoice is only attached when it really is this tenant's — the
 * declared ids are metadata, and metadata is typed by whoever owns the
 * connected Stripe account. A mismatch simply leaves invoice_id null: the
 * row stays attributed to the account Stripe named (so the platform and
 * that tenant can see it) and never appears on a stranger's invoice.
 */
async function scopeForDeclared(
  supabase: ServiceClient,
  account: ResolvedAccount,
  declared: DeclaredScope | null
): Promise<{ account_id: string | null; invoice_id: string | null }> {
  if (!account) return { account_id: null, invoice_id: null };
  if (!declared || declared.declaredAccountId !== account.id) {
    return { account_id: account.id, invoice_id: null };
  }
  const { data, error } = await supabase
    .from("invoices")
    .select("id, account_id")
    .eq("id", declared.declaredInvoiceId)
    .maybeSingle();
  if (error) throw new Error(`invoices.select(scope): ${error.message}`);
  const invoice = (data ?? null) as { id: string; account_id: string } | null;
  return {
    account_id: account.id,
    invoice_id: invoice && invoice.account_id === account.id ? invoice.id : null,
  };
}

/**
 * Advances the invoice's status to match the ledger, exactly as
 * recordPayment does — read pilot.invoice_totals (the one source for a
 * balance), then write 'paid' or 'partial'.
 *
 * Returns a sentence for the pilot when the invoice and the payment have
 * disagreed with each other, and null when everything lines up.
 *
 * THE STATUS IS RE-READ HERE, NOT PASSED IN FROM BEFORE THE INSERT, AND
 * THE WRITE IS GUARDED. Both halves matter, because this is the one place
 * in the product where a status write has no database backstop:
 * invoices_protect_issued early-returns for service_role
 * (20260810170000:84-86), so nothing refuses void -> paid on this path,
 * and invoice_payments_validate's FOR SHARE lock on the invoice — taken on
 * the manual path precisely because "an invoice being voided and a payment
 * being recorded against it could each read the other's pre-write state
 * and both commit" (20260810120000:105-112) — is waived for us too. The
 * earlier version computed `next` from the status read BEFORE the payment
 * insert and wrote it filtered on id + account_id alone, so a pilot's void
 * committing in that window was silently overwritten with 'paid': a
 * cancelled invoice reading Paid, and the accounting ledger's
 * payment_void_reclass (which keys on invoices.status = 'void',
 * 20260812100000:645) never firing, so money that is a client_credit
 * liability posts as income.
 *
 * Throws on a read/write failure, which returns 500 and lets Stripe retry:
 * a payment recorded against an invoice still reading "Sent" is the
 * specific bug recordPayment's own comments describe, and here nobody is
 * watching a screen to notice it. The retry is safe and productive — it
 * re-runs this function without re-inserting the payment.
 */
async function syncInvoiceStatus(
  supabase: ServiceClient,
  accountId: string,
  invoiceId: string
): Promise<string | null> {
  const [totalsResult, invoiceResult] = await Promise.all([
    supabase
      .from("invoice_totals")
      .select("balance_due_cents")
      .eq("invoice_id", invoiceId)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select("status")
      .eq("id", invoiceId)
      .eq("account_id", accountId)
      .maybeSingle(),
  ]);
  if (totalsResult.error) {
    throw new Error(`invoice_totals.select(after insert): ${totalsResult.error.message}`);
  }
  if (invoiceResult.error) {
    throw new Error(`invoices.select(after insert): ${invoiceResult.error.message}`);
  }

  const balance =
    (totalsResult.data as { balance_due_cents: number } | null)?.balance_due_cents ?? null;
  const statusNow = (invoiceResult.data as { status: string } | null)?.status ?? null;
  if (statusNow === null) {
    throw new Error(`invoices.select(after insert) found no invoice ${invoiceId}`);
  }

  if (statusNow === "void" || statusNow === "draft") {
    return deadInvoiceNote(statusNow);
  }

  const next = nextInvoiceStatus(statusNow, balance);
  if (next && next !== statusNow) {
    // count:"exact" for the house reason — PostgREST answers 200 for an
    // UPDATE that matched nothing — and the status filter so that the only
    // rows this can move are the two it is allowed to move.
    const { error: updateError, count } = await supabase
      .from("invoices")
      .update({ status: next } as never, { count: "exact" })
      .eq("id", invoiceId)
      .eq("account_id", accountId)
      .in("status", ["sent", "partial"]);
    if (updateError) throw new Error(`invoices.update(status): ${updateError.message}`);
    if (count === 0) {
      // The invoice left sent/partial between the read above and this
      // write. Find out where it went rather than assuming.
      const { data: afterData, error: afterError } = await supabase
        .from("invoices")
        .select("status")
        .eq("id", invoiceId)
        .eq("account_id", accountId)
        .maybeSingle();
      if (afterError) throw new Error(`invoices.select(status conflict): ${afterError.message}`);
      const after = (afterData as { status: string } | null)?.status ?? null;
      if (after === null) {
        throw new Error(`invoices.update(status) matched 0 rows for invoice ${invoiceId}`);
      }
      if (after === "void" || after === "draft") return deadInvoiceNote(after);
      // 'paid' when this wanted 'partial' means someone else's write read a
      // fresher balance than this one did. Theirs wins; nothing to say.
    }
  }

  // OVERPAID. The balance was re-read after the insert, so a negative one
  // means this invoice now carries more money than it billed — in practice
  // a hand-typed payment that committed between this handler's ledger read
  // and its own insert (the guard in resolveAutoPayment is read-then-
  // decide-then-insert with no lock, so a manual row landing inside that
  // window is invisible to it). Detecting it here costs nothing: the read
  // has already happened.
  if (balance !== null && balance < 0) {
    return `This invoice is now overpaid by ${formatCentsPlain(
      -balance
    )}. A payment was probably recorded by hand at the same moment this one arrived. Check whether they are the same money, and correct one of them if they are.`;
  }

  return null;
}

function deadInvoiceNote(status: string): string {
  return status === "void"
    ? "This invoice was voided at the same moment the payment arrived, so it has NOT been marked paid. The money is in your Stripe account against a cancelled invoice. Refund the client in Stripe, or reissue the invoice."
    : "This invoice was put back to draft at the same moment the payment arrived, so its status has not been advanced. Check the invoice against what reached your Stripe account.";
}

/**
 * The webhook's copy of recordPayment's retirePaymentLink: deactivate on
 * Stripe first, then clear the four stored columns.
 *
 * A COPY ON PURPOSE. The original lives in a "use server" actions file and
 * takes a session-scoped Supabase client; importing it here would drag a
 * server-action module into a route handler and hand it a service-role
 * client, which is a worse coupling than twenty lines. The ORDER is what
 * must not drift, and it is the same: Stripe first (only that call can
 * stop a URL in a client's inbox taking money), the row second.
 *
 * Never throws. The payment is already recorded by the time this runs, and
 * a Stripe outage must not turn a recorded payment into a 500 and a retry.
 */
async function retirePaymentLink(params: {
  supabase: ServiceClient;
  accountId: string;
  connectAccountId: string;
  invoiceId: string;
  paymentLinkId: string;
}): Promise<string> {
  let note = "";
  try {
    await deactivatePaymentLink({
      connectAccountId: params.connectAccountId,
      paymentLinkId: params.paymentLinkId,
    });
  } catch (err) {
    note =
      `The payment link ${params.paymentLinkId} could not be switched off on Stripe. Deactivate it in your Stripe Dashboard.`;
    console.error(
      `deactivatePaymentLink failed after auto-recording a payment on invoice ${params.invoiceId}: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
  }

  const { error, count } = await params.supabase
    .from("invoices")
    .update(
      {
        stripe_payment_link_id: null,
        stripe_payment_link_url: null,
        stripe_payment_link_livemode: null,
        stripe_payment_link_amount_cents: null,
      } as never,
      { count: "exact" }
    )
    .eq("id", params.invoiceId)
    .eq("account_id", params.accountId);

  if (error || count === 0) {
    console.error(
      `[db] invoices.update(clear payment_link) after auto-record on ${params.invoiceId}: ${
        error ? error.message : "matched 0 rows"
      }`
    );
    note = `${note} This invoice's stored record of that link could not be cleared.`.trim();
  }

  return note;
}

/**
 * AUTOPAY ENROLLMENT. A client finished the vendor page's Checkout setup
 * session, so their saved card lands on pilot.clients — the ONLY writer of
 * those five columns (the migration withholds them from every
 * authenticated grant precisely so this signed path is the only way in).
 *
 * Returns the sentence for the events ledger. Metadata problems RETURN
 * rather than throw — a malformed setup session reads the same three days
 * running, so a retry buys nothing — while Stripe/Postgres failures throw
 * so the delivery is retried with the enrollment still unrecorded.
 */
async function handleAutopaySetup(params: {
  supabase: ServiceClient;
  connectedAccountId: string;
  account: ResolvedAccount;
  session: Stripe.Checkout.Session;
}): Promise<string> {
  const { supabase, connectedAccountId, account, session } = params;
  const metadata = session.metadata ?? {};

  if ((metadata.autopay_setup ?? "") !== "1") {
    return `Setup session ${session.id} completed on this Stripe account but was not started by this product's autopay flow. Nothing recorded.`;
  }
  if (!account) {
    return `Setup session ${session.id} completed on connected account ${connectedAccountId}, which no longer resolves to a tenant. Nothing recorded.`;
  }
  // The same trust rule as every payment claim: metadata says WHICH
  // client, the signed event.account says WHOSE. A mismatch is a forgery
  // attempt or a stale session from before a reconnect — either way, no.
  if ((metadata.account_id ?? "") !== account.id) {
    return `Setup session ${session.id} names account ${metadata.account_id ?? "(none)"} but was delivered from connected account ${connectedAccountId}, which belongs to a different tenant. Refused.`;
  }
  const clientId = (metadata.client_id ?? "").trim();
  if (!clientId) {
    return `Setup session ${session.id} carries no client_id. Nothing recorded.`;
  }
  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select("id, account_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) throw new Error(`clients.select (autopay setup): ${clientError.message}`);
  const client = clientData as { id: string; account_id: string } | null;
  if (!client || client.account_id !== account.id) {
    return `Setup session ${session.id} names a client that is not one of this tenant's. Refused.`;
  }

  const setupIntentId = idOf(session.setup_intent);
  if (!setupIntentId) {
    return `Setup session ${session.id} completed with no setup_intent, so there is no saved method to record.`;
  }
  const saved = await readAutopaySetupResult({
    connectAccountId: connectedAccountId,
    setupIntentId,
  });
  if (!saved) {
    return `Setup session ${session.id}'s SetupIntent has not succeeded, so no method was saved and autopay was not enabled.`;
  }

  const { error: updateError, count } = await supabase
    .from("clients")
    .update(
      {
        autopay_stripe_customer_id: saved.customerId,
        autopay_stripe_payment_method_id: saved.paymentMethodId,
        autopay_method_label: saved.label,
        autopay_consented_at: new Date().toISOString(),
        autopay_livemode: isLiveMode(),
      } as never,
      { count: "exact" }
    )
    .eq("id", client.id)
    .eq("account_id", account.id);
  if (updateError) throw new Error(`clients.update (autopay setup): ${updateError.message}`);
  if (count === 0) {
    throw new Error(`clients.update (autopay setup ${client.id}) matched 0 rows.`);
  }

  return `Autopay enabled: the client saved ${saved.label} for automatic charging of recurring invoices.`;
}

/**
 * Emails the client their receipt for a payment this delivery just
 * recorded. The mail goes out in the PILOT'S name (fromName =
 * accounts.legal_name, reply-to = the owner's own address) and carries no
 * V1 branding — lib/email/payment-receipt.ts owns the copy and restates
 * the rule.
 *
 * NEVER THROWS. The payment is on the ledger by the time this runs; a
 * failed lookup or refused send is logged and the delivery finishes
 * normally. A redelivery lands 'duplicate' before reaching this, so a
 * receipt is attempted at most once per payment — a failed attempt is not
 * retried, which is the right trade for mail with no idempotency key.
 */
async function sendClientReceipt(params: {
  supabase: ServiceClient;
  accountName: string;
  invoice: {
    id: string;
    account_id: string;
    invoice_number: string | null;
    client_id: string | null;
    bill_to_email: string | null;
    bill_to_name: string | null;
    bill_to_contact_name: string | null;
  };
  insert: PaymentInsert;
}): Promise<void> {
  const { supabase, invoice, insert } = params;
  try {
    type ReceiptClient = {
      name: string;
      contact_name: string | null;
      contact_email: string | null;
      billing_email: string | null;
    };
    let client: ReceiptClient | null = null;
    if (invoice.client_id) {
      const { data, error } = await supabase
        .from("clients")
        .select("name, contact_name, contact_email, billing_email")
        .eq("id", invoice.client_id)
        .eq("account_id", invoice.account_id)
        .maybeSingle();
      if (error) {
        console.error(`[receipt] clients.select(${invoice.client_id}): ${error.message}. No receipt sent.`);
        return;
      }
      client = (data ?? null) as ReceiptClient | null;
    }

    const to = billToEmail(invoice, client, looksLikeEmail);
    if (!to) {
      // An invoice with no reachable address gets no receipt — same as it
      // gets no emailed copy. Not an error; nothing to log at error level.
      return;
    }

    // The balance AFTER this payment, re-read from the one source for a
    // balance. A failed read drops the balance line from the receipt
    // rather than dropping the receipt.
    const { data: totalsData } = await supabase
      .from("invoice_totals")
      .select("balance_due_cents")
      .eq("invoice_id", invoice.id)
      .maybeSingle();
    const balanceDueCents =
      (totalsData as { balance_due_cents: number } | null)?.balance_due_cents ?? null;

    const receipt = buildClientReceipt({
      accountName: params.accountName,
      clientName: client?.name ?? invoice.bill_to_name ?? "",
      contactName: client?.contact_name ?? invoice.bill_to_contact_name,
      invoiceNumber: invoice.invoice_number,
      amountCents: insert.amount_cents,
      paidOnIso: insert.paid_on,
      balanceDueCents,
    });

    const replyTo = await ownerEmail(supabase, invoice.account_id);
    const result = await sendEmail({
      to,
      subject: receipt.subject,
      text: receipt.text,
      fromName: params.accountName || undefined,
      replyTo,
    });
    if (!result.ok) {
      console.error(
        `[receipt] send for invoice ${invoice.id} failed (${result.kind}): ${result.error}`
      );
    }
  } catch (err) {
    console.error(
      `[receipt] unexpected failure for invoice ${invoice.id}: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
  }
}

/** The Checkout Session on this event, when it carries one. */
function sessionFrom(event: Stripe.Event): Stripe.Checkout.Session | null {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    return event.data.object as Stripe.Checkout.Session;
  }
  return null;
}

/** `string | { id } | null` -> `string | null`, for Stripe's expandable fields. */
function idOf(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : (value.id ?? null);
}

/** The PaymentIntent on this event, when it carries one. */
function intentFrom(event: Stripe.Event): Stripe.PaymentIntent | null {
  if (event.type === "payment_intent.succeeded") {
    return event.data.object as Stripe.PaymentIntent;
  }
  return null;
}

/** SDK → plain shape for the autopay intent reader, mirroring toConnectSessionEvent. */
function toConnectIntentEvent(
  event: Stripe.Event,
  connectedAccountId: string,
  intent: Stripe.PaymentIntent | null
): ConnectIntentEvent {
  return {
    eventId: event.id,
    eventType: event.type,
    eventAccount: connectedAccountId,
    eventCreated: event.created,
    intent: {
      id: intent?.id ?? "",
      amountReceivedCents: intent?.amount_received ?? null,
      currency: intent?.currency ?? null,
      metadata: (intent?.metadata ?? null) as Readonly<Record<string, string>> | null,
    },
  };
}

/**
 * Narrows Stripe's SDK types down to the plain shape the pure decision
 * module takes. Everything the mapping is allowed to see passes through
 * here — which is what keeps lib/stripe/connect-payments.ts free of the
 * SDK, and its tests free of a fixture nobody can read.
 */
function toConnectSessionEvent(
  event: Stripe.Event,
  connectedAccountId: string,
  session: Stripe.Checkout.Session | null
): ConnectSessionEvent {
  return {
    eventId: event.id,
    eventType: event.type,
    eventAccount: connectedAccountId,
    eventCreated: event.created,
    livemode: event.livemode,
    session: {
      id: session?.id ?? "",
      paymentStatus: session?.payment_status ?? null,
      amountTotal: session?.amount_total ?? null,
      currency: session?.currency ?? null,
      paymentIntentId: idOf(session?.payment_intent),
      paymentLinkId: idOf(session?.payment_link),
      paymentMethodTypes: session?.payment_method_types ?? null,
      metadata: (session?.metadata ?? null) as Readonly<Record<string, string>> | null,
    },
  };
}
