import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Link as RadixLink,
  Table,
  Text,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import EmptyState from "@/components/ui/empty-state";
import PageShell from "../page-shell";
import { computeDuePeriods } from "./recurring/actions";
import type { Database } from "@/lib/supabase/database.types";

export const metadata = { title: "Invoices" };

type RecurringScheduleRow = Database["pilot"]["Tables"]["recurring_invoice_schedules"]["Row"];

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

/**
 * Supabase's Data API caps rows and TRUNCATES SILENTLY (200, not an
 * error). Every other list in this app carries this; these three reads did
 * not, and a truncated invoice_totals read renders formatCents(undefined
 * ?? 0) — "$0.00", in the gray styling reserved for settled — for an
 * invoice whose detail page shows the real balance.
 */
const LIST_LIMIT = 1000;

/** The buckets an accountant and a chasing pilot both think in. */
const AGING_BUCKETS = [
  { key: "current", label: "Not yet due", from: -Infinity, to: 0 },
  { key: "d1_30", label: "1-30 days", from: 1, to: 30 },
  { key: "d31_60", label: "31-60 days", from: 31, to: 60 },
  { key: "d61_90", label: "61-90 days", from: 61, to: 90 },
  { key: "d90", label: "90+ days", from: 91, to: Infinity },
] as const;

const FILTERS = [
  { key: "outstanding", label: "Outstanding" },
  { key: "overdue", label: "Overdue" },
  { key: "draft", label: "Drafts" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireAccount("/invoices");
  const { show } = await searchParams;
  // "Outstanding" is the default view, not "all". A contract pilot opens
  // this screen to find out who owes them money — the reference calls
  // chasing payment a top-three pain — and a reverse-chronological list of
  // every invoice they have ever issued is not that answer.
  const filter: FilterKey =
    (FILTERS.find((f) => f.key === show)?.key as FilterKey) ?? "outstanding";

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
    { data: recurringScheduleData, error: recurringScheduleError },
    { data: recurringGenerationData, error: recurringGenerationError },
    { data: connectNoticeData },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, client_id, invoice_number, status, issued_on, due_on")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from("invoice_totals")
      .select("invoice_id, total_cents, balance_due_cents")
      .limit(LIST_LIMIT),
    // days_overdue, not just the id: it is already computed by the view and
    // it is the whole basis of the aging strip below.
    supabase.from("invoices_overdue").select("invoice_id, days_overdue").limit(LIST_LIMIT),
    supabase.from("clients").select("id, name").limit(LIST_LIMIT),
    // Best-effort: a failed read here only costs the "due to create" count
    // its accuracy, not the whole invoice list, so it's kept out of
    // firstError (matching how invoices/recurring/page.tsx treats its own
    // reads as blocking, but THIS page's primary purpose is the invoice
    // list, not the recurring queue).
    supabase
      .from("recurring_invoice_schedules")
      .select("id, account_id, client_id, cadence, anchor_date, end_date, description, amount_cents, tax_rate_bps, active, created_at, updated_at")
      .eq("active", true),
    supabase.from("recurring_invoice_generations").select("schedule_id, period_start"),
    // Invoices carrying an unresolved Connect prompt — a Stripe payment
    // that arrived and was deliberately not recorded (20260813100000).
    //
    // WHY IT IS ON THE LIST AND NOT ONLY ON THE INVOICE. The prompt's most
    // serious trigger is a client paying an invoice that already reads
    // Paid, and a Paid invoice is precisely the one a pilot has no reason
    // to open: the list says settled, so the amber "if the client paid
    // twice, refund them" sits unread until the client complains. There is
    // still no notification (docs/WAVE-PARITY §8 #1 says so plainly); this
    // is the cheapest thing that makes the prompt reachable from the screen
    // a pilot does open — one indexed read against
    // stripe_connect_events_needs_review_idx.
    //
    // Best-effort, like the recurring reads above: a failed read costs a
    // badge, not a figure, so it is kept out of firstError.
    supabase
      .from("stripe_connect_events")
      .select("invoice_id")
      .in("outcome", ["needs_review", "refused"])
      .is("reviewed_at", null)
      .not("invoice_id", "is", null)
      .limit(LIST_LIMIT),
  ]);

  // A failed totals/overdue/clients query is not "no data" — rendering it
  // as $0.00 would make a sent, unpaid invoice look paid in normal styling.
  const firstError = error ?? totalsError ?? overdueError ?? clientError;

  // "Due to create" — the same computation invoices/recurring/page.tsx
  // does, reused here (not forked) so this count and that page's queue can
  // never disagree. Silently 0 on a read failure rather than surfacing a
  // second error banner on this page — recurringScheduleError/
  // recurringGenerationError are deliberately not folded into firstError.
  let dueToCreateCount = 0;
  if (!recurringScheduleError && !recurringGenerationError) {
    const generationsBySchedule = new Map<string, Set<string>>();
    for (const g of (recurringGenerationData ?? []) as { schedule_id: string; period_start: string }[]) {
      if (!generationsBySchedule.has(g.schedule_id)) generationsBySchedule.set(g.schedule_id, new Set());
      generationsBySchedule.get(g.schedule_id)!.add(g.period_start);
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const schedule of (recurringScheduleData ?? []) as RecurringScheduleRow[]) {
      const generated = generationsBySchedule.get(schedule.id) ?? new Set<string>();
      dueToCreateCount += (await computeDuePeriods(schedule, generated, today)).length;
    }
  }

  const invoices = (invoiceData ?? []) as InvoiceListRow[];
  const totalsByInvoice = new Map(
    ((totalsData ?? []) as TotalsRow[]).map((t) => [t.invoice_id, t])
  );
  const overdueRows = (overdueData ?? []) as {
    invoice_id: string;
    days_overdue: number;
  }[];
  const overdueIds = new Set(overdueRows.map((o) => o.invoice_id));
  const daysOverdueById = new Map(
    overdueRows.map((o) => [o.invoice_id, o.days_overdue])
  );
  const truncated =
    invoices.length === LIST_LIMIT || (totalsData ?? []).length === LIST_LIMIT;
  // Resolved in memory rather than a PostgREST embed — same reason as
  // trips/page.tsx: the embed's return type resolves to `never` against
  // the hand-authored types file, and a pilot's client list is small.
  const clientNames = new Map(
    ((clientData ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );
  const noticeInvoiceIds = new Set(
    ((connectNoticeData ?? []) as { invoice_id: string | null }[])
      .map((row) => row.invoice_id)
      .filter((invoiceId): invoiceId is string => invoiceId !== null)
  );

  const overdueCount = overdueIds.size;

  // RECEIVABLES. Balance owed, bucketed by how late it is. Only invoices
  // that can still be paid count — a draft has not been sent and a void
  // one is not owed, so including either would inflate what a pilot
  // believes is coming to them.
  const owedRows = invoices.filter(
    (i) => i.status === "sent" || i.status === "partial"
  );
  const aging = new Map<string, { cents: number; count: number }>(
    AGING_BUCKETS.map((b) => [b.key, { cents: 0, count: 0 }])
  );
  let outstandingCents = 0;
  for (const invoice of owedRows) {
    const balance = totalsByInvoice.get(invoice.id)?.balance_due_cents ?? 0;
    if (balance <= 0) continue;
    outstandingCents += balance;
    // Absent from invoices_overdue means not yet due — the view is the one
    // source for past-due-ness, so lateness is never recomputed here.
    const days = daysOverdueById.get(invoice.id) ?? 0;
    const bucket =
      AGING_BUCKETS.find((b) => days >= b.from && days <= b.to) ?? AGING_BUCKETS[0];
    const cell = aging.get(bucket.key)!;
    cell.cents += balance;
    cell.count += 1;
  }

  const visible = invoices.filter((invoice) => {
    const balance = totalsByInvoice.get(invoice.id)?.balance_due_cents ?? 0;
    switch (filter) {
      case "outstanding":
        return (invoice.status === "sent" || invoice.status === "partial") && balance > 0;
      case "overdue":
        return overdueIds.has(invoice.id);
      case "draft":
        return invoice.status === "draft";
      case "paid":
        return invoice.status === "paid";
      default:
        return true;
    }
  });

  return (
    <PageShell
      title="Invoices"
      subtitle={
        firstError
          ? "Some figures below couldn't load. See the notice."
          : // The default view filters to "outstanding", so `invoices.length`
            // (everything loaded) and `visible.length` (what the table below
            // actually shows) diverge whenever a filter is narrowing the
            // list — say so, the way trips/page.tsx's subtitle names an
            // active filter rather than quoting a count the table disagrees
            // with.
            visible.length !== invoices.length
            ? `Showing ${visible.length} of ${invoices.length} invoices${
                overdueCount ? ` · ${overdueCount} past due` : ""
              }`
            : `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}${
                overdueCount ? ` · ${overdueCount} past due` : ""
              }`
      }
      action={
        <Flex gap="2" wrap="wrap">
          <Button asChild variant="soft">
            <NextLink href="/invoices/recurring">
              Recurring
              {dueToCreateCount > 0 ? (
                <Badge color="amber" ml="1" className="tnum">
                  {dueToCreateCount} due
                </Badge>
              ) : null}
            </NextLink>
          </Button>
          <Button asChild>
            <NextLink href="/invoices/new">New invoice</NextLink>
          </Button>
        </Flex>
      }
    >
      {dueToCreateCount > 0 ? (
        <Callout.Root color="amber">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            <Text as="span" className="tnum">
              {dueToCreateCount}
            </Text>{" "}
            recurring invoice{dueToCreateCount === 1 ? " is" : "s are"} due to create.{" "}
            <RadixLink asChild>
              <NextLink href="/invoices/recurring">Review the queue</NextLink>
            </RadixLink>
            .
          </Callout.Text>
        </Callout.Root>
      ) : null}
      {truncated ? (
        <Callout.Root color="amber">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Only the most recent {LIST_LIMIT} invoices could be loaded, so the
            figures below cover those and not your whole history.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {!firstError && outstandingCents > 0 ? (
        <Card size="3">
          <Flex justify="between" align="baseline" wrap="wrap" gap="2" mb="3">
            <Text size="2" weight="bold">
              Owed to you
            </Text>
            <Text size="5" weight="bold" className="tnum">
              {formatCents(outstandingCents)}
            </Text>
          </Flex>
          <Grid columns={{ initial: "1", sm: "5" }} gap="3">
            {AGING_BUCKETS.map((bucket) => {
              const cell = aging.get(bucket.key)!;
              return (
                <Flex key={bucket.key} direction="column" gap="1">
                  <Text size="1" color="gray">
                    {bucket.label}
                  </Text>
                  <Text
                    size="3"
                    weight="medium"
                    className="tnum"
                    // Only real lateness is coloured. A pilot glancing at
                    // this needs the 90+ column to be the one that shouts.
                    color={cell.cents === 0 ? "gray" : bucket.key === "d90" ? "red" : undefined}
                  >
                    {formatCents(cell.cents)}
                  </Text>
                  <Text size="1" color="gray">
                    {cell.count === 1 ? "1 invoice" : `${cell.count} invoices`}
                  </Text>
                </Flex>
              );
            })}
          </Grid>
        </Card>
      ) : null}

      <Flex gap="2" wrap="wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            asChild
            size="2"
            variant={filter === f.key ? "solid" : "soft"}
          >
            <NextLink href={f.key === "outstanding" ? "/invoices" : `/invoices?show=${f.key}`}>
              {f.label}
            </NextLink>
          </Button>
        ))}
      </Flex>

      <Card size="3">
        {firstError ? (
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{friendlyDbError(firstError, "invoices.select")}</Callout.Text>
          </Callout.Root>
        ) : visible.length === 0 ? (
          // "No invoices yet" is only true when there are none at all.
          // Saying it while a filter is hiding forty of them is the same
          // class of lie the trips screens used to tell.
          invoices.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              action={
                <Button asChild>
                  <NextLink href="/invoices/new">Draft your first invoice</NextLink>
                </Button>
              }
            >
              Draft one from a client and the trips you&rsquo;ve already flown for
              them: the flight days, travel days, and rebilled expenses fill
              themselves in.
            </EmptyState>
          ) : (
            // Same primitive, different case: the filtered state. Keeping
            // both on one component is what stops the two from drifting
            // apart visually and reading as two different screens.
            <EmptyState
              title={
                filter === "outstanding"
                  ? "Nothing outstanding"
                  : filter === "overdue"
                    ? "Nothing past due"
                    : "Nothing here"
              }
              action={
                <Button asChild variant="soft">
                  <NextLink href="/invoices?show=all">Show all invoices</NextLink>
                </Button>
              }
            >
              {filter === "outstanding"
                ? `Every invoice you've sent has been paid. You have ${invoices.length} in total.`
                : `None of your ${invoices.length} invoices match this filter.`}
            </EmptyState>
          )
        ) : (
          <Table.Root variant="ghost">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Number</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Issued</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Due</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Late</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Balance due</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visible.map((invoice) => {
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
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      {/* The number a pilot actually quotes when they
                          chase: "that one's 74 days out". The word
                          "overdue" used to sit next to the due date and
                          said less. */}
                      {overdue ? (
                        <Text color="red" weight="medium" className="tnum">
                          {`${daysOverdueById.get(invoice.id) ?? 0}d`}
                        </Text>
                      ) : (
                        <Text color="gray">N/A</Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Flex align="center" gap="2" wrap="wrap">
                        {overdue ? (
                          <Badge color="red">Overdue</Badge>
                        ) : (
                          <Badge color={badge.color}>{badge.label}</Badge>
                        )}
                        {/* Beside the status, not instead of it: a Stripe
                            payment arrived for this invoice and was not
                            recorded. Amber, because nothing is broken and
                            no money was lost — but the sentence explaining
                            it lives on the invoice, so this is only a
                            pointer to it. */}
                        {noticeInvoiceIds.has(invoice.id) ? (
                          <Badge color="amber">Check payment</Badge>
                        ) : null}
                      </Flex>
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
