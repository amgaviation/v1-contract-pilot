import "server-only";
import { buildInvoiceDocument } from "@/lib/invoice-document";
import { isLiveMode } from "@/lib/stripe/server";
import { resolvePreferences } from "@/lib/preferences";
import { friendlyDbError } from "@/lib/db-errors";
import {
  sendEmail,
  emailIsConfigured,
  looksLikeEmail,
  type SendFailureKind,
} from "./send";
import {
  buildInvoiceMessage,
  buildReminderMessage,
  daysOverdue,
  type ReminderLinkActivity,
} from "./invoice-message";
import {
  lateFeeReminderSentence,
  normalizeLateFeePolicy,
} from "@/lib/reminders/policy";
import { billToEmail } from "@/lib/invoice-bill-to";

/**
 * THE SHARED HALF OF EVERY INVOICE EMAIL: load the client, render the
 * document, compose the words, hand it to the mail service.
 *
 * WHY THIS LIVES IN lib/ AND NOT IN app/(app)/invoices/actions.ts, WHERE IT
 * WAS. It has one new caller — the scheduled reminder run, which has no
 * session and cannot use a server action — and actions.ts carries the
 * "use server" directive, under which EVERY export is a public HTTP endpoint.
 * Exporting the sender from there to reach it would have published an
 * unauthenticated "email this invoice to this client" action, which is not a
 * refactor, it is a hole. Moving it here keeps it importable by both callers
 * and callable by neither the browser nor anyone else: `server-only` fails
 * the build if a client component so much as imports this file.
 *
 * The body below is the one that shipped in actions.ts, moved with its
 * comments intact. What was added: the two reminder-only facts (link
 * activity, the agreed late-fee sentence), and the caller-supplied `now` —
 * see those parameters.
 *
 * Returns rather than throws, so every caller has to deal with the failure:
 * in a server action a thrown error becomes an unhandled 500 the pilot learns
 * nothing from, and in the scheduled run it would abandon every remaining
 * account in the pass.
 */

/**
 * THE FAILURE KIND TRAVELS WITH THE MESSAGE, unchanged, from lib/email/send.ts.
 *
 * Every refusal this function makes on its own account is 'refused': it is
 * deciding not to call the mail service at all, so nothing was sent and it
 * knows it. Only the transport can produce 'unknown', and only one caller acts
 * on the difference (lib/reminders/run.ts, which retries a definite failure and
 * never retries an indeterminate one). Interactive callers read `error` exactly
 * as they always have.
 */
export type InvoiceEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; kind: SendFailureKind; error: string };

export async function sendInvoiceEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  invoiceId: string,
  kind: "invoice" | "reminder",
  /**
   * WHERE A REPLY GOES, and it must not be the platform.
   *
   * INVOICE_FROM_EMAIL is one deployment-wide sender shared by every tenant,
   * so without an explicit reply-to a client hitting Reply writes to a mailbox
   * belonging to the software vendor rather than to their pilot. That is wrong
   * in every case and actively harmful on a reminder, whose own words invite a
   * reply: "if anything on it needs correcting, let me know and I will send a
   * revised copy." The one person who can revise the bill would never see it,
   * and — worse for a product whose trust story is that AMG cannot see a
   * pilot's client relationships — the vendor would.
   *
   * The pilot's own signed-in address is the right target: it is verified by
   * Supabase Auth, it is theirs, and it needs no new column.
   *
   * THE SCHEDULED RUN HAS NO SESSION, so it cannot supply one that way. It
   * resolves the OWNER's address instead (lib/reminders/run.ts) and passes it
   * here, which is the same person's mailbox by a different route — and when
   * it cannot resolve one, it passes undefined and the send goes out with no
   * reply-to rather than with the vendor's. An account-level billing address
   * would settle both paths at once and is still the change to make; this is
   * the one place it would land.
   */
  replyTo: string | undefined,
  /**
   * Attach rebilled-expense receipt pages to the PDF. Defaults true so every
   * surface keeps the same default; only sendInvoice's dialog checkbox ever
   * passes false.
   */
  includeReceipts: boolean = true,
  /**
   * The pilot's per-send note, already trimmed and length-checked by the
   * caller. null on every path that does not offer the box — which includes
   * every scheduled send, because nobody is there to write one.
   */
  customMessage: string | null = null,
  /**
   * "Now", supplied by the caller rather than read from the clock here.
   *
   * The scheduled run decides which rung is due against a single calendar day
   * and then records the outcome against that same day; if this function read
   * its own clock, a run that crossed midnight could send the "14 days
   * overdue" rung and compose it as 15. Defaults to the current instant, so
   * the interactive callers are unchanged.
   */
  now: Date = new Date()
): Promise<InvoiceEmailResult> {
  if (!emailIsConfigured()) {
    return {
      ok: false,
      kind: "refused",
      error:
        "Emailing isn't set up on this account yet, so nothing was sent. Download the PDF and send it yourself, or set the mail service up in the project's environment first.",
    };
  }

  const { data: invoiceRow, error: invoiceError } = await supabase
    .from("invoices")
    .select(
      // bill_to_name/bill_to_email ride along for the clientless case
      // (20260815100000). The address columns are NOT read here: the PDF
      // builder below resolves the printed block itself, and reading them
      // twice would be two sources for one address.
      "id, client_id, bill_to_name, bill_to_email, notes, stripe_payment_link_url, stripe_payment_link_livemode"
    )
    .eq("id", invoiceId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (invoiceError) {
    return {
      ok: false,
      kind: "refused",
      error: `${friendlyDbError(invoiceError, "invoices.select")} Nothing was sent.`,
    };
  }
  const invoice = invoiceRow as {
    client_id: string | null;
    bill_to_name: string | null;
    bill_to_email: string | null;
    notes: string | null;
    stripe_payment_link_url: string | null;
    stripe_payment_link_livemode: boolean | null;
  } | null;
  if (!invoice) {
    return { ok: false, kind: "refused", error: "That invoice no longer exists." };
  }

  // NO CLIENT, NO CLIENT READ. An invoice raised without one (20260815100000)
  // carries its own bill-to details, and the query that would fetch a client
  // for it has no id to filter on.
  const { data: clientRow, error: clientError } =
    invoice.client_id === null
      ? { data: null, error: null }
      : await supabase
          .from("clients")
          .select(
            // The late-fee columns ride the same read the greeting already
            // needed. They are used ONLY to compose a sentence about what was
            // agreed, and only when late_fee_note_on_reminders is on.
            "name, contact_name, contact_email, billing_email, late_fee_flat_cents, late_fee_bps_per_month, late_fee_grace_days, late_fee_note_on_reminders"
          )
          .eq("id", invoice.client_id)
          .eq("account_id", accountId)
          .maybeSingle();

  if (clientError) {
    return {
      ok: false,
      kind: "refused",
      error: `${friendlyDbError(clientError, "clients.select")} Nothing was sent.`,
    };
  }
  const client = clientRow as {
    name: string;
    contact_name: string | null;
    contact_email: string | null;
    billing_email: string | null;
    late_fee_flat_cents: number | null;
    late_fee_bps_per_month: number | null;
    late_fee_grace_days: number | null;
    late_fee_note_on_reminders: boolean | null;
  } | null;
  // Only a MISSING row for an invoice that names a client is an error. A
  // clientless invoice legitimately has none, and saying "that invoice's
  // client no longer exists" about one would be a false statement about a
  // relationship that never existed.
  if (invoice.client_id !== null && !client) {
    return {
      ok: false,
      kind: "refused",
      error: "That invoice's client no longer exists.",
    };
  }

  // Who this is addressed to, in the greeting and in the failure sentences
  // below. The client's name when there is one, the typed name when there is
  // not; never a placeholder, because bill_to_name is non-null whenever
  // client_id is null (invoices_bill_to_or_client).
  const billedName = client?.name ?? invoice.bill_to_name ?? "This invoice";

  // WHERE THE MONEY PAPERWORK GOES, resolved by the one function the invoice
  // screen also calls so "Goes to {email}" can never name an address this
  // send does not use. For a client: billing_email (20260814092000) when it
  // looks real, contact_email otherwise, because a real operator's scheduler
  // books the trip and never touches payables. For a clientless invoice:
  // the single address typed on it, since there is no relationship to keep
  // two inboxes for.
  const recipientEmail = billToEmail(invoice, client, looksLikeEmail);
  // The most common reason a send cannot happen, and the one the pilot can fix
  // in ten seconds, so it names the target and points at the right screen. The
  // two screens are different: a client's address lives on the client, a typed
  // one lives on the invoice itself.
  if (!looksLikeEmail(recipientEmail)) {
    return {
      ok: false,
      kind: "refused",
      error:
        invoice.client_id === null
          ? `${billedName} has no email address on this invoice, so nothing was sent. Add one in the invoice's bill-to details and try again.`
          : `${billedName} has no email address on file, so nothing was sent. Add one on the client's page and try again.`,
    };
  }

  const built = await buildInvoiceDocument(supabase, accountId, invoiceId, {
    includeReceipts,
  });
  if (!built.ok) {
    return { ok: false, kind: "refused", error: `${built.error} Nothing was sent.` };
  }
  const doc = built.document;

  // THE MODE GUARD. A payment link minted in Stripe test mode is unpayable,
  // and putting one in a real client's inbox wastes their time and the
  // pilot's credibility. Same condition the invoice screen already applies
  // before it shows the link — kept identical on purpose.
  const paymentUrl =
    invoice.stripe_payment_link_url &&
    invoice.stripe_payment_link_livemode === isLiveMode()
      ? invoice.stripe_payment_link_url
      : null;

  // THE ACCOUNT'S SAVED WORDING, read at SEND time rather than carried in
  // from the screen that offered the button. Two reasons, and the second is
  // the load-bearing one: the reminder path has no dialog that could carry
  // it at all, and a template edited in another tab between render and
  // click must not send yesterday's sentence.
  //
  // READ THROUGH THE `supabase` CLIENT THIS CALL WAS HANDED, NOT via
  // lib/preferences.ts's loadPreferences — that helper always opens its OWN
  // cookie-bound session client (lib/supabase/server createClient()),
  // ignoring whatever client the caller already has. The scheduled reminder
  // run (lib/reminders/run.ts) calls this function with a SERVICE-ROLE
  // client because there is no session to run as; loadPreferences's fresh
  // client sees no session either, runs as anon, and account_preferences'
  // policies are authenticated-only — so on every cron send loadPreferences
  // silently degraded to DEFAULT_PREFERENCES, and the pilot's saved
  // wording never reached a single scheduled reminder, while the manual
  // "Send a reminder" button (a real session) used it correctly the whole
  // time. Querying with the client already in hand fixes both callers at
  // once: the service-role client can read the row directly, and the
  // interactive callers keep RLS exactly as before.
  //
  // resolvePreferences is the same TOTAL validator loadPreferences uses on
  // this same column — a missing row (the ordinary state) and a failed read
  // both resolve to the product's own defaults, which for this section
  // means "no template", i.e. exactly the built-in copy. So a preferences
  // outage still costs a pilot their custom opening line and never costs
  // them the send.
  const { data: prefsRow, error: prefsError } = await supabase
    .from("account_preferences")
    .select("prefs")
    .eq("account_id", accountId)
    .maybeSingle();
  if (prefsError) friendlyDbError(prefsError, "account_preferences.load");
  const preferences = resolvePreferences(
    (prefsRow as { prefs: unknown } | null)?.prefs
  );
  const template =
    kind === "reminder"
      ? preferences.templates.reminder
      : preferences.templates.invoice;

  const shared = {
    accountName: doc.accountName,
    clientName: billedName,
    contactName: client?.contact_name ?? null,
    invoiceNumber: doc.invoiceNumber,
    dueOn: doc.dueOn,
    totalCents: doc.totalCents,
    balanceDueCents: doc.balanceDueCents,
    paymentUrl,
    notes: invoice.notes,
    // Genuinely-embedded receipt IMAGES only — not fallback/caption pages,
    // and never the toggle's intent.
    receiptCount: doc.receiptCount,
    template,
    customMessage,
  };

  let message;
  if (kind === "reminder") {
    message = buildReminderMessage({
      ...shared,
      daysOverdue: daysOverdue(doc.dueOn, now),
      linkActivity: await readLinkActivity(supabase, accountId, invoiceId),
      // A LATE FEE IS SOMETHING AGREED WITH A PARTICULAR CLIENT, so a
      // clientless invoice has no policy and this sentence is omitted
      // entirely rather than composed from zeros. Inventing a consequence
      // the pilot has not agreed with the person being billed is the one
      // thing this whole reminder path refuses to do.
      lateFeeNote: client
        ? lateFeeReminderSentence(
            normalizeLateFeePolicy({
              flatCents: client.late_fee_flat_cents,
              bpsPerMonth: client.late_fee_bps_per_month,
              graceDays: client.late_fee_grace_days ?? 0,
              noteOnReminders: client.late_fee_note_on_reminders === true,
            })
          )
        : null,
    });
  } else {
    message = buildInvoiceMessage(shared);
  }

  const result = await sendEmail({
    to: recipientEmail as string,
    subject: message.subject,
    text: message.text,
    // Only set when it is a usable address — a malformed reply-to is worse
    // than none, because some clients silently drop the whole message.
    replyTo: looksLikeEmail(replyTo) ? replyTo : undefined,
    attachments: [{ filename: doc.filename, content: doc.buffer }],
  });

  if (!result.ok) return { ok: false, kind: result.kind, error: result.error };
  return { ok: true, messageId: result.id };
}

/**
 * Whether this invoice's share link has ever been fetched — and NOTHING more
 * than that. See ReminderLinkActivity in invoice-message.ts for the limits of
 * what the stamp means and the copy rules that follow from them.
 *
 * BEST-EFFORT BY DESIGN: any read failure, and the absence of a share row (the
 * ordinary case — most invoices are emailed and never shared by link), both
 * resolve to `no_link`, which produces no sentence at all. A reminder must
 * never fail to go out because a cosmetic wording input could not be read.
 *
 * A REVOKED link is treated as no link, matching pilot.invoice_public: once
 * revoked the URL 404s, so saying anything about it would describe a page the
 * client can no longer open.
 */
async function readLinkActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  invoiceId: string
): Promise<ReminderLinkActivity> {
  try {
    const { data, error } = await supabase
      .from("invoice_shares")
      .select("first_viewed_at, revoked_at")
      .eq("account_id", accountId)
      .eq("invoice_id", invoiceId)
      .maybeSingle();
    if (error) return { kind: "no_link" };
    const share = data as {
      first_viewed_at: string | null;
      revoked_at: string | null;
    } | null;
    if (!share || share.revoked_at) return { kind: "no_link" };
    if (!share.first_viewed_at) return { kind: "never_opened" };
    return { kind: "opened", firstViewedAt: share.first_viewed_at };
  } catch {
    return { kind: "no_link" };
  }
}
