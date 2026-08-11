import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf, type InvoicePdfLine } from "@/lib/invoice-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE INVOICE PDF, BUILT IN ONE PLACE.
 *
 * This was lifted out of app/(app)/invoices/[id]/pdf/route.tsx when emailing
 * an invoice was added, and the reason is the house rule rather than tidiness:
 * one source of truth per number. Two renderers reading two query sets would
 * eventually disagree, and the disagreement would be between the document a
 * pilot downloads and inspects and the document their client actually
 * receives and pays from. That is the worst possible place for a drift to
 * hide, because the only person positioned to notice is the one who was never
 * shown both.
 *
 * So the download route and the email attachment call this, and there is no
 * third path.
 *
 * `reason` exists so the HTTP caller can still choose a status code — a
 * missing invoice is a 404 and a failed totals read is a 500, and collapsing
 * them would be the same "we could not find out" versus "there is none"
 * confusion lib/supabase/rows.ts was written to end.
 */

export type InvoiceDocument = {
  buffer: Buffer;
  filename: string;
  invoiceNumber: string | null;
  dueOn: string | null;
  clientName: string;
  accountName: string;
  totalCents: number;
  balanceDueCents: number;
};

export type InvoiceDocumentResult =
  | { ok: true; document: InvoiceDocument }
  | { ok: false; reason: "not_found" | "load_failed"; error: string };

type AddressFields = {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

type InvoiceRow = {
  id: string;
  client_id: string;
  invoice_number: string | null;
  issued_on: string | null;
  due_on: string | null;
  notes: string | null;
};

type TotalsRow = {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  balance_due_cents: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function buildInvoiceDocument(
  supabase: SupabaseClient<any, any, any>,
  accountId: string,
  invoiceId: string
): Promise<InvoiceDocumentResult> {
  const [
    { data: invoiceData, error: invoiceError },
    { data: lineData, error: lineError },
    { data: totalsData, error: totalsError },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, client_id, invoice_number, issued_on, due_on, notes")
      .eq("id", invoiceId)
      .eq("account_id", accountId) // defence in depth alongside RLS
      .maybeSingle(),
    supabase
      .from("invoice_lines")
      .select("description, quantity, unit_amount_cents, amount_cents")
      .eq("invoice_id", invoiceId)
      .eq("account_id", accountId)
      .order("sort_order", { ascending: true }),
    supabase.from("invoice_totals").select("*").eq("invoice_id", invoiceId).maybeSingle(),
  ]);

  if (invoiceError) {
    return { ok: false, reason: "load_failed", error: "Couldn't load that invoice." };
  }

  const invoice = invoiceData as InvoiceRow | null;
  // A missing row and a cross-tenant row look identical under RLS — no
  // distinct message that would tell an attacker which one they hit.
  if (!invoice) {
    return { ok: false, reason: "not_found", error: "Not found." };
  }
  if (lineError) {
    return {
      ok: false,
      reason: "load_failed",
      error: "Couldn't load that invoice's lines.",
    };
  }
  // A failed totals read must NOT degrade to an all-zero document. The
  // on-screen invoice can fall back to a zeroed display because it shows the
  // real line items beside a visible error callout; this produces the
  // artifact the client keeps, with no such callout, so a failed read has to
  // fail the whole document rather than ship a real line-item list under a
  // fabricated $0.00 total and $0.00 balance due. Emailing it would be worse
  // still — the pilot would never see what was sent.
  if (totalsError) {
    return {
      ok: false,
      reason: "load_failed",
      error: "Couldn't load that invoice's totals.",
    };
  }

  const [{ data: accountRow }, { data: clientRow }] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "legal_name, logo_url, address_line1, address_line2, city, state, postal_code, country"
      )
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("clients")
      .select(
        "name, contact_name, address_line1, address_line2, city, state, postal_code, country"
      )
      .eq("id", invoice.client_id)
      .eq("account_id", accountId)
      .maybeSingle(),
  ]);

  const accountInfo = accountRow as
    | (AddressFields & { legal_name: string; logo_url: string | null })
    | null;
  const clientInfo = clientRow as
    | (AddressFields & { name: string; contact_name: string | null })
    | null;

  if (!accountInfo || !clientInfo) {
    return { ok: false, reason: "not_found", error: "Not found." };
  }

  const lines = (lineData ?? []) as InvoicePdfLine[];
  const totals = (totalsData as TotalsRow | null) ?? {
    subtotal_cents: 0,
    tax_cents: 0,
    total_cents: 0,
    amount_paid_cents: 0,
    balance_due_cents: 0,
  };

  // The logo is fetched as BYTES and handed to react-pdf as a data URI, not
  // as a URL. Two reasons: the bucket is private, so a URL would have to be
  // signed and react-pdf's fetch would race the 60-second expiry; and an
  // invoice must render even when the image cannot be reached. Any failure
  // here degrades to a text-only invoice rather than a failed document — a
  // pilot whose logo is momentarily unavailable still needs to bill.
  let logoDataUri: string | null = null;
  if (accountInfo.logo_url?.startsWith(`${accountId}/`)) {
    try {
      const { data: blob, error: logoError } = await supabase.storage
        .from("receipts")
        .download(accountInfo.logo_url);
      if (logoError) throw new Error(logoError.message);
      if (blob) {
        const bytes = Buffer.from(await blob.arrayBuffer());
        const mime = accountInfo.logo_url.endsWith(".png") ? "image/png" : "image/jpeg";
        logoDataUri = `data:${mime};base64,${bytes.toString("base64")}`;
      }
    } catch (cause) {
      console.error("[invoice-document] logo unavailable, rendering without it", cause);
    }
  }

  const buffer = await renderToBuffer(
    <InvoicePdf
      logoDataUri={logoDataUri}
      account={accountInfo}
      client={clientInfo}
      invoice={invoice}
      lines={lines}
      totals={totals}
    />
  );

  return {
    ok: true,
    document: {
      buffer,
      filename: `${invoice.invoice_number ?? `invoice-${invoice.id.slice(0, 8)}`}.pdf`,
      invoiceNumber: invoice.invoice_number,
      dueOn: invoice.due_on,
      clientName: clientInfo.name,
      accountName: accountInfo.legal_name,
      totalCents: totals.total_cents,
      balanceDueCents: totals.balance_due_cents,
    },
  };
}
