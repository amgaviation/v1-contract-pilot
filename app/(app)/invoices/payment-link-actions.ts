"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import {
  createPaymentLinkForInvoice,
  deactivatePaymentLink,
  LINK_STILL_LIVE_WARNING,
} from "@/lib/stripe/connect";
import { friendlyDbError } from "@/lib/db-errors";

/**
 * "Pay online" for an invoice — the payment-link half of Stripe Connect
 * (docs/PLAN.md decision #8). See payment-panel.tsx's header comment and
 * supabase/migrations/20260809040000_connect_payments.sql's header for
 * why this stops at generating a link rather than auto-recording a
 * payment: no new service_role caller is added anywhere in this file.
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
};

export async function createInvoicePaymentLink(
  _prevState: CreateLinkState,
  formData: FormData
): Promise<CreateLinkState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!invoiceId) return { error: "Missing invoice." };

  const { account } = await requireAccount("/invoices");
  if (!account.connect_account_id) {
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
  if (!invoice.invoice_number) {
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
        connectAccountId: account.connect_account_id,
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

  let link;
  try {
    link = await createPaymentLinkForInvoice({
      connectAccountId: account.connect_account_id,
      invoiceNumber: invoice.invoice_number,
      amountCents: balanceDueCents,
    });
  } catch (err) {
    console.error(
      `createPaymentLinkForInvoice failed for invoice ${invoiceId}: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
    return { error: "Couldn't create a Stripe payment link. Try again.", warning };
  }

  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      stripe_payment_link_id: link.id,
      stripe_payment_link_url: link.url,
      stripe_payment_link_livemode: link.livemode,
      // What the link is priced at, so the invoice screen can say so and
      // can spot a link that no longer matches the balance due.
      stripe_payment_link_amount_cents: balanceDueCents,
    } as never)
    .eq("id", invoiceId);
  if (updateError) return { error: friendlyDbError(updateError, "invoices.update(payment_link)") };

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null, url: link.url, warning };
}
