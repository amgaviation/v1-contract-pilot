import { notFound } from "next/navigation";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import Divider from "@mui/material/Divider";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDBadge from "@/components/mdpro/MDBadge";
import MDButton from "@/components/mdpro/MDButton";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import HeaderForm, { type ClientOption } from "./header-form";
import LinesEditor, { type LineRow, type RebillableExpense } from "./lines-editor";
import StatusActions from "./status-actions";
import PaymentPanel, { type PaymentRow } from "./payment-panel";

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
};

type TotalsRow = {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  last_paid_on: string | null;
  balance_due_cents: number;
};

type Badge = { tone: string; label: string };
const STATUS_FALLBACK: Badge = { tone: "secondary", label: "Draft" };
const STATUS_BADGE: Record<string, Badge> = {
  draft: STATUS_FALLBACK,
  sent: { tone: "info", label: "Sent" },
  partial: { tone: "warning", label: "Partially paid" },
  paid: { tone: "success", label: "Paid" },
  void: { tone: "dark", label: "Void" },
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ warning?: string }>;
}) {
  const { id } = await params;
  const { warning } = await searchParams;
  await requireAccount(`/invoices/${id}`);

  const supabase = await createClient();

  const [
    { data: invoiceData, error: invoiceError },
    { data: lineData, error: lineError },
    { data: paymentData, error: paymentError },
    { data: totalsData, error: totalsError },
    { data: overdueData, error: overdueError },
    { data: clientData, error: clientError },
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

  // A failed totals/payments/overdue/clients query is not "no data" — a
  // sent, unpaid invoice must not render as a healthy $0.00 balance in
  // normal styling just because the view read failed transiently.
  const moneyError = totalsError ?? paymentError ?? overdueError ?? clientError;

  const draft = invoice.status === "draft";

  // Rebillable expenses this client's trips carry, not already attached to
  // ANY invoice — pilot.invoice_lines' unique(account_id, expense_id)
  // guarantees a rebilled expense is on at most one invoice, so the
  // set already used on THIS draft is enough to exclude, but excluding
  // every already-referenced expense_id is the correct global check.
  let rebillable: RebillableExpense[] = [];
  if (draft) {
    const [{ data: clientTrips }, { data: usedLines }] = await Promise.all([
      supabase.from("trips").select("id").eq("client_id", invoice.client_id),
      supabase.from("invoice_lines").select("expense_id").not("expense_id", "is", null),
    ]);
    const tripIds = ((clientTrips ?? []) as { id: string }[]).map((t) => t.id);
    const usedExpenseIds = new Set(
      ((usedLines ?? []) as { expense_id: string | null }[]).map((l) => l.expense_id)
    );
    if (tripIds.length > 0) {
      const { data: expenseData } = await supabase
        .from("expenses")
        .select("id, trip_id, category, vendor, amount_cents, incurred_on")
        .eq("treatment", "rebill")
        .in("trip_id", tripIds);
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
        <MDBox display="flex" alignItems="center" gap={1} mt={0.5}>
          <MDBadge
            variant="gradient"
            color={badge.tone}
            badgeContent={badge.label}
            size="sm"
            container
          />
          <MDTypography variant="button" color={overdue ? "error" : "text"} fontWeight="regular">
            {invoice.issued_on ? `Issued ${formatDate(invoice.issued_on)}` : "Not yet issued"}
            {invoice.due_on ? ` · Due ${formatDate(invoice.due_on)}${overdue ? " (overdue)" : ""}` : ""}
          </MDTypography>
        </MDBox>
      }
      action={
        invoice.status !== "draft" ? (
          <MDButton
            component="a"
            href={`/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            variant="outlined"
            color="info"
          >
            Download PDF
          </MDButton>
        ) : undefined
      }
    >
      {warning ? (
        <MDBox mb={3}>
          <Card>
            <MDBox p={2}>
              <MDTypography variant="button" color="warning" fontWeight="regular">
                {warning}
              </MDTypography>
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      {moneyError ? (
        <MDBox mb={3}>
          <Card>
            <MDBox p={2}>
              <MDTypography variant="button" color="error">
                {friendlyDbError(moneyError, "invoices.detail")}
              </MDTypography>
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={7}>
          <MDBox mb={3}>
            <HeaderForm invoice={invoice} clients={clients} locked={!draft} />
          </MDBox>

          <Card>
            <MDBox p={3}>
              <MDTypography variant="h6" mb={2}>
                Lines
              </MDTypography>
              <LinesEditor
                invoiceId={invoice.id}
                lines={lines}
                editable={draft}
                rebillable={rebillable}
              />

              <Divider sx={{ my: 2 }} />

              {totalsError ? (
                <MDTypography variant="button" color="error">
                  {friendlyDbError(totalsError, "invoice_totals.select")}
                </MDTypography>
              ) : (
                <MDBox display="flex" flexDirection="column" gap={0.5} alignItems="flex-end">
                  <TotalsLine label="Subtotal" value={totals?.subtotal_cents ?? 0} />
                  <TotalsLine label="Tax" value={totals?.tax_cents ?? 0} />
                  <TotalsLine label="Total" value={totals?.total_cents ?? 0} emphasize />
                  <TotalsLine label="Paid" value={totals?.amount_paid_cents ?? 0} />
                  <TotalsLine
                    label="Balance due"
                    value={totals?.balance_due_cents ?? 0}
                    emphasize
                  />
                </MDBox>
              )}
            </MDBox>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <MDBox mb={3}>
            <StatusActions invoice={invoice} hasLines={lines.length > 0} />
          </MDBox>
          <PaymentPanel
            invoiceId={invoice.id}
            status={invoice.status}
            payments={payments}
          />
        </Grid>
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
    <MDBox display="flex" gap={2} minWidth={220} justifyContent="space-between">
      <MDTypography
        variant="button"
        color="text"
        fontWeight={emphasize ? "bold" : "regular"}
      >
        {label}
      </MDTypography>
      <MDTypography variant="button" fontWeight={emphasize ? "bold" : "regular"}>
        {formatCents(value)}
      </MDTypography>
    </MDBox>
  );
}
