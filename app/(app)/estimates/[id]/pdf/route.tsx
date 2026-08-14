import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { buildEstimateDocument } from "@/lib/estimate-document";

// @react-pdf/renderer needs Node APIs — same reason invoices/[id]/pdf/route.tsx
// pins this.
export const runtime = "nodejs";
// A fresh document reflecting the estimate's CURRENT lines/totals every
// time, never a cached artifact.
export const dynamic = "force-dynamic";

/**
 * The download path. Mirrors app/(app)/invoices/[id]/pdf/route.tsx: all the
 * actual work lives in lib/estimate-document.tsx (shared with the email
 * attachment), and this route's only job is turning a failure reason into
 * an HTTP status code. No query parameters (an estimate has no receipts
 * toggle), so unlike the invoice route this has no use for the request.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { account } = await requireEntitlement("estimates", `/estimates/${id}`);

  const supabase = await createClient();
  const result = await buildEstimateDocument(supabase, account.id, id);

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
