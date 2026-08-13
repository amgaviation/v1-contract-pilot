import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { loadYearEndReport } from "../queries";
import { loadTravelLog } from "../travel-log-queries";
import { csvRow } from "@/lib/csv";

// A year-end figure is either right or it should error loudly — never a
// silently truncated download that looks complete. This report's queries
// are already bounded (PAYMENTS_LIMIT/EXPENSES_LIMIT in queries.ts, a
// couple thousand rows at most for a single tax year), so unlike
// app/(app)/logbook/export/route.ts's unbounded career-length export,
// there is no streaming case to design for: the whole dataset is fetched
// and any error is resolved BEFORE the first byte of the response is
// built, so a failure here is always a real 500, never a partial 200.
export const dynamic = "force-dynamic";

const SECTIONS = [
  "income",
  "deductible",
  "rebilled",
  "unassigned",
  "mileage",
  "tax-forms",
  "travel-log",
] as const;
type Section = (typeof SECTIONS)[number];



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
  const { account } = await requireAccount("/reports/year-end");

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const year = Number(yearParam);
  if (!yearParam || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "A valid ?year= is required." }, { status: 400 });
  }

  const sectionParam = url.searchParams.get("section") as Section | null;
  if (!sectionParam || !SECTIONS.includes(sectionParam)) {
    return NextResponse.json(
      { error: `?section= must be one of: ${SECTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // The travel log has its own loader (no other section reads
  // trips/trip_days/trip_legs), so it branches before the money report is
  // loaded at all — same right-or-loudly-wrong rules, applied to its own
  // error and truncation flags.
  if (sectionParam === "travel-log") {
    const log = await loadTravelLog(supabase, account.id, year);
    if (log.error) {
      console.error("[year-end export] travel log load failed", log.error);
      return NextResponse.json(
        { error: "Couldn't load your travel log for export." },
        { status: 500 }
      );
    }
    if (log.truncated) {
      return NextResponse.json(
        {
          error:
            "This year holds more trip days than the export can safely list in one file. Contact support — exporting a silently partial travel log would misstate your away-day counts.",
        },
        { status: 500 }
      );
    }

    const logRows: string[] = [
      csvRow([
        "Date",
        "Client",
        "Day type",
        "Away from home",
        "Per-diem day",
        "Route flown",
        "Aircraft",
      ]),
    ];
    for (const d of log.rows) {
      logRows.push(
        csvRow([
          d.dayOn,
          d.clientName,
          d.dayTypeLabel,
          d.away ? "Away" : "Home",
          d.perDiemDay ? "Yes" : "",
          d.route ?? "",
          d.aircraftIdent ?? "",
        ])
      );
    }
    logRows.push(
      csvRow(["Totals", "", "", log.awayDayCount, log.perDiemDayCount, "", ""])
    );
    // Day counts only, stated inside the file itself — the CSV travels
    // without the page around it, and the person opening it is the
    // pilot's tax preparer, not the pilot.
    logRows.push(
      csvRow([
        "Per-diem day count only. No M&IE rate is applied and no deduction is computed here — the preparer applies the current rate to the counts above.",
      ])
    );

    const logFilename = `travel-log-${year}-${slugify(account.legal_name ?? account.id)}.csv`;
    return new NextResponse(logRows.join(""), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${logFilename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const report = await loadYearEndReport(supabase, account.id, year);
  // Same labels the screen shows — a CSV that disagreed with the report
  // it was exported from would be its own bug.
  const categoryLabels = await loadOptionLabels("expense_category");

  if (report.error) {
    console.error("[year-end export] report load failed", report.error);
    return NextResponse.json(
      { error: "Couldn't load your year-end figures for export." },
      { status: 500 }
    );
  }

  // Same "right or loudly wrong, never silently partial" rule as the
  // report.error check above — this document goes to a CPA, and a Total
  // computed over only the first 2,000 of 2,001 rows is worse than no
  // export at all because nothing about the file itself flags it as
  // incomplete. queries.ts already computed whether THIS section's own
  // query hit its row cap; refuse to emit that section rather than ship a
  // csv whose Total silently excludes rows past the limit. (tax-forms has
  // no limit/truncation flag — one row per client per year, never in the
  // thousands — so it's exempt.)
  const truncatedBySection: Partial<Record<Section, boolean>> = {
    income: report.paymentsTruncated,
    deductible: report.deductibleTruncated,
    rebilled: report.rebilledTruncated,
    unassigned: report.unassignedTruncated,
    mileage: report.mileageTruncated,
  };
  if (truncatedBySection[sectionParam]) {
    return NextResponse.json(
      {
        error:
          "This section has more rows than the export can safely total in one file. Narrow the date range or contact support — exporting a silently partial total would misstate your year-end figures.",
      },
      { status: 500 }
    );
  }

  const rows: string[] = [];
  let filenamePart: string;

  switch (sectionParam) {
    case "income": {
      rows.push(
        csvRow(["Date paid", "Client", "Invoice", "Method", "Amount"])
      );
      for (const p of report.payments) {
        rows.push(
          csvRow([
            p.paidOn,
            p.clientName,
            p.invoiceNumber ?? "",
            p.method ?? "",
            centsToDollarsString(p.amountCents),
          ])
        );
      }
      rows.push(csvRow(["", "", "", "Total", centsToDollarsString(report.incomeTotalCents)]));
      filenamePart = "income";
      break;
    }
    case "deductible": {
      rows.push(csvRow(["Date", "Category", "Vendor", "Amount"]));
      for (const e of report.deductibleExpenses) {
        rows.push(
          csvRow([
            e.incurredOn,
            categoryLabels[e.category] ?? e.category,
            e.vendor ?? "",
            centsToDollarsString(e.amountCents),
          ])
        );
      }
      rows.push(
        csvRow(["", "", "Total", centsToDollarsString(report.deductibleTotalCents)])
      );
      filenamePart = "deductible-expenses";
      break;
    }
    case "rebilled": {
      rows.push(
        csvRow([
          "Date incurred",
          "Category",
          "Vendor",
          "Expense amount",
          "Client",
          "Invoice",
          "Invoice status",
          "Invoiced amount",
          "Delta",
          "Status",
        ])
      );
      for (const r of report.rebilled) {
        rows.push(
          csvRow([
            r.incurredOn,
            categoryLabels[r.category] ?? r.category,
            r.vendor ?? "",
            centsToDollarsString(r.expenseAmountCents),
            r.clientName ?? "",
            r.invoiceNumber ?? "",
            r.invoiceStatus ?? "",
            r.lineAmountCents === null ? "" : centsToDollarsString(r.lineAmountCents),
            r.deltaCents === null ? "" : centsToDollarsString(r.deltaCents),
            r.invoiceId ? "Invoiced" : "Not yet invoiced",
          ])
        );
      }
      filenamePart = "rebilled-expenses";
      break;
    }
    case "unassigned": {
      rows.push(csvRow(["Date", "Category", "Vendor", "Amount"]));
      for (const e of report.unassigned) {
        rows.push(
          csvRow([
            e.incurredOn,
            categoryLabels[e.category] ?? e.category,
            e.vendor ?? "",
            centsToDollarsString(e.amountCents),
          ])
        );
      }
      rows.push(
        csvRow(["", "", "Total", centsToDollarsString(report.unassignedTotalCents)])
      );
      filenamePart = "unassigned-receipts";
      break;
    }
    case "mileage": {
      // One summary row, not a per-drive listing: the query behind this
      // (loadYearEndReport's section E) is bounded to this one tax year,
      // and the figure Schedule C wants is total miles x the year's OWN
      // rate on file rounded once (lib/mileage.ts) — a per-drive amount
      // column here would show each row's own SNAPSHOTTED rate, which can
      // legitimately differ from the year's current rate and would not
      // sum to the total below. Miles and the rate basis are still both
      // present, per the task this section exists to satisfy.
      rows.push(csvRow(["Drives", "Miles", "Rate (cents/mile)", "Amount"]));
      rows.push(
        csvRow([
          report.mileageCount,
          report.mileageMiles.toFixed(1),
          report.mileageRateCentsPerMile ?? "",
          report.mileageAmountCents === null
            ? ""
            : centsToDollarsString(report.mileageAmountCents),
        ])
      );
      filenamePart = "mileage";
      break;
    }
    case "tax-forms": {
      rows.push(
        csvRow([
          "Client",
          "Your ledger (cash-basis)",
          "Form type",
          "Form reports",
          "Delta (form minus your ledger)",
          "Received",
          "Notes",
        ])
      );
      for (const t of report.taxForms) {
        rows.push(
          csvRow([
            t.clientName,
            centsToDollarsString(t.ledgerCents),
            t.formType ?? "",
            t.reportedAmountCents === null ? "" : centsToDollarsString(t.reportedAmountCents),
            t.deltaCents === null ? "" : centsToDollarsString(t.deltaCents),
            t.receivedOn ?? "",
            t.notes ?? "",
          ])
        );
      }
      filenamePart = "1099-reconciliation";
      break;
    }
  }

  const body = rows.join("");
  const filename = `${filenamePart}-${year}-${slugify(account.legal_name ?? account.id)}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
