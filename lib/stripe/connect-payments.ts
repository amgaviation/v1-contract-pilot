/**
 * The event-to-payment mapping for Stripe Connect payment links.
 *
 * DELIBERATELY PURE. No imports, no "server-only", no I/O, no Stripe SDK
 * types — the same discipline lib/entitlements.ts states for itself, and
 * for the same reason: this is where the decisions that move a pilot's
 * money are made, so it has to be testable with nothing installed and no
 * network (tests/connect-auto-payment.test.mjs). Everything that talks to
 * Postgres or Stripe lives in app/api/stripe/connect-webhook/route.ts,
 * which is a thin shell around the two functions here.
 *
 * The split is: `readConnectPaymentEvent` turns a signed delivery into a
 * CLAIM (what the event says happened), and `resolveAutoPayment` decides
 * what to do about it given what the database actually holds. The route
 * does the reads in between. Nothing here trusts a claim — see the
 * tenancy checks in resolveAutoPayment, which exist because a Payment
 * Link's metadata is typed by whoever owns the connected Stripe account
 * and is therefore attacker-controlled input.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: money going back out.
 * `charge.refunded`, `charge.dispute.created` and every other
 * refund/chargeback event are OUT OF SCOPE for automatic recording, and
 * the Connect endpoint is documented (.env.example, docs/LAUNCH-GATES.md)
 * as subscribing only to the two checkout.session.* types above. A pilot
 * who refunds a client in their Stripe dashboard — including the refund
 * the void-invoice refusal below tells them to make — must correct the
 * payment on the invoice themselves (`correctPayment`), because reversing
 * money automatically is a strictly larger claim than recording it: an
 * auto-reversal that fires wrongly takes money off an invoice the client
 * really did pay, and there is no equivalent of the payment-intent unique
 * index to make it safe to retry. Stated here rather than left as a gap a
 * reader has to notice.
 */

/**
 * The two events that mean "this Checkout Session has been paid".
 *
 * `completed` fires when the customer finishes the flow — which for an
 * asynchronous method (ACH debit, and anything else a pilot may have
 * enabled on their own connected account) is BEFORE the money moves, with
 * payment_status still 'unpaid'. `async_payment_succeeded` is the one that
 * follows when it settles. Subscribing to both and gating on
 * payment_status is the documented shape; subscribing to `completed`
 * alone would record ACH payments that can still fail.
 */
export const AUTO_PAYMENT_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
] as const;

/**
 * How far apart a hand-typed payment and a Stripe payment may sit and
 * still be read as "the same money, entered twice".
 *
 * Three days, not zero: a pilot who sees the payment land in their Stripe
 * dashboard on Friday and types it in on Monday dated Friday is the
 * ordinary case, and `paid_on` is a date the pilot chooses, not a
 * timestamp. Three days, not thirty: a client who genuinely pays the same
 * invoice amount twice in a month is a real event that must not be
 * swallowed. Widening this trades a visible missing row (recoverable in
 * one click) for an invisible double credit (found by the client), so it
 * should only ever be widened with that trade stated.
 */
export const MANUAL_MATCH_WINDOW_DAYS = 3;

/**
 * How much SMALLER than the Stripe charge a hand-typed row may be and
 * still be read as "the same money, entered twice".
 *
 * Not zero, and this is the correction to an earlier exact-equality rule
 * that missed the most likely way a pilot hand-records a Stripe payment.
 * The figure a pilot SEES — in their Stripe payout, and in their bank — is
 * the NET: the charge minus Stripe's fee (2.9% + 30¢ on a domestic card,
 * more with currency conversion; 0.8% capped at $5 on ACH). A pilot who
 * types that number in has recorded this payment, and an exact-match test
 * says they have not, so the webhook records the gross on top of it and
 * the client is credited about 1.03x what they paid.
 *
 * 5% + $1.00 covers every published Stripe fee shape with room, and stays
 * far below the smallest realistic "genuinely different payment" (a second
 * payment that lands within 5% of the first, within three days, on the
 * same invoice, entered by hand). A row inside the band is never recorded
 * and never ignored — it raises the review prompt, which is the same trade
 * the window itself makes: a visible missing row over an invisible double
 * credit.
 */
export const MANUAL_MATCH_FEE_BAND_BPS = 500;
export const MANUAL_MATCH_FEE_BAND_FLOOR_CENTS = 100;

/** The smallest hand-typed amount that still looks like `amountCents` net of fees. */
export function manualMatchFloorCents(amountCents: number): number {
  return (
    amountCents -
    Math.ceil((amountCents * MANUAL_MATCH_FEE_BAND_BPS) / 10_000) -
    MANUAL_MATCH_FEE_BAND_FLOOR_CENTS
  );
}

/** A normalised Connect delivery. Built from the Stripe SDK types by the route. */
export type ConnectSessionEvent = {
  eventId: string;
  eventType: string;
  /**
   * Stripe's `event.account` — the connected account the event came from.
   * The ONLY authenticated statement of whose payment this is. Absent on a
   * platform-scope delivery, which this endpoint must never act on.
   */
  eventAccount: string | null;
  /** `event.created`, unix seconds. */
  eventCreated: number;
  livemode: boolean;
  session: {
    id: string;
    paymentStatus: string | null;
    amountTotal: number | null;
    currency: string | null;
    paymentIntentId: string | null;
    /** The plink_... the session came from, for cross-checking only. */
    paymentLinkId: string | null;
    paymentMethodTypes: readonly string[] | null;
    metadata: Readonly<Record<string, string>> | null;
  };
};

/** What the event says happened, once it is well-formed enough to act on. */
export type PaymentClaim = {
  eventId: string;
  connectedAccountId: string;
  sessionId: string;
  paymentIntentId: string;
  paymentLinkId: string | null;
  /** From metadata — UNTRUSTED until resolveAutoPayment has checked it. */
  declaredAccountId: string;
  declaredInvoiceId: string;
  declaredInvoiceNumber: string | null;
  amountCents: number;
  /** ISO date (YYYY-MM-DD), UTC, from the event's own timestamp. */
  paidOn: string;
  method: PaymentMethod | null;
};

export type PaymentMethod = "ach" | "check" | "wire" | "card" | "cash" | "other";

/**
 * The invoice a NON-CLAIM delivery still says it was about.
 *
 * Why this exists at all: a stage-one refusal (a session in the wrong
 * currency, a session with no payment_intent) is a REAL PAYMENT that this
 * product declined to record — the most money-bearing rows the ledger
 * holds — and without this the route had nothing to attribute them to, so
 * account_id stayed null and RLS hid them from the only person who could
 * act. Carried only once the ids are well-formed uuids; still untrusted,
 * and still checked against event.account by the route before it is used.
 */
export type DeclaredScope = { declaredAccountId: string; declaredInvoiceId: string };

export type ReadResult =
  | { kind: "ignored"; detail: string; declared?: DeclaredScope }
  | { kind: "refused"; detail: string; declared?: DeclaredScope }
  | { kind: "claim"; claim: PaymentClaim };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO date in UTC from a unix-seconds timestamp. */
export function isoDateFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** Whole days between two ISO dates, absolute. Both are dates, so this is exact. */
export function daysBetweenIsoDates(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round(ms / 86_400_000));
}

/**
 * What to write in `method`.
 *
 * A Checkout Session's `payment_method_types` is what was OFFERED, not
 * what was USED — so it answers the question only when everything offered
 * MEANS THE SAME THING. It usually does: a connected account with Stripe's
 * Link wallet enabled (the default) offers ['card', 'link'], which is one
 * answer, "card", not an ambiguity. An earlier version of this function
 * counted the array instead of mapping it and so labelled that ordinary
 * account's every payment "Other" — technically not a lie, but 'other' was
 * documented here as the rare fallback and was in fact the common case.
 *
 * When the offered methods genuinely disagree (card AND bank debit), this
 * still returns 'other' rather than guessing 'card': the pilot reconciles
 * this column against their bank, and an ACH debit labelled "Card" is a
 * small lie in the one place a lie costs an afternoon. Reading the real
 * instrument would mean retrieving the PaymentIntent's charge, which is a
 * second Stripe round trip inside a webhook for a label; not worth it, and
 * not worth pretending either.
 */
export function paymentMethodFromSession(
  types: readonly string[] | null | undefined
): PaymentMethod | null {
  if (!types || types.length === 0) return null;
  let only: PaymentMethod | null = null;
  for (const type of types) {
    const meaning = methodForPaymentMethodType(type);
    if (only === null) only = meaning;
    else if (only !== meaning) return "other";
  }
  return only;
}

function methodForPaymentMethodType(type: string): PaymentMethod {
  switch (type) {
    case "card":
    // Link is Stripe's saved-card wallet — a card payment by any reading.
    case "link":
      return "card";
    case "us_bank_account":
    case "acss_debit":
      return "ach";
    default:
      return "other";
  }
}

/**
 * Stage one: is this delivery something to act on, and what does it claim?
 *
 * Every "no" here is recorded against the event, never thrown: an endpoint
 * that 500s on an event it simply does not care about hands Stripe three
 * days of retries and hides the events that do matter.
 */
export function readConnectPaymentEvent(event: ConnectSessionEvent): ReadResult {
  if (!(AUTO_PAYMENT_EVENT_TYPES as readonly string[]).includes(event.eventType)) {
    return { kind: "ignored", detail: `${event.eventType} is not an event this endpoint acts on.` };
  }

  // No event.account means Stripe delivered this on the PLATFORM's own
  // scope, not a connected account's. There is no authenticated tenancy
  // fact in such a delivery, and metadata is not one — so there is nothing
  // this handler could safely do with it.
  if (!event.eventAccount) {
    return {
      kind: "refused",
      detail:
        "Delivery carried no event.account, so it did not come from a connected account. Connect events must be sent to this endpoint from a webhook registered to listen on connected accounts.",
    };
  }

  const session = event.session;

  // The async gate. For a card payment this is already 'paid' on
  // `completed`; for ACH it is 'unpaid' until async_payment_succeeded.
  if (session.paymentStatus !== "paid") {
    return {
      kind: "ignored",
      detail: `Session ${session.id} is not paid yet (payment_status=${
        session.paymentStatus ?? "null"
      }). Waiting for checkout.session.async_payment_succeeded.`,
    };
  }

  const metadata = session.metadata ?? {};
  const declaredInvoiceId = (metadata.invoice_id ?? "").trim();
  const declaredAccountId = (metadata.account_id ?? "").trim();
  const declaredInvoiceNumber = (metadata.invoice_number ?? "").trim() || null;

  // BACKWARD COMPATIBILITY, and the reason old links do not break. Every
  // payment link minted before this feature carried only invoice_number,
  // which is per-tenant and cannot identify an invoice. Such a payment is
  // real and the pilot still has to record it by hand — exactly as before
  // — so this is 'ignored' with a sentence that says which invoice number
  // it was, not an error.
  //
  // IT IS NOT THE ONLY WAY TO GET HERE, and the sentence must not pretend
  // otherwise. This endpoint is registered on the connected-accounts scope,
  // so it receives EVERY Checkout Session on the pilot's own Stripe
  // account — including sales from a business of theirs that has nothing to
  // do with this product. Those carry no invoice metadata either. Claiming
  // "its payment link predates automatic recording" of one of them is a
  // statement this handler cannot support, about somebody's unrelated
  // sale, in a row this product keeps. So the sentence covers both, and
  // says which it is when it can (an invoice number means it was ours).
  if (!declaredInvoiceId || !declaredAccountId) {
    return {
      kind: "ignored",
      detail: declaredInvoiceNumber
        ? `Session ${session.id} names invoice ${declaredInvoiceNumber} but carries no invoice metadata — its payment link predates automatic recording, so this payment must be recorded by hand.`
        : `Session ${session.id} carries no invoice metadata — either a payment link minted before automatic recording, or a checkout on this Stripe account that has nothing to do with this product. Nothing was recorded either way.`,
    };
  }

  // Malformed ids are refused HERE rather than handed to Postgres, where a
  // non-uuid becomes a 22P02 the route would report as a handler failure
  // and Stripe would retry for three days.
  if (!UUID_RE.test(declaredInvoiceId) || !UUID_RE.test(declaredAccountId)) {
    return {
      kind: "refused",
      detail: `Session ${session.id} names an invoice or account that is not a uuid. Metadata on a payment link is written by the connected account and is not trusted.`,
    };
  }

  // From here on the delivery names a well-formed invoice, so every
  // refusal below can be ATTRIBUTED — see DeclaredScope. These are the
  // refusals where real money moved and nothing was written down; a row
  // the tenant cannot see is the same as no row at all.
  const declared: DeclaredScope = { declaredAccountId, declaredInvoiceId };

  if (session.amountTotal === null || session.amountTotal <= 0) {
    return {
      kind: "refused",
      declared,
      detail: `Session ${session.id} reported no positive amount_total, so there is no payment to record.`,
    };
  }

  // The ledger has no currency column — pilot.invoice_payments is cents of
  // USD throughout, and lib/stripe/connect.ts prices every link in USD. A
  // session in anything else cannot be written as cents without inventing
  // a rate, so it is refused and shown, never converted.
  if ((session.currency ?? "usd").toLowerCase() !== "usd") {
    return {
      kind: "refused",
      declared,
      detail: `A client paid this invoice in ${String(
        session.currency
      ).toUpperCase()}, but payments in this product are recorded in USD — so it was not recorded automatically. Check the amount that reached your Stripe balance and record it by hand.`,
    };
  }

  // NO PAYMENT INTENT, NO RECORD. This id is the only thing that makes a
  // retry safe (see invoice_payments_one_row_per_payment_intent): without
  // it a redelivered event would insert a second row for the same money.
  // Refusing is the conservative half of that trade.
  if (!session.paymentIntentId) {
    return {
      kind: "refused",
      declared,
      detail: `A client paid this invoice through its payment link, but Stripe sent no payment_intent with it — so it was not recorded automatically, because without that id a redelivery of the same event would record the money a second time (a duplicate). Check your Stripe balance and record the payment by hand.`,
    };
  }

  return {
    kind: "claim",
    claim: {
      eventId: event.eventId,
      connectedAccountId: event.eventAccount,
      sessionId: session.id,
      paymentIntentId: session.paymentIntentId,
      paymentLinkId: session.paymentLinkId,
      declaredAccountId,
      declaredInvoiceId,
      declaredInvoiceNumber,
      amountCents: session.amountTotal,
      // The event's own time, not "today": a delivery retried three days
      // later must still date the payment when it happened.
      paidOn: isoDateFromUnixSeconds(event.eventCreated),
      method: paymentMethodFromSession(session.paymentMethodTypes),
    },
  };
}

/** The tenant the CONNECTED ACCOUNT resolves to. Never built from metadata. */
export type ResolvedAccount = { id: string; connect_account_id: string | null } | null;

export type ResolvedInvoice = {
  id: string;
  account_id: string;
  status: string;
  stripe_payment_link_id: string | null;
} | null;

/** The invoice's existing payment rows, as pilot.invoice_payments holds them. */
export type LedgerRow = {
  id: string;
  amount_cents: number;
  paid_on: string;
  source: string;
  stripe_payment_intent_id: string | null;
  reverses_payment_id: string | null;
};

export type PaymentInsert = {
  account_id: string;
  invoice_id: string;
  paid_on: string;
  amount_cents: number;
  method: PaymentMethod | null;
  source: "stripe_link";
  stripe_payment_intent_id: string;
};

export type AutoPaymentDecision =
  /**
   * Tenancy or invoice state says do not touch the ledger. `detail` is
   * written to a row the TENANT can read; `logDetail`, when present, is
   * the fuller sentence for the platform's console only — see the
   * existence-oracle note on the invoice checks below.
   */
  | { kind: "refused"; detail: string; logDetail?: string }
  /** This PaymentIntent is already on the ledger. */
  | { kind: "duplicate"; detail: string }
  /** Real money, but it looks already entered by hand. Shown to the pilot. */
  | { kind: "needs_review"; detail: string }
  | {
      kind: "record";
      detail: string;
      insert: PaymentInsert;
      /** The live payment link to retire, mirroring recordPayment. */
      retireLinkId: string | null;
    };

/**
 * Stage two: what to do, given what the database holds.
 *
 * THE TENANCY ARGUMENT, in order, because the order is the security
 * property. `account` was looked up by the connected account id Stripe
 * signed; everything else in the claim came from metadata, which the owner
 * of that connected Stripe account types themselves. So:
 *
 *   1. the connected account must resolve to a tenant here at all;
 *   2. metadata's account_id must be that tenant — a link whose metadata
 *      names someone else is a forgery attempt, not a routing mistake;
 *   3. the invoice named must itself belong to that tenant.
 *
 * (3) is not redundant with (2): metadata is one blob, and an attacker who
 * can type their own account_id can type any invoice id alongside it. Only
 * the invoice ROW's own account_id settles which tenant an invoice is.
 *
 * NO BALANCE IS TAKEN HERE ANY MORE, and its absence is deliberate. This
 * used to receive pilot.invoice_totals.balance_due_cents and use "the
 * balance has already moved by at least this much" as a proxy for "a
 * payment for this money is probably already recorded". It is a proxy that
 * fails in the direction that costs money — an invoice whose balance GREW
 * after its link was priced (a reversed cheque, with the link's Stripe
 * deactivation having failed) sits above the link amount, so the proxy
 * skipped the already-recorded scan with the matching hand-typed row
 * sitting right there in the ledger. The ledger itself answers the
 * question directly; the balance was never more than a hint at it. The
 * post-insert balance still matters, and is read where it is meaningful —
 * after the write, by the route, to catch an overpaid invoice.
 */
export function resolveAutoPayment(input: {
  claim: PaymentClaim;
  account: ResolvedAccount;
  invoice: ResolvedInvoice;
  /** Every payment row already on that invoice. */
  ledger: readonly LedgerRow[];
}): AutoPaymentDecision {
  const { claim, account, invoice, ledger } = input;

  if (!account) {
    return {
      kind: "refused",
      detail: `No tenant is linked to connected account ${claim.connectedAccountId}. The account may have been disconnected, or this delivery was meant for another platform.`,
    };
  }

  if (claim.declaredAccountId !== account.id) {
    return {
      kind: "refused",
      detail: `Payment link metadata named account ${claim.declaredAccountId}, but Stripe delivered this from connected account ${claim.connectedAccountId}, which belongs to a different tenant. Refused.`,
    };
  }

  // ONE SENTENCE FOR BOTH "there is no such invoice" AND "that invoice is
  // someone else's", in the row this tenant can read.
  //
  // The distinction is real and worth logging, but it is an EXISTENCE
  // ORACLE if it is written where the person who forged the metadata can
  // read it: this row is attributed to their own account, and their own
  // stripe_connect_events rows are readable to them by policy. A pilot
  // holding another tenant's invoice uuid (a pasted screenshot, a
  // forwarded share link) could otherwise mint a link naming it, pay
  // themselves fifty cents, and read back whether that uuid is a live
  // invoice on this platform. Nothing else leaks, and uuids are not
  // guessable at scale, which is why this is a small hole and not a large
  // one — but it is a deliberate cross-tenant signal, so it goes in the
  // platform's log (logDetail) and not in the tenant's row.
  if (!invoice || invoice.account_id !== account.id) {
    return {
      kind: "refused",
      detail: `A payment arrived through a link whose metadata named an invoice that is not one of yours, so nothing was recorded. If you did not expect this, check the payment in your Stripe dashboard.`,
      logDetail: invoice
        ? `Payment link metadata named invoice ${claim.declaredInvoiceId}, which belongs to a different tenant than connected account ${claim.connectedAccountId}. Refused.`
        : `Payment link metadata named invoice ${claim.declaredInvoiceId}, which does not exist.`,
    };
  }

  // REPLAY. Checked before anything about status or balance, because a
  // redelivery of an event that already worked must be a no-op even on an
  // invoice that has since moved on.
  if (ledger.some((row) => row.stripe_payment_intent_id === claim.paymentIntentId)) {
    return {
      kind: "duplicate",
      detail: `Payment ${claim.paymentIntentId} is already recorded on this invoice.`,
    };
  }

  // A cross-check, not a gate. The stored link id is cleared whenever a
  // link is retired or regenerated (recordPayment, correctPayment,
  // disconnect), so a mismatch is usually just "that link has since been
  // replaced" — worth saying in the record, never worth refusing money
  // over. Metadata is the durable key; this is corroboration.
  const linkNote =
    claim.paymentLinkId && invoice.stripe_payment_link_id &&
    claim.paymentLinkId !== invoice.stripe_payment_link_id
      ? ` (paid via ${claim.paymentLinkId}, which is no longer the link stored on this invoice)`
      : "";

  // THE DATABASE IS NOT THE BACKSTOP HERE. invoice_payments_validate
  // early-returns for service_role, so this check is the only thing
  // standing between a stale link and a payment recorded against a voided
  // invoice. 20260809040000's own header warns that the platform cannot
  // always revoke a link (a disconnect that failed leaves it live on the
  // pilot's account), so a stale link IS payable and this case IS reachable.
  //
  // THE SENTENCE BELOW IS ADDRESSED TO THE PILOT AND THE PILOT MUST BE ABLE
  // TO READ IT. It was not always so: 'refused' rows went to the events
  // ledger and the platform's console only, while the invoice screen
  // queried 'needs_review' alone — so "the client paid $X, refund them"
  // was written for a reader who did not exist, and a client's real money
  // sat unrefunded until they complained. app/(app)/invoices/[id]/page.tsx
  // now reads both outcomes for rows tied to one of this tenant's
  // invoices. If that query is ever narrowed again, this sentence has to
  // be rewritten to whoever is actually left reading it.
  if (invoice.status === "void" || invoice.status === "draft") {
    return {
      kind: "refused",
      detail: `Invoice ${claim.declaredInvoiceNumber ?? invoice.id} is ${invoice.status}, so a payment cannot be recorded against it. The client paid ${formatCentsPlain(
        claim.amountCents
      )} through a link that should have been deactivated — check Stripe and refund them.`,
    };
  }

  // ALREADY SETTLED. The pilot got there first (they saw it in their Stripe
  // dashboard and typed it in), or the client has genuinely paid twice.
  // Either way there is nothing to credit and this must not guess which:
  // recording would leave an invoice reading paid with a negative balance,
  // and staying silent would hide a double payment. So: no row, and a
  // prompt the pilot sees on the invoice.
  if (invoice.status === "paid") {
    return {
      kind: "needs_review",
      detail: `Stripe took ${formatCentsPlain(claim.amountCents)} for this invoice${linkNote}, but it was already fully paid. If you recorded this payment by hand there is nothing to do; if the client paid twice, refund them in Stripe.`,
    };
  }

  // ALREADY RECORDED BY HAND. A payment for this money is probably already
  // on the ledger under a different name — the pilot recorded the card
  // payment as a cheque, say, or typed in the net figure their bank showed
  // them. Only a row that MATCHES (manual, still standing, dated within the
  // window, and for this amount or this amount net of a plausible Stripe
  // fee) is treated as that payment; anything else and the money is
  // credited, because a client who really did pay twice must not be
  // quietly ignored.
  //
  // RUN UNCONDITIONALLY, not only when the balance has already moved by at
  // least this much. The balance was a proxy for "a payment already landed"
  // and it is the wrong proxy: an invoice whose balance GREW after the link
  // was priced (a reversed cheque) sits above the link amount with the
  // hand-typed row plainly there in the ledger, and the proxy skipped the
  // check exactly then. The predicate below is narrow enough to stand on
  // its own — and if there is a matching manual row, the balance question
  // was never the interesting one.
  {
    const reversed = new Set(
      ledger.map((row) => row.reverses_payment_id).filter((id): id is string => Boolean(id))
    );
    const floor = manualMatchFloorCents(claim.amountCents);
    const match = ledger.find(
      (row) =>
        row.reverses_payment_id === null &&
        row.source === "manual" &&
        row.amount_cents > 0 &&
        // At most the gross (nobody hand-records MORE than was charged)
        // and at least the gross net of a plausible fee.
        row.amount_cents <= claim.amountCents &&
        row.amount_cents >= floor &&
        !reversed.has(row.id) &&
        daysBetweenIsoDates(row.paid_on, claim.paidOn) <= MANUAL_MATCH_WINDOW_DAYS
    );
    if (match) {
      const sameAmount = match.amount_cents === claim.amountCents;
      return {
        kind: "needs_review",
        detail: `Stripe took ${formatCentsPlain(
          claim.amountCents
        )} for this invoice${linkNote}, and a payment of ${formatCentsPlain(
          match.amount_cents
        )} dated ${match.paid_on} is already recorded by hand${
          sameAmount ? "" : " — close enough, after Stripe's fee, to look like the same money"
        }. It was not recorded twice. If those are two different payments, record the second one yourself.`,
      };
    }
  }

  return {
    kind: "record",
    detail: `Recorded ${formatCentsPlain(claim.amountCents)} paid through this invoice's payment link${linkNote}.`,
    insert: {
      account_id: account.id,
      invoice_id: invoice.id,
      paid_on: claim.paidOn,
      amount_cents: claim.amountCents,
      method: claim.method,
      source: "stripe_link",
      stripe_payment_intent_id: claim.paymentIntentId,
    },
    // Mirrors recordPayment: any payment landing makes a link priced
    // against the old balance wrong, so the link goes.
    retireLinkId: invoice.stripe_payment_link_id,
  };
}

/**
 * The status the invoice should hold after a payment lands — the exact
 * rule recordPayment applies (app/(app)/invoices/actions.ts), extracted so
 * both paths cannot drift. Null means "leave it alone": 'draft' has
 * nothing issued, 'paid' has nowhere to go, and 'void' is dead.
 *
 * Read from pilot.invoice_totals AFTER the insert, never projected: the
 * totals view is the one source for a balance, and a concurrent
 * correction between the insert and this read must win.
 */
export function nextInvoiceStatus(
  status: string,
  balanceDueCents: number | null
): "paid" | "partial" | null {
  if (status !== "sent" && status !== "partial") return null;
  if (balanceDueCents === null) return null;
  return balanceDueCents <= 0 ? "paid" : "partial";
}

/**
 * Dollars for a log line and for the sentence a pilot reads on the invoice
 * screen. Not lib/format.ts's formatCents — that is a client-facing module
 * this deliberately-dependency-free file does not import; the shapes agree
 * ("$1,234.56").
 *
 * Exported because the route writes pilot-facing sentences too (the
 * overpaid notice, which can only be computed after the insert) and two
 * copies of a money formatter is exactly how "$4500.5" ends up on one
 * screen and "$4,500.50" on another.
 */
export function formatCentsPlain(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}
