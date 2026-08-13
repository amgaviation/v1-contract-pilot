import "server-only";
import { buildInvoiceDocument } from "@/lib/invoice-document";
import { isLiveMode } from "@/lib/stripe/server";
import { loadPreferences } from "@/lib/preferences";
import { friendlyDbError } from "@/lib/db-errors";
import { sendEmail, emailIsConfigured, looksLikeEmail } from "./send";
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

export type InvoiceEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

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
      error:
        "Emailing isn't set up on this account yet, so nothing was sent. Download the PDF and send it yourself, or set the mail service up in the project's environment first.",
    };
  }

  const { data: invoiceRow, error: invoiceError } = await supabase
    .from("invoices")
    .select(
      "id, client_id, notes, stripe_payment_link_url, stripe_payment_link_livemode"
    )
    .eq("id", invoiceId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (invoiceError) {
    return {
      ok: false,
      error: `${friendlyDbError(invoiceError, "invoices.select")} Nothing was sent.`,
    };
  }
  const invoice = invoiceRow as {
    client_id: string;
    notes: string | null;
    stripe_payment_link_url: string | null;
    stripe_payment_link_livemode: boolean | null;
  } | null;
  if (!invoice) return { ok: false, error: "That invoice no longer exists." };

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select(
      // The late-fee columns ride the same read the greeting already needed.
      // They are used ONLY to compose a sentence about what was agreed, and
      // only when late_fee_note_on_reminders is on — see below.
      "name, contact_name, contact_email, late_fee_flat_cents, late_fee_bps_per_month, late_fee_grace_days, late_fee_note_on_reminders"
    )
    .eq("id", invoice.client_id)
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
    late_fee_flat_cents: number | null;
    late_fee_bps_per_month: number | null;
    late_fee_grace_days: number | null;
    late_fee_note_on_reminders: boolean | null;
  } | null;
  if (!client) {
    return { ok: false, error: "That invoice's client no longer exists." };
  }
  // The most common reason a send cannot happen, and the one the pilot can fix
  // in ten seconds — so it names the client and points at the screen.
  if (!looksLikeEmail(client.contact_email)) {
    return {
      ok: false,
      error: `${client.name} has no email address on file, so nothing was sent. Add one on the client's page and try again.`,
    };
  }

  const built = await buildInvoiceDocument(supabase, accountId, invoiceId, {
    includeReceipts,
  });
  if (!built.ok) {
    return { ok: false, error: `${built.error} Nothing was sent.` };
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
  // loadPreferences is total — a missing row (the ordinary state) and a
  // failed read both resolve to the product's own defaults, which for this
  // section means "no template", i.e. exactly the built-in copy. So a
  // preferences outage costs a pilot their custom opening line and never
  // costs them the send.
  const preferences = await loadPreferences(accountId);
  const template =
    kind === "reminder"
      ? preferences.templates.reminder
      : preferences.templates.invoice;

  const shared = {
    accountName: doc.accountName,
    clientName: client.name,
    contactName: client.contact_name,
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
      lateFeeNote: lateFeeReminderSentence(
        normalizeLateFeePolicy({
          flatCents: client.late_fee_flat_cents,
          bpsPerMonth: client.late_fee_bps_per_month,
          graceDays: client.late_fee_grace_days ?? 0,
          noteOnReminders: client.late_fee_note_on_reminders === true,
        })
      ),
    });
  } else {
    message = buildInvoiceMessage(shared);
  }

  const result = await sendEmail({
    to: client.contact_email as string,
    subject: message.subject,
    text: message.text,
    // Only set when it is a usable address — a malformed reply-to is worse
    // than none, because some clients silently drop the whole message.
    replyTo: looksLikeEmail(replyTo) ? replyTo : undefined,
    attachments: [{ filename: doc.filename, content: doc.buffer }],
  });

  if (!result.ok) return { ok: false, error: result.error };
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
