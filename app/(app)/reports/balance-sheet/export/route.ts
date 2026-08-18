import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { csvRow } from "@/lib/csv";
import {
  assembleBalanceSheet,
  type BalanceSheetSection,
  type LedgerBalanceRow,
} from "../../../accounting/ledger-lib";
import { isValidIsoDate, todayIso } from "../../sales-tax/report-lib";
import { BRAND } from "@/lib/brand";

// Same discipline as reports/profit-loss/export: the whole dataset is
// fetched and any error resolved BEFORE the first byte is written, so a
// failure is a real 500, never a partial 200.
export const dynamic = "force-dynamic";

function centsToDollarsString(cents: number): string {
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
  const { account } = await requireEntitlement("accounting", "/reports/balance-sheet");

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const asOf = dateParam && isValidIsoDate(dateParam) ? dateParam : todayIso();

  const supabase = await createClient();
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);
  const { data, error: balanceError } = await supabase.rpc("ledger_balances", {
    target_account_id: account.id,
    through_date: asOf,
  } as never);

  const error = syncError ?? balanceError;
  if (error) {
    console.error("[balance-sheet export] load failed", error);
    return NextResponse.json(
      { error: "Couldn't load your balance sheet for export." },
      { status: 500 }
    );
  }

  const sheet = assembleBalanceSheet((data ?? []) as LedgerBalanceRow[]);
  if (!sheet.balances) {
    // Refusal, not a wrong file: a sheet that doesn't balance must never
    // leave the building as a CSV that looks authoritative.
    return NextResponse.json(
      {
        error:
          `This balance sheet does not balance, which should be impossible. Nothing was exported: this product never ships figures that don't tie. Email ${BRAND.supportEmail}.`,
      },
      { status: 500 }
    );
  }

  const rows: string[] = [];
  rows.push(csvRow(["Balance sheet as of", asOf]));
  rows.push(csvRow(["Basis", "Accrual: receivables count when invoiced; the P&L reports cash-basis income"]));
  rows.push(csvRow([]));

  const writeSection = (section: BalanceSheetSection) => {
    rows.push(csvRow([section.label, "Amount"]));
    for (const line of section.lines) {
      rows.push(
        csvRow([
          line.name + (line.archived ? " (archived)" : ""),
          centsToDollarsString(line.balanceCents),
        ])
      );
    }
    rows.push(
      csvRow([`Total ${section.label.toLowerCase()}`, centsToDollarsString(section.totalCents)])
    );
    rows.push(csvRow([]));
  };

  writeSection(sheet.assets);
  writeSection(sheet.liabilities);

  rows.push(csvRow(["Equity", "Amount"]));
  for (const line of sheet.equity.lines) {
    rows.push(
      csvRow([
        line.name + (line.archived ? " (archived)" : ""),
        centsToDollarsString(line.balanceCents),
      ])
    );
  }
  rows.push(csvRow(["Net income to date", centsToDollarsString(sheet.netIncomeToDateCents)]));
  rows.push(
    csvRow([
      "Total equity",
      centsToDollarsString(sheet.equity.totalCents + sheet.netIncomeToDateCents),
    ])
  );
  rows.push(csvRow([]));
  rows.push(csvRow(["Total assets", centsToDollarsString(sheet.totalAssetsCents)]));
  rows.push(
    csvRow([
      "Total liabilities + equity",
      centsToDollarsString(sheet.totalLiabilitiesAndEquityCents),
    ])
  );

  const body = rows.join("");
  const filename = `balance-sheet-${asOf}-${slugify(account.legal_name ?? account.id)}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
