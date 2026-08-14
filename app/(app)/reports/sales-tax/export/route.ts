import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { csvRow } from "@/lib/csv";
import { loadSalesTaxReport } from "../queries";
import {
  correctionNote,
  formatBps,
  isValidIsoDate,
  resolveSalesTaxPeriod,
  todayIso,
} from "../report-lib";

// Same discipline as app/(app)/reports/profit-loss/export/route.ts: the
// whole dataset is fetched and any error resolved BEFORE the first byte of
// the response is written, so a failure here is always a real 500, never a
// partial 200.
export const dynamic = "force-dynamic";

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
 * Takes the EXACT bounds the screen just rendered — ?from=/?to= — the same
 * design as profit-loss's export, so the downloaded CSV is always aligned
 * with what the pilot was looking at. Invalid params are a 400, not a
 * silent fallback to a different period (a CSV for a period the pilot
 * didn't ask for is worse than an error).
 */
export async function GET(request: NextRequest) {
  const { account } = await requireEntitlement("sales_tax_report", "/reports/sales-tax");

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  for (const [name, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (!value || !isValidIsoDate(value)) {
      return NextResponse.json(
        { error: `?${name}= must be a YYYY-MM-DD date.` },
        { status: 400 }
      );
    }
  }
  // Both bounds validated above, so resolve only normalizes ordering.
  const period = resolveSalesTaxPeriod({ from: from as string, to: to as string }, todayIso());

  const supabase = await createClient();
  const report = await loadSalesTaxReport(supabase, account.id, period);

  if (report.error !== null) {
    console.error("[sales-tax export] report load failed", report.error);
    return NextResponse.json(
      { error: "Couldn't load your sales tax figures for export." },
      { status: 500 }
    );
  }

  // Same "right or loudly wrong, never silently partial" rule as every
  // report export in this app: refuse to emit rather than ship a CSV
  // whose Total silently excludes rows past the Data API cap.
  if (report.truncated) {
    return NextResponse.json(
      {
        error:
          "This period has more rows than the export can safely total in one file. Narrow the date range or contact support. Exporting a silently partial total would misstate your figures.",
      },
      { status: 500 }
    );
  }

  const rows: string[] = [];
  rows.push(csvRow(["Sales tax", `${period.from} – ${period.to}`]));
  rows.push(
    csvRow([
      "Basis",
      "Cash: an invoice's tax counts on the day it was paid in full, matching this product's other reports. If a payment is corrected later, the period it was originally counted in stands unchanged and the correction appears as a negative row in the period the correction was made. These figures are for whoever prepares your filings. This file does not calculate what to remit.",
    ])
  );
  rows.push(csvRow([]));

  rows.push(
    csvRow([
      "Invoice",
      "Client",
      "Issued",
      // Same header as the page: the day the invoice was paid in full
      // (collected rows) or the day a correction un-settled it
      // (correction rows, negative amounts, explained in Note).
      "Counted on",
      "Taxable subtotal",
      "Tax rate",
      "Tax",
      "Note",
    ])
  );
  for (const r of report.rows) {
    rows.push(
      csvRow([
        r.invoiceNumber,
        r.clientName,
        r.issuedOn ?? "",
        r.countedOn,
        centsToDollarsString(r.taxableSubtotalCents),
        formatBps(r.taxRateBps),
        centsToDollarsString(r.taxCents),
        r.kind === "correction" && r.previouslyCountedOn
          ? correctionNote(r.previouslyCountedOn)
          : "",
      ])
    );
  }
  rows.push(
    csvRow([
      "Total",
      "",
      "",
      "",
      centsToDollarsString(report.taxableTotalCents),
      "",
      centsToDollarsString(report.taxTotalCents),
      "",
    ])
  );
  rows.push(csvRow([]));

  rows.push(
    csvRow([
      "Invoices paid in full this period that charged no tax (not listed above)",
      report.untaxedPaidCount,
    ])
  );
  rows.push(
    csvRow([
      "Tax on invoices issued this period still awaiting full payment (excluded from the totals above; each counts on the day it's paid in full)",
      report.awaitingCount,
      centsToDollarsString(report.awaitingTaxCents),
    ])
  );

  const body = rows.join("");
  const filename = `sales-tax-${period.from}-to-${period.to}-${slugify(account.legal_name ?? account.id)}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
