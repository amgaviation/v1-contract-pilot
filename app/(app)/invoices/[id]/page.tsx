import { notFound } from "next/navigation";
import { Badge, Callout, Card, Flex, Grid, Separator, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { isLiveMode } from "@/lib/stripe/server";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { emailIsConfigured } from "@/lib/email/send";
import PageShell from "../../page-shell";
import HeaderForm, { type ClientOption } from "./header-form";
import LinesEditor, { type LineRow, type RebillableExpense } from "./lines-editor";
import PdfDownload from "./pdf-download";
import StatusActions from "./status-actions";
import PaymentPanel, { type ConnectNoticeRow, type PaymentRow } from "./payment-panel";
import SharePanel, { type ShareRow } from "./share-panel";

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
    // contact_email rides along for StatusActions: whether "email it to the
    // client" can be offered depends on the client having an address on file,
    // which is one of the two halves a send needs. (The other is the mail
    // service being configured, which is an environment question only the
    // server can answer — see emailIsConfigured() below.)
    supabase
      .from("clients")
      .select("id, name, contact_email")
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
    // Stripe payments for this invoice that the Connect webhook deliberately
    // did NOT record (20260813100000). Almost always zero rows.
    //
    // BOTH OUTCOMES, not just 'needs_review'. They differ in why the money
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
      .select("id, connected_account_id, detail")
      .eq("invoice_id", id)
      .in("outcome", ["needs_review", "refused"])
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
  })[];
  const share = (shareData ?? null) as ShareRow;
  const connectNotices = (connectNoticeData ?? []) as ConnectNoticeRow[];

  // The client this invoice actually bills, for the send controls. Read off
  // the list already fetched rather than issuing a sixth query.
  const billedClient = clients.find((c) => c.id === invoice.client_id) ?? null;

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
  if (draft) {
    const [
      { data: clientTrips, error: clientTripsError },
      { data: usedLines, error: usedLinesError },
    ] = await Promise.all([
      supabase.from("trips").select("id").eq("client_id", invoice.client_id),
      supabase.from("invoice_lines").select("expense_id").not("expense_id", "is", null),
    ]);
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
                  expenses couldn&rsquo;t be loaded for this client — nothing is
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
            clientEmail={billedClient?.contact_email ?? null}
            clientName={billedClient?.name ?? "this client"}
            receiptCount={receiptCount}
          />
          {/* Matches pilot.invoice_share_create's own status gate
              (sent/partial/paid only) — never offered on a draft, so the
              button is never shown where the database would refuse it. */}
          {!draft ? <SharePanel invoiceId={invoice.id} share={share} /> : null}
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
