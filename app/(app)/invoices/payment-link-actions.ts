"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import {
  createPaymentLinkForInvoice,
  deactivatePaymentLink,
  isStripeRequestRejection,
  readAchCapability,
  LINK_STILL_LIVE_WARNING,
} from "@/lib/stripe/connect";
import {
  BANK_METHOD,
  BANK_PAYMENT_REJECTED_NOTE,
  CARD_METHOD,
  isPaymentMethodChoice,
  resolveOfferedMethods,
  type AchCapability,
  type PaymentMethodChoice,
} from "@/lib/stripe/payment-methods";
import { loadPreferences } from "@/lib/preferences";
import { friendlyDbError } from "@/lib/db-errors";

/**
 * "Pay online" for an invoice — the payment-link half of Stripe Connect
 * (docs/PLAN.md decision #8).
 *
 * THE PAYMENT IS NO LONGER RECORDED BY HAND. This file used to say that
 * generating the link was the end of the story and the pilot typed the
 * payment in themselves; that is out of date as of
 * supabase/migrations/20260813100000_connect_auto_payments.sql. When a
 * client pays one of these links, Stripe delivers the Checkout Session to
 * app/api/stripe/connect-webhook/route.ts, which records the payment
 * against this invoice and advances its status — the same row, the same
 * table and the same status rule the manual path writes, marked
 * source='stripe_link' so the pilot can see which is which.
 *
 * What that cost, stated plainly rather than left implicit: there are now
 * TWO service_role callers in the product, not one. This file still adds
 * none of them — it runs as the signed-in pilot, through RLS, exactly as
 * before — but the sentence "no new service_role caller is added anywhere"
 * that used to sit here was a claim about the whole feature, and the whole
 * feature changed. The argument for the second one is in the migration's
 * header and in lib/supabase/service-role.ts.
 *
 * The one thing this file must keep getting right for that to work is the
 * METADATA on the link (invoice_id + account_id): it is the only durable
 * handle from a Stripe payment back to an invoice. Links minted before it
 * existed simply never auto-record, which is the old behaviour, not a
 * failure.
 *
 * WHAT THE LINK TAKES (2026-08-13). A link now offers card, bank payment
 * (ACH), or both, from the account's stored preference or a per-invoice
 * override posted with the form. Two things about that are worth stating
 * where the code is rather than leaving to be discovered:
 *
 *   - ACH DEGRADES, IT DOES NOT BLOCK. The bank option needs a capability
 *     on the pilot's OWN connected Stripe account that this platform can
 *     read but cannot grant. When it is missing the link is created for
 *     cards alone and the pilot is told why — an invoice that cannot be
 *     paid online at all would be a worse answer to "your Stripe account
 *     isn't set up for ACH" than one that can be paid by card.
 *   - A LINK'S METHODS ARE FIXED WHEN IT IS MINTED. Changing the
 *     preference does not change a link already in a client's inbox, and
 *     nothing in this product edits a live link's methods. Regenerating is
 *     the only way to change what an invoice can be paid with.
 *
 * ONE LIVE LINK PER INVOICE (added after review). "Generate a new link"
 * used to leave the previous one live on Stripe and simply overwrite the
 * stored id — so an invoice regenerated after a partial payment had two
 * working links at two different amounts, and the pilot could only see
 * the newer one. Regenerating now deactivates the old link before
 * creating the replacement, so the stored id is always the ONLY payable
 * link for that invoice.
 */

export type CreateLinkState = {
  error: string | null;
  url?: string;
  /** Set when the new link was created but the old one couldn't be killed. */
  warning?: string;
  /**
   * Set when the link was created WITHOUT the bank (ACH) option the pilot
   * asked for. A separate field from `warning` because the two are separate
   * facts about separate links — an old link that may still be live, and
   * what the new one can actually take — and collapsing them into one
   * string produces a sentence about two different problems.
   */
  methodNotice?: string;
};

export async function createInvoicePaymentLink(
  _prevState: CreateLinkState,
  formData: FormData
): Promise<CreateLinkState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!invoiceId) return { error: "Missing invoice." };

  const { account } = await requireAccount("/invoices");
  // Bound to a const, not read off `account` at each use: the Stripe calls
  // below happen inside a closure, and TypeScript widens a narrowed
  // PROPERTY back to `string | null` the moment one is involved.
  const connectAccountId = account.connect_account_id;
  if (!connectAccountId) {
    return { error: "Connect Stripe from Settings before generating a payment link." };
  }

  const supabase = await createClient();

  // RLS scopes this to the caller's own tenant; a nonexistent or
  // another-tenant's id both come back as no row, same as invoices/[id]/page.tsx.
  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_number, status, stripe_payment_link_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) return { error: friendlyDbError(invoiceError, "invoices.select") };
  const invoice = invoiceData as {
    id: string;
    invoice_number: string | null;
    status: string;
    stripe_payment_link_id: string | null;
  } | null;
  if (!invoice) return { error: "Invoice not found." };

  // Matches invoice_payments_validate and the new
  // invoices_payment_link_requires_sendable_status CHECK: only a sent or
  // partially-paid invoice is payable. A draft has nothing billed yet; a
  // paid/void invoice has nothing left to collect (or ever will).
  if (invoice.status !== "sent" && invoice.status !== "partial") {
    return { error: "Only a sent invoice can be paid online." };
  }
  const invoiceNumber = invoice.invoice_number;
  if (!invoiceNumber) {
    return { error: "This invoice has no invoice number yet." };
  }

  const { data: totalsData, error: totalsError } = await supabase
    .from("invoice_totals")
    .select("balance_due_cents")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (totalsError) return { error: friendlyDbError(totalsError, "invoice_totals.select") };
  const balanceDueCents = (totalsData as { balance_due_cents: number } | null)?.balance_due_cents ?? 0;
  if (balanceDueCents <= 0) {
    return { error: "This invoice has no balance due." };
  }

  // Kill the previous link BEFORE minting its replacement. Order matters:
  // if the create then fails, the invoice is left with no payable link
  // (recoverable — the pilot presses the button again) rather than two,
  // which is the state nobody can see or reason about.
  let warning: string | undefined;
  if (invoice.stripe_payment_link_id) {
    try {
      await deactivatePaymentLink({
        connectAccountId,
        paymentLinkId: invoice.stripe_payment_link_id,
      });
    } catch (err) {
      console.error(
        `deactivatePaymentLink failed for invoice ${invoiceId}: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
      warning = LINK_STILL_LIVE_WARNING;
    }
  }

  /**
   * WHAT THIS LINK OFFERS: the invoice screen's choice if it made one,
   * otherwise the account default.
   *
   * The posted value is validated, not trusted — this is a form field, and
   * an unrecognised string must not reach a Stripe call. It falls through
   * to the account default rather than erroring, because the only way to
   * post a bad value is a stale or tampered form and neither is worth
   * blocking a payment link over.
   */
  const posted = formData.get("methods");
  const choice: PaymentMethodChoice = isPaymentMethodChoice(posted)
    ? posted
    : (await loadPreferences(account.id)).payments.methods;

  /**
   * THE CAPABILITY READ, and why it is skipped when it cannot matter.
   * `us_bank_account_ach_payments` must be active on the PILOT'S connected
   * account for a link to offer ACH at all; asking Stripe costs a round
   * trip, so a card-only choice does not ask. 'inactive' is passed in that
   * case as the honest "we did not establish it" — resolveOfferedMethods
   * ignores the capability entirely when no bank method was requested, so
   * this can never produce a sentence about ACH the pilot did not ask for.
   */
  const capability: AchCapability =
    choice === "card" ? "inactive" : await readAchCapability(connectAccountId);
  const offered = resolveOfferedMethods({ choice, capability });
  let methodNotice = offered.note ?? undefined;

  const createWith = (paymentMethodTypes: readonly string[]) =>
    createPaymentLinkForInvoice({
      connectAccountId,
      // Both row ids ride along as link metadata — see that function's
      // header. `account.id` comes from requireAccount, never from the
      // form, so a forged invoice_id cannot drag a link onto another
      // tenant's account even before the webhook re-checks it.
      accountId: account.id,
      invoiceId: invoice.id,
      invoiceNumber,
      amountCents: balanceDueCents,
      paymentMethodTypes,
    });

  let link;
  try {
    link = await createWith(offered.types);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`createPaymentLinkForInvoice failed for invoice ${invoiceId}: ${message}`);

    // THE BANK METHOD IS DROPPED, NEVER THE LINK — but only when Stripe
    // REFUSED the request (a 400-class invalid_request_error, so nothing
    // was created). A timeout or a 5xx may have minted the link before the
    // response was lost, and retrying that would leave the invoice with two
    // live links at the same price. See isStripeRequestRejection.
    const canDropBank = offered.types.includes(BANK_METHOD) && isStripeRequestRejection(err);
    if (!canDropBank) {
      return { error: "Couldn't create a Stripe payment link. Try again.", warning };
    }
    try {
      link = await createWith([CARD_METHOD]);
      methodNotice = BANK_PAYMENT_REJECTED_NOTE;
    } catch (retryErr) {
      console.error(
        `card-only retry also failed for invoice ${invoiceId}: ${
          retryErr instanceof Error ? retryErr.message : "unknown error"
        }`
      );
      return { error: "Couldn't create a Stripe payment link. Try again.", warning };
    }
  }

  // THE LINK ALREADY EXISTS ON STRIPE BY THIS POINT. That is what makes
  // this particular write the one that must not fail quietly: if the row
  // does not record the id, the product can never retire the link when the
  // invoice is paid nor deactivate it when the invoice is voided, and a
  // client can pay a link this software cannot see. A trigger regression
  // made exactly that happen — see
  // supabase/migrations/20260810130000_restore_payment_link_amount_guard.sql.
  //
  // So: count the rows. PostgREST answers 200 for a write that matched
  // none, and the account_id filter means a forged invoice id matches
  // nothing rather than relying on RLS alone to silently drop it.
  const { error: updateError, count } = await supabase
    .from("invoices")
    .update(
      {
        stripe_payment_link_id: link.id,
        stripe_payment_link_url: link.url,
        stripe_payment_link_livemode: link.livemode,
        // What the link is priced at, so the invoice screen can say so and
        // can spot a link that no longer matches the balance due.
        stripe_payment_link_amount_cents: balanceDueCents,
      } as never,
      { count: "exact" }
    )
    .eq("id", invoiceId)
    .eq("account_id", account.id);
  if (updateError) return { error: friendlyDbError(updateError, "invoices.update(payment_link)") };
  if (count === 0) {
    // The link is live on Stripe and unrecorded here. Say so, with the id,
    // because the pilot's own Stripe Dashboard is now the only place it
    // can be deactivated.
    console.error(
      `payment link ${link.id} created on Stripe but NOT recorded on invoice ${invoiceId}, zero rows updated`
    );
    return {
      error: `A payment link was created but couldn't be saved against this invoice. Deactivate ${link.id} in your Stripe Dashboard before generating another one.`,
      warning,
      methodNotice,
    };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null, url: link.url, warning, methodNotice };
}

export type ReviewNoticeState = { error: string | null };

/**
 * "I've checked it" — dismisses one pilot.stripe_connect_events row the
 * invoice screen is showing ('needs_review' or 'refused').
 *
 * WHAT SUCH A ROW MEANS, and why dismissing it is the only action offered.
 * The webhook received a real, signed, paid Stripe session for this
 * invoice and DECLINED to record it. Either the money looks as though it
 * was already entered by hand (the invoice was already settled, or a
 * matching hand-typed row sits within the race window) — the handler will
 * not guess between "the pilot typed this same payment in on Friday" and
 * "the client paid twice", because one of those answers double-credits a
 * client and only the pilot can tell them apart. Or the invoice could not
 * take the payment at all: a link that outlived a void, a session in
 * another currency. Either way the row sits on the invoice screen saying
 * what happened, and this action clears it once they have looked.
 *
 * Deliberately not filtered by outcome here. The button is only rendered
 * next to a row the screen chose to show, the update is scoped by primary
 * key and account_id, and it writes one nullable timestamp — so widening
 * which outcomes the screen surfaces must not require a second edit in
 * this file, where forgetting it would leave a prompt that cannot be
 * dismissed.
 *
 * It writes ONE nullable timestamp and nothing else: `reviewed_at` is the
 * only column `authenticated` may update on that table (20260813100000),
 * so this cannot restate what Stripe sent, cannot move money, and cannot
 * touch another tenant's row — RLS scopes the update and the account_id
 * filter below makes a zero-row match visible rather than silent.
 */
export async function markConnectNoticeReviewed(
  _prevState: ReviewNoticeState,
  formData: FormData
): Promise<ReviewNoticeState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const eventId = String(formData.get("event_id") ?? "");
  const connectedAccountId = String(formData.get("connected_account_id") ?? "");
  if (!invoiceId || !eventId || !connectedAccountId) return { error: "Missing notice." };

  const { account } = await requireAccount(`/invoices/${invoiceId}`);
  const supabase = await createClient();

  // count:"exact" for the house reason: PostgREST answers 200 for an
  // UPDATE that matched nothing, and a notice that silently refuses to
  // dismiss is worse than one that says it couldn't.
  const { error, count } = await supabase
    .from("stripe_connect_events")
    .update({ reviewed_at: new Date().toISOString() } as never, { count: "exact" })
    .eq("id", eventId)
    .eq("connected_account_id", connectedAccountId)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "stripe_connect_events.update(reviewed_at)") };
  if (count === 0) return { error: "That notice is no longer on this invoice." };

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}
