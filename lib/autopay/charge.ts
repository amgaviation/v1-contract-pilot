import "server-only";
import { chargeAutopayInvoice } from "@/lib/stripe/connect";
import { isLiveMode } from "@/lib/stripe/server";

/**
 * ISSUE THEN CHARGE — the one implementation, shared by both callers.
 *
 * THE ORDER MATTERS AND IS NOT AN ACCIDENT. The draft→sent transition is
 * what assigns the invoice its number and due date
 * (pilot.invoices_assign_number_on_issue), and the number goes into the
 * charge's own metadata and Stripe description. It also means a client is
 * only ever charged for an ISSUED document — the webhook refuses payments
 * against drafts outright, so charging first would record nothing.
 *
 * WHY THIS IS A SHARED MODULE RATHER THAN A SECOND COPY. It was
 * module-private in app/(app)/invoices/recurring/actions.ts, reachable only
 * from the pilot's own click. The scheduled pass (lib/autopay/run.ts) needs
 * the identical sequence with a service-role client and no session. Copying
 * it would put the product's only off-session card-charging sequence in two
 * places that drift — the same defect class as the HEIC magic-byte check
 * that was duplicated across expenses/ and documents/ and had already
 * diverged by the time anyone looked. One sequence, one place, two callers.
 *
 * IT CANNOT SIMPLY BE EXPORTED FROM ITS OLD HOME: that file is "use server",
 * so every export becomes a publicly reachable server action at a stable id.
 * A function that issues an invoice and charges a saved card must not be an
 * endpoint. Here it is an ordinary module-private-by-convention import,
 * reachable only from code that already established the right to call it.
 *
 * NEVER THROWS. Both callers treat a failure as "this invoice did not get
 * charged" and carry on — the interactive one shows the sentence, the
 * scheduled one records it and moves to the next account. An exception
 * escaping here would abort a whole pass over one client's expired card.
 */

export type AutopayChargeOutcome =
  /** Issued and the card was charged. Stripe confirms the payment by webhook. */
  | { kind: "charged"; message: string; invoiceNumber: string; amountCents: number }
  /**
   * Issued, but the charge itself failed (declined, expired card, Stripe
   * error). The invoice is REAL and outstanding — this is not a no-op, and
   * the caller must not retry the generation.
   */
  | { kind: "issued_not_charged"; message: string; invoiceNumber: string | null; reason: string }
  /**
   * Nothing was issued and nothing was charged. The invoice is still the
   * draft the caller just generated, safe to send by hand.
   */
  | { kind: "not_issued"; message: string; reason: string };

type SupabaseLike = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns: string) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (values: never, options?: { count: "exact" }) => any;
  };
};

export async function issueAndChargeAutopayInvoice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseLike | any,
  account: { id: string; connectAccountId: string | null },
  clientId: string,
  invoiceId: string
): Promise<AutopayChargeOutcome> {
  if (!account.connectAccountId) {
    return {
      kind: "not_issued",
      reason: "stripe_not_connected",
      message:
        "Autopay is on for this schedule, but Stripe isn't connected, so the invoice was created as a draft to send yourself.",
    };
  }

  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select(
      "autopay_stripe_customer_id, autopay_stripe_payment_method_id, autopay_method_label, autopay_livemode"
    )
    .eq("id", clientId)
    .eq("account_id", account.id)
    .maybeSingle();
  if (clientError || !clientData) {
    return {
      kind: "not_issued",
      reason: "client_unreadable",
      message:
        "Autopay is on for this schedule, but the client's autopay details couldn't be read, so the invoice was created as a draft to send yourself.",
    };
  }
  const enrolled = clientData as {
    autopay_stripe_customer_id: string | null;
    autopay_stripe_payment_method_id: string | null;
    autopay_method_label: string | null;
    autopay_livemode: boolean | null;
  };
  if (!enrolled.autopay_stripe_customer_id || !enrolled.autopay_stripe_payment_method_id) {
    return {
      kind: "not_issued",
      reason: "no_saved_card",
      message:
        "Autopay is on for this schedule, but the client hasn't saved a card yet — send them your vendor page link to set it up. The invoice was created as a draft to send yourself.",
    };
  }
  if (enrolled.autopay_livemode !== isLiveMode()) {
    // A card saved under the other Stripe mode. Refused here rather than
    // erroring at Stripe with a message nobody could act on.
    //
    // This is also the check pilot.generate_autopay_invoice deliberately
    // does NOT make (see 20260819100000): only this layer knows which mode
    // the process is running against.
    return {
      kind: "not_issued",
      reason: "livemode_mismatch",
      message:
        "Autopay is on, but the client's card was saved under a different Stripe mode (test vs live). Ask them to set autopay up again from your vendor page. The invoice was created as a draft to send yourself.",
    };
  }

  // ISSUE. Same transition the invoice screen's own send performs; the
  // status trigger assigns the number and due date.
  const { error: sendError, count: sendCount } = await supabase
    .from("invoices")
    .update({ status: "sent" } as never, { count: "exact" })
    .eq("id", invoiceId)
    .eq("account_id", account.id);
  if (sendError || sendCount === 0) {
    return {
      kind: "not_issued",
      reason: sendError ? "issue_failed" : "issue_matched_no_rows",
      message:
        "Autopay is on, but the invoice couldn't be issued, so nothing was charged. It was created as a draft to send yourself.",
    };
  }

  const [{ data: invoiceRow }, { data: totalsRow }] = await Promise.all([
    supabase
      .from("invoices")
      .select("invoice_number")
      .eq("id", invoiceId)
      .eq("account_id", account.id)
      .maybeSingle(),
    supabase.from("invoice_totals").select("total_cents").eq("invoice_id", invoiceId).maybeSingle(),
  ]);
  const invoiceNumber = (invoiceRow as { invoice_number: string | null } | null)?.invoice_number ?? null;
  const totalCents = (totalsRow as { total_cents: number } | null)?.total_cents ?? null;
  if (!invoiceNumber || totalCents === null || totalCents <= 0) {
    // The invoice IS issued at this point — the transition above succeeded.
    // Reported as issued-not-charged rather than not-issued so the caller
    // never treats it as a draft it can quietly retry.
    return {
      kind: "issued_not_charged",
      invoiceNumber,
      reason: "total_unreadable",
      message:
        "Autopay is on and the invoice was issued, but its total couldn't be read, so nothing was charged. Send it with a payment link instead.",
    };
  }

  const charge = await chargeAutopayInvoice({
    connectAccountId: account.connectAccountId,
    accountId: account.id,
    invoiceId,
    invoiceNumber,
    amountCents: totalCents,
    customerId: enrolled.autopay_stripe_customer_id,
    paymentMethodId: enrolled.autopay_stripe_payment_method_id,
  });
  if (!charge.ok) {
    return {
      kind: "issued_not_charged",
      invoiceNumber,
      reason: charge.reason,
      message: `Invoice ${invoiceNumber} was issued, but the autopay charge failed: ${charge.reason}`,
    };
  }

  const label = enrolled.autopay_method_label ?? "the client's saved card";
  return {
    kind: "charged",
    invoiceNumber,
    amountCents: totalCents,
    message: `Invoice ${invoiceNumber} was issued and ${label} was charged ${(totalCents / 100).toLocaleString(
      "en-US",
      { style: "currency", currency: "USD" }
    )}. The payment is recorded automatically when Stripe confirms it.`,
  };
}
