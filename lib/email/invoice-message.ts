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

/* ===========================================================================
 * REUSABLE MESSAGE TEMPLATES — the pilot's own opening line, with
 * placeholders substituted here, server-side, and nowhere else.
 * ===========================================================================
 *
 * WHAT A TEMPLATE REPLACES, AND WHAT IT CANNOT. A template supplies the
 * OPENING SENTENCE of the body and nothing else. Every other block below —
 * the part-payment reconciliation, the receipt count, the payment link, the
 * invoice's own notes, the sign-off — is a statement of fact about THIS
 * invoice, computed from the row, and a pilot cannot edit those into
 * something the invoice does not say. The greeting and the sign-off stay
 * fixed for the same reason they always were: they carry the pilot's
 * business name, which is the only name allowed in this mail.
 *
 * THE SUBJECT IS NOT TEMPLATABLE, deliberately. A subject is a mail HEADER,
 * and free text in a header is where CRLF injection lives — a stored
 * template containing a newline would let a settings value append headers
 * to every message this account sends. The subject also carries the invoice
 * reference and the pilot's business name, which is exactly what an
 * accounts-payable inbox filters and threads on. Both reasons point the
 * same way, so the subject is built by this module and only by this module.
 *
 * NOTHING IS ESCAPED, AND NOTHING NEEDS TO BE. lib/email/send.ts sends
 * `text` only ("Every mail this product sends is legible without HTML") and
 * no caller sets `html`. There is no markup context for a substituted value
 * to break out of. If an HTML body is ever added, the escaping question
 * arrives with it and must be answered THERE, where the markup is built —
 * not by pre-escaping here, which would put &amp; into the plain-text body
 * a client actually reads today.
 */

/** The facts a template may name. `days_overdue` is reminder-only. */
export type MessagePlaceholderKey =
  | "client_name"
  | "invoice_number"
  | "amount_due"
  | "due_date"
  | "days_overdue";

export type MessagePlaceholder = {
  key: MessagePlaceholderKey;
  /** Exactly what the pilot types, shown verbatim in the settings panel. */
  token: string;
  /**
   * The insert chip's own words — plain language a pilot who has never
   * seen `{{double_braces}}` syntax before still recognises ("Client
   * name", not "client_name"). Kept separate from `description` rather
   * than derived from it: a chip is a two-or-three-word button label, and
   * `description` is a full sentence written to be read once, not to fit
   * on a button.
   */
  label: string;
  /** What it becomes, in the words the settings panel shows. */
  description: string;
};

const PLACEHOLDER = (
  key: MessagePlaceholderKey,
  label: string,
  description: string
): MessagePlaceholder => ({ key, token: `{{${key}}}`, label, description });

/** The four an invoice message may name. */
export const INVOICE_PLACEHOLDERS: readonly MessagePlaceholder[] = [
  PLACEHOLDER(
    "client_name",
    "Client name",
    "The contact you address, or the client's name"
  ),
  PLACEHOLDER(
    "invoice_number",
    "Invoice number",
    "The invoice number, e.g. INV-0042"
  ),
  PLACEHOLDER(
    "amount_due",
    "Amount due",
    "The balance still owed, e.g. $14,000.00"
  ),
  PLACEHOLDER("due_date", "Due date", "The due date, e.g. Sep 10, 2026"),
];

/**
 * The same four plus `days_overdue`. A reminder's whole subject is
 * lateness, and the built-in wording states it ("21 days ago"); without a
 * placeholder for it, saving the default reminder template would silently
 * drop the one fact that message exists to carry.
 */
export const REMINDER_PLACEHOLDERS: readonly MessagePlaceholder[] = [
  ...INVOICE_PLACEHOLDERS,
  PLACEHOLDER("days_overdue", "How overdue", "How overdue it is, e.g. 21 days"),
];

/**
 * A template is stored free text, so it is bounded. 1,000 characters is
 * several paragraphs of opening line, and it keeps the whole
 * pilot.account_preferences blob (16 KB by CHECK, shared with the
 * appearance and layout sections) far short of its limit — an unbounded
 * template would let one over-long paste fail the write for EVERY
 * preference at once.
 */
export const MAX_MESSAGE_TEMPLATE_CHARS = 1000;

/**
 * The per-send message box. Longer than a template because it is prose
 * about one specific send ("Dana — this covers the two KTEB legs on the
 * 4th; the hotel is the one we discussed"), still bounded because it rides
 * a mail body that also has to carry the invoice.
 */
export const MAX_CUSTOM_MESSAGE_CHARS = 2000;

/**
 * ANY double-brace pair, whatever is inside it.
 *
 * The first version of this matched `[a-z_]+` — the shape of a real token —
 * and that was the wrong instinct, caught by a test. `{{Client_Name}}` did
 * not match, so it was not a placeholder, so it was not UNKNOWN either: the
 * settings panel accepted it happily and the pilot's client received the
 * literal characters `{{Client_Name}}` in a bill. Matching only well-formed
 * tokens means every MALFORMED one sails through to the inbox, which is the
 * single worst outcome this feature has.
 *
 * So the pattern is deliberately greedy about what counts as an attempt —
 * `{{anything}}`, `{{ Client_Name }}`, `{{client name}}`, even `{{}}` — and
 * the name is then matched against the known set EXACTLY, case included.
 * Unknown attempts are refused at the settings panel with the offending
 * token named, and refused again at send time by applyTemplate. A pilot who
 * genuinely wants literal double braces in an invoice email is a
 * hypothetical; a pilot who typos a token is a Tuesday.
 *
 * Inner whitespace is trimmed so `{{ client_name }}` works rather than
 * being a puzzling near-miss. `{{{{client_name}}}}` matches only the inner
 * pair (the character class excludes braces), so it renders as the value
 * inside a literal brace pair — never as a second round of substitution.
 */
const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

/**
 * Every placeholder name a template mentions, in order, without repeats.
 * Names are trimmed; an empty `{{}}` reports as the empty string, which is
 * in no allowed set and is therefore refused like any other unknown.
 */
export function templatePlaceholders(template: string): string[] {
  const found: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]!.trim();
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/** The ones this product does not know — what the settings panel rejects on. */
export function unknownPlaceholders(
  template: string,
  allowed: readonly MessagePlaceholder[]
): string[] {
  const keys = allowed.map((placeholder) => placeholder.key as string);
  return templatePlaceholders(template).filter((name) => !keys.includes(name));
}

/**
 * Substitute, or decline to.
 *
 * ONE PASS, AND THE REPLACEMENT IS NEVER RESCANNED. `String.replace` with a
 * FUNCTION walks the ORIGINAL string once and inserts each return value
 * literally: a client named `{{amount_due}}` renders as those characters
 * and cannot expand into the balance, and a value containing `$&` or `$1`
 * is not treated as a capture reference the way a replacement STRING would
 * be. Both are pinned in tests/invoice-message.test.mjs. Never rewrite this
 * as a loop of replaces over the accumulating output — that reintroduces
 * exactly the substitution-of-substituted-text hole this shape closes.
 *
 * RETURNS null RATHER THAN A HOLE. A template is used only when every
 * placeholder it names has a real value on THIS invoice. An invoice with no
 * due date cannot render "due {{due_date}}" as anything honest — "due ." is
 * broken, and inventing "on receipt" would add a payment term the pilot
 * never agreed with their client. So the template is declined and the
 * caller falls back to the built-in wording, which was written to handle
 * the absence (it omits the clause entirely). Same rule for an unknown
 * placeholder, which is also how a stored template survives this product
 * retiring a token: the pilot's words stop being used, and the client still
 * gets a correct, complete message rather than one with a hole in it.
 */
export function applyTemplate(
  template: string,
  values: Partial<Record<MessagePlaceholderKey, string>>,
  allowed: readonly MessagePlaceholder[]
): string | null {
  const keys = allowed.map((placeholder) => placeholder.key as string);
  for (const name of templatePlaceholders(template)) {
    if (!keys.includes(name)) return null;
    if (!values[name as MessagePlaceholderKey]) return null;
  }
  return template.replace(
    PLACEHOLDER_PATTERN,
    (_match, name: string) =>
      values[name.trim() as MessagePlaceholderKey] ?? ""
  );
}

/**
 * The wording the settings panel shows as the starting point, and the
 * wording a pilot gets if they save it untouched.
 *
 * These are TODAY'S COPY, character for character, for an invoice that has
 * both a number and a due date — tests/invoice-message.test.mjs asserts
 * that equality directly against the built-in path, so changing either
 * sentence and forgetting the other fails the suite. That is what makes
 * "the default template is what the product already says" a checked claim
 * rather than a comment.
 *
 * Zero-config behaviour is unchanged by something stronger than a matching
 * default, though: an account that has never opened the panel stores NO
 * template, and the built-in path below runs untouched with every
 * conditional intact.
 */
export const DEFAULT_INVOICE_TEMPLATE =
  "Invoice {{invoice_number}} is attached, for {{amount_due}}, due {{due_date}}.";

export const DEFAULT_REMINDER_TEMPLATE =
  "A quick follow-up on Invoice {{invoice_number}}, for {{amount_due}}, which was due {{due_date}}, {{days_overdue}} ago. A copy is attached.";

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
  /**
   * How many receipts are GENUINELY EMBEDDED as real image pages in the
   * attached PDF (lib/invoice-document.tsx's receiptCount — which counts
   * decoded images only, never the caption/fallback pages for a PDF-format,
   * unsupported, corrupt, or unreachable receipt). This is the ONLY receipt
   * fact the body is allowed to state, and it states exactly this number: an
   * accounts-payable reader deciding whether to chase substantiation learns
   * how many receipt images are already in hand, and nothing is claimed about
   * receipts that are only "available on request". If every receipt degraded
   * to a fallback page this is 0 and the body says nothing about receipts at
   * all. Omitted/0 changes nothing — every pre-existing message renders
   * byte-identically.
   */
  receiptCount?: number;
  /**
   * The ACCOUNT'S saved template for this kind of message, already
   * normalised by lib/preferences.ts (trimmed, length-bounded, and known to
   * name only placeholders this build understands). Absent/null — the state
   * of every account that has never opened the panel — means the built-in
   * wording below, unchanged.
   */
  template?: string | null;
  /**
   * What the pilot typed in THIS send's dialog, for THIS client, once.
   *
   * PASSED THROUGH VERBATIM — no placeholder substitution, deliberately.
   * A template is written once for every client and earns its
   * substitution; a per-send note is written to one named person while
   * looking at their invoice, so there is nothing for `{{client_name}}` to
   * save them. Running it through the substituter would also inherit
   * applyTemplate's decline-on-missing-value rule, which here would mean a
   * pilot's whole note silently vanishing from a mail they believed they
   * had personalised. Same treatment as `notes` above, for the same reason.
   */
  customMessage?: string | null;
};

export type InvoiceMessage = { subject: string; text: string };

/**
 * WHAT THIS PRODUCT KNOWS ABOUT WHETHER THE CLIENT HAS SEEN THE INVOICE, and
 * it is less than it sounds.
 *
 * pilot.invoice_shares.first_viewed_at/last_viewed_at mean exactly one thing,
 * and their own migration (20260812200000) is emphatic about it: "this share
 * link was FETCHED while valid." Mail scanners and link-preview bots issue
 * GETs; Outlook SafeLinks is indistinguishable from a CFO. So a stamp is a
 * fact about a LINK, never about a person, and the wording below is written
 * to that limit — "the link was opened", never "you read it", never "we can
 * see you've seen this". A reminder that claims knowledge of somebody's
 * reading habits is both wrong and insulting, in a message whose entire job
 * is to stay easy to reply to.
 *
 * `no_link` is the ORDINARY case, not an edge one: a reminder carries the PDF
 * as an attachment and most invoices never had a share link minted at all
 * (email and link travel separately — see lib/invoice-share-receipts.ts's
 * header). It produces no sentence, because there is nothing to say.
 */
export type ReminderLinkActivity =
  | { kind: "no_link" }
  | { kind: "never_opened" }
  | { kind: "opened"; firstViewedAt: string };

export type ReminderMessageInput = InvoiceMessageInput & {
  daysOverdue: number;
  /**
   * How the shared link has behaved. Absent is treated as `no_link`, so every
   * existing caller renders byte-identically.
   */
  linkActivity?: ReminderLinkActivity;
  /**
   * The agreed late-fee sentence, ALREADY resolved by the caller from the
   * client's own opt-in (lib/reminders/policy.ts's lateFeeReminderSentence,
   * which returns null unless the pilot switched the note on AND has a figure
   * on file). Passed in rather than computed here for the same reason
   * `paymentUrl` is: this module states facts, it does not decide policy.
   *
   * It is placed with the closing courtesy, not with the amount — a fee that
   * appears next to the balance reads as part of it, and the balance is
   * whatever pilot.invoice_totals says and nothing else.
   */
  lateFeeNote?: string | null;
};

function reference(invoiceNumber: string | null): string {
  return invoiceNumber ? `Invoice ${invoiceNumber}` : "Invoice";
}

/**
 * The facts of THIS invoice, in the form a template substitutes them in.
 *
 * A KEY IS PRESENT ONLY WHEN THE FACT IS REAL. An absent key is what makes
 * applyTemplate decline (see its header) rather than print a blank, so
 * "this invoice has no due date" must arrive here as a missing key and
 * never as formatDate's em-dash placeholder — which is exactly what
 * formatDate returns for null AND for a malformed date, hence the equality
 * check rather than a null check on the input.
 */
function placeholderValues(
  input: InvoiceMessageInput
): Partial<Record<MessagePlaceholderKey, string>> {
  const values: Partial<Record<MessagePlaceholderKey, string>> = {
    client_name: input.contactName?.trim() || input.clientName,
    amount_due: formatCents(input.balanceDueCents),
  };
  if (input.invoiceNumber) values.invoice_number = input.invoiceNumber;
  const due = input.dueOn ? formatDate(input.dueOn) : "—";
  if (due !== "—") values.due_date = due;
  return values;
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
  //
  // A saved template replaces THIS sentence and only this sentence, and
  // only when every placeholder it names resolves — otherwise the built-in
  // wording below runs, conditional clause and all. See applyTemplate.
  const templated = input.template?.trim()
    ? applyTemplate(input.template.trim(), placeholderValues(input), INVOICE_PLACEHOLDERS)
    : null;
  lines.push(
    templated ??
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

  // THE PILOT'S OWN WORDS FOR THIS SEND, above the machine-stated facts
  // that follow (receipt count, payment link) and below the amount, which
  // is what the reader opened the mail for. A note about the trip reads as
  // context for the bill in that position; below the payment link it would
  // read as a footnote to it.
  if (input.customMessage?.trim()) {
    lines.push("");
    lines.push(input.customMessage.trim());
  }

  if (input.receiptCount) {
    // Speaks ONLY to genuinely-embedded images (lib/invoice-document's
    // receiptCount excludes caption/fallback pages), and states the exact
    // count rather than "the rebilled expenses" — which would imply every
    // rebilled line's receipt is in hand even when some are PDF-only or
    // corrupt and rode along as an "available on request" page. So the mail
    // never claims an image a toggled-off, receiptless, or fallback-only PDF
    // doesn't carry.
    lines.push("");
    lines.push(
      input.receiptCount === 1
        ? "One receipt for a rebilled expense is included in the attached PDF."
        : `${input.receiptCount} receipts for rebilled expenses are included in the attached PDF.`
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
  input: ReminderMessageInput
): InvoiceMessage {
  const ref = reference(input.invoiceNumber);
  const greetingName = input.contactName?.trim() || input.clientName;
  const overdue = input.daysOverdue > 0;

  const subject = overdue
    ? `Reminder: ${ref} from ${input.accountName}, ${formatCents(
        input.balanceDueCents
      )} outstanding`
    : `Reminder: ${ref} from ${input.accountName}`;

  const lines: string[] = [];
  lines.push(`${greetingName},`);
  lines.push("");

  const dayWord = input.daysOverdue === 1 ? "day" : "days";
  // `days_overdue` is a real fact only on an overdue invoice, so it is
  // withheld otherwise — which makes applyTemplate decline any template
  // naming it, and the not-yet-due wording below runs instead. That is the
  // correct outcome: a template written to chase a late invoice must never
  // be sent about one that is not late yet.
  const templated = input.template?.trim()
    ? applyTemplate(
        input.template.trim(),
        {
          ...placeholderValues(input),
          ...(overdue ? { days_overdue: `${input.daysOverdue} ${dayWord}` } : {}),
        },
        REMINDER_PLACEHOLDERS
      )
    : null;

  if (templated) {
    lines.push(templated);
  } else if (overdue) {
    lines.push(
      `A quick follow-up on ${ref}, for ${formatCents(
        input.balanceDueCents
      )}, which was due ${
        input.dueOn ? formatDate(input.dueOn) : "earlier"
      }, ${input.daysOverdue} ${dayWord} ago. A copy is attached.`
    );
  } else {
    lines.push(
      `A quick note that ${ref}, for ${formatCents(input.balanceDueCents)}, is due${
        input.dueOn ? ` ${formatDate(input.dueOn)}` : " shortly"
      }. A copy is attached.`
    );
  }

  // WHAT THE LINK DID, stated as narrowly as the stamp permits — see
  // ReminderLinkActivity. Sits directly under the opening line because it is
  // the reason this particular follow-up is worded the way it is, and above
  // the pilot's own note so their words are the last thing before the
  // payment link.
  const activity = input.linkActivity ?? { kind: "no_link" as const };
  if (activity.kind === "never_opened") {
    lines.push("");
    lines.push(
      "The copy I shared by link hasn't been opened yet, so in case it didn't reach you, it is attached here as well."
    );
  } else if (activity.kind === "opened") {
    // "was opened", never "you opened it" or "you've seen it": the stamp
    // records a fetch of a URL. It cannot distinguish a person from a mail
    // scanner, and the copy must not pretend otherwise.
    lines.push("");
    lines.push(
      `The copy I shared by link was opened on ${formatDate(
        activity.firstViewedAt
      )}, so I want to be sure it has reached the right desk.`
    );
  }

  if (input.customMessage?.trim()) {
    lines.push("");
    lines.push(input.customMessage.trim());
  }

  if (input.paymentUrl) {
    lines.push("");
    lines.push("You can pay online here:");
    lines.push(input.paymentUrl);
  }

  // The agreed fee, when the pilot has opted this client in. Deliberately
  // here — beneath the payment link, beside the courtesy — and not near the
  // amount: it states what was agreed, and it is not part of what is owed.
  if (input.lateFeeNote?.trim()) {
    lines.push("");
    lines.push(input.lateFeeNote.trim());
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
