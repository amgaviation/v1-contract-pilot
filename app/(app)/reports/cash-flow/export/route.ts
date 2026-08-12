import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { csvRow } from "@/lib/csv";
import {
  assembleCashFlow,
  presentedBalanceCents,
  shiftIsoDate,
  type CashFlowRow,
  type LedgerBalanceRow,
} from "../../../accounting/ledger-lib";
import { isValidIsoDate } from "../../sales-tax/report-lib";

// Same discipline as reports/profit-loss/export: everything fetched and
// verified BEFORE the first byte — a failure is a real 500, never a
// partial 200; a statement that doesn't tie is refused, not shipped.
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
  const { account } = await requireEntitlement("accounting", "/reports/cash-flow");

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    return NextResponse.json(
      { error: "?from= and ?to= must be YYYY-MM-DD dates with from before to." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);

  const [flowRes, openingRes, closingRes] = await Promise.all([
    supabase.rpc("ledger_cash_flow", {
      target_account_id: account.id,
      period_start: from,
      period_end: to,
    } as never),
    supabase.rpc("ledger_balances", {
      target_account_id: account.id,
      through_date: shiftIsoDate(from, -1),
    } as never),
    supabase.rpc("ledger_balances", {
      target_account_id: account.id,
      through_date: to,
    } as never),
  ]);

  const error = syncError ?? flowRes.error ?? openingRes.error ?? closingRes.error;
  if (error) {
    console.error("[cash-flow export] load failed", error);
    return NextResponse.json(
      { error: "Couldn't load your cash flow for export." },
      { status: 500 }
    );
  }

  const bankOf = (rows: LedgerBalanceRow[]): number | null => {
    const bank = rows.find((r) => r.system_key === "bank");
    return bank ? presentedBalanceCents("asset", bank.balance_cents) : null;
  };
  const opening = bankOf((openingRes.data ?? []) as LedgerBalanceRow[]);
  const closing = bankOf((closingRes.data ?? []) as LedgerBalanceRow[]);
  if (opening === null || closing === null) {
    return NextResponse.json(
      { error: "Couldn't read the Cash & bank balances for export." },
      { status: 500 }
    );
  }

  const flow = assembleCashFlow((flowRes.data ?? []) as CashFlowRow[], opening, closing);
  if (!flow.ties) {
    return NextResponse.json(
      {
        error:
          "Opening plus net movement doesn't equal closing — refusing to export a statement that doesn't tie. Contact support.",
      },
      { status: 500 }
    );
  }

  const rows: string[] = [];
  rows.push(csvRow(["Cash flow", `${from} to ${to}`]));
  rows.push(
    csvRow(["Basis", "Cash — movements of the ledger's Cash & bank account only"])
  );
  rows.push(csvRow([]));
  rows.push(csvRow(["Opening cash", centsToDollarsString(flow.openingCents)]));
  rows.push(csvRow([]));

  rows.push(csvRow(["Cash in", "Entries", "Amount"]));
  for (const line of flow.inflows) {
    rows.push(csvRow([line.name, line.entryCount, centsToDollarsString(line.cashCents)]));
  }
  rows.push(csvRow(["Total cash in", "", centsToDollarsString(flow.inflowTotalCents)]));
  rows.push(csvRow([]));

  rows.push(csvRow(["Cash out", "Entries", "Amount"]));
  for (const line of flow.outflows) {
    rows.push(csvRow([line.name, line.entryCount, centsToDollarsString(line.cashCents)]));
  }
  rows.push(csvRow(["Total cash out", "", centsToDollarsString(flow.outflowTotalCents)]));
  rows.push(csvRow([]));

  rows.push(csvRow(["Net cash movement", centsToDollarsString(flow.netCents)]));
  rows.push(csvRow(["Closing cash", centsToDollarsString(flow.closingCents)]));

  const body = rows.join("");
  const filename = `cash-flow-${from}-to-${to}-${slugify(account.legal_name ?? account.id)}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
