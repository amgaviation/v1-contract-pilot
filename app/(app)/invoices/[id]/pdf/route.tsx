import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { InvoicePdf, type InvoicePdfLine } from "@/lib/invoice-pdf";

// @react-pdf/renderer needs Node APIs (its layout engine, fontkit, etc.) —
// not available on the Edge runtime.
export const runtime = "nodejs";
// This is a fresh document reflecting the invoice's CURRENT lines/totals
// every time, never a cached artifact.
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { account } = await requireAccount(`/invoices/${id}`);

  const supabase = await createClient();

  const [
    { data: invoiceData, error: invoiceError },
    { data: lineData, error: lineError },
    { data: totalsData },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, client_id, invoice_number, issued_on, due_on, notes")
      .eq("id", id)
      .eq("account_id", account.id) // defence in depth alongside RLS
      .maybeSingle(),
    supabase
      .from("invoice_lines")
      .select("description, quantity, unit_amount_cents, amount_cents")
      .eq("invoice_id", id)
      .eq("account_id", account.id)
      .order("sort_order", { ascending: true }),
    supabase.from("invoice_totals").select("*").eq("invoice_id", id).maybeSingle(),
  ]);

  if (invoiceError) {
    return NextResponse.json(
      { error: "Couldn't load that invoice." },
      { status: 500 }
    );
  }

  type InvoiceRow = {
    id: string;
    client_id: string;
    invoice_number: string | null;
    issued_on: string | null;
    due_on: string | null;
    notes: string | null;
  };
  const invoice = invoiceData as InvoiceRow | null;
  // A missing/cross-tenant row and a genuine 404 look identical under RLS
  // — no distinct message that would tell an attacker which.
  if (!invoice) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (lineError) {
    return NextResponse.json(
      { error: "Couldn't load that invoice's lines." },
      { status: 500 }
    );
  }

  const [{ data: accountRow }, { data: clientRow }] = await Promise.all([
    supabase
      .from("accounts")
      .select("legal_name, address_line1, address_line2, city, state, postal_code, country")
      .eq("id", account.id)
      .maybeSingle(),
    supabase
      .from("clients")
      .select(
        "name, contact_name, address_line1, address_line2, city, state, postal_code, country"
      )
      .eq("id", invoice.client_id)
      .eq("account_id", account.id)
      .maybeSingle(),
  ]);

  type AddressFields = {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  const accountInfo = accountRow as (AddressFields & { legal_name: string }) | null;
  const clientInfo = clientRow as
    | (AddressFields & { name: string; contact_name: string | null })
    | null;

  if (!accountInfo || !clientInfo) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const lines = (lineData ?? []) as InvoicePdfLine[];
  type TotalsRow = {
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    amount_paid_cents: number;
    balance_due_cents: number;
  };
  const totals = (totalsData as TotalsRow | null) ?? {
    subtotal_cents: 0,
    tax_cents: 0,
    total_cents: 0,
    amount_paid_cents: 0,
    balance_due_cents: 0,
  };

  const buffer = await renderToBuffer(
    <InvoicePdf
      account={accountInfo}
      client={clientInfo}
      invoice={invoice}
      lines={lines}
      totals={totals}
    />
  );

  const filename = `${invoice.invoice_number ?? `invoice-${invoice.id.slice(0, 8)}`}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
