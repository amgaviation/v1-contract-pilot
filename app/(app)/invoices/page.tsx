import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Link as RadixLink,
  Table,
  Text,
} from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

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

type Badge = { color: "gray" | "blue" | "amber" | "green" | "red"; label: string };

const STATUS_FALLBACK: Badge = { color: "gray", label: "Draft" };
const STATUS_BADGE: Record<string, Badge> = {
  draft: STATUS_FALLBACK,
  sent: { color: "blue", label: "Sent" },
  partial: { color: "amber", label: "Partially paid" },
  paid: { color: "green", label: "Paid" },
  void: { color: "gray", label: "Void" },
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
        <Button asChild>
          <NextLink href="/invoices/new">New invoice</NextLink>
        </Button>
      }
    >
      <Card size="3">
        {firstError ? (
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{friendlyDbError(firstError, "invoices.select")}</Callout.Text>
          </Callout.Root>
        ) : invoices.length === 0 ? (
          <Flex direction="column" align="center" gap="3" py="6">
            <Text size="4" weight="bold">
              No invoices yet
            </Text>
            <Text size="2" color="gray" align="center">
              Draft one from a client and the trips you&rsquo;ve already flown
              for them — the flight days, travel days, and rebilled expenses
              fill themselves in.
            </Text>
            <Button asChild>
              <NextLink href="/invoices/new">Draft your first invoice</NextLink>
            </Button>
          </Flex>
        ) : (
          <Table.Root variant="ghost">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Number</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Issued</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Due</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Balance due</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {invoices.map((invoice) => {
                const badge = STATUS_BADGE[invoice.status] ?? STATUS_FALLBACK;
                const totals = totalsByInvoice.get(invoice.id);
                const overdue = overdueIds.has(invoice.id);
                return (
                  <Table.Row key={invoice.id}>
                    <Table.RowHeaderCell>
                      <RadixLink asChild weight="medium">
                        <NextLink href={`/invoices/${invoice.id}`}>
                          {invoice.invoice_number ?? "Draft"}
                        </NextLink>
                      </RadixLink>
                    </Table.RowHeaderCell>
                    <Table.Cell>
                      <Text color="gray">{clientNames.get(invoice.client_id) ?? "—"}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text color="gray">{formatDate(invoice.issued_on)}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text color={overdue ? "red" : "gray"} weight={overdue ? "medium" : "regular"}>
                        {formatDate(invoice.due_on)}
                        {overdue ? " · overdue" : ""}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {overdue ? (
                        <Badge color="red">Overdue</Badge>
                      ) : (
                        <Badge color={badge.color}>{badge.label}</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text weight="medium" className="tnum">
                        {formatCents(totals?.total_cents ?? 0)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text
                        weight="medium"
                        color={(totals?.balance_due_cents ?? 0) > 0 ? "amber" : "gray"}
                        className="tnum"
                      >
                        {formatCents(totals?.balance_due_cents ?? 0)}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </PageShell>
  );
}
