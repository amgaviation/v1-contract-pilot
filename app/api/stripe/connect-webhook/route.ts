import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, isLiveMode } from "@/lib/stripe/server";
import { deactivatePaymentLink } from "@/lib/stripe/connect";
import { createServiceClient } from "@/lib/supabase/service-role";
import {
  formatCentsPlain,
  nextInvoiceStatus,
  readConnectPaymentEvent,
  resolveAutoPayment,
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
 * MONEY GOING BACK OUT IS NOT HANDLED HERE, and that is a decision rather
 * than an omission. Refunds and disputes (charge.refunded,
 * charge.dispute.*) are deliberately NOT subscribed to (.env.example lists
 * the two event types to register) and are NOT acted on: a pilot who
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
      "STRIPE_CONNECT_WEBHOOK_SECRET is unset — automatic payment recording is off, refusing this Connect delivery. Set it from the connected-accounts webhook endpoint's signing secret (dashboard.stripe.com/webhooks)."
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

  // Insert-first idempotency, copied from the platform webhook: the insert
  // IS the check. A redelivery collides on the primary key and we then ask
  // whether the first attempt actually finished.
  const insertRow: EventsInsert = {
    id: event.id,
    connected_account_id: connectedAccountId,
    type: event.type,
    stripe_created_at: new Date(event.created * 1000).toISOString(),
    object_id: session?.id ?? null,
    payment_intent_id: idOf(session?.payment_intent),
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
        }) — refusing to run the handler with no delivery row to record its outcome on.`
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
        `stripe_connect_events.update(${event.id}) matched 0 rows — outcome "${
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
      .select("id, connect_account_id")
      .eq("connect_account_id", connectedAccountId)
      .maybeSingle();
    if (accountError) throw new Error(`accounts.select: ${accountError.message}`);
    const account = (accountData ?? null) as ResolvedAccount;

    const read = readConnectPaymentEvent(
      toConnectSessionEvent(event, connectedAccountId, session)
    );
    if (read.kind !== "claim") {
      // 'ignored' is the ordinary path for every event type this endpoint
      // is not interested in, and for links minted before metadata
      // existed. 'refused' is louder: something was wrong with a payment
      // that did happen. Both are recorded and answered 200 — retrying
      // either would produce the same answer three days running.
      const scope = await scopeForDeclared(supabase, account, read.declared ?? null);
      if (read.kind === "refused") {
        console.error(`Connect event ${event.id} refused: ${read.detail}`);
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
      .select("id, account_id, status, stripe_payment_link_id")
      .eq("id", claim.declaredInvoiceId)
      .maybeSingle();
    if (invoiceError) throw new Error(`invoices.select: ${invoiceError.message}`);
    const invoice = (invoiceData ?? null) as ResolvedInvoice;

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
        : `Payment ${claim.paymentIntentId} was already on the ledger — recorded once, not twice.`;
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
      `invoice_payments insert for ${payload.stripe_payment_intent_id} hit the payment-intent unique index — already recorded.`
    );
    return false;
  }
  throw new Error(`invoice_payments.insert: ${error.message}`);
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
    )} — a payment was probably recorded by hand at the same moment this one arrived. Check whether they are the same money, and correct one of them if they are.`;
  }

  return null;
}

function deadInvoiceNote(status: string): string {
  return status === "void"
    ? "This invoice was voided at the same moment the payment arrived, so it has NOT been marked paid — the money is in your Stripe account against a cancelled invoice. Refund the client in Stripe, or reissue the invoice."
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
      `The payment link ${params.paymentLinkId} could not be switched off on Stripe — deactivate it in your Stripe Dashboard.`;
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
