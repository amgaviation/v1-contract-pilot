/**
 * WHO AN INVOICE BILLS, RESOLVED IN ONE PLACE.
 *
 * pilot.invoices.client_id became nullable in 20260815100000. An invoice now
 * bills either a pilot.clients row (unchanged behaviour: its CURRENT details,
 * read live at render, never frozen) or the typed bill_to_* columns it carries
 * itself. The check constraint invoices_bill_to_or_client guarantees exactly
 * one of the two, so there is never a row where both are set and never one
 * where neither is.
 *
 * This module is the only place that knows that. Four readers need the answer
 * and they must not each work it out: the PDF (lib/invoice-document.tsx), the
 * email (lib/email/send-invoice.ts), the invoice screen, and the list. Two of
 * them put the result in front of the pilot's client, so a divergence would be
 * discovered by the wrong person.
 *
 * DELIBERATELY NOT `server-only`. It is pure functions over plain objects with
 * no Supabase client, no environment and no I/O, which is what lets
 * tests/invoice-bill-to.test.mjs pin it directly rather than through a screen.
 */

/**
 * The bill-to block, in the shape the PDF and the public share payload have
 * always taken it. The field names are the pilot.clients column names on
 * purpose: the client path hands its row through unchanged, so there is one
 * shape and no translation layer that could drop a field.
 */
export type BillTo = {
  name: string;
  contact_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

/** The client columns this module needs. A superset is fine. */
export type BillToClientRow = BillTo & {
  contact_email?: string | null;
  billing_email?: string | null;
};

/** The invoice columns this module needs. A superset is fine. */
export type BillToInvoiceRow = {
  client_id: string | null;
  bill_to_name: string | null;
  bill_to_contact_name: string | null;
  bill_to_email: string | null;
  bill_to_address_line1: string | null;
  bill_to_address_line2: string | null;
  bill_to_city: string | null;
  bill_to_state: string | null;
  bill_to_postal_code: string | null;
  bill_to_country: string | null;
};

/**
 * WHAT AN INVOICE WITH NO CLIENT IS CALLED, everywhere it is listed beside
 * ones that have a client.
 *
 * One constant rather than a string per screen, because these labels sit in
 * the same column of the same tables ("No client" on the invoice list, in the
 * overview queue, in a report rollup) and three near-synonyms would read as
 * three different states. It is deliberately NOT "Unknown client": that
 * sentence already means something specific in this codebase, namely "a client
 * id we could not resolve", which is a failed read and not this.
 */
export const NO_CLIENT_LABEL = "No client";

/**
 * The bill-to block for an invoice, or null when it cannot be resolved.
 *
 * Null means one thing only: this invoice names a client and that client row
 * was not supplied or came back short. It is a FAILED READ, and every caller
 * treats it as one rather than substituting a blank address, because the two
 * documents this feeds are the PDF a client is billed from and the page a
 * client pays from.
 *
 * A clientless invoice never returns null: bill_to_name is non-null by check
 * constraint whenever client_id is null.
 */
export function resolveBillTo(
  invoice: BillToInvoiceRow,
  client: BillToClientRow | null | undefined
): BillTo | null {
  if (invoice.client_id !== null) {
    if (!client) return null;
    // The client's CURRENT details, unchanged from before this feature
    // existed. Nothing is snapshotted at send and nothing is frozen here.
    return {
      name: client.name,
      contact_name: client.contact_name,
      address_line1: client.address_line1,
      address_line2: client.address_line2,
      city: client.city,
      state: client.state,
      postal_code: client.postal_code,
      country: client.country,
    };
  }
  return {
    // Non-null by invoices_bill_to_or_client. The fallback is here so a row
    // written by service_role outside that constraint's reach still renders a
    // document instead of an empty heading.
    name: invoice.bill_to_name ?? NO_CLIENT_LABEL,
    contact_name: invoice.bill_to_contact_name,
    address_line1: invoice.bill_to_address_line1,
    address_line2: invoice.bill_to_address_line2,
    city: invoice.bill_to_city,
    state: invoice.bill_to_state,
    postal_code: invoice.bill_to_postal_code,
    country: invoice.bill_to_country,
  };
}

/**
 * The name to show for an invoice in a LIST, where the client row may not
 * have been read at all.
 *
 * Three cases and they say three different things:
 *   * a client, resolved      -> the client's name
 *   * a client, not resolved  -> "Unknown client", the existing phrase for a
 *                                short read, kept because it already means
 *                                that everywhere in this codebase
 *   * no client               -> the typed name, or NO_CLIENT_LABEL if a row
 *                                somehow has neither
 */
export function billToListLabel(
  invoice: Pick<BillToInvoiceRow, "client_id" | "bill_to_name">,
  clientNames: ReadonlyMap<string, string>
): string {
  if (invoice.client_id === null) return invoice.bill_to_name ?? NO_CLIENT_LABEL;
  return clientNames.get(invoice.client_id) ?? "Unknown client";
}

/**
 * WHERE AN EMAILED COPY OR A HAND-SENT REMINDER GOES.
 *
 * The client path is unchanged and must stay identical to what the screens
 * predict: billing_email (20260814092000) when it looks like a real address,
 * contact_email otherwise. A clientless invoice has exactly one address, the
 * one that was typed on it, because there is no relationship to keep an
 * accounts-payable inbox separate from a scheduler's.
 *
 * `looksLikeEmail` is injected rather than imported so this module stays free
 * of lib/email/send.ts, which is `server-only`. The one validator is still the
 * one validator: every caller passes that function.
 */
export function billToEmail(
  invoice: Pick<BillToInvoiceRow, "client_id" | "bill_to_email">,
  client: Pick<BillToClientRow, "contact_email" | "billing_email"> | null | undefined,
  looksLikeEmail: (value: string | null | undefined) => boolean
): string | null {
  if (invoice.client_id === null) {
    return looksLikeEmail(invoice.bill_to_email) ? (invoice.bill_to_email as string) : null;
  }
  if (!client) return null;
  if (looksLikeEmail(client.billing_email)) return client.billing_email as string;
  return looksLikeEmail(client.contact_email) ? (client.contact_email as string) : null;
}

/**
 * WHAT THE SCHEDULED REMINDER RUN WILL DO WITH THIS INVOICE, said once so the
 * invoice screen and lib/reminders/run.ts cannot describe it differently.
 *
 * The run reads its ladder from pilot.clients (reminder_before_due,
 * reminder_on_due, reminder_after_due) and scopes its whole pass to clients
 * that have one. An invoice with no client has no ladder to read, so it is out
 * of scope: nothing is sent, nothing is skipped, nothing is recorded. That is
 * a decision, not an accident, and the panel that would otherwise render an
 * empty ladder says this sentence instead.
 *
 * Sending a reminder by hand is unaffected and still goes to bill_to_email.
 */
export const NO_CLIENT_REMINDER_NOTICE =
  "Scheduled reminders follow a client's schedule, and this invoice has no client. Nothing goes out for it on its own. You can still send a reminder by hand from the panel above.";

/**
 * The same fact about late fees. A late fee is a rate the pilot agreed with a
 * particular client (clients.late_fee_flat_cents / late_fee_bps_per_month),
 * so there is nothing to quote here and the panel says why rather than
 * showing an empty policy.
 */
export const NO_CLIENT_LATE_FEE_NOTICE =
  "Late fees come from a client's agreed terms, and this invoice has no client. Nothing is charged automatically. Add a line for it yourself if you have agreed one.";
