import { notFound } from "next/navigation";
import { Badge, Callout, Card, Flex, Grid, Separator, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { isLiveMode } from "@/lib/stripe/server";
import { formatCents, formatDate } from "@/lib/format";
import { YOU_INVOICE_COLUMN } from "@/lib/counterparty";
import { friendlyDbError } from "@/lib/db-errors";
import { emailIsConfigured, looksLikeEmail } from "@/lib/email/send";
import { loadPreferences } from "@/lib/preferences";
import { loadOptionLabels } from "@/lib/custom-options-read";
import PageShell from "../../page-shell";
import HeaderForm, { type ClientOption } from "./header-form";
import LinesEditor, { type LineRow, type RebillableExpense } from "./lines-editor";
import PdfDownload from "./pdf-download";
import StatusActions from "./status-actions";
import PaymentPanel, { type ConnectNoticeRow, type PaymentRow } from "./payment-panel";
import SharePanel, { type ShareRow } from "./share-panel";
import ReminderPanel, {
  type LateFeeView,
  type ReminderRungView,
} from "./reminder-panel";
import {
  consumedRungKeys,
  decideReminder,
  describeHold,
  describeLateFeePolicy,
  describeRung,
  lastPossibleSendAt,
  normalizeLateFeePolicy,
  normalizeReminderPolicy,
  quoteLateFee,
  reminderPolicyIsEmpty,
  rungsFor,
  summarizeRungLedger,
  toCalendarDate,
  MANUAL_RULE_KEY,
  type ReminderOutcome,
} from "@/lib/reminders/policy";

export const metadata = { title: "Invoice" };

type InvoiceRow = {
  id: string;
  client_id: string;
  invoice_number: string | null;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  issued_on: string | null;
  due_on: string | null;
  sent_at: string | null;
  tax_rate_bps: number;
  delivery_method: "platform_email" | "manual_download" | null;
  notes: string | null;
  stripe_payment_link_url: string | null;
  stripe_payment_link_livemode: boolean | null;
  stripe_payment_link_amount_cents: number | null;
  reminders_suppressed: boolean;
};

type TotalsRow = {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  last_paid_on: string | null;
  balance_due_cents: number;
};

type Badge = { color: "gray" | "blue" | "amber" | "green" | "red"; label: string };
const STATUS_FALLBACK: Badge = { color: "gray", label: "Draft" };
const STATUS_BADGE: Record<string, Badge> = {
  draft: STATUS_FALLBACK,
  sent: { color: "blue", label: "Sent" },
  partial: { color: "amber", label: "Partially paid" },
  paid: { color: "green", label: "Paid" },
  void: { color: "gray", label: "Void" },
};

// invoice PDF route is owned elsewhere; this screen only links to it.
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ warning?: string }>;
}) {
  const { id } = await params;
  const { warning } = await searchParams;
  const { account } = await requireAccount(`/invoices/${id}`);

  const supabase = await createClient();

  const [
    { data: invoiceData, error: invoiceError },
    { data: lineData, error: lineError },
    { data: paymentData, error: paymentError },
    { data: totalsData, error: totalsError },
    { data: overdueData, error: overdueError },
    { data: clientData, error: clientError },
    { data: shareData },
    { data: connectNoticeData },
  ] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", id)
      .order("paid_on", { ascending: false }),
    supabase.from("invoice_totals").select("*").eq("invoice_id", id).maybeSingle(),
    supabase.from("invoices_overdue").select("invoice_id").eq("invoice_id", id),
    // Not filtered to active-only: an issued invoice may bill a client
    // that has since been archived, and the picker still needs to show it.
    // contact_email/billing_email ride along for StatusActions: whether
    // "email it to the client" can be offered depends on the client having
    // an address on file, which is one of the two halves a send needs. (The
    // other is the mail service being configured, which is an environment
    // question only the server can answer — see emailIsConfigured() below.)
    // billing_email (20260814092000) is the address sendInvoiceEmail
    // actually prefers when it looks like a real one — this screen has to
    // resolve the SAME preference or "Goes to {email}" would name an
    // address the send does not use.
    // 20260815120000: this list backs the header form's client picker, so
    // it offers only counterparties the pilot bills. An invoice cannot
    // lose its own current selection this way, because a client with any
    // invoice is refused the flag in the first place
    // (pilot.clients_refuse_stop_invoicing()).
    supabase
      .from("clients")
      .select("id, name, contact_email, billing_email")
      .eq(YOU_INVOICE_COLUMN, true)
      .order("name", { ascending: true }),
    // A share row is best-effort read: its own error is not folded into
    // moneyError below, because a failed read here degrades to "no share
    // link shown yet" (the pilot can just try Share again), never to a
    // wrong dollar figure — a materially different failure mode than the
    // totals/payments/overdue/clients reads this screen already treats as
    // hard errors.
    supabase
      .from("invoice_shares")
      .select("token, revoked_at, first_viewed_at, last_viewed_at")
      .eq("invoice_id", id)
      .maybeSingle(),
    // What the Connect webhook saw for this invoice and did NOT turn into a
    // payment row (20260813100000, 20260813120000). Almost always zero rows.
    //
    // FOUR OUTCOMES, and `outcome` is SELECTED as well as filtered on,
    // because the panel renders two of them differently: 'payment_pending'
    // is a bank debit on its way — information, in blue, with nothing for
    // the pilot to do — while the other three are amber and want a human.
    // Selecting the column is what lets the panel tell them apart; without
    // it, "your client's money lands Thursday" would render as a warning
    // beside "a client paid a voided invoice, refund them", and a pilot who
    // learns that warnings here are routine will miss the one that is not.
    //
    // BOTH OF THE ORIGINAL OUTCOMES, not just 'needs_review'. They differ in why the money
    // was not recorded — 'needs_review' means it looked like money already
    // entered by hand, 'refused' means the invoice or the session could not
    // take it (a client paying a link that outlived a voided invoice; a
    // session that settled in another currency) — and they do not differ at
    // all in what the pilot must do: look, and decide. Querying
    // 'needs_review' alone meant the handler's most urgent sentence, "the
    // client paid $4,500 through a link that should have been deactivated —
    // check Stripe and refund them", was written to a reader who did not
    // exist: it reached the events ledger and the platform's server log,
    // neither of which a pilot has ever seen.
    //
    // A 'refused' row that could not be tied to one of THIS tenant's
    // invoices has a null invoice_id and so cannot match here — a forged
    // link naming a stranger's invoice never appears on anyone's screen.
    //
    // Best-effort, like the share read above and for the same reason: this
    // is a prompt, not a figure. A failed read hides a warning the pilot can
    // still reach from their Stripe dashboard, whereas folding it into
    // moneyError would blank the totals on this screen over a notice. RLS
    // scopes it to this tenant; rows the webhook could not attribute to any
    // account carry a null account_id and are visible to nobody.
    supabase
      .from("stripe_connect_events")
      .select("id, connected_account_id, detail, outcome")
      .eq("invoice_id", id)
      .in("outcome", ["needs_review", "refused", "payment_pending", "payment_failed"])
      .is("reviewed_at", null)
      .order("stripe_created_at", { ascending: false }),
  ]);

  // A failed QUERY is not a missing invoice — see trips/[id]/page.tsx for
  // the same reasoning: a 503 must not read as "you lost an invoice."
  if (invoiceError) {
    throw new Error(`Couldn't load invoice ${id}: ${invoiceError.message}`);
  }
  if (lineError) {
    throw new Error(`Couldn't load invoice ${id}'s lines: ${lineError.message}`);
  }

  const invoice = invoiceData as InvoiceRow | null;
  // Another tenant's id and a nonexistent one both return no row under
  // RLS, so a probe can't tell them apart.
  if (!invoice) notFound();

  const lines = (lineData ?? []) as LineRow[];
  const payments = (paymentData ?? []) as PaymentRow[];
  const totals = totalsData as TotalsRow | null;
  const overdue = ((overdueData ?? []) as { invoice_id: string }[]).length > 0;
  const clients = (clientData ?? []) as (ClientOption & {
    contact_email: string | null;
    billing_email: string | null;
  })[];
  const share = (shareData ?? null) as ShareRow;
  const connectNotices = (connectNoticeData ?? []) as ConnectNoticeRow[];

  // The account's default for what a new payment link offers. Total over
  // the stored blob (lib/preferences.ts), so an account that has never
  // touched the control — every account, until today — gets the product's
  // own default rather than an empty control.
  const preferences = await loadPreferences(account.id);

  // The client this invoice actually bills, for the send controls. Read off
  // the list already fetched rather than issuing a sixth query.
  const billedClient = clients.find((c) => c.id === invoice.client_id) ?? null;

  // THE SAME PREFERENCE sendInvoiceEmail resolves (lib/email/send-invoice.ts):
  // billing_email when it looks like a real address, contact_email
  // otherwise. Computed once here so StatusActions' "Goes to {email}" and
  // ReminderPanel's "has no email on file" can never name or gate on an
  // address the actual send does not use.
  const billedClientEmail = looksLikeEmail(billedClient?.billing_email)
    ? (billedClient?.billing_email as string)
    : (billedClient?.contact_email ?? null);

  // A failed totals/payments/overdue/clients query is not "no data" — a
  // sent, unpaid invoice must not render as a healthy $0.00 balance in
  // normal styling just because the view read failed transiently.
  const moneyError = totalsError ?? paymentError ?? overdueError ?? clientError;

  // invoices_protect_issued only lets a draft's client/dates/tax/lines
  // change — every branch below keys off this same flag so the screen
  // never offers a control the database would refuse.
  const draft = invoice.status === "draft";

  // Rebillable expenses this client's trips carry, not already attached to
  // ANY invoice — pilot.invoice_lines' unique(account_id, expense_id)
  // guarantees a rebilled expense is on at most one invoice, so the
  // set already used on THIS draft is enough to exclude, but excluding
  // every already-referenced expense_id is the correct global check.
  let rebillable: RebillableExpense[] = [];
  // Unlike moneyError above, a failed read here does not display a wrong
  // figure — it silently offers nothing to attach, and once
  // invoices_protect_issued locks this document the receipts the pilot
  // meant to rebill are never billed at all. That has to be disclosed,
  // not just degraded to an empty list.
  let rebillableError: { code?: string | null; message?: string | null } | null = null;
  // The tenant's own expense-category vocabulary — same source
  // createInvoiceDraft/addRebillExpenseLine now write onto the line itself
  // (app/(app)/invoices/actions.ts), so the picker below offers the same
  // label the line will actually be saved with rather than the retired
  // eight-entry fallback.
  let categoryLabels: Record<string, string> = {};
  if (draft) {
    const [
      { data: clientTrips, error: clientTripsError },
      { data: usedLines, error: usedLinesError },
      resolvedCategoryLabels,
    ] = await Promise.all([
      supabase.from("trips").select("id").eq("client_id", invoice.client_id),
      supabase.from("invoice_lines").select("expense_id").not("expense_id", "is", null),
      loadOptionLabels("expense_category"),
    ]);
    categoryLabels = resolvedCategoryLabels;
    rebillableError = clientTripsError ?? usedLinesError;
    const tripIds = ((clientTrips ?? []) as { id: string }[]).map((t) => t.id);
    const usedExpenseIds = new Set(
      ((usedLines ?? []) as { expense_id: string | null }[]).map((l) => l.expense_id)
    );
    if (!rebillableError && tripIds.length > 0) {
      const { data: expenseData, error: expenseError } = await supabase
        .from("expenses")
        .select("id, trip_id, category, vendor, amount_cents, incurred_on")
        .eq("treatment", "rebill")
        .in("trip_id", tripIds);
      rebillableError = expenseError;
      rebillable = ((expenseData ?? []) as RebillableExpense[]).filter(
        (e) => !usedExpenseIds.has(e.id)
      );
    }
  }

  // How many of this invoice's rebill lines have a receipt ON FILE — what
  // the PDF's receipt pages (lib/invoice-document.tsx) will actually
  // attach, driving both toggles (download button + send dialog). Read
  // best-effort like the share row above: a failed read degrades to
  // count 0, which HIDES the toggles while the document itself still
  // defaults receipts on — the surfaces disagree with each other for one
  // transient render, never with what gets billed, and never a wrong
  // dollar figure.
  const rebillExpenseIds = lines
    .map((line) => line.expense_id)
    .filter((expenseId): expenseId is string => expenseId !== null);
  let receiptCount = 0;
  if (rebillExpenseIds.length > 0) {
    const { data: receiptRows } = await supabase
      .from("expenses")
      .select("id")
      .in("id", rebillExpenseIds)
      .not("receipt_path", "is", null);
    receiptCount = ((receiptRows ?? []) as { id: string }[]).length;
  }

  // WHICH OPENING LINE THIS SEND WILL ACTUALLY USE — enough of it for the
  // send dialog to stop promising the wrong one. The dialog used to say
  // "your saved wording" unconditionally, which is a claim about something
  // that does not exist for an account that never opened Settings, and one
  // that a saved template can silently break: applyTemplate declines a
  // template naming {{due_date}} on an invoice that has none, and the
  // built-in copy goes out instead with nothing to say so.
  //
  // Only the two facts the dialog's copy branches on are passed down, NOT
  // the template text and NOT a re-resolution of the message: emailInvoice
  // resolves the real thing at send time (deliberately — see its comment
  // about a template edited in another tab), and a second resolver here
  // would be free to drift from it. A boolean cannot drift; it can only be
  // stale by the width of one page load, which is what the dialog's own
  // "unless" wording already allows for.
  //
  // loadPreferences is total — a missing row (the ordinary state) and a
  // failed read both resolve to no template, i.e. the built-in wording,
  // which is the same thing the send path falls back to. So the worst case
  // is that the dialog under-promises, never that it over-promises.
  const hasInvoiceTemplate =
    (await loadPreferences(account.id)).templates.invoice !== null;

  // ---------------------------------------------------------------------
  // THE REMINDER LADDER AND THE AGREED LATE FEE, both computed here from the
  // SAME pure functions the scheduled run uses (lib/reminders/policy.ts).
  //
  // Derived at render, stored nowhere — the rule this schema has held since
  // Phase 5 refused to store an "overdue" flag. What IS stored is only what
  // actually happened: the rows in pilot.invoice_reminder_sends.
  //
  // Only for an invoice the run itself would act on. A draft is not chased, a
  // paid one is settled and a void one is not owed, so showing a ladder for
  // any of them would describe something that cannot happen.
  // ---------------------------------------------------------------------
  const chaseable = invoice.status === "sent" || invoice.status === "partial";
  let reminderView: {
    scheduleIsEmpty: boolean;
    rungs: ReminderRungView[];
    nextUp: string | null;
    hold: string | null;
    lateFee: LateFeeView;
    manualSends: string[];
  } | null = null;

  if (chaseable) {
    const [
      { data: policyData },
      { data: sendData },
      { data: feeData },
    ] = await Promise.all([
      supabase
        .from("clients")
        .select(
          "reminder_before_due, reminder_on_due, reminder_after_due, late_fee_flat_cents, late_fee_bps_per_month, late_fee_grace_days, archived_at"
        )
        .eq("id", invoice.client_id)
        .eq("account_id", account.id)
        .maybeSingle(),
      supabase
        .from("invoice_reminder_sends")
        .select("rule_key, outcome, detail, created_at")
        .eq("account_id", account.id)
        .eq("invoice_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("invoice_late_fees")
        // `basis` rides along for the quote: a flat fee already raised blocks
        // a later rate fee outright (quoteLateFee's header says why).
        .select("id, fee_invoice_id, amount_cents, basis, months_accrued, created_at")
        .eq("account_id", account.id)
        .eq("source_invoice_id", id)
        .order("created_at", { ascending: false }),
    ]);

    const policyRow = policyData as {
      reminder_before_due: number[] | null;
      reminder_on_due: boolean | null;
      reminder_after_due: number[] | null;
      late_fee_flat_cents: number | null;
      late_fee_bps_per_month: number | null;
      late_fee_grace_days: number | null;
      archived_at: string | null;
    } | null;

    // runDueRemindersForAccount (lib/reminders/run.ts) scopes its whole pass
    // to `.is("archived_at", null)` — an archived client's open invoices are
    // silently out of scope for the run, no send, no hold, no blocked entry.
    // decideReminder below has no idea archival exists, so left alone it
    // would render this panel's ladder and "Next: …" exactly as if the run
    // were going to act on it. Overridden below so the screen and the
    // scheduler cannot disagree about whether anything is actually coming.
    const clientArchived = policyRow?.archived_at != null;

    const policy = normalizeReminderPolicy({
      beforeDue: policyRow?.reminder_before_due,
      onDue: policyRow?.reminder_on_due,
      afterDue: policyRow?.reminder_after_due,
    });

    const sends = (sendData ?? []) as {
      rule_key: string;
      outcome: ReminderOutcome;
      detail: string | null;
      created_at: string;
    }[];
    // NEWEST ROW WINS, and a rung can now have more than one. A definite
    // failure leaves the rung available, so a rung that failed on Tuesday and
    // sent on Wednesday has two rows, and the one worth showing is the one
    // that says how it ended. `sends` is ordered created_at descending, and a
    // Map keeps the LAST value written for a key, so the list is walked in
    // reverse to leave the newest in place.
    const byRule = new Map(
      sends
        .filter((row) => row.rule_key !== MANUAL_RULE_KEY)
        .slice()
        .reverse()
        .map((row) => [row.rule_key, row])
    );
    // What is spent and what is still owed, decided by the same function the
    // scheduled run uses. A rung with nothing but definite failures against it,
    // and attempts still left, is NOT consumed: it is coming back tonight.
    const rungStates = summarizeRungLedger(sends);

    const today = toCalendarDate(new Date());
    const decision = decideReminder({
      policy,
      dueOn: invoice.due_on,
      today,
      consumed: consumedRungKeys(sends),
      // A reminder that may have reached the client starts a quiet period; one
      // that definitely did not reached nobody, and a skipped rung reached
      // nobody either. Same function the run itself calls
      // (lib/reminders/run.ts), so this screen and the scheduler cannot
      // disagree about why nothing is going out.
      lastReminderAt: lastPossibleSendAt(sends),
      // Same quiet period as a reminder itself — see ReminderInput.sentAt's
      // comment. Without this the panel would promise a before-due rung the
      // scheduler is actually holding, on every invoice sent the same day
      // (or within QUIET_PERIOD_DAYS) as its own before-due ladder starts.
      sentAt: invoice.sent_at,
      // A REVOKED LINK'S STAMPS DESCRIBE A PAGE THE CLIENT CAN NO LONGER OPEN,
      // so they are no information — the same rule the run applies, and it has
      // to be the same one or this panel's premise fails in the direction that
      // costs something: the screen would say "the client opened the link in
      // the last couple of days, so the next reminder waits" while tonight's
      // pass, reading a revoked share as never viewed, sends it. Being told
      // nothing would go out and then having mail reach a client is the one
      // disagreement worth guarding against.
      lastViewedAt: share && !share.revoked_at ? share.last_viewed_at : null,
      suppressed: invoice.reminders_suppressed === true,
    });

    const rungs: ReminderRungView[] = rungsFor(policy, invoice.due_on).map((rung) => {
      const row = byRule.get(rung.key);
      const state = rungStates.get(rung.key);
      return {
        key: rung.key,
        label: describeRung(rung),
        when: formatDate(rung.onDate),
        // A FAILURE READS DIFFERENTLY DEPENDING ON WHETHER IT IS OVER. While
        // attempts remain the honest label is "will retry", because that is
        // what is going to happen; once they are used up it is "failed" and
        // this rung is finished. 'unknown' is neither: nothing more will be
        // attempted and nobody can say whether the client has it.
        state: !row
          ? "upcoming"
          : row.outcome === "failed" && !state?.consumed
            ? "retrying"
            : row.outcome,
        detail: row?.detail ?? null,
        at: row ? formatDate(row.created_at) : null,
        attempts: state && state.failures > 0 ? state.failures : null,
      };
    });

    // The next thing that will happen, said as a date rather than as a state.
    // A rung that is coming back for a retry is not "next": it is overdue and
    // the row above already says so, so only genuinely unspent rungs count.
    const consumedOrPending = new Set(
      rungsFor(policy, invoice.due_on)
        .map((rung) => rung.key)
        .filter((key) => rungStates.has(key))
    );
    const nextRung = rungsFor(policy, invoice.due_on).find(
      (rung) => !consumedOrPending.has(rung.key) && rung.onDate > today
    );

    const fees = (feeData ?? []) as {
      id: string;
      fee_invoice_id: string;
      amount_cents: number;
      basis: string;
      months_accrued: number | null;
      created_at: string;
    }[];
    let feeNumbers = new Map<string, string | null>();
    if (fees.length > 0) {
      const { data: feeInvoiceData } = await supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("account_id", account.id)
        .in(
          "id",
          fees.map((fee) => fee.fee_invoice_id)
        );
      feeNumbers = new Map(
        ((feeInvoiceData ?? []) as { id: string; invoice_number: string | null }[]).map(
          (row) => [row.id, row.invoice_number]
        )
      );
    }

    const lateFeePolicy = normalizeLateFeePolicy({
      flatCents: policyRow?.late_fee_flat_cents,
      bpsPerMonth: policyRow?.late_fee_bps_per_month,
      graceDays: policyRow?.late_fee_grace_days ?? 0,
    });
    const quote = quoteLateFee({
      policy: lateFeePolicy,
      balanceDueCents: totals?.balance_due_cents ?? 0,
      dueOn: invoice.due_on,
      today,
      monthsAlreadyBilled: fees.reduce(
        (sum, fee) => sum + (fee.months_accrued ?? 0),
        0
      ),
      anyFeeAlreadyRaised: fees.length > 0,
      flatFeeAlreadyRaised: fees.some((fee) => fee.basis === "flat"),
    });

    reminderView = {
      scheduleIsEmpty: reminderPolicyIsEmpty(policy),
      rungs,
      nextUp:
        !clientArchived && nextRung
          ? `Next: ${describeRung(nextRung).toLowerCase()}, on ${formatDate(nextRung.onDate)}.`
          : null,
      // A hold that is merely "nothing is due yet" is not worth a sentence —
      // the ladder above already shows that. Archival wins over that rule:
      // it is worth saying even when nothing would otherwise be due today,
      // because the ladder above is describing a chase that will not run.
      hold: clientArchived
        ? "This client is archived, so scheduled reminders don't run for them. Unarchive them to resume the ladder above."
        : decision.action === "hold" && decision.reason !== "nothing_due"
          ? describeHold(decision.reason)
          : null,
      lateFee: {
        policy: describeLateFeePolicy(lateFeePolicy),
        quote: quote ? `${formatCents(quote.amountCents)}: ${quote.explanation}` : null,
        raised: fees.map((fee) => ({
          id: fee.fee_invoice_id,
          number: feeNumbers.get(fee.fee_invoice_id) ?? null,
          amount: formatCents(fee.amount_cents),
          when: formatDate(fee.created_at),
        })),
      },
      manualSends: sends
        .filter((row) => row.rule_key === MANUAL_RULE_KEY && row.outcome === "sent")
        .slice(0, 3)
        .map((row) => formatDate(row.created_at)),
    };
  }

  const badge = STATUS_BADGE[invoice.status] ?? STATUS_FALLBACK;

  return (
    <PageShell
      title={invoice.invoice_number ?? "Draft invoice"}
      subtitle={
        <Flex align="center" gap="2" mt="1">
          <Badge color={badge.color}>{badge.label}</Badge>
          <Text color={overdue ? "red" : "gray"}>
            {invoice.issued_on ? `Issued ${formatDate(invoice.issued_on)}` : "Not yet issued"}
            {invoice.due_on ? ` · Due ${formatDate(invoice.due_on)}${overdue ? " (overdue)" : ""}` : ""}
          </Text>
        </Flex>
      }
      action={<PdfDownload invoiceId={invoice.id} draft={draft} receiptCount={receiptCount} />}
    >
      {warning ? (
        <Callout.Root color="amber" mb="4">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{warning}</Callout.Text>
        </Callout.Root>
      ) : null}

      {moneyError ? (
        <Callout.Root color="red" mb="4">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{friendlyDbError(moneyError, "invoices.detail")}</Callout.Text>
        </Callout.Root>
      ) : null}

      <Grid columns={{ initial: "1", lg: "12" }} gap="4">
        <Flex direction="column" gap="4" gridColumn={{ lg: "span 7" }}>
          <HeaderForm invoice={invoice} clients={clients} locked={!draft} />

          <Card size="3">
            <Text as="div" size="4" weight="bold" mb="3">
              Lines
            </Text>
            {rebillableError ? (
              <Callout.Root color="amber" mb="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  {friendlyDbError(rebillableError, "invoice.rebillable")} Rebillable
                  expenses couldn&rsquo;t be loaded for this client. Nothing is
                  offered to attach below. Reload before issuing this invoice, or
                  the receipts tagged rebill for it will go unbilled.
                </Callout.Text>
              </Callout.Root>
            ) : null}
            <LinesEditor
              invoiceId={invoice.id}
              lines={lines}
              editable={draft}
              rebillable={rebillable}
              categoryLabels={categoryLabels}
            />

            <Separator size="4" my="4" />

            {totalsError ? (
              <Text color="red">{friendlyDbError(totalsError, "invoice_totals.select")}</Text>
            ) : (
              <Flex direction="column" gap="1" align="end">
                <TotalsLine label="Subtotal" value={totals?.subtotal_cents ?? 0} />
                <TotalsLine label="Tax" value={totals?.tax_cents ?? 0} />
                <TotalsLine label="Total" value={totals?.total_cents ?? 0} emphasize />
                <TotalsLine label="Paid" value={totals?.amount_paid_cents ?? 0} />
                <TotalsLine
                  label="Balance due"
                  value={totals?.balance_due_cents ?? 0}
                  emphasize
                />
              </Flex>
            )}
          </Card>
        </Flex>

        <Flex direction="column" gap="4" gridColumn={{ lg: "span 5" }}>
          <StatusActions
            invoice={invoice}
            hasLines={lines.length > 0}
            canEmail={emailIsConfigured()}
            clientEmail={billedClientEmail}
            clientName={billedClient?.name ?? "this client"}
            receiptCount={receiptCount}
            hasInvoiceTemplate={hasInvoiceTemplate}
            // THE TWO FACTS THE RUN ITSELF CHECKS, kept apart rather than
            // and-ed into one boolean: "this client has no schedule" and "you
            // paused this invoice" are claims at different scopes, and
            // collapsing them made the screen tell a pilot that nothing goes
            // out automatically FOR THE CLIENT when they had merely paused one
            // disputed invoice — while every other invoice for that client
            // stayed on the ladder. See StatusActions' own prop comment.
            automaticChase={
              reminderView === null || reminderView.scheduleIsEmpty
                ? "none"
                : invoice.reminders_suppressed === true
                  ? "paused"
                  : "live"
            }
            hasDueDate={invoice.due_on !== null}
          />
          {reminderView ? (
            <ReminderPanel
              invoiceId={invoice.id}
              clientId={invoice.client_id}
              clientName={billedClient?.name ?? "this client"}
              suppressed={invoice.reminders_suppressed === true}
              scheduleIsEmpty={reminderView.scheduleIsEmpty}
              rungs={reminderView.rungs}
              nextUp={reminderView.nextUp}
              hold={reminderView.hold}
              canEmail={emailIsConfigured()}
              clientHasEmail={Boolean(billedClientEmail)}
              lateFee={reminderView.lateFee}
              manualSends={reminderView.manualSends}
            />
          ) : null}
          {/* Matches pilot.invoice_share_create's own status gate
              (sent/partial/paid only) — never offered on a draft, so the
              button is never shown where the database would refuse it. */}
          {!draft ? (
            // receiptCount is the SAME count StatusActions and the download
            // button take, and the same set pilot.invoice_share_receipts
            // resolves for this invoice's token — so what the panel tells
            // the pilot the link will show cannot drift from what it shows.
            <SharePanel
              invoiceId={invoice.id}
              share={share}
              receiptCount={receiptCount}
            />
          ) : null}
          <PaymentPanel
            invoiceId={invoice.id}
            status={invoice.status}
            payments={payments}
            paymentsLoadError={Boolean(paymentError)}
            connectAccountConnected={Boolean(account.connect_account_id)}
            // A payment link created in the other mode (e.g. a test link
            // left over from before the deployment went live-keyed) is
            // never surfaced as payable — same test/live separation the
            // platform webhook enforces via isLiveMode(), applied here to
            // display rather than to a write.
            existingPaymentLinkUrl={
              invoice.stripe_payment_link_url && invoice.stripe_payment_link_livemode === isLiveMode()
                ? invoice.stripe_payment_link_url
                : null
            }
            // What that link is priced at, so the panel can say so and can
            // flag a link that no longer matches the balance due. A link is
            // a snapshot of a Stripe Price; the app retires one whenever a
            // payment lands, but this is what makes a mismatch visible
            // rather than a thing the pilot finds out from their client.
            existingPaymentLinkAmountCents={
              invoice.stripe_payment_link_url && invoice.stripe_payment_link_livemode === isLiveMode()
                ? invoice.stripe_payment_link_amount_cents
                : null
            }
            balanceDueCents={totals?.balance_due_cents ?? null}
            connectNotices={connectNotices}
            defaultPaymentMethods={preferences.payments.methods}
          />
        </Flex>
      </Grid>
    </PageShell>
  );
}

function TotalsLine({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <Flex gap="4" minWidth="220px" justify="between">
      <Text color="gray" weight={emphasize ? "bold" : "regular"}>
        {label}
      </Text>
      <Text weight={emphasize ? "bold" : "regular"} className="tnum">
        {formatCents(value)}
      </Text>
    </Flex>
  );
}
