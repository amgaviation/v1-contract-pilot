import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { cn } from "@/lib/ledger/cn";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { billToListLabel } from "@/lib/invoice-bill-to";
import { computeDuePeriods } from "./recurring/actions";
import type { Database } from "@/lib/supabase/database.types";

export const metadata = { title: "Invoices" };

type RecurringScheduleRow = Database["pilot"]["Tables"]["recurring_invoice_schedules"]["Row"];

type InvoiceListRow = {
  // Nullable since 20260815100000: an invoice may bill typed bill-to details
  // instead of a client, and bill_to_name is what the Client column shows for
  // one. A/R is deliberately NOT split by that: the aging strip, the totals
  // and the past-due counts below read every live invoice regardless of
  // whether it has a client, because money owed is money owed.
  client_id: string | null;
  bill_to_name: string | null;
  id: string;
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

// STATUS_BADGE keeps INSTRUMENT's Radix Badge colour vocabulary (gray/blue/
// amber/green/red) as its own data — it is this screen's one remaining tie
// to that vocabulary, and Ledger's LPill has its own tone vocabulary, so
// this is the one translation point this screen needs on top of it. Same
// dictionary as Overview's ladderToPillTone: red→crit, amber→warn,
// green→good, gray→neutral, and blue→accent (the one status this screen
// has that ladder didn't: "Sent").
function statusToPillTone(color: Badge["color"]): "crit" | "warn" | "good" | "neutral" | "accent" {
  switch (color) {
    case "red":
      return "crit";
    case "amber":
      return "warn";
    case "green":
      return "good";
    case "blue":
      return "accent";
    default:
      return "neutral";
  }
}

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds an /invoices link that keeps every OTHER active narrowing and
 * sets (or, for `null`, clears) the one named here — same shape as
 * trips/page.tsx's tripsFilterHref, so a pilot who arrived from a client's
 * page on ?client= and then picks "Drafts" is not silently dropped back
 * into every client's drafts.
 */
function invoicesFilterHref(
  current: { show?: string; client?: string },
  patch: Partial<{ show: string | null; client: string | null }>
): string {
  const merged = { ...current, ...patch };
  const params = new URLSearchParams();
  if (merged.show) params.set("show", merged.show);
  if (merged.client) params.set("client", merged.client);
  const qs = params.toString();
  return qs ? `/invoices?${qs}` : "/invoices";
}

export default async function InvoicesPage({
  searchParams,
}: {
  // ?client= is the deep link clients/[id]/page.tsx sends its capped
  // "Outstanding invoices" card to — that page inlined its own 10-row list
  // precisely because this one could not be narrowed to a client.
  searchParams: Promise<{ show?: string; client?: string }>;
}) {
  await requireAccount("/invoices");
  const { show, client } = await searchParams;
  // "Outstanding" is the default view, not "all". A contract pilot opens
  // this screen to find out who owes them money — the reference calls
  // chasing payment a top-three pain — and a reverse-chronological list of
  // every invoice they have ever issued is not that answer.
  const filter: FilterKey =
    (FILTERS.find((f) => f.key === show)?.key as FilterKey) ?? "outstanding";
  // Unrecognized values are ignored rather than rejected — a stale or
  // hand-edited query string degrades to "show everything", not a page
  // error, the same way trips/page.tsx treats its own ?client=.
  const clientFilter = client && UUID_RE.test(client) ? client : null;

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
      .select("id, client_id, bill_to_name, invoice_number, status, issued_on, due_on")
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

  const loadedInvoices = (invoiceData ?? []) as InvoiceListRow[];
  // Narrowed in memory rather than as a second query: the read above is
  // already capped at LIST_LIMIT and the truncation check below has to
  // measure that full read, not the filtered slice. An invoice billing
  // typed bill-to details carries no client_id, so a client filter
  // deliberately excludes every clientless invoice.
  const invoices = clientFilter
    ? loadedInvoices.filter((invoice) => invoice.client_id === clientFilter)
    : loadedInvoices;
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
    loadedInvoices.length === LIST_LIMIT || (totalsData ?? []).length === LIST_LIMIT;
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

  // Counted off the invoices this page is listing rather than off the
  // overdue view's own size, so the subtitle's "N past due" scopes with an
  // active client filter instead of quoting the whole account's figure
  // beside a narrowed table.
  const overdueCount = invoices.filter((invoice) => overdueIds.has(invoice.id)).length;

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

  // THE OVERDUE VIEW IS ORDERED BY LATENESS, not by the created_at the
  // single .order above gives every other view. A pilot on this filter is
  // chasing money and the 90-day invoice is the one to chase first;
  // reverse-chronological buries it among fresher ones. days_overdue comes
  // from invoices_overdue (the one source for past-due-ness) and is already
  // in memory, so this re-orders rather than re-reads.
  if (filter === "overdue") {
    visible.sort(
      (a, b) => (daysOverdueById.get(b.id) ?? 0) - (daysOverdueById.get(a.id) ?? 0)
    );
  }

  const filterHrefBase = {
    show: filter === "outstanding" ? undefined : filter,
    client: clientFilter ?? undefined,
  };
  // A client with nothing on file at all — distinct from "this status
  // filter hides everything they have", because the way out of it is
  // dropping the client, not widening the status.
  const noneForClient = clientFilter !== null && invoices.length === 0;

  return (
    <LPageShell
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
        <>
          <NextLink href="/invoices/recurring" className={lButtonClass({ variant: "outline" })}>
            Recurring
            {dueToCreateCount > 0 ? (
              <LPill tone="warn" className="tnum-l">
                {dueToCreateCount} due
              </LPill>
            ) : null}
          </NextLink>
          {/* THE ONE FILLED ACCENT BUTTON on this screen — the filter chips'
              active state is a state indicator, not a second call to
              action, and every other action on this screen is outline or
              quiet. */}
          <NextLink href="/invoices/new" className={lButtonClass({ variant: "primary" })}>
            New invoice
          </NextLink>
        </>
      }
    >
      {dueToCreateCount > 0 ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            <span className="tnum-l">{dueToCreateCount}</span>{" "}
            {`recurring invoice${dueToCreateCount === 1 ? " is" : "s are"} due to create. `}
            <NextLink
              href="/invoices/recurring"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Review the queue
            </NextLink>
            .
          </span>
        </LAlert>
      ) : null}
      {truncated ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`Only the most recent ${LIST_LIMIT} invoices could be loaded, so the figures below cover those and not your whole history.`}
          </span>
        </LAlert>
      ) : null}

      {!firstError && outstandingCents > 0 ? (
        <LCard>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-h3 font-semibold">Owed to you</h2>
            <p className="tnum-l text-figure font-bold tracking-tight">
              {formatCents(outstandingCents)}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            {AGING_BUCKETS.map((bucket) => {
              const cell = aging.get(bucket.key)!;
              return (
                <div key={bucket.key} className="flex flex-col gap-1">
                  <span className="text-caption text-ink-3">{bucket.label}</span>
                  <span
                    className={cn(
                      "tnum-l text-body font-medium",
                      // Only real lateness is coloured. A pilot glancing at
                      // this needs the 90+ column to be the one that
                      // shouts.
                      cell.cents === 0
                        ? "text-ink-3"
                        : bucket.key === "d90"
                          ? "text-crit"
                          : "text-ink"
                    )}
                  >
                    {formatCents(cell.cents)}
                  </span>
                  <span className="text-caption text-ink-3">
                    {cell.count === 1 ? "1 invoice" : `${cell.count} invoices`}
                  </span>
                </div>
              );
            })}
          </div>
        </LCard>
      ) : null}

      {/* The active client, named and clearable — the same row trips/page.tsx
          shows for its own ?client= deep link. Every chip below carries the
          client through, so narrowing by status never drops it. */}
      <div className="flex flex-col gap-2">
        {clientFilter ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-s text-ink-2">
              Client:{" "}
              <span className="font-medium text-ink">
                {clientNames.get(clientFilter) ?? "Unknown client"}
              </span>
            </span>
            <NextLink
              href={invoicesFilterHref(filterHrefBase, { client: null })}
              className="text-body-s text-accent hover:underline"
            >
              Clear
            </NextLink>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <NextLink
              key={f.key}
              href={invoicesFilterHref(filterHrefBase, {
                show: f.key === "outstanding" ? null : f.key,
              })}
              className={lButtonClass({
                variant: filter === f.key ? "primary" : "outline",
                size: "sm",
              })}
            >
              {f.label}
            </NextLink>
          ))}
        </div>
      </div>

      <LCard>
        {firstError ? (
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError(firstError, "invoices.select")}</span>
          </LAlert>
        ) : visible.length === 0 ? (
          // "No invoices yet" is only true when there are none at all.
          // Saying it while a filter is hiding forty of them is the same
          // class of lie the trips screens used to tell — which is why this
          // measures the whole loaded read and not the client-narrowed one.
          loadedInvoices.length === 0 ? (
            <LEmpty
              title="No invoices yet"
              action={
                <NextLink href="/invoices/new" className={lButtonClass({ variant: "primary" })}>
                  Draft your first invoice
                </NextLink>
              }
            >
              Draft one from a client and the trips you&rsquo;ve already flown for
              them: the flight days, travel days, and rebilled expenses fill
              themselves in.
            </LEmpty>
          ) : (
            // Same primitive, different case: the filtered state. Keeping
            // both on one component is what stops the two from drifting
            // apart visually and reading as two different screens.
            <LEmpty
              title={
                noneForClient
                  ? "Nothing for this client"
                  : filter === "outstanding"
                    ? "Nothing outstanding"
                    : filter === "overdue"
                      ? "Nothing past due"
                      : "Nothing here"
              }
              action={
                <NextLink
                  href={
                    noneForClient
                      ? invoicesFilterHref(filterHrefBase, { show: "all", client: null })
                      : invoicesFilterHref(filterHrefBase, { show: "all" })
                  }
                  className={lButtonClass({ variant: "outline" })}
                >
                  {clientFilter && !noneForClient
                    ? "Show all their invoices"
                    : "Show all invoices"}
                </NextLink>
              }
            >
              {noneForClient
                ? "No invoice bills this client. One that bills typed details instead of a saved client isn't listed under them."
                : filter === "outstanding"
                  ? `Every invoice you've sent has been paid. You have ${invoices.length} in total.`
                  : `None of your ${invoices.length} invoices match this filter.`}
            </LEmpty>
          )
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Invoices</span>
            </caption>
            <thead>
              <tr>
                <LTh>Number</LTh>
                <LTh>Client</LTh>
                <LTh>Issued</LTh>
                <LTh>Due</LTh>
                <LTh numeric>Late</LTh>
                <LTh>Status</LTh>
                <LTh numeric>Total</LTh>
                <LTh numeric>Balance due</LTh>
              </tr>
            </thead>
            <tbody>
              {visible.map((invoice) => {
                const badge = STATUS_BADGE[invoice.status] ?? STATUS_FALLBACK;
                const totals = totalsByInvoice.get(invoice.id);
                const overdue = overdueIds.has(invoice.id);
                return (
                  <tr key={invoice.id}>
                    {/* scope="row": the accessible-name row header Radix's
                        Table.RowHeaderCell gave this cell, restated as a
                        plain <th> since LTd has no row-header variant. */}
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      <NextLink
                        href={`/invoices/${invoice.id}`}
                        className="text-accent hover:underline"
                      >
                        {invoice.invoice_number ?? "Draft"}
                      </NextLink>
                    </th>
                    <LTd>
                      {/* Resting colour stays text-ink-2, accent only on
                          hover: the row-header number above is this row's one
                          accent-coloured link, and a second one would read as
                          a competing primary action. A typed bill-to has no
                          client record to open, so it stays plain text. */}
                      {invoice.client_id !== null ? (
                        <NextLink
                          href={`/clients/${invoice.client_id}`}
                          className="text-ink-2 hover:text-accent hover:underline"
                        >
                          {billToListLabel(invoice, clientNames)}
                        </NextLink>
                      ) : (
                        <span className="text-ink-2">{billToListLabel(invoice, clientNames)}</span>
                      )}
                    </LTd>
                    <LTd>
                      <span className="text-ink-2">{formatDate(invoice.issued_on)}</span>
                    </LTd>
                    <LTd>
                      <span className={overdue ? "font-medium text-crit" : "text-ink-2"}>
                        {formatDate(invoice.due_on)}
                      </span>
                    </LTd>
                    <LTd numeric>
                      {/* The number a pilot actually quotes when they
                          chase: "that one's 74 days out". The word
                          "overdue" used to sit next to the due date and
                          said less. */}
                      {overdue ? (
                        <span className="font-medium text-crit">
                          {`${daysOverdueById.get(invoice.id) ?? 0}d`}
                        </span>
                      ) : (
                        <span className="text-ink-3">N/A</span>
                      )}
                    </LTd>
                    <LTd>
                      <div className="flex flex-wrap items-center gap-2">
                        {overdue ? (
                          <LPill tone="crit">Overdue</LPill>
                        ) : (
                          <LPill tone={statusToPillTone(badge.color)}>{badge.label}</LPill>
                        )}
                        {/* Beside the status, not instead of it: a Stripe
                            payment arrived for this invoice and was not
                            recorded. Warn, because nothing is broken and
                            no money was lost — but the sentence explaining
                            it lives on the invoice, so this is only a
                            pointer to it. */}
                        {noticeInvoiceIds.has(invoice.id) ? (
                          <LPill tone="warn">Check payment</LPill>
                        ) : null}
                      </div>
                    </LTd>
                    <LTd numeric>
                      <span className="font-medium">{formatCents(totals?.total_cents ?? 0)}</span>
                    </LTd>
                    <LTd numeric>
                      <span
                        className={cn(
                          "font-medium",
                          (totals?.balance_due_cents ?? 0) > 0 ? "text-warn" : "text-ink-2"
                        )}
                      >
                        {formatCents(totals?.balance_due_cents ?? 0)}
                      </span>
                    </LTd>
                  </tr>
                );
              })}
            </tbody>
          </LTable>
        )}
      </LCard>
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Defined once here, aria-hidden, stroke="currentColor" so it
 * inherits its caller's tone utility (text-warn, text-crit). Same shape as
 * overview/page.tsx's own WarningIcon. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
