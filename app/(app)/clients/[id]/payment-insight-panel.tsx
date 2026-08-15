import { Callout, Card, Flex, Table, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import { formatCents } from "@/lib/format";
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  assemblePaymentInsight,
  formatMedianDays,
  type InsightInvoice,
  type InsightOverdue,
  type InsightPaymentRow,
  type InsightTotals,
} from "./payment-insight";

/**
 * Payment behavior, from this client's own invoices and payments — see
 * payment-insight.ts's header for what is computed and the explicit
 * no-cross-tenant rule. A server component with its own reads (the
 * PacketPanel arrangement), so the client page's own query block stays
 * untouched for the agents editing it concurrently.
 */

// Same cap discipline as every list read in this app (see
// app/(app)/reports/sales-tax/queries.ts): 1000, detected by exact
// equality, never a larger number the server's own clamp would make
// unreachable.
const INSIGHT_LIMIT = 1000;

// The full-ledger read pages past the cap with .range() — a running sum
// over half a ledger MISPLACES an invoice's crossing date, so the ledger
// is either complete or the panel refuses (the sales-tax report's rule,
// same reasoning, smaller scope: one client).
const MAX_LEDGER_PAGES = 5;

function FailedState() {
  return (
    <Callout.Root color="red">
      <Callout.Icon>
        <ExclamationTriangleIcon />
      </Callout.Icon>
      <Callout.Text>
        Couldn&rsquo;t load this client&rsquo;s payment history. The figures
        are unavailable rather than zero. Try reloading the page.
      </Callout.Text>
    </Callout.Root>
  );
}

export default async function PaymentInsightPanel({
  accountId,
  clientId,
}: {
  accountId: string;
  clientId: string;
}) {
  const supabase = await createClient();

  const shell = (body: React.ReactNode) => (
    <Card>
      <Text as="div" size="4" weight="bold" mb="1">
        Payment behavior
      </Text>
      <Text as="div" size="2" color="gray" mb="3">
        How fast this client has paid, and how the current balance ages,
        from your own ledger. Computed from your records only; nothing
        here comes from, or is shared with, anyone else.
      </Text>
      {body}
    </Card>
  );

  // Issued invoices only: a draft was never sent, so it has no
  // payment-behavior story; a void is not owed and not history.
  //
  // Clientless invoices (20260815100000) are excluded by the same
  // `.eq("client_id", clientId)` that scopes this panel, and correctly so:
  // this measures how promptly THIS client pays, and an invoice billed to
  // typed details is not evidence about them.
  const invoicesResult = rowsOf<InsightInvoice>(
    await supabase
      .from("invoices")
      .select("id, status, issued_on")
      .eq("account_id", accountId)
      .eq("client_id", clientId)
      .in("status", ["sent", "partial", "paid"])
      .order("issued_on", { ascending: true })
      .order("id", { ascending: true })
      .limit(INSIGHT_LIMIT)
  );
  if (!invoicesResult.ok) return shell(<FailedState />);

  if (invoicesResult.rows.length === 0) {
    return shell(
      <Text size="2" color="gray">
        No issued invoices yet. Payment history appears once this client
        has been billed.
      </Text>
    );
  }
  if (invoicesResult.rows.length === INSIGHT_LIMIT) {
    // More invoices than one read returns: a median over an arbitrary
    // subset would be presented as this client's history while silently
    // ignoring part of it. Refuse, say so.
    return shell(
      <Callout.Root color="amber">
        <Callout.Icon>
          <ExclamationTriangleIcon />
        </Callout.Icon>
        <Callout.Text>
          This client has more invoices than this panel can read in one
          pass, so the figures aren&rsquo;t shown. A partial history would
          be presented as the whole one.
        </Callout.Text>
      </Callout.Root>
    );
  }

  const invoiceIds = invoicesResult.rows.map((i) => i.id);

  const [totalsResult, overdueResult] = await Promise.all([
    rowsOf<InsightTotals>(
      await supabase
        .from("invoice_totals")
        .select("invoice_id, total_cents, balance_due_cents")
        .eq("account_id", accountId)
        .in("invoice_id", invoiceIds)
        .limit(INSIGHT_LIMIT)
    ),
    rowsOf<InsightOverdue>(
      await supabase
        .from("invoices_overdue")
        .select("invoice_id, days_overdue")
        .eq("account_id", accountId)
        .in("invoice_id", invoiceIds)
        .limit(INSIGHT_LIMIT)
    ),
  ]);
  if (!totalsResult.ok || !overdueResult.ok) return shell(<FailedState />);

  // The FULL ledger of every invoice — every payment and correction on
  // any date — because the first-crossing date is a fact about the whole
  // ledger. Paged to completeness; a cap hit refuses.
  const ledger: InsightPaymentRow[] = [];
  {
    let offset = 0;
    for (;;) {
      if (offset >= INSIGHT_LIMIT * MAX_LEDGER_PAGES) {
        return shell(<FailedState />);
      }
      const page = rowsOf<InsightPaymentRow>(
        await supabase
          .from("invoice_payments")
          .select("id, invoice_id, paid_on, amount_cents")
          .eq("account_id", accountId)
          .in("invoice_id", invoiceIds)
          .order("paid_on", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + INSIGHT_LIMIT - 1)
      );
      if (!page.ok) return shell(<FailedState />);
      ledger.push(...page.rows);
      offset += page.rows.length;
      if (page.rows.length < INSIGHT_LIMIT) break;
    }
  }

  const assembly = assemblePaymentInsight({
    invoices: invoicesResult.rows,
    totals: totalsResult.rows,
    overdue: overdueResult.rows,
    payments: ledger,
  });
  if (!assembly.ok) return shell(<FailedState />);
  const insight = assembly.insight;

  return shell(
    <Flex direction="column" gap="3">
      <Flex gap="5" wrap="wrap">
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Median days to pay
          </Text>
          {insight.medianDaysToPay === null ? (
            <Text size="2" color="gray">
              No invoice paid in full yet
            </Text>
          ) : (
            <>
              <Text size="4" weight="bold" className="tnum">
                {formatMedianDays(insight.medianDaysToPay)}
              </Text>
              <Text size="1" color="gray">
                issue to paid in full, over {insight.settledSampleCount}{" "}
                {insight.settledSampleCount === 1 ? "invoice" : "invoices"}
              </Text>
            </>
          )}
        </Flex>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Outstanding now
          </Text>
          <Text size="4" weight="bold" className="tnum">
            {formatCents(insight.outstandingCents)}
          </Text>
          <Text size="1" color="gray">
            across {insight.openInvoiceCount} open{" "}
            {insight.openInvoiceCount === 1 ? "invoice" : "invoices"}
          </Text>
        </Flex>
      </Flex>

      {insight.openInvoiceCount === 0 ? (
        <Text size="2" color="gray">
          Nothing outstanding right now.
        </Text>
      ) : (
        <Table.Root variant="ghost" size="1">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Aging</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">
                Balance
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {AGING_BUCKETS.filter((b) => insight.agingCents[b] !== 0).map(
              (bucket) => (
                <Table.Row key={bucket}>
                  <Table.RowHeaderCell>
                    {AGING_BUCKET_LABEL[bucket]}
                  </Table.RowHeaderCell>
                  <Table.Cell justify="end">
                    <Text className="tnum">
                      {formatCents(insight.agingCents[bucket])}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )
            )}
          </Table.Body>
        </Table.Root>
      )}
    </Flex>
  );
}
