import NextLink from "next/link";
import { notFound } from "next/navigation";
import { LAlert, LCard, LPill, lButtonClass, LTable, LTd, LTh } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { LPageShell } from "@/components/ledger/page-shell";
import { cn } from "@/lib/ledger/cn";

import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { buildClientStatement, STATEMENT_LIST_LIMIT } from "./queries";
import {
  addressLines,
  resolveStatementPeriod,
  todayIso,
  STATEMENT_STATUS_LABEL,
  type StatementRow,
} from "./statement-lib";

export const metadata = { title: "Statement" };

/**
 * The statement screen: for one client, every invoice issued in a period,
 * what has been paid against each, and what is outstanding — the "here's
 * where we stand" document a contract pilot sends an aircraft owner or a
 * flight department whose AP pays in batches. The period defaults to the
 * current calendar year and is selectable via ?from=/?to=, validated
 * server-side (see resolveStatementPeriod).
 *
 * Every figure comes through buildClientStatement, which reads
 * invoice_totals and invoices_overdue — the same sources the invoice
 * screens use — and refuses on any failed read. The three states this
 * screen can render are deliberately distinct:
 *   - a red alert       → a read FAILED; nothing here can be trusted
 *   - "No invoices…"     → the reads succeeded and the period is empty
 *   - the statement      → the reads succeeded and there are rows
 */

// Same crit/warn/good/neutral vocabulary as every other migrated screen's
// own dictionary (invoices/page.tsx's statusToPillTone).
const STATUS_TONE: Record<StatementRow["status"], "accent" | "warn" | "good"> = {
  sent: "accent",
  partial: "warn",
  paid: "good",
};

export default async function ClientStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { account } = await requireEntitlement("client_statements", `/clients/${id}/statement`);
  const sp = await searchParams;

  const today = todayIso();
  const period = resolveStatementPeriod(sp, today);
  const year = Number(today.slice(0, 4));
  const thisYear = { from: `${year}-01-01`, to: `${year}-12-31` };
  const lastYear = { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  const isThisYear = period.from === thisYear.from && period.to === thisYear.to;
  const isLastYear = period.from === lastYear.from && period.to === lastYear.to;

  const supabase = await createClient();
  const result = await buildClientStatement(supabase, account.id, id, period);

  // Another tenant's client id and a nonexistent one are indistinguishable
  // here, and that is the point — same note as clients/[id]/page.tsx.
  if (!result.ok && result.reason === "not_found") notFound();

  const statement = result.ok ? result.statement : null;
  const printHref = `/clients/${id}/statement/print?from=${period.from}&to=${period.to}`;

  return (
    <LPageShell
      title="Statement"
      subtitle={
        statement
          ? `${statement.client.name} · invoices issued ${formatDate(period.from)} to ${formatDate(period.to)}`
          : "Couldn't load this statement. See below."
      }
      action={
        <>
          <NextLink href={`/clients/${id}`} className={lButtonClass({ variant: "outline" })}>
            Back to client
          </NextLink>
          {statement && !statement.truncated ? (
            // A standalone print-quality document (see print/route.ts) —
            // opened in its own tab so the pilot can print or save it as
            // a PDF from the browser without losing this screen.
            <a href={printHref} target="_blank" rel="noopener" className={lButtonClass({ variant: "primary" })}>
              Print / save as PDF
            </a>
          ) : null}
        </>
      }
    >
      {/* Period controls: two presets plus an explicit range. Links and a
          GET form, no client component — the server re-resolves ?from=/?to=
          on every request, so the URL is shareable and the back button
          works. */}
      <div className="flex flex-wrap items-center gap-2">
        <NextLink
          href={`/clients/${id}/statement`}
          className={lButtonClass({ variant: isThisYear ? "primary" : "outline", size: "sm" })}
        >
          This year
        </NextLink>
        <NextLink
          href={`/clients/${id}/statement?from=${lastYear.from}&to=${lastYear.to}`}
          className={lButtonClass({ variant: isLastYear ? "primary" : "outline", size: "sm" })}
        >
          Last year
        </NextLink>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <LInput
            type="date"
            name="from"
            defaultValue={period.from}
            aria-label="Statement period start"
            className="w-auto"
          />
          <span className="text-caption text-ink-3">to</span>
          <LInput
            type="date"
            name="to"
            defaultValue={period.to}
            aria-label="Statement period end"
            className="w-auto"
          />
          <button type="submit" className={lButtonClass({ variant: "outline", size: "sm" })}>
            Apply
          </button>
        </form>
      </div>

      {!result.ok ? (
        // A failed read renders a FAILURE, never an empty statement — a
        // client statement showing nothing is a claim that nothing is owed,
        // and this screen has no basis for that claim right now. See
        // lib/supabase/rows.ts for the house reasoning.
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>
              {friendlyDbError(result.error, "client-statement.load")} This
              statement couldn&rsquo;t be assembled, so nothing is shown.
              A partial statement would misstate what&rsquo;s outstanding.
            </span>
          </LAlert>
        </LCard>
      ) : statement ? (
        <>
          {statement.truncated ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                This period has more than {STATEMENT_LIST_LIMIT} invoices, so
                the figures below cover only the first{" "}
                {STATEMENT_LIST_LIMIT} and the totals are partial. Narrow the
                date range. The print view refuses a partial statement
                outright.
              </span>
            </LAlert>
          ) : null}

          <LCard>
            {/* The two parties — the same fields the invoice PDF renders
                (accounts.legal_name + address; clients.name/contact/address),
                so the statement and the invoices it summarizes name the
                same people the same way. */}
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="text-caption font-medium text-ink-3">From</div>
                <div className="font-bold text-ink">{account.legal_name}</div>
                {addressLines(account).map((line, i) => (
                  <div key={i} className="text-body-s text-ink-2">
                    {line}
                  </div>
                ))}
              </div>
              <div>
                <div className="text-caption font-medium text-ink-3">Prepared for</div>
                <div className="font-bold text-ink">
                  {statement.client.name}
                  {statement.clientArchived ? " (archived)" : ""}
                </div>
                {statement.client.contact_name ? (
                  <div className="text-body-s text-ink-2">{statement.client.contact_name}</div>
                ) : null}
                {addressLines(statement.client).map((line, i) => (
                  <div key={i} className="text-body-s text-ink-2">
                    {line}
                  </div>
                ))}
              </div>
            </div>

            {statement.rows.length === 0 ? (
              // The VALID empty statement — reached only after every read
              // succeeded, so this sentence is a verified fact, not a
              // failed query wearing good news.
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <div className="text-h2 font-bold">No invoices issued this period</div>
                <p className="text-body-s text-ink-3">
                  Nothing was issued to {statement.client.name} between{" "}
                  {formatDate(period.from)} and {formatDate(period.to)}.
                  Drafts and voided invoices are never part of a statement.
                  If you expected activity here, widen the date range.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-ink-3">Total invoiced</span>
                    <span className="tnum-l text-figure font-bold tracking-tight">
                      {formatCents(statement.totals.invoicedCents)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-ink-3">Paid to date</span>
                    <span className="tnum-l text-figure font-bold tracking-tight">
                      {formatCents(statement.totals.paidCents)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-ink-3">Balance outstanding</span>
                    <span
                      className={cn(
                        "tnum-l text-figure font-bold tracking-tight",
                        statement.totals.outstandingCents > 0 ? "text-warn" : "text-ink-3"
                      )}
                    >
                      {formatCents(statement.totals.outstandingCents)}
                    </span>
                  </div>
                </div>

                <LTable>
                  <caption>
                    <span className="sr-only">Statement lines</span>
                  </caption>
                  <thead>
                    <tr>
                      <LTh>Number</LTh>
                      <LTh>Issued</LTh>
                      <LTh>Due</LTh>
                      <LTh numeric>Late</LTh>
                      <LTh>Status</LTh>
                      <LTh numeric>Total</LTh>
                      <LTh numeric>Paid to date</LTh>
                      <LTh numeric>Balance due</LTh>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.rows.map((row) => {
                      const overdue = row.daysOverdue !== null;
                      return (
                        <tr key={row.id}>
                          <th
                            scope="row"
                            className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                          >
                            <NextLink href={`/invoices/${row.id}`} className="text-accent hover:underline">
                              {row.invoiceNumber ?? "Invoice"}
                            </NextLink>
                          </th>
                          <LTd>
                            <span className="text-ink-2">{formatDate(row.issuedOn)}</span>
                          </LTd>
                          <LTd>
                            <span className={overdue ? "font-medium text-crit" : "text-ink-2"}>
                              {formatDate(row.dueOn)}
                            </span>
                          </LTd>
                          <LTd numeric>
                            {/* Days past due from invoices_overdue — the
                                same figure the invoices screen quotes, so
                                a pilot chasing "that one's 74 days out"
                                reads the identical number here. */}
                            {overdue ? (
                              <span className="font-medium text-crit">{`${row.daysOverdue}d`}</span>
                            ) : (
                              <span className="text-ink-3">—</span>
                            )}
                          </LTd>
                          <LTd>
                            {overdue ? (
                              <LPill tone="crit">Overdue</LPill>
                            ) : (
                              <LPill tone={STATUS_TONE[row.status]}>
                                {STATEMENT_STATUS_LABEL[row.status]}
                              </LPill>
                            )}
                          </LTd>
                          <LTd numeric>
                            <span className="font-medium">{formatCents(row.totalCents)}</span>
                          </LTd>
                          <LTd numeric>
                            <span className="text-ink-2">{formatCents(row.paidCents)}</span>
                          </LTd>
                          <LTd numeric>
                            <span
                              className={cn(
                                "font-medium",
                                row.balanceCents > 0 ? "text-warn" : "text-ink-2"
                              )}
                            >
                              {formatCents(row.balanceCents)}
                            </span>
                          </LTd>
                        </tr>
                      );
                    })}
                  </tbody>
                </LTable>
              </>
            )}

            <p className="mt-4 text-caption text-ink-3">
              Covers invoices issued {formatDate(period.from)} to{" "}
              {formatDate(period.to)} (sent, partially paid, or paid).
              Drafts and voided invoices are excluded. &ldquo;Paid to
              date&rdquo; reflects every payment recorded through{" "}
              {formatDate(today)}, including any received after the period
              ended.
            </p>
          </LCard>
        </>
      ) : null}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. */
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
