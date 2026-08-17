import { formatCents, formatDate } from "@/lib/format";

/**
 * The receipt a pilot's CLIENT receives when their payment lands — sent by
 * the Connect webhook the moment an online payment (payment link or
 * autopay) is recorded on the ledger.
 *
 * SAME VOICE RULES AS lib/email/invoice-message.ts, stated again because
 * this mail is triggered by a Stripe event rather than a pilot's click and
 * the temptation to brand it is therefore larger: the message goes out
 * under the pilot's business name, about the pilot's own commercial
 * relationship. No "sent via V1", no attribution, no third party's name in
 * a receipt between two other businesses. Plain text, like every
 * client-facing mail this product sends.
 *
 * MANUAL PAYMENTS DELIBERATELY GET NO RECEIPT. A hand-recorded payment is
 * the pilot writing down something that already happened between the two
 * of them — a check, a wire, cash — possibly days later and possibly
 * corrected twice. Mailing the client about it would announce the pilot's
 * bookkeeping. Only the two online sources ('stripe_link',
 * 'stripe_autopay'), where the client themselves just acted, are receipted.
 *
 * PURE ON PURPOSE — no I/O, no environment, no server-only import — so
 * tests/payment-receipt.test.mjs pins the copy directly.
 */

export type ClientReceiptInput = {
  /** The pilot's business name — the only name allowed in this mail. */
  accountName: string;
  /** The client's company name (or typed bill-to name). */
  clientName: string;
  /** The named contact, when there is one; greets them instead. */
  contactName: string | null;
  invoiceNumber: string | null;
  /** What was just paid, in cents. */
  amountCents: number;
  /** ISO date (YYYY-MM-DD) the payment was recorded. */
  paidOnIso: string;
  /**
   * The balance still due AFTER this payment, or null when it could not be
   * read — in which case the receipt states the payment and says nothing
   * about the balance, rather than guessing at one.
   */
  balanceDueCents: number | null;
};

export type ClientReceipt = { subject: string; text: string };

export function buildClientReceipt(input: ClientReceiptInput): ClientReceipt {
  const ref = input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : "your invoice";
  const refTitle = input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : "Invoice";
  const greetingName = input.contactName?.trim() || input.clientName;
  const amount = formatCents(input.amountCents);

  const subject = `Payment received — ${refTitle} — ${input.accountName}`;

  const lines: string[] = [];
  lines.push(`${greetingName},`);
  lines.push("");
  lines.push(
    `Payment of ${amount} was received on ${ref} on ${formatDate(input.paidOnIso)}.`
  );

  if (input.balanceDueCents !== null) {
    lines.push("");
    if (input.balanceDueCents <= 0) {
      lines.push(`The invoice is paid in full. Nothing further is due.`);
    } else {
      lines.push(`The remaining balance is ${formatCents(input.balanceDueCents)}.`);
    }
  }

  lines.push("");
  lines.push("Thank you,");
  lines.push(input.accountName);

  return { subject, text: lines.join("\n") };
}
