import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { buildInvoiceDocument } from "@/lib/invoice-document";

// @react-pdf/renderer needs Node APIs (its layout engine, fontkit, etc.) —
// not available on the Edge runtime. buildInvoiceDocument pulls it in, so the
// requirement moved with the code but did not go away.
export const runtime = "nodejs";
// This is a fresh document reflecting the invoice's CURRENT lines/totals
// every time, never a cached artifact.
export const dynamic = "force-dynamic";

/**
 * The download path. Everything this route used to do inline now lives in
 * lib/invoice-document.tsx, because emailing an invoice needs the identical
 * bytes and two renderers would eventually disagree — see that file's header
 * for why that particular drift is the dangerous one.
 *
 * What stays here is the only thing that is genuinely HTTP's business: turning
 * a failure reason into a status code.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { account } = await requireAccount(`/invoices/${id}`);

  // `?receipts=0` renders the invoice WITHOUT the rebilled-expense receipt
  // pages. Anything else — absent, `1`, malformed — takes the default,
  // which is receipts ON (see buildInvoiceDocument's options comment for
  // why on is the default). The download button (pdf-download.tsx) is the
  // ordinary author of this parameter.
  const includeReceipts = request.nextUrl.searchParams.get("receipts") !== "0";

  const supabase = await createClient();
  const result = await buildInvoiceDocument(supabase, account.id, id, { includeReceipts });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.reason === "not_found" ? 404 : 500 }
    );
  }

  return new NextResponse(new Uint8Array(result.document.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${result.document.filename}"`,
    },
  });
}
