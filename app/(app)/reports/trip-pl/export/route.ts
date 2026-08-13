import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { csvRow } from "@/lib/csv";
import { loadTripPLReport } from "../queries";
import {
  formatDayQuantity,
  formatMiles,
  isValidIsoDate,
  type TripPLPeriod,
  type TripPLPeriodKind,
} from "../report-lib";

// Same discipline as the year-end and profit-loss exports: the whole
// dataset is fetched and any error resolved BEFORE the first byte of the
// response is written, so a failure here is always a real 500, never a
// partial 200 that looks like a complete file.
export const dynamic = "force-dynamic";

const KINDS: TripPLPeriodKind[] = ["year", "quarter", "month", "mtd", "custom"];

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
 * Takes the EXACT bounds the screen just rendered (?start=/?end=) rather
 * than recomputing them from ?kind=/?year=/?quarter=/?month=. That keeps
 * the downloaded CSV byte-for-byte aligned with what the pilot was looking
 * at, without this route re-deriving — and risking re-deriving differently
 * — calendar arithmetic report-lib.ts already did once for the page.
 */
export async function GET(request: NextRequest) {
  const { account } = await requireAccount("/reports/trip-pl");

  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind") as TripPLPeriodKind | null;
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  if (!kindParam || !KINDS.includes(kindParam)) {
    return NextResponse.json(
      { error: `?kind= must be one of: ${KINDS.join(", ")}` },
      { status: 400 }
    );
  }
  for (const [name, value] of [
    ["start", start],
    ["end", end],
  ] as const) {
    // isValidIsoDate, not just a regex: "2026-02-30" matches the shape and
    // is not a date, and a bogus bound would silently select nothing.
    if (!value || !isValidIsoDate(value)) {
      return NextResponse.json(
        { error: `?${name}= must be a real YYYY-MM-DD date.` },
        { status: 400 }
      );
    }
  }

  const period: TripPLPeriod = {
    kind: kindParam,
    label: `${start} – ${end}`,
    start: start as string,
    end: end as string,
  };

  const supabase = await createClient();
  const report = await loadTripPLReport(supabase, account.id, period);

  if (report.error) {
    console.error("[trip-pl export] report load failed", report.error);
    return NextResponse.json(
      { error: "Couldn't load your trip profitability figures for export." },
      { status: 500 }
    );
  }

  // The assembly refused: the reads worked but the rows don't support an
  // honest report. Emitting the CSV anyway would ship exactly the silently
  // inflated margin the refusal exists to prevent.
  if (report.refusal) {
    console.error("[trip-pl export] assembly refused", report.refusal);
    return NextResponse.json(
      {
        error:
          "These figures don't reconcile, so they can't be exported. A margin is a subtraction — a partial join makes it too high, not too low. Contact support.",
      },
      { status: 500 }
    );
  }

  // "Right or loudly wrong, never silently partial" — the same rule the
  // year-end and profit-loss exports apply. A CSV is the artifact that
  // leaves the product and gets opened in Excel by someone who cannot see
  // this page's warning banner, so a truncated read must refuse here even
  // though the screen merely warns.
  if (report.truncated) {
    return NextResponse.json(
      {
        error:
          "This period has more rows than the export can safely total in one file. Narrow the date range or contact support — exporting a silently partial margin would misstate your figures.",
      },
      { status: 500 }
    );
  }

  const rows: string[] = [];

  rows.push(csvRow(["Trip profitability", period.label]));
  rows.push(
    csvRow([
      "Basis",
      "INVOICED, NOT COLLECTED — what was billed for each trip, not what has been paid. Payments are recorded per invoice with no line-level allocation, so no payment can be honestly attributed to one trip. For collected cash see the profit & loss report (cash-basis).",
    ])
  );
  rows.push(
    csvRow([
      "Margin definition",
      "Invoiced day money minus deductible expenses. Rebilled costs and their reimbursements (both legs), undecided receipts, mileage, and revenue not tied to a trip are all EXCLUDED — each is listed in its own section below.",
    ])
  );
  rows.push(
    csvRow([
      "Period rule",
      "A trip is included when its dates overlap the period. A trip straddling a boundary appears in full in both periods; its money is not split across the boundary.",
    ])
  );
  rows.push(csvRow([]));

  // ---- By trip ------------------------------------------------------------
  rows.push(csvRow(["By trip"]));
  rows.push(
    csvRow([
      "Trip start",
      "Trip end",
      "Tail number",
      "Client",
      "Trip kind",
      "Trip status",
      "Billing state",
      "Days",
      "Day count source",
      "Invoiced day money",
      "of which on draft invoices",
      "Deductible expenses",
      "Margin",
      "Margin per day",
      "Rebilled cost (excluded)",
      "Rebilled invoiced (excluded)",
      "Rebill gap",
      "Undecided receipts (excluded)",
      "Mileage (miles, excluded)",
    ])
  );
  for (const t of report.trips) {
    rows.push(
      csvRow([
        t.startsOn,
        t.endsOn,
        t.aircraftIdent ?? "",
        t.clientName,
        t.tripKind,
        t.tripStatus,
        t.billingState,
        formatDayQuantity(t.dayQuantity),
        t.dayQuantitySource === "day_rows"
          ? "day grid"
          : t.dayQuantitySource === "scalar"
            ? "trip day count (no day grid)"
            : "no days recorded",
        centsToDollarsString(t.invoicedDayMoneyCents),
        centsToDollarsString(t.draftDayMoneyCents),
        centsToDollarsString(t.deductibleExpenseCents),
        centsToDollarsString(t.marginCents),
        t.marginPerDayCents === null ? "" : centsToDollarsString(t.marginPerDayCents),
        centsToDollarsString(t.rebilledCostCents),
        centsToDollarsString(t.rebillInvoicedCents),
        centsToDollarsString(t.rebillGapCents),
        centsToDollarsString(t.unassignedExpenseCents),
        formatMiles(t.mileageMiles),
      ])
    );
  }
  rows.push(csvRow([]));

  // ---- By client ----------------------------------------------------------
  rows.push(csvRow(["By client"]));
  rows.push(
    csvRow([
      "Client",
      "Trips",
      "Days",
      "Invoiced day money",
      "of which on draft invoices",
      "Deductible expenses",
      "Margin",
      "Margin per day",
      "Rebilled cost (excluded)",
      "Rebilled invoiced (excluded)",
      "Rebill gap",
      "Undecided receipts (excluded)",
      // Dated by the invoice's ISSUE DATE, unlike every other column in
      // this table, which is dated by the trip's travel dates.
      "Revenue not tied to a trip, sent invoices issued in this period (excluded from margin)",
      // PLUS, not "of which": these two are disjoint — the SQL splits them
      // by invoice status — unlike "Invoiced day money" / "of which on
      // draft invoices" above, which really is a subset. Not labelled
      // "undated" either: a draft may carry a provisional issue date; what
      // is true of every one of them is that it has not been sent.
      "PLUS revenue not tied to a trip, unsent draft invoices (any date)",
      "Mileage (miles, excluded)",
    ])
  );
  for (const c of report.clients) {
    rows.push(
      csvRow([
        c.clientName,
        c.tripCount,
        formatDayQuantity(c.dayQuantity),
        centsToDollarsString(c.invoicedDayMoneyCents),
        centsToDollarsString(c.draftDayMoneyCents),
        centsToDollarsString(c.deductibleExpenseCents),
        centsToDollarsString(c.marginCents),
        c.marginPerDayCents === null ? "" : centsToDollarsString(c.marginPerDayCents),
        centsToDollarsString(c.rebilledCostCents),
        centsToDollarsString(c.rebillInvoicedCents),
        centsToDollarsString(c.rebillGapCents),
        centsToDollarsString(c.unassignedExpenseCents),
        centsToDollarsString(c.unattributedLineCents),
        centsToDollarsString(c.draftUnattributedLineCents),
        formatMiles(c.mileageMiles),
      ])
    );
  }
  rows.push(csvRow([]));

  // ---- Totals -------------------------------------------------------------
  rows.push(csvRow(["Totals"]));
  rows.push(csvRow(["Trips", report.totals.tripCount]));
  rows.push(csvRow(["Days", formatDayQuantity(report.totals.dayQuantity)]));
  rows.push(
    csvRow([
      "Invoiced day money (invoiced, not collected)",
      centsToDollarsString(report.totals.invoicedDayMoneyCents),
    ])
  );
  rows.push(
    csvRow([
      "of which on draft invoices",
      centsToDollarsString(report.totals.draftDayMoneyCents),
    ])
  );
  rows.push(
    csvRow([
      "Deductible expenses",
      centsToDollarsString(report.totals.deductibleExpenseCents),
    ])
  );
  rows.push(csvRow(["Margin", centsToDollarsString(report.totals.marginCents)]));
  rows.push(
    csvRow([
      "Margin per day",
      report.totals.marginPerDayCents === null
        ? "n/a — no billable days"
        : centsToDollarsString(report.totals.marginPerDayCents),
    ])
  );
  rows.push(csvRow([]));

  rows.push(csvRow(["Excluded from margin"]));
  rows.push(
    csvRow([
      "Rebilled cost — money you fronted (excluded; the pass-through's other leg is below)",
      centsToDollarsString(report.totals.rebilledCostCents),
    ])
  );
  rows.push(
    csvRow([
      "Rebilled invoiced — money you billed back (excluded; pairs with the cost above)",
      centsToDollarsString(report.totals.rebillInvoicedCents),
    ])
  );
  rows.push(
    csvRow([
      "Rebill gap (invoiced minus cost; NEGATIVE means you fronted money you never billed back)",
      centsToDollarsString(report.totals.rebillGapCents),
    ])
  );
  rows.push(
    csvRow([
      "Undecided receipts — neither billed nor deducted (excluded)",
      centsToDollarsString(report.totals.unassignedExpenseCents),
    ])
  );
  rows.push(
    csvRow([
      "Revenue not tied to a trip — chiefly monthly guarantees (excluded from margin; real revenue). Sent invoices only, placed by ISSUE DATE, not by trip dates",
      centsToDollarsString(report.totals.unattributedLineCents),
      `${report.totals.unattributedLineCount} lines`,
    ])
  );
  rows.push(
    csvRow([
      "PLUS the same on unsent draft invoices (not filtered by this period; disjoint from the row above, so the two add)",
      centsToDollarsString(report.totals.draftUnattributedLineCents),
      `${report.totals.draftUnattributedLineCount} lines`,
    ])
  );
  rows.push(
    csvRow([
      "Mileage in MILES, not dollars — the standard mileage rate and actual vehicle expenses are alternative methods, never additive, so no mileage figure enters a margin",
      formatMiles(report.totals.mileageMiles),
    ])
  );

  const body = rows.join("");
  const filename = `trip-profitability-${period.start}-to-${period.end}-${slugify(
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
