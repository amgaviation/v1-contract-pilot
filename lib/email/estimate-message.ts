import { formatCents, formatDate } from "@/lib/format";

/**
 * The words a pilot's client actually receives when an estimate is
 * emailed. Mirrors lib/email/invoice-message.ts's own header in spirit —
 * pure, no imports beyond formatting, unit-testable without a database, a
 * mail service, or a session (tests/estimate-message.test.mjs) — but
 * deliberately NARROWER:
 *
 *   - NO template system. Invoices let a pilot save a standing opening
 *     line (lib/preferences.ts); estimates have no such column and this
 *     first version does not add one. Every estimate email uses the same
 *     built-in wording, with only the per-send note (below) as a pilot's
 *     own words.
 *   - NO reminder machinery. Invoices distinguish buildInvoiceMessage from
 *     buildReminderMessage because a reminder chases money that is owed.
 *     An estimate owes nothing — "sending it again" IS the whole action,
 *     so there is exactly one message shape here.
 *   - NO payment language. An estimate is a price, not a bill (see
 *     pilot.estimates' own migration comment); this body never mentions
 *     "due", "pay", or a remittance instruction.
 *
 * WHOSE VOICE THIS IS — same rule as invoice-message.ts: the message goes
 * out under the pilot's own business name. AMG is not a party to it.
 */

export type EstimateMessageInput = {
  accountName: string;
  clientName: string;
  contactName: string | null;
  estimateNumber: string | null;
  validUntil: string | null;
  totalCents: number;
  /** Free-text the pilot added to the estimate; passed through untouched. */
  notes: string | null;
  /**
   * What the pilot typed in THIS send's dialog, for THIS client, once —
   * same treatment as InvoiceMessageInput.customMessage: passed through
   * verbatim, never templated.
   */
  customMessage?: string | null;
};

export type EstimateMessage = { subject: string; text: string };

function reference(estimateNumber: string | null): string {
  return estimateNumber ? `Estimate ${estimateNumber}` : "Estimate";
}

export function buildEstimateMessage(input: EstimateMessageInput): EstimateMessage {
  const ref = reference(input.estimateNumber);
  const greetingName = input.contactName?.trim() || input.clientName;

  const subject = `${ref} from ${input.accountName}`;

  const lines: string[] = [];
  lines.push(`${greetingName},`);
  lines.push("");
  lines.push(
    `${ref} is attached, for ${formatCents(input.totalCents)}${
      input.validUntil ? `, valid until ${formatDate(input.validUntil)}` : ""
    }. This is a price quote, not a bill. No payment is due.`
  );

  // THE PILOT'S OWN WORDS FOR THIS SEND, same placement rule as
  // buildInvoiceMessage: above the estimate's own notes, below the
  // headline fact the reader opened the mail for.
  if (input.customMessage?.trim()) {
    lines.push("");
    lines.push(input.customMessage.trim());
  }

  if (input.notes?.trim()) {
    lines.push("");
    lines.push(input.notes.trim());
  }

  lines.push("");
  lines.push("Thank you,");
  lines.push(input.accountName);

  return { subject, text: lines.join("\n") };
}
