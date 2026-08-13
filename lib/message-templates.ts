import {
  INVOICE_PLACEHOLDERS,
  MAX_MESSAGE_TEMPLATE_CHARS,
  REMINDER_PLACEHOLDERS,
  unknownPlaceholders,
  type MessagePlaceholder,
} from "@/lib/email/invoice-message";

/**
 * THE STORED SHAPE OF A PILOT'S SAVED MESSAGE WORDING, and the total
 * function that turns an untrusted blob into it.
 *
 * This is the third preference section, and it is deliberately built like
 * the first two rather than like a new feature: lib/theme-slots.ts owns the
 * appearance section, lib/nav.ts owns the layout section, and this file
 * owns the templates section. lib/preferences.ts composes the three and
 * knows the storage; none of them knows about the database. Keeping that
 * split is what lets 20260813000000's promise hold — "adding a new switch
 * is a UI change, full stop" — because the validation for a section lives
 * with the code that understands its values, not in the writer.
 *
 * WHY pilot.account_preferences AND NOT A NEW TABLE OR A NEW accounts
 * COLUMN. 20260813000000's header states the test for that column, and a
 * message template passes it on every clause: nothing in the database
 * computes on it (no trigger reads it, no view joins it, no invoice total
 * moves because of it), its entire consumer is one total resolver with
 * defaults, and a corrupt or stale value degrades to the product's own
 * copy rather than to a broken render. A column per template would buy
 * type-checking that lib/email/invoice-message.ts does not rely on — it
 * treats the value as `unknown` regardless — and cost a migration.
 *
 * So THIS FEATURE SHIPS WITH NO MIGRATION AT ALL. The
 * `grant update (prefs)` and `grant insert (account_id, prefs)` from
 * 20260813000000 already permit exactly this write, RLS already scopes it
 * to the tenant, and the 16 KB CHECK already bounds it. The counterweight
 * is real and is why MAX_MESSAGE_TEMPLATE_CHARS exists: the templates
 * share one row and one CHECK with the appearance and layout sections, so
 * an unbounded template would let one over-long paste fail the write for
 * every preference at once. Bounded here, the two templates together
 * cannot exceed ~2 KB of a 16 KB budget.
 *
 * NEVER TRUST THE BLOB — the same rule, for the same reasons, as
 * lib/preferences.ts's own header sets out at length. Validating only on
 * write is the half that breaks: the row outlives the code that wrote it,
 * and a placeholder this build understands can be retired by the next one.
 * `normalizeMessageTemplates` is therefore TOTAL over `unknown` and every
 * rejection resolves to null, which means "use the built-in wording" —
 * a state the product renders correctly because it is the state every
 * account starts in.
 */

export type MessageTemplates = {
  /** The opening line of an invoice send. null = the built-in wording. */
  invoice: string | null;
  /** The opening line of a reminder. null = the built-in wording. */
  reminder: string | null;
};

export const DEFAULT_MESSAGE_TEMPLATES: MessageTemplates = {
  invoice: null,
  reminder: null,
};

/**
 * One template, checked against the placeholder set that message kind
 * allows. Returns the sentence a pilot should read, or null when the text
 * is fine.
 *
 * Shared by the writer (which shows the sentence) and the reader (which
 * only cares whether there is one), so the two can never disagree about
 * what a valid template is — the failure mode where a saved template stops
 * being used and nothing anywhere says why.
 */
export function messageTemplateProblem(
  text: string,
  allowed: readonly MessagePlaceholder[]
): string | null {
  if (text.length > MAX_MESSAGE_TEMPLATE_CHARS) {
    return `Keep it under ${MAX_MESSAGE_TEMPLATE_CHARS} characters — this is the opening line, not the whole message.`;
  }
  const unknown = unknownPlaceholders(text, allowed);
  if (unknown.length > 0) {
    // Named, not merely counted: a typo like {{client}} is invisible until
    // someone says which word is wrong, and this is the one screen where
    // the pilot can still fix it before a client sees the result.
    const list = unknown.map((name) => `{{${name}}}`).join(", ");
    const known = allowed.map((placeholder) => placeholder.token).join(", ");
    return `${list} ${unknown.length === 1 ? "isn't" : "aren't"} something this product can fill in. Use ${known}, or plain words.`;
  }
  return null;
}

/** Untrusted jsonb → known-good templates. Total; never throws. */
export function normalizeMessageTemplates(raw: unknown): MessageTemplates {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  return {
    invoice: normalizeOne(source.invoice, INVOICE_PLACEHOLDERS),
    reminder: normalizeOne(source.reminder, REMINDER_PLACEHOLDERS),
  };
}

/**
 * REJECTION IS ALWAYS null, NEVER A REPAIR. Truncating an over-long
 * template would send a client a sentence that stops mid-word, and
 * stripping an unrecognised placeholder would send them a sentence with a
 * gap where a fact used to be. Both are worse than the product's own
 * wording, which is complete and correct by construction — so anything
 * this function cannot vouch for falls all the way back to it.
 */
function normalizeOne(
  value: unknown,
  allowed: readonly MessagePlaceholder[]
): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  if (messageTemplateProblem(text, allowed) !== null) return null;
  return text;
}
