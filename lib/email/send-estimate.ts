import "server-only";
import { buildEstimateDocument } from "@/lib/estimate-document";
import { friendlyDbError } from "@/lib/db-errors";
import { sendEmail, emailIsConfigured, looksLikeEmail } from "./send";
import { buildEstimateMessage } from "./estimate-message";

/**
 * THE SHARED HALF OF EVERY ESTIMATE EMAIL: load the client, render the
 * document, compose the words, hand it to the mail service. Mirrors
 * lib/email/send-invoice.ts's own shape and its reason for living in lib/
 * rather than app/(app)/estimates/actions.ts — that file carries "use
 * server", under which every export is a public HTTP endpoint, so the
 * sender itself lives where it is importable but not directly callable
 * from the browser (`server-only` fails the build on a client import).
 *
 * Deliberately narrower than sendInvoiceEmail: no `kind` parameter (no
 * reminder — see lib/email/estimate-message.ts's header), no receipts, no
 * saved template resolution. Returns rather than throws, for the same
 * reason: a thrown error inside a server action becomes an unhandled 500
 * the pilot learns nothing from.
 */

export type EstimateEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export async function sendEstimateEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  estimateId: string,
  /**
   * WHERE A REPLY GOES — same reasoning as sendInvoiceEmail's own
   * `replyTo` parameter: the pilot's signed-in address, never the
   * platform's, so a client hitting Reply reaches the person who can
   * actually revise the quote.
   */
  replyTo: string | undefined,
  /**
   * The pilot's per-send note, already trimmed and length-checked by the
   * caller. null when nobody wrote one.
   */
  customMessage: string | null = null
): Promise<EstimateEmailResult> {
  if (!emailIsConfigured()) {
    return {
      ok: false,
      error:
        "Emailing isn't set up on this account yet, so nothing was sent. Download the PDF and send it yourself, or set the mail service up in the project's environment first.",
    };
  }

  const { data: estimateRow, error: estimateError } = await supabase
    .from("estimates")
    .select("client_id, notes")
    .eq("id", estimateId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (estimateError) {
    return {
      ok: false,
      error: `${friendlyDbError(estimateError, "estimates.select")} Nothing was sent.`,
    };
  }
  const estimate = estimateRow as { client_id: string; notes: string | null } | null;
  if (!estimate) return { ok: false, error: "That estimate no longer exists." };

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("name, contact_name, contact_email, billing_email")
    .eq("id", estimate.client_id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (clientError) {
    return {
      ok: false,
      error: `${friendlyDbError(clientError, "clients.select")} Nothing was sent.`,
    };
  }
  const client = clientRow as {
    name: string;
    contact_name: string | null;
    contact_email: string | null;
    billing_email: string | null;
  } | null;
  if (!client) {
    return { ok: false, error: "That estimate's client no longer exists." };
  }
  // SAME PREFERENCE sendInvoiceEmail resolves (billing_email,
  // 20260814092000, when it looks like a real address; contact_email
  // otherwise) — read that change first, per this feature's own
  // instructions, so an estimate and an invoice to the same client never
  // disagree about which inbox is "the" address on file.
  const recipientEmail = looksLikeEmail(client.billing_email)
    ? (client.billing_email as string)
    : client.contact_email;
  if (!looksLikeEmail(recipientEmail)) {
    return {
      ok: false,
      error: `${client.name} has no email address on file, so nothing was sent. Add one on the client's page and try again.`,
    };
  }

  const built = await buildEstimateDocument(supabase, accountId, estimateId);
  if (!built.ok) {
    return { ok: false, error: `${built.error} Nothing was sent.` };
  }
  const doc = built.document;

  const message = buildEstimateMessage({
    accountName: doc.accountName,
    clientName: client.name,
    contactName: client.contact_name,
    estimateNumber: doc.estimateNumber,
    validUntil: doc.validUntil,
    totalCents: doc.totalCents,
    notes: estimate.notes,
    customMessage,
  });

  const result = await sendEmail({
    to: recipientEmail as string,
    subject: message.subject,
    text: message.text,
    replyTo: looksLikeEmail(replyTo) ? replyTo : undefined,
    attachments: [{ filename: doc.filename, content: doc.buffer }],
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, messageId: result.id };
}
