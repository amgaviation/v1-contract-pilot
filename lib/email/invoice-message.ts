import { formatCents, formatDate } from "@/lib/format";

/**
 * The words a pilot's client actually receives.
 *
 * Deliberately a pure function with no imports beyond formatting, so the
 * copy is unit-testable without a database, a mail service, or a session —
 * tests/invoice-message.test.mjs pins the parts that must not regress.
 *
 * WHOSE VOICE THIS IS. The message goes out under the pilot's business name
 * and is about the pilot's own commercial relationship. AMG is not a party to
 * it (docs/PLAN.md: "Tony is a software vendor here, nothing more"), so this
 * product never signs, brands, or footnotes the message — no "sent via V1",
 * no attribution line, nothing that would put a third party into a bill
 * between two other businesses. The only name in the mail is the pilot's.
 *
 * TERMINOLOGY. The recipient is an aircraft owner, operator or management
 * company, not a consumer. "Invoice", "due", "trip" — no invented friendliness,
 * no exclamation marks, and never advice about how they should pay their
 * taxes or classify the pilot.
 */

export type InvoiceMessageInput = {
  accountName: string;
  clientName: string;
  contactName: string | null;
  invoiceNumber: string | null;
  dueOn: string | null;
  totalCents: number;
  balanceDueCents: number;
  /**
   * The Stripe Connect payment link, ALREADY mode-checked by the caller. A
   * test-mode link in a real client's inbox is a dead end they cannot pay
   * through, so app/(app)/invoices/actions.ts gates this on the same
   * `livemode === isLiveMode()` condition the invoice screen uses before it
   * ever reaches here.
   */
  paymentUrl: string | null;
  /** Free-text the pilot added to the invoice; passed through untouched. */
  notes: string | null;
};

export type InvoiceMessage = { subject: string; text: string };

function reference(invoiceNumber: string | null): string {
  return invoiceNumber ? `Invoice ${invoiceNumber}` : "Invoice";
}

export function buildInvoiceMessage(input: InvoiceMessageInput): InvoiceMessage {
  const ref = reference(input.invoiceNumber);
  const greetingName = input.contactName?.trim() || input.clientName;

  const subject = `${ref} from ${input.accountName}`;

  const lines: string[] = [];
  lines.push(`${greetingName},`);
  lines.push("");
  // The amount named in the body is the BALANCE DUE, not the invoice total.
  // On a partly-paid invoice those differ, and the number a payer needs is
  // what remains. The total still appears on the attached PDF.
  lines.push(
    `${ref} is attached, for ${formatCents(input.balanceDueCents)}${
      input.dueOn ? `, due ${formatDate(input.dueOn)}` : ""
    }.`
  );

  if (input.balanceDueCents !== input.totalCents) {
    // Said explicitly rather than left for the reader to reconcile against
    // the PDF — a client who has already part-paid should not have to work
    // out why the email names a smaller number than the invoice total.
    lines.push("");
    lines.push(
      `That is the remaining balance; the invoice total is ${formatCents(
        input.totalCents
      )} and payments already received are shown on the attached copy.`
    );
  }

  if (input.paymentUrl) {
    lines.push("");
    lines.push("You can pay online here:");
    lines.push(input.paymentUrl);
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

/**
 * The reminder. Same attachment, same payment link, different framing — and
 * the framing is the point: a reminder that reads as an accusation costs a
 * contract pilot the next booking, and the overwhelmingly common reason an
 * invoice goes unpaid at a flight department is that it is sitting in an
 * approvals queue. So this states the fact and asks, and never threatens a
 * late fee this product does not compute or a consequence the pilot has not
 * agreed with their client.
 */
export function buildReminderMessage(
  input: InvoiceMessageInput & { daysOverdue: number }
): InvoiceMessage {
  const ref = reference(input.invoiceNumber);
  const greetingName = input.contactName?.trim() || input.clientName;
  const overdue = input.daysOverdue > 0;

  const subject = overdue
    ? `Reminder: ${ref} from ${input.accountName} — ${formatCents(
        input.balanceDueCents
      )} outstanding`
    : `Reminder: ${ref} from ${input.accountName}`;

  const lines: string[] = [];
  lines.push(`${greetingName},`);
  lines.push("");

  if (overdue) {
    const dayWord = input.daysOverdue === 1 ? "day" : "days";
    lines.push(
      `A quick follow-up on ${ref}, for ${formatCents(
        input.balanceDueCents
      )}, which was due ${
        input.dueOn ? formatDate(input.dueOn) : "earlier"
      } — ${input.daysOverdue} ${dayWord} ago. A copy is attached.`
    );
  } else {
    lines.push(
      `A quick note that ${ref}, for ${formatCents(input.balanceDueCents)}, is due${
        input.dueOn ? ` ${formatDate(input.dueOn)}` : " shortly"
      }. A copy is attached.`
    );
  }

  if (input.paymentUrl) {
    lines.push("");
    lines.push("You can pay online here:");
    lines.push(input.paymentUrl);
  }

  lines.push("");
  lines.push(
    "If it is already in progress on your end, please disregard this. If anything on it needs correcting, let me know and I will send a revised copy."
  );
  lines.push("");
  lines.push("Thank you,");
  lines.push(input.accountName);

  return { subject, text: lines.join("\n") };
}

/**
 * Whole days between a due date and today, floor 0. Dates here are plain
 * `YYYY-MM-DD` calendar dates with no timezone, so both sides are pinned to
 * UTC midnight before subtracting — parsing "2026-08-11" as local time in a
 * negative-offset zone yields the previous day, which would report an invoice
 * as a day more overdue than it is.
 */
export function daysOverdue(dueOn: string | null, today: Date): number {
  if (!dueOn) return 0;
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  if (Number.isNaN(due)) return 0;
  const now = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const diff = Math.floor((now - due) / 86_400_000);
  return diff > 0 ? diff : 0;
}
