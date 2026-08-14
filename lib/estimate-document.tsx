import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { EstimatePdf, type EstimatePdfLine } from "@/lib/estimate-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * THE ESTIMATE PDF, BUILT IN ONE PLACE — same reason as
 * lib/invoice-document.tsx's own header: the download route and the email
 * attachment must render byte-identical bytes, or the document a pilot
 * previews and the one their client receives could disagree about what was
 * quoted. So both call this, and there is no third path.
 *
 * Deliberately simpler than buildInvoiceDocument: an estimate has no
 * payments, no rebilled-expense receipts, and no reminder machinery, so
 * none of that plumbing is reproduced here. See lib/estimate-pdf.tsx's own
 * header for what else an estimate document must NOT say.
 */

export type EstimateDocument = {
  buffer: Buffer;
  filename: string;
  estimateNumber: string | null;
  status: string;
  validUntil: string | null;
  clientName: string;
  accountName: string;
  totalCents: number;
};

export type EstimateDocumentResult =
  | { ok: true; document: EstimateDocument }
  | { ok: false; reason: "not_found" | "load_failed"; error: string };

type AddressFields = {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

type EstimateRow = {
  id: string;
  client_id: string;
  estimate_number: string | null;
  status: string;
  issued_on: string | null;
  valid_until: string | null;
  terms: string | null;
  notes: string | null;
};

type TotalsRow = {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function buildEstimateDocument(
  supabase: SupabaseClient<any, any, any>,
  accountId: string,
  estimateId: string
): Promise<EstimateDocumentResult> {
  const [
    { data: estimateData, error: estimateError },
    { data: lineData, error: lineError },
    { data: totalsData, error: totalsError },
  ] = await Promise.all([
    supabase
      .from("estimates")
      .select("id, client_id, estimate_number, status, issued_on, valid_until, terms, notes")
      .eq("id", estimateId)
      .eq("account_id", accountId) // defence in depth alongside RLS
      .maybeSingle(),
    supabase
      .from("estimate_lines")
      .select("description, quantity, unit_amount_cents, amount_cents")
      .eq("estimate_id", estimateId)
      .eq("account_id", accountId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("estimate_totals").select("*").eq("estimate_id", estimateId).maybeSingle(),
  ]);

  if (estimateError) {
    return { ok: false, reason: "load_failed", error: "Couldn't load that estimate." };
  }

  const estimate = estimateData as EstimateRow | null;
  // A missing row and a cross-tenant row look identical under RLS — no
  // distinct message that would tell an attacker which one they hit.
  if (!estimate) {
    return { ok: false, reason: "not_found", error: "Not found." };
  }
  if (lineError) {
    return {
      ok: false,
      reason: "load_failed",
      error: "Couldn't load that estimate's lines.",
    };
  }
  // Same reasoning as buildInvoiceDocument: a failed totals read must not
  // degrade to a fabricated $0.00 document, especially one that is about to
  // be emailed to a client.
  if (totalsError) {
    return {
      ok: false,
      reason: "load_failed",
      error: "Couldn't load that estimate's totals.",
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
      .eq("id", estimate.client_id)
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

  const lines = (lineData ?? []) as EstimatePdfLine[];
  const totals = (totalsData as TotalsRow | null) ?? {
    subtotal_cents: 0,
    tax_cents: 0,
    total_cents: 0,
  };

  // Same never-fail-the-document contract as buildInvoiceDocument's own
  // logo fetch: any failure degrades to a text-only estimate, never to a
  // failed document.
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
      console.error("[estimate-document] logo unavailable, rendering without it", cause);
    }
  }

  const buffer = await renderToBuffer(
    <EstimatePdf
      logoDataUri={logoDataUri}
      account={accountInfo}
      client={clientInfo}
      estimate={estimate}
      lines={lines}
      totals={totals}
    />
  );

  return {
    ok: true,
    document: {
      buffer,
      filename: `${estimate.estimate_number ?? `estimate-${estimate.id.slice(0, 8)}`}.pdf`,
      estimateNumber: estimate.estimate_number,
      status: estimate.status,
      validUntil: estimate.valid_until,
      clientName: clientInfo.name,
      accountName: accountInfo.legal_name,
      totalCents: totals.total_cents,
    },
  };
}
