import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { rowsOf, type DbErrorLike } from "@/lib/supabase/rows";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { idChunks } from "@/lib/id-chunks";
import ReceiptLink from "@/app/(app)/expenses/[id]/receipt-link";

export const metadata = { title: "Receipts" };

/**
 * THE SHOEBOX, AS A LEDGER.
 *
 * There is no standalone "receipt" record in this product and this screen
 * does not add one — pilot.expenses.receipt_path IS the receipt, and the
 * expense row is the log entry. This page is a second READ of that same
 * table, split into "has a receipt" and "doesn't", so a pilot can work the
 * missing-receipt queue without a second source of truth to keep in sync.
 * Upload, validation and the signed-URL gate all stay in
 * app/(app)/expenses/actions.ts (uploadReceipt, receiptUrl) — this file
 * only reads and reuses them.
 *
 * Claim rule (docs/MARKETING.md §5.1): a receipt is organised BY THE PILOT,
 * never by the product on its own. Nothing on this screen implies a
 * receipt attaches itself — "Add expense" and "Add receipt" both hand the
 * pilot to the form that does the scanning.
 */

type ExpenseReceiptRow = {
  id: string;
  incurred_on: string;
  vendor: string | null;
  amount_cents: number;
  category: string;
  treatment: string;
  receipt_path: string | null;
  trip_id: string | null;
};

/** Only the columns app/(app)/expenses/page.tsx's own Trip column reads —
 *  trips has no "name" column, so the label is built the same way that
 *  screen builds it: date range plus aircraft ident. */
type TripLabelRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
};

type Badge = { tone: "warn" | "accent" | "good"; label: string };

// The exact dictionary app/(app)/expenses/page.tsx's TREATMENT_BADGE uses —
// a pilot who has learned "Rebill / Deduct / Unassigned" on the expenses
// ledger must not meet different words for the same three states here.
const TREATMENT_FALLBACK: Badge = { tone: "warn", label: "Unassigned" };
const TREATMENT_BADGE: Record<string, Badge> = {
  unassigned: TREATMENT_FALLBACK,
  rebill: { tone: "accent", label: "Rebill" },
  deduct: { tone: "good", label: "Deduct" },
};

// Supabase's Data API caps rows and TRUNCATES SILENTLY on a plain select —
// no error, just a shorter array. An explicit .limit makes that boundary
// visible instead of invisible, same pattern as expenses/page.tsx's own
// EXPENSES_LIMIT and clients/page.tsx's CLIENTS_LIMIT. Capped lower than
// the expenses ledger's own 1000: this screen exists to work the on-file /
// missing queues, not to stand in as the account's full expense history.
const EXPENSES_LIMIT = 500;

const VIEWS = [
  { key: "on_file", label: "On file" },
  { key: "missing", label: "Missing" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

function tripLabel(trip: TripLabelRow): string {
  return `${formatDateRange(trip.starts_on, trip.ends_on)}${
    trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""
  }`;
}

export default async function ReceiptsPage({
  searchParams,
}: {
  // ?view=missing switches the queue; unrecognized values are ignored
  // rather than rejected, same as every other list screen's own filter —
  // a stale or hand-edited query string degrades to the default view, not
  // a page error.
  searchParams: Promise<{ view?: string }>;
}) {
  // No entitlement gate: expenses (and therefore their receipts) are a
  // Solo-tier surface, same as app/(app)/expenses/page.tsx.
  await requireAccount("/receipts");
  const params = await searchParams;
  const view: ViewKey =
    (VIEWS.find((v) => v.key === params.view)?.key as ViewKey | undefined) ?? "on_file";

  const supabase = await createClient();

  const [expensesRes, categoryLabels] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, incurred_on, vendor, amount_cents, category, treatment, receipt_path, trip_id"
      )
      .order("incurred_on", { ascending: false })
      .limit(EXPENSES_LIMIT),
    // Resolves the tenant's own category renames (and retired categories
    // still on old rows) the same way expenses/page.tsx does — this is a
    // history screen, so a category the pilot has since renamed or retired
    // must still render as whatever it was filed under.
    loadOptionLabels("expense_category"),
  ]);

  const expensesResult = rowsOf<ExpenseReceiptRow>(
    expensesRes as { data: ExpenseReceiptRow[] | null; error: DbErrorLike | null }
  );
  const expenses = expensesResult.ok ? expensesResult.rows : [];
  const truncated = expenses.length === EXPENSES_LIMIT;

  const onFile = expenses.filter((e) => e.receipt_path !== null);
  const missing = expenses.filter((e) => e.receipt_path === null);
  const rows = view === "missing" ? missing : onFile;

  // WHICH TRIPS THIS PAGE NEEDS, and only those — the same chunked-.in()
  // technique expenses/page.tsx uses for its own trip lookup, applied here
  // to trip LABELS instead of client resolution. Bounded by what's actually
  // rendered rather than by the account's full trip history, so a career
  // pilot's trip count can never silently truncate this the way an
  // unbounded `select` over every trip would.
  const neededTripIds = [
    ...new Set(rows.map((e) => e.trip_id).filter((id): id is string => id !== null)),
  ];
  const tripChunks = await Promise.all(
    idChunks(neededTripIds).map((chunk) =>
      supabase.from("trips").select("id, starts_on, ends_on, aircraft_ident").in("id", chunk)
    )
  );
  const tripLabels = new Map<string, string>();
  let tripLabelsFailed = false;
  for (const chunk of tripChunks) {
    const chunkResult = rowsOf<TripLabelRow>(
      chunk as { data: TripLabelRow[] | null; error: DbErrorLike | null }
    );
    if (!chunkResult.ok) {
      tripLabelsFailed = true;
      continue;
    }
    for (const trip of chunkResult.rows) tripLabels.set(trip.id, tripLabel(trip));
  }

  const viewHref = (key: ViewKey) => (key === "on_file" ? "/receipts" : `/receipts?view=${key}`);
  const viewCount = (key: ViewKey) => (key === "on_file" ? onFile.length : missing.length);

  return (
    <LPageShell
      title="Receipts"
      subtitle={
        !expensesResult.ok
          ? "Couldn't load your expenses."
          : "Every receipt on file, and the expenses still missing one."
      }
      action={
        <NextLink href="/expenses/new" className={lButtonClass({ variant: "primary" })}>
          Add expense
        </NextLink>
      }
    >
      {truncated ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`Showing your ${EXPENSES_LIMIT} most recent expenses. Older ones aren't checked here for a receipt, but they're still in your account.`}
          </span>
        </LAlert>
      ) : null}

      {tripLabelsFailed ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`Couldn't load some trip names. The Trip column below may show a generic link instead of the trip's dates.`}
          </span>
        </LAlert>
      ) : null}

      {/* Link-based chips, no client JS — same idiom as
          app/(app)/estimates/page.tsx's own FILTERS row. "Add expense"
          above is the one filled accent action on this screen
          (docs/design/LEDGER.md's restraint rule), so the active view is
          outline, not primary. */}
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => {
          const active = view === v.key;
          return (
            <NextLink
              key={v.key}
              href={viewHref(v.key)}
              className={lButtonClass({ variant: active ? "outline" : "quiet", size: "sm" })}
            >
              {`${v.label} (${viewCount(v.key)})`}
            </NextLink>
          );
        })}
      </div>

      <LCard>
        {!expensesResult.ok ? (
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError(expensesResult.error, "expenses.select")}</span>
          </LAlert>
        ) : rows.length === 0 ? (
          view === "on_file" ? (
            <LEmpty
              title="Nothing on file"
              action={
                <NextLink href="/expenses/new" className={lButtonClass({ variant: "outline" })}>
                  Add expense
                </NextLink>
              }
            >
              Receipts you add to expenses are kept here. Scan one when you add the expense.
            </LEmpty>
          ) : (
            <LEmpty title="Nothing missing">
              Every expense has its receipt. Nothing to chase.
            </LEmpty>
          )
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Receipts</span>
            </caption>
            <thead>
              <tr>
                <LTh>Date</LTh>
                <LTh>Vendor</LTh>
                <LTh numeric>Amount</LTh>
                <LTh>Category</LTh>
                <LTh>Treatment</LTh>
                <LTh>Trip</LTh>
                <LTh>Receipt</LTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((expense) => {
                const badge = TREATMENT_BADGE[expense.treatment] ?? TREATMENT_FALLBACK;
                return (
                  <tr key={expense.id}>
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      <NextLink
                        href={`/expenses/${expense.id}`}
                        className="text-accent hover:underline"
                      >
                        {formatDate(expense.incurred_on)}
                      </NextLink>
                    </th>
                    <LTd>
                      <span className="text-ink-2">{expense.vendor ?? "—"}</span>
                    </LTd>
                    <LTd numeric>
                      <span className="font-medium">{formatCents(expense.amount_cents)}</span>
                    </LTd>
                    <LTd>
                      <span className="text-ink-2">
                        {categoryLabels[expense.category] ?? "Other"}
                      </span>
                    </LTd>
                    <LTd>
                      <LPill tone={badge.tone}>{badge.label}</LPill>
                    </LTd>
                    <LTd>
                      {expense.trip_id ? (
                        <NextLink
                          href={`/trips/${expense.trip_id}`}
                          className="text-ink-2 hover:underline"
                        >
                          {tripLabels.get(expense.trip_id) ?? "View trip"}
                        </NextLink>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </LTd>
                    <LTd>
                      {/* Every row in "On file" has a path and every row in
                          "Missing" does not — branching on the value itself
                          (rather than on the view) means this cell is
                          correct in both queues with no duplicated markup. */}
                      {expense.receipt_path ? (
                        <ReceiptLink path={expense.receipt_path} />
                      ) : (
                        <NextLink
                          href={`/expenses/${expense.id}`}
                          className={lButtonClass({ variant: "outline", size: "sm" })}
                        >
                          Add receipt
                        </NextLink>
                      )}
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
 * expenses/page.tsx's own WarningIcon. */
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
