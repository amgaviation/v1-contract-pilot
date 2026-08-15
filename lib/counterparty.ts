/**
 * Counterparties you bill, and counterparties you only fly for.
 *
 * pilot.clients is the product's ONE counterparty table: the operator whose
 * indoc you sat through and the operator whose invoices you send are the
 * same kind of record, because the first routinely becomes the second.
 * pilot.clients.you_invoice (20260815120000) is what separates them, and
 * this file is the one place its meaning is written in TypeScript.
 *
 * WHY A LIB FILE RATHER THAN A LITERAL AT EACH CALL SITE. The rule spans a
 * migration, five server components and two server actions. Spelled out at
 * each of those, it is seven independent chances to write the filter
 * backwards, and a backwards filter here is silent: the pilot simply does
 * not see a client in a picker, or sees one they said they never bill.
 * Every function below is pure and unit-tested (tests/counterparty.test.mjs)
 * for exactly that reason.
 *
 * WHAT THIS FILE DOES NOT DECIDE. Whether the refusal below is enforceable
 * is not up to the app: pilot.clients_refuse_stop_invoicing() and
 * pilot.refuse_billing_a_non_invoiced_client() are the boundary, and they
 * hold against a crafted post that never runs a line of this file. What
 * lives here is the SENTENCE a pilot reads instead of a Postgres error, and
 * the filter the pickers apply so they are never offered the choice the
 * database would refuse.
 */

/** The column, spelled once. Used to build Supabase filters. */
export const YOU_INVOICE_COLUMN = "you_invoice";

/**
 * Anything carrying the flag. Optional and nullable because several reads
 * in the product select a narrow column list, and a row that did not ask
 * for the flag must not silently read as "not invoiced".
 */
export type BillingCounterparty = { you_invoice?: boolean | null };

/**
 * Is this someone you bill?
 *
 * ABSENT OR NULL READS AS TRUE, deliberately, matching the column's own
 * `not null default true`: every client that existed before this feature
 * is one you bill, and a read that did not select the column has said
 * nothing about it. The dangerous direction is the other one, where a
 * missing field would quietly drop a paying client out of a picker.
 */
export function isInvoicedCounterparty(row: BillingCounterparty): boolean {
  return row.you_invoice !== false;
}

/** The picker rule: only counterparties you bill. */
export function invoicedCounterparties<T extends BillingCounterparty>(
  rows: readonly T[]
): T[] {
  return rows.filter(isInvoicedCounterparty);
}

/**
 * What already ties a client to money. Counted by the caller from the
 * three tables the database guard checks, in that order.
 */
export type BillingPaperwork = {
  invoices: number;
  estimates: number;
  schedules: number;
};

/**
 * Why this client cannot be marked as one you do not invoice, or null if
 * they can be.
 *
 * REFUSED RATHER THAN HANDLED, and the sentence says what to do instead.
 * See 20260815120000's header for the full reasoning; the short version is
 * that the alternative is either hiding money the pilot is owed from A/R,
 * or leaving a client the product was told is not billed sitting in the
 * aging buckets and on the overdue ladder. Archiving is the feature for
 * "take this billed client out of my pickers", and it already exists.
 *
 * ORDER MATTERS ONLY FOR THE WORDING: a client with all three gets told
 * about the invoices, which is the heaviest of the three and the one whose
 * remedy (archive) is different from the other two (delete them).
 */
export function stopInvoicingRefusal(paperwork: BillingPaperwork): string | null {
  if (paperwork.invoices > 0) {
    return "You've already invoiced this client, so you can't mark them as one you don't invoice. Archive them instead: their invoices stay, and they stop appearing when you pick a client for new work.";
  }
  if (paperwork.estimates > 0) {
    return "You've sent this client an estimate, so you can't mark them as one you don't invoice. Delete the estimate first, or archive the client instead.";
  }
  if (paperwork.schedules > 0) {
    return "This client has a recurring invoice schedule, so you can't mark them as one you don't invoice. Delete the schedule first, or it would keep billing them.";
  }
  return null;
}

/**
 * THE COPY, in one place because it is asked and answered on four screens
 * (the client form, the client list, the client page, the qualifications
 * panel) and those four have to say the same thing.
 */
export const COUNTERPARTY_COPY = {
  /** The checkbox on the client form. */
  toggleLabel: "You invoice this client",
  /** Under the checkbox. Says what turning it off does, and what it keeps. */
  toggleHelp:
    "Leave this off for an operator you fly for but never bill. They keep their qualifications, documents, trips and rates, and they stop appearing when you pick a client for an invoice or an estimate.",
  /** The badge on the client list and the client page. */
  badge: "Not invoiced",
  /** Shown on a non-invoiced client's own page, where Statement used to be. */
  pageNote:
    "You don't invoice this operator, so there's nothing to put on a statement. Their qualifications, documents and trips are all still here. Turn \"You invoice this client\" back on above the moment they send you paid work.",
  /** The inline create control on the operator qualifications panel. */
  addOperatorHeading: "Flying for another operator?",
  addOperatorHelp:
    "Add them by name and record their indoc straight away. You don't invoice them until you say so, so they stay out of your invoices and estimates.",
  addOperatorSubmit: "Add operator",
} as const;
