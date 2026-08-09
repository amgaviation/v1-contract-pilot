import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { CATEGORY_LABEL } from "../../year-end/db";
import { loadProfitLossReport, type PLPeriod, type PLPeriodKind } from "../queries";
import { csvRow } from "@/lib/csv";

// Same discipline as app/(app)/reports/year-end/export/route.ts: the whole
// dataset (both the current and prior period) is fetched and any error
// resolved BEFORE the first byte of the response is written, so a failure
// here is always a real 500, never a partial 200.
export const dynamic = "force-dynamic";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: PLPeriodKind[] = ["year", "quarter", "month", "mtd", "custom"];

function centsToDollarsString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pilot"
  );
}

/**
 * Unlike the year-end/quarterly exports (which recompute their period from
 * a single ?year=), this export takes the EXACT bounds the screen just
 * rendered — ?start=/?end=/?priorStart=/?priorEnd= — rather than
 * recomputing them from ?kind=/?year=/?quarter=/?month=. That keeps the
 * downloaded CSV byte-for-byte aligned with whatever the pilot was
 * looking at, including the day-shifted "custom" prior window, without
 * the export route re-deriving (and risking re-deriving differently) the
 * same calendar arithmetic queries.ts already did once in the page.
 */
export async function GET(request: NextRequest) {
  const { account } = await requireAccount("/reports/profit-loss");

  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind") as PLPeriodKind | null;
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const priorStart = url.searchParams.get("priorStart");
  const priorEnd = url.searchParams.get("priorEnd");

  if (!kindParam || !KINDS.includes(kindParam)) {
    return NextResponse.json(
      { error: `?kind= must be one of: ${KINDS.join(", ")}` },
      { status: 400 }
    );
  }
  for (const [name, value] of [
    ["start", start],
    ["end", end],
    ["priorStart", priorStart],
    ["priorEnd", priorEnd],
  ] as const) {
    if (!value || !ISO_DATE_RE.test(value)) {
      return NextResponse.json({ error: `?${name}= must be a YYYY-MM-DD date.` }, { status: 400 });
    }
  }

  const period: PLPeriod = {
    kind: kindParam,
    label: `${start} – ${end}`,
    start: start as string,
    end: end as string,
    priorLabel: `${priorStart} – ${priorEnd}`,
    priorStart: priorStart as string,
    priorEnd: priorEnd as string,
    priorIsApproximate: kindParam === "custom",
  };

  const supabase = await createClient();
  const report = await loadProfitLossReport(supabase, account.id, period);

  if (report.error) {
    console.error("[profit-loss export] report load failed", report.error);
    return NextResponse.json(
      { error: "Couldn't load your profit & loss figures for export." },
      { status: 500 }
    );
  }

  // Same "right or loudly wrong, never silently partial" rule as
  // year-end's export: refuse to emit rather than ship a CSV whose Total
  // silently excludes rows past PAYMENTS_LIMIT/EXPENSES_LIMIT. Defect 10:
  // this guard used to check only incomeTruncated/expensesTruncated while
  // still writing the rebilled and unassigned totals unconditionally below
  // — those two have their own truncation flags (rebilledTruncated,
  // unassignedTruncated, and now mileageTruncated) that the on-screen
  // callouts already surface, so the export must refuse on them too rather
  // than being the one artifact that can carry a silently short figure.
  if (
    report.incomeTruncated ||
    report.expensesTruncated ||
    report.rebilledTruncated ||
    report.unassignedTruncated ||
    report.mileageTruncated
  ) {
    return NextResponse.json(
      {
        error:
          "This period has more rows than the export can safely total in one file. Narrow the date range or contact support — exporting a silently partial total would misstate your figures.",
      },
      { status: 500 }
    );
  }

  const netProfitCents = report.incomeComparison.currentCents - report.expensesComparison.currentCents;

  const rows: string[] = [];
  rows.push(csvRow([`Period`, period.label]));
  rows.push(csvRow([`Compared against`, period.priorLabel]));
  rows.push(csvRow([]));

  rows.push(csvRow(["Income by client", "Payments", "Amount"]));
  for (const c of report.incomeByClient) {
    rows.push(csvRow([c.clientName, c.paymentCount, centsToDollarsString(c.totalCents)]));
  }
  rows.push(
    csvRow([
      "Total income",
      "",
      centsToDollarsString(report.incomeComparison.currentCents),
      "Prior period",
      report.incomeComparison.hasPriorData ? centsToDollarsString(report.incomeComparison.priorCents) : "no prior data",
    ])
  );
  rows.push(csvRow([]));

  rows.push(csvRow(["Expenses by category", "Receipts", "Amount"]));
  for (const c of report.expensesByCategory) {
    rows.push(csvRow([CATEGORY_LABEL[c.category] ?? c.category, c.count, centsToDollarsString(c.totalCents)]));
  }
  rows.push(
    csvRow([
      "Total expenses",
      "",
      centsToDollarsString(report.expensesComparison.currentCents),
      "Prior period",
      report.expensesComparison.hasPriorData ? centsToDollarsString(report.expensesComparison.priorCents) : "no prior data",
    ])
  );
  rows.push(csvRow([]));

  rows.push(
    csvRow([
      "Net profit",
      centsToDollarsString(netProfitCents),
      "Prior period",
      report.netProfitComparison.hasPriorData
        ? centsToDollarsString(report.netProfitComparison.priorCents)
        : "no prior data",
    ])
  );
  rows.push(csvRow([]));

  rows.push(
    csvRow([
      "Rebilled costs (already counted inside Total expenses above, paired with the reimbursement in Total income)",
      report.rebilledCount,
      centsToDollarsString(report.rebilledCostCents),
    ])
  );
  rows.push(
    csvRow([
      "Unassigned receipts (excluded from income and expenses)",
      report.unassignedCount,
      centsToDollarsString(report.unassignedTotalCents),
    ])
  );
  rows.push(
    csvRow([
      "Mileage (excluded from expenses — standard mileage rate is an alternative to, not additive with, actual vehicle expenses)",
      report.mileageCount,
      centsToDollarsString(report.mileageTotalCents),
    ])
  );

  const body = rows.join("");
  const filename = `profit-loss-${period.start}-to-${period.end}-${slugify(account.legal_name ?? account.id)}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
