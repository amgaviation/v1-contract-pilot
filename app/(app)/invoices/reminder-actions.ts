"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { formatCents } from "@/lib/format";
import { DASHBOARD_PATH } from "@/lib/nav";
import {
  lateFeeLineDescription,
  normalizeLateFeePolicy,
  quoteLateFee,
  toCalendarDate,
} from "@/lib/reminders/policy";
import {
  runDueRemindersForAccount,
  type ReminderRunSummary,
} from "@/lib/reminders/run";
import type { Database } from "@/lib/supabase/database.types";

type InvoiceInsert = Database["pilot"]["Tables"]["invoices"]["Insert"];
type InvoiceUpdate = Database["pilot"]["Tables"]["invoices"]["Update"];
type LineInsert = Database["pilot"]["Tables"]["invoice_lines"]["Insert"];
type LateFeeInsert = Database["pilot"]["Tables"]["invoice_late_fees"]["Insert"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reminder scheduling and late fees — the actions behind the invoice screen's
 * reminder panel and the Settings run button.
 *
 * Kept out of invoices/actions.ts, which is already 2,500 lines and is where
 * the money-moving actions live. Nothing here moves money except
 * createLateFeeInvoice, which creates a DRAFT and stops.
 */

/**
 * "Leave this one alone."
 *
 * The one thing a pilot needs to say about an automated chase, and the moment
 * they need to say it is always after the invoice has gone out — which is why
 * reminders_suppressed is in invoices_protect_issued's writable allowlist (see
 * migration 20260813130000 section 3). Every other column on an issued invoice
 * stays frozen.
 */
export async function setInvoiceRemindersSuppressed(
  id: string,
  suppressed: boolean
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That invoice no longer exists." };

  const { account } = await requireAccount(`/invoices/${id}`);
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("invoices")
    .update({ reminders_suppressed: suppressed } satisfies InvoiceUpdate as never, {
      count: "exact",
    })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "invoices.update") };
  // PostgREST returns 200 with no error for a write that matched nothing.
  // "No error" is not "it saved".
  if (count === 0) return { error: "That invoice no longer exists." };

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return { error: null };
}

/**
 * THE LATE FEE, AS A SEPARATE DRAFT INVOICE.
 *
 * Read migration 20260813130000's section 5 before changing this. The short
 * version: a line cannot be added to an issued invoice (the database refuses
 * it), and forcing one through the service_role exemption would move the
 * balance on a document the client already holds, has a share page for, and
 * may have a Stripe payment link priced against. So the fee is its own
 * document.
 *
 * IT IS A DRAFT AND IT STAYS ONE. Nothing in this feature issues or sends it.
 * That is docs/PLAN.md's rule for every invoice in this product ("reviewed and
 * sent by the pilot — never sent silently"), and a fee — the one bill a client
 * is most likely to argue with — is the last place to make an exception.
 */
export async function createLateFeeInvoice(
  sourceInvoiceId: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(sourceInvoiceId)) {
    return { error: "That invoice no longer exists." };
  }

  const { account } = await requireAccount(`/invoices/${sourceInvoiceId}`);
  const supabase = await createClient();

  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, client_id, invoice_number, status, due_on")
    .eq("id", sourceInvoiceId)
    .eq("account_id", account.id)
    .maybeSingle();

  if (invoiceError) {
    return { error: friendlyDbError(invoiceError, "invoices.select") };
  }
  const source = invoiceData as {
    client_id: string;
    invoice_number: string | null;
    status: string;
    due_on: string | null;
  } | null;
  if (!source) return { error: "That invoice no longer exists." };

  // RE-READ AT WRITE TIME, never trusted from the screen that offered the
  // button — the same reason sendInvoiceReminder re-reads status. The gap
  // between render and click is exactly where an invoice gets paid, and a fee
  // raised against a bill that was settled this morning is a bill the pilot
  // has to withdraw by hand.
  if (source.status !== "sent" && source.status !== "partial") {
    const why =
      source.status === "paid"
        ? "It has been paid in full."
        : source.status === "void"
          ? "It has been voided."
          : "It hasn't been issued yet.";
    return {
      error: `No fee was raised. ${why} Reload the page to see where it stands.`,
    };
  }

  const [
    { data: clientData, error: clientError },
    { data: totalsData, error: totalsError },
    { data: priorData, error: priorError },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "name, late_fee_flat_cents, late_fee_bps_per_month, late_fee_grace_days"
      )
      .eq("id", source.client_id)
      .eq("account_id", account.id)
      .maybeSingle(),
    supabase
      .from("invoice_totals")
      .select("balance_due_cents")
      .eq("invoice_id", sourceInvoiceId)
      .maybeSingle(),
    supabase
      .from("invoice_late_fees")
      // `basis` too: a flat fee already raised blocks a later rate fee
      // outright — quoteLateFee's header carries the argument.
      .select("months_accrued, basis")
      .eq("account_id", account.id)
      .eq("source_invoice_id", sourceInvoiceId),
  ]);

  const readError = clientError ?? totalsError ?? priorError;
  if (readError) {
    return {
      error: `${friendlyDbError(readError, "late_fee.read")} No fee was raised.`,
    };
  }

  const client = clientData as {
    name: string;
    late_fee_flat_cents: number | null;
    late_fee_bps_per_month: number | null;
    late_fee_grace_days: number | null;
  } | null;
  if (!client) return { error: "That invoice's client no longer exists." };

  const prior = (priorData ?? []) as {
    months_accrued: number | null;
    basis: string;
  }[];
  const quote = quoteLateFee({
    policy: normalizeLateFeePolicy({
      flatCents: client.late_fee_flat_cents,
      bpsPerMonth: client.late_fee_bps_per_month,
      graceDays: client.late_fee_grace_days ?? 0,
    }),
    balanceDueCents:
      (totalsData as { balance_due_cents: number } | null)?.balance_due_cents ?? 0,
    dueOn: source.due_on,
    today: toCalendarDate(new Date()),
    monthsAlreadyBilled: prior.reduce(
      (sum, row) => sum + (row.months_accrued ?? 0),
      0
    ),
    anyFeeAlreadyRaised: prior.length > 0,
    flatFeeAlreadyRaised: prior.some((row) => row.basis === "flat"),
  });

  if (!quote) {
    return {
      error: `Nothing to charge. Either you haven't agreed a late fee with ${client.name}, the grace period hasn't passed, the balance is settled, or this period's fee has already been raised.`,
    };
  }

  // The fee invoice. tax_rate_bps 0 and a non-taxable line: a late fee is a
  // charge for the delay, not a service rendered, and states differ on whether
  // it is taxable at all. Zero is the assumption a pilot can correct on the
  // draft in front of them; a guessed tax on a fee invoice is a number they
  // would have to notice to fix.
  const invoicePayload: InvoiceInsert = {
    account_id: account.id,
    client_id: source.client_id,
    tax_rate_bps: 0,
    notes: `Late fee relating to ${
      source.invoice_number ? `Invoice ${source.invoice_number}` : "an earlier invoice"
    }, as agreed.`,
  };
  const { data: created, error: createError } = await supabase
    .from("invoices")
    .insert(invoicePayload as never)
    .select("id")
    .single();

  if (createError) {
    return { error: friendlyDbError(createError, "invoices.insert") };
  }
  const feeInvoiceId = (created as { id: string }).id;

  const linePayload: LineInsert = {
    account_id: account.id,
    invoice_id: feeInvoiceId,
    // 'other', not a new 'late_fee' line_type — see migration section 5 for
    // why widening the vocabulary needs a seeded chart account first, and why
    // pilot.invoice_late_fees is what identifies this as a fee regardless.
    line_type: "other",
    description: lateFeeLineDescription(
      quote,
      source.invoice_number,
      source.due_on
    ),
    quantity: 1,
    unit_amount_cents: quote.amountCents,
    taxable: false,
    sort_order: 0,
  };
  const { error: lineError } = await supabase
    .from("invoice_lines")
    .insert(linePayload as never);

  if (lineError) {
    await abandonDraft(supabase, account.id, feeInvoiceId);
    return { error: friendlyDbError(lineError, "invoice_lines.insert") };
  }

  // THE IDEMPOTENCY ROW, and the reason it is written LAST: it needs the fee
  // invoice's id, which does not exist until the insert above. The app already
  // checked (the quote returns null when this period is billed) — this is the
  // constraint catching the race that check cannot: two tabs, or a
  // double-click, both reading "not yet billed" before either wrote.
  const feePayload: LateFeeInsert = {
    account_id: account.id,
    source_invoice_id: sourceInvoiceId,
    fee_invoice_id: feeInvoiceId,
    period_start: quote.periodStart,
    amount_cents: quote.amountCents,
    basis: quote.basis,
    basis_bps: quote.basisBps,
    months_accrued: quote.monthsAccrued,
  };
  const { error: feeError } = await supabase
    .from("invoice_late_fees")
    .insert(feePayload as never);

  if (feeError) {
    // The draft is withdrawn rather than left behind: a fee invoice with no
    // record of what it was for is exactly the unexplained bill this table
    // exists to prevent, and it is still a draft, so nothing has been sent.
    await abandonDraft(supabase, account.id, feeInvoiceId);
    return {
      error:
        feeError.code === "23505"
          ? quote.basis === "flat"
            ? "A late fee for this invoice has already been raised, and a flat fee is charged once, so nothing was created. Reload to see it."
            : "A late fee for this invoice has already been raised for this month, so nothing was created. Reload to see it."
          : `${friendlyDbError(feeError, "invoice_late_fees.insert")} The draft fee invoice was withdrawn.`,
    };
  }

  revalidatePath(`/invoices/${sourceInvoiceId}`);
  revalidatePath("/invoices");
  revalidatePath(DASHBOARD_PATH);
  // Straight to the draft, because the whole point is that a human reads it
  // before anyone else does.
  redirect(`/invoices/${feeInvoiceId}`);
}

/**
 * Voids a draft this action created and could not finish. draft -> void is a
 * legal transition (invoices_protect_issued's own table), and a void draft
 * never had a number, so nothing is burned.
 */
async function abandonDraft(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  invoiceId: string
): Promise<void> {
  const { error } = await supabase
    .from("invoices")
    .update({ status: "void" } satisfies InvoiceUpdate as never)
    .eq("id", invoiceId)
    .eq("account_id", accountId);
  if (error) {
    console.error(
      `[late-fee] could not withdraw draft ${invoiceId}: ${error.message}`
    );
  }
}

export type ReminderRunResult = {
  error: string | null;
  /** A sentence per line, for the panel to render. */
  lines?: string[];
};

/**
 * "RUN DUE REMINDERS NOW" — the same pass the scheduler runs, on demand.
 *
 * This exists so the feature works with no scheduler configured at all, which
 * is the floor 20260809030000 set for recurring invoices (a due queue the
 * pilot works through) and this keeps. It is also how a pilot verifies what
 * the scheduler WOULD do before trusting it with their clients.
 *
 * Runs under the pilot's OWN session client — RLS scopes it to their account
 * exactly as every other screen in the app is scoped. The privileged client
 * is only ever used by the cron route, which has no session to use instead.
 */
export async function runDueRemindersNow(): Promise<ReminderRunResult> {
  const { account, user } = await requireAccount("/settings");
  const supabase = await createClient();

  const summary = await runDueRemindersForAccount(supabase, account.id, {
    // The pilot's own verified address, so a client's reply reaches them and
    // not the software vendor — see sendInvoiceEmail's replyTo comment.
    replyTo: user.email,
  });

  revalidatePath("/settings");
  revalidatePath("/invoices");
  revalidatePath(DASHBOARD_PATH);

  return { error: null, lines: describeRun(summary) };
}

/**
 * The run, in sentences.
 *
 * Reports what happened and what did NOT — a pass that sent nothing because
 * the mail service is unconfigured must say so, or the pilot reads "0 sent"
 * as "nothing was due" and finds out otherwise from a client.
 */
function describeRun(summary: ReminderRunSummary): string[] {
  const lines: string[] = [];
  if (summary.sent > 0) {
    lines.push(
      `${summary.sent} reminder${summary.sent === 1 ? "" : "s"} sent.`
    );
  }
  if (summary.failed > 0) {
    lines.push(
      `${summary.failed} couldn't be sent. Nothing reached your client and nothing was marked as sent. The invoice screen shows what the mail service said. Each one is tried again on the next few runs, so fixing the cause is usually all it takes.`
    );
  }
  if (summary.unknown > 0) {
    lines.push(
      `${summary.unknown} may or may not have gone out. The mail service stopped answering part way through, so we can't tell you either way. Check with your client before sending one of these by hand. They are not tried again, because a second copy of the same chase is worse than a missed one.`
    );
  }
  for (const blocked of summary.blocked) {
    lines.push(
      `${blocked.invoiceNumber ?? "An invoice"} for ${blocked.clientName}: ${blocked.reason}`
    );
  }
  for (const error of summary.errors) lines.push(error);
  // Notices are ordinary outcomes rather than faults, but they are the whole
  // answer when a pass stood down — and they must be said before the
  // "nothing was due" fallback below can be reached, because a stand-down
  // considers no invoices at all and "0 open invoices checked" would be a
  // false account of what the press did.
  for (const notice of summary.notices) lines.push(notice);
  if (lines.length === 0) {
    lines.push(
      `Nothing was due. ${summary.invoicesConsidered} open invoice${
        summary.invoicesConsidered === 1 ? "" : "s"
      } checked.`
    );
  }
  return lines;
}

/**
 * What a late fee would come to today, for the invoice screen to show BEFORE
 * the pilot agrees to raise one. Read-only: it writes nothing and creates
 * nothing.
 *
 * Exported as an action rather than computed in the page because the same
 * quote function has to produce both this number and the one that lands on
 * the invoice — two implementations of "what does the fee come to" is the
 * two-sources-for-one-number defect this schema's totals design exists to
 * avoid, one layer up.
 */
export async function quoteLateFeeForInvoice(
  sourceInvoiceId: string
): Promise<{ error: string | null; amountCents?: number; explanation?: string }> {
  if (!UUID_RE.test(sourceInvoiceId)) {
    return { error: "That invoice no longer exists." };
  }
  const { account } = await requireAccount(`/invoices/${sourceInvoiceId}`);
  const supabase = await createClient();

  const { data: invoiceData } = await supabase
    .from("invoices")
    .select("client_id, due_on, status")
    .eq("id", sourceInvoiceId)
    .eq("account_id", account.id)
    .maybeSingle();
  const source = invoiceData as {
    client_id: string;
    due_on: string | null;
    status: string;
  } | null;
  if (!source) return { error: "That invoice no longer exists." };

  const [{ data: clientData }, { data: totalsData }, { data: priorData }] =
    await Promise.all([
      supabase
        .from("clients")
        .select("late_fee_flat_cents, late_fee_bps_per_month, late_fee_grace_days")
        .eq("id", source.client_id)
        .eq("account_id", account.id)
        .maybeSingle(),
      supabase
        .from("invoice_totals")
        .select("balance_due_cents")
        .eq("invoice_id", sourceInvoiceId)
        .maybeSingle(),
      supabase
        .from("invoice_late_fees")
        // See createLateFeeInvoice: the quote needs to know a flat fee was
        // already raised, or the screen would offer a number the write refuses.
        .select("months_accrued, basis")
        .eq("account_id", account.id)
        .eq("source_invoice_id", sourceInvoiceId),
    ]);

  const client = clientData as {
    late_fee_flat_cents: number | null;
    late_fee_bps_per_month: number | null;
    late_fee_grace_days: number | null;
  } | null;
  const prior = (priorData ?? []) as {
    months_accrued: number | null;
    basis: string;
  }[];

  const quote = quoteLateFee({
    policy: normalizeLateFeePolicy({
      flatCents: client?.late_fee_flat_cents,
      bpsPerMonth: client?.late_fee_bps_per_month,
      graceDays: client?.late_fee_grace_days ?? 0,
    }),
    balanceDueCents:
      (totalsData as { balance_due_cents: number } | null)?.balance_due_cents ?? 0,
    dueOn: source.due_on,
    today: toCalendarDate(new Date()),
    monthsAlreadyBilled: prior.reduce(
      (sum, row) => sum + (row.months_accrued ?? 0),
      0
    ),
    anyFeeAlreadyRaised: prior.length > 0,
    flatFeeAlreadyRaised: prior.some((row) => row.basis === "flat"),
  });

  if (!quote) return { error: null };
  return {
    error: null,
    amountCents: quote.amountCents,
    explanation: `${formatCents(quote.amountCents)}: ${quote.explanation}`,
  };
}
