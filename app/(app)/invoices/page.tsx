import NextLink from "next/link";
import Card from "@mui/material/Card";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import MDBadge from "@/components/mdpro/MDBadge";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../page-shell";

export const metadata = { title: "Invoices" };

type InvoiceListRow = {
  id: string;
  client_id: string;
  invoice_number: string | null;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  issued_on: string | null;
  due_on: string | null;
};

type TotalsRow = {
  invoice_id: string;
  total_cents: number;
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

export default async function InvoicesPage() {
  await requireAccount("/invoices");

  const supabase = await createClient();
  // invoice_totals/invoices_overdue are the one source for money and
  // past-due-ness (pilot.invoice_totals' own comment: two sources for one
  // number is the exact defect class this schema exists to avoid) — read
  // straight from those views rather than summing invoice_lines here.
  const [
    { data: invoiceData, error },
    { data: totalsData, error: totalsError },
    { data: overdueData, error: overdueError },
    { data: clientData, error: clientError },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, client_id, invoice_number, status, issued_on, due_on")
      .order("created_at", { ascending: false }),
    supabase.from("invoice_totals").select("invoice_id, total_cents, balance_due_cents"),
    supabase.from("invoices_overdue").select("invoice_id"),
    supabase.from("clients").select("id, name"),
  ]);

  // A failed totals/overdue/clients query is not "no data" — rendering it
  // as $0.00 would make a sent, unpaid invoice look paid in normal styling.
  const firstError = error ?? totalsError ?? overdueError ?? clientError;

  const invoices = (invoiceData ?? []) as InvoiceListRow[];
  const totalsByInvoice = new Map(
    ((totalsData ?? []) as TotalsRow[]).map((t) => [t.invoice_id, t])
  );
  const overdueIds = new Set(
    ((overdueData ?? []) as { invoice_id: string }[]).map((o) => o.invoice_id)
  );
  // Resolved in memory rather than a PostgREST embed — same reason as
  // trips/page.tsx: the embed's return type resolves to `never` against
  // the hand-authored types file, and a pilot's client list is small.
  const clientNames = new Map(
    ((clientData ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );

  const overdueCount = overdueIds.size;

  return (
    <PageShell
      title="Invoices"
      subtitle={
        firstError
          ? "Some figures below couldn't load — see the notice."
          : `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}${
              overdueCount ? ` · ${overdueCount} past due` : ""
            }`
      }
      action={
        <MDButton
          component={NextLink}
          href="/invoices/new"
          variant="gradient"
          color="info"
        >
          New invoice
        </MDButton>
      }
    >
      <Card>
        <MDBox p={3}>
          {firstError ? (
            <MDTypography variant="button" color="error">
              {friendlyDbError(firstError, "invoices.select")}
            </MDTypography>
          ) : invoices.length === 0 ? (
            <MDBox py={4} textAlign="center">
              <MDTypography variant="h6">No invoices yet</MDTypography>
              <MDTypography variant="button" color="text" fontWeight="regular">
                Draft one from a client and the trips you've already flown
                for them — the flight days, travel days, and rebilled
                expenses fill themselves in.
              </MDTypography>
              <MDBox mt={3}>
                <MDButton
                  component={NextLink}
                  href="/invoices/new"
                  variant="gradient"
                  color="info"
                >
                  Draft your first invoice
                </MDButton>
              </MDBox>
            </MDBox>
          ) : (
            <TableContainer sx={{ boxShadow: "none" }}>
              <Table>
                <TableHead sx={{ display: "table-header-group" }}>
                  <TableRow>
                    {[
                      "Number",
                      "Client",
                      "Issued",
                      "Due",
                      "Status",
                      "Total",
                      "Balance due",
                    ].map((heading, index) => (
                      <TableCell
                        key={heading}
                        align={index >= 5 ? "right" : "left"}
                      >
                        <MDTypography
                          variant="caption"
                          fontWeight="bold"
                          textTransform="uppercase"
                        >
                          {heading}
                        </MDTypography>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {invoices.map((invoice) => {
                    const badge = STATUS_BADGE[invoice.status] ?? STATUS_FALLBACK;
                    const totals = totalsByInvoice.get(invoice.id);
                    const overdue = overdueIds.has(invoice.id);
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell component="th" scope="row">
                          <MDTypography
                            component={NextLink}
                            href={`/invoices/${invoice.id}`}
                            variant="button"
                            fontWeight="medium"
                          >
                            {invoice.invoice_number ?? "Draft"}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDTypography
                            variant="button"
                            color="text"
                            fontWeight="regular"
                          >
                            {clientNames.get(invoice.client_id) ?? "—"}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDTypography
                            variant="button"
                            color="text"
                            fontWeight="regular"
                          >
                            {formatDate(invoice.issued_on)}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDTypography
                            variant="button"
                            color={overdue ? "error" : "text"}
                            fontWeight={overdue ? "medium" : "regular"}
                          >
                            {formatDate(invoice.due_on)}
                            {overdue ? " · overdue" : ""}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDBadge
                            variant="gradient"
                            color={badge.tone}
                            badgeContent={badge.label}
                            size="sm"
                            container
                          />
                        </TableCell>
                        <TableCell align="right">
                          <MDTypography variant="button" fontWeight="medium">
                            {formatCents(totals?.total_cents ?? 0)}
                          </MDTypography>
                        </TableCell>
                        <TableCell align="right">
                          <MDTypography
                            variant="button"
                            fontWeight="medium"
                            color={
                              (totals?.balance_due_cents ?? 0) > 0
                                ? "warning"
                                : "text"
                            }
                          >
                            {formatCents(totals?.balance_due_cents ?? 0)}
                          </MDTypography>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </MDBox>
      </Card>
    </PageShell>
  );
}
