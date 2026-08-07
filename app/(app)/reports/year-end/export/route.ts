import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { CATEGORY_LABEL } from "../db";
import { loadYearEndReport } from "../queries";

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
  "tax-forms",
] as const;
type Section = (typeof SECTIONS)[number];

/**
 * RFC 4180 field escaping, plus formula-injection guarding for a leading
 * =/+/-/@ — copied verbatim from app/(app)/logbook/export/route.ts's
 * csvField so the two CSV exports in this product escape identically
 * rather than drifting into two slightly different implementations.
 */
function csvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}

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
  const report = await loadYearEndReport(supabase, account.id, year);

  if (report.error) {
    console.error("[year-end export] report load failed", report.error);
    return NextResponse.json(
      { error: "Couldn't load your year-end figures for export." },
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
            CATEGORY_LABEL[e.category] ?? e.category,
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
            CATEGORY_LABEL[r.category] ?? r.category,
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
            CATEGORY_LABEL[e.category] ?? e.category,
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
