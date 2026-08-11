import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { buildClientStatement } from "../queries";
import { resolveStatementPeriod, todayIso } from "../statement-lib";
import { renderStatementHtml } from "../statement-html";

// A statement reflects the invoices and payments as they stand RIGHT NOW —
// "paid to date" is a moving fact — so this must never be served from a
// cache. Same reasoning as the invoice PDF route.
export const dynamic = "force-dynamic";

/**
 * The print view: a standalone, print-formatted HTML document the pilot
 * opens in its own tab and prints or saves as a PDF for the client's AP
 * department. See statement-html.ts's header for why this is HTML rather
 * than the house react-pdf setup.
 *
 * It reads through the SAME buildClientStatement as the screen — one data
 * assembly for both surfaces, so the document a client receives cannot
 * disagree with the screen the pilot checked (the drift
 * lib/invoice-document.tsx exists to prevent, and the same period
 * resolution, so ?from=/?to= mean the identical range on both).
 *
 * Failure semantics, matching the invoice PDF route and the CSV exports:
 * a missing/cross-tenant client is a 404, a failed read is a 500, and a
 * TRUNCATED list is also a refusal — the screen can show a partial
 * statement beside a loud callout, but this route produces the artifact
 * the client keeps, with no one looking over its shoulder, so "right or
 * loudly absent, never silently partial" applies with full force.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { account } = await requireAccount(`/clients/${id}/statement`);

  const sp = request.nextUrl.searchParams;
  const period = resolveStatementPeriod(
    { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined },
    todayIso()
  );

  const supabase = await createClient();
  const result = await buildClientStatement(supabase, account.id, id, period);

  if (!result.ok) {
    // friendlyDbError logs the real code/message server-side and returns a
    // sentence with no schema details in it — nothing here leaks whether a
    // 404 was "not real" or "not yours".
    const message =
      result.reason === "not_found"
        ? "Not found."
        : friendlyDbError(result.error, "client-statement.print");
    return NextResponse.json(
      { error: message },
      { status: result.reason === "not_found" ? 404 : 500 }
    );
  }

  if (result.statement.truncated) {
    return NextResponse.json(
      {
        error:
          "This period has more invoices than a single statement can safely total. Narrow the date range — printing a silently partial statement would misstate what's outstanding.",
      },
      { status: 500 }
    );
  }

  const html = renderStatementHtml({
    account: { name: account.legal_name, address: account },
    client: {
      name: result.statement.client.name,
      contactName: result.statement.client.contact_name,
      address: result.statement.client,
    },
    period,
    rows: result.statement.rows,
    totals: result.statement.totals,
    generatedOn: todayIso(),
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
