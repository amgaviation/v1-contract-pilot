import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { loadQuarterlyReport } from "../queries";
import { csvRow } from "@/lib/csv";
import { BRAND } from "@/lib/brand";

// Same "right or loudly wrong, never silently partial" discipline as
// app/(app)/reports/year-end/export/route.ts — this report's queries are
// already bounded (PAYMENTS_LIMIT/EXPENSES_LIMIT in ../queries.ts), so the
// whole dataset is fetched and any error is resolved before the first
// byte of the response is built.
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

export async function GET(request: NextRequest) {
  const { account } = await requireAccount("/reports/quarterly");

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const year = Number(yearParam);
  if (!yearParam || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "A valid ?year= is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const report = await loadQuarterlyReport(supabase, account.id, year);

  if (report.error) {
    console.error("[quarterly export] report load failed", report.error);
    return NextResponse.json(
      { error: "Couldn't load your quarterly figures for export." },
      { status: 500 }
    );
  }

  // Same "right or loudly wrong" rule as the report.error check above —
  // this covers the whole year in one file, so a truncation anywhere
  // means every period's total downstream of it is suspect, not just one
  // period's row.
  if (report.paymentsTruncated || report.deductibleTruncated || report.mileageTruncated) {
    return NextResponse.json(
      {
        error:
          `There are more payments, deductible expenses, or logged drives in this year than the export can safely total in one file. Email ${BRAND.supportEmail}. Exporting a silently partial total would misstate your quarterly figures.`,
      },
      { status: 500 }
    );
  }

  const rows: string[] = [];
  rows.push(
    csvRow([
      "Period",
      "Covers",
      "Payment due",
      "Payments received (count)",
      "Cash received",
      "Deductible expenses (count)",
      "Deductible expenses",
      "Net profit",
      "Unassigned receipts (count)",
      "Unassigned receipts total",
      "Mileage drives",
      "Mileage miles",
      "Mileage rate (cents/mile)",
      "Mileage amount (informational, not in net profit)",
    ])
  );
  for (const pf of report.periods) {
    rows.push(
      csvRow([
        pf.period.label,
        `${pf.period.start} to ${pf.period.end}`,
        pf.period.dueDate,
        pf.paymentCount,
        centsToDollarsString(pf.incomeCents),
        pf.expenseCount,
        centsToDollarsString(pf.deductibleCents),
        centsToDollarsString(pf.netProfitCents),
        pf.unassigned.length,
        centsToDollarsString(pf.unassignedTotalCents),
        pf.mileageCount,
        pf.mileageMiles.toFixed(1),
        pf.mileageRateCentsPerMile ?? "",
        pf.mileageAmountCents === null ? "" : centsToDollarsString(pf.mileageAmountCents),
      ])
    );
  }
  // Statutory due dates only — see app/(app)/reports/quarterly/periods.ts's
  // header comment for why this file never attempts a weekend/holiday
  // shift, and why the "Set aside" figure the on-screen version shows is
  // deliberately absent from this export (it depends on a rate the pilot
  // types into a form, not on anything this route can source itself: the
  // GET request that downloads the CSV has no read of that in-page,
  // unsaved value).

  const body = rows.join("");
  const filename = `quarterly-estimated-tax-${year}-${slugify(
    account.legal_name ?? account.id
  )}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
