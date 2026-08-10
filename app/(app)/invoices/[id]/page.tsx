import { notFound } from "next/navigation";
import { Badge, Button, Callout, Card, Flex, Grid, Separator, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { isLiveMode } from "@/lib/stripe/server";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import HeaderForm, { type ClientOption } from "./header-form";
import LinesEditor, { type LineRow, type RebillableExpense } from "./lines-editor";
import StatusActions from "./status-actions";
import PaymentPanel, { type PaymentRow } from "./payment-panel";
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
    supabase.from("clients").select("id, name").order("name", { ascending: true }),
    // A share row is best-effort read: its own error is not folded into
    // moneyError below, because a failed read here degrades to "no share
    // link shown yet" (the pilot can just try Share again), never to a
    // wrong dollar figure — a materially different failure mode than the
    // totals/payments/overdue/clients reads this screen already treats as
    // hard errors.
    supabase.from("invoice_shares").select("token, revoked_at").eq("invoice_id", id).maybeSingle(),
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
  const clients = (clientData ?? []) as ClientOption[];
  const share = (shareData ?? null) as ShareRow;

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
      action={
        <Button asChild variant="outline">
          <a href={`/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer">
            {draft ? "Preview PDF" : "Download PDF"}
          </a>
        </Button>
      }
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
          <StatusActions invoice={invoice} hasLines={lines.length > 0} />
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
