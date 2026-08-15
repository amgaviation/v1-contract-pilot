import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf, type InvoicePdfLine } from "@/lib/invoice-pdf";
import { decodeEmbeddableReceipt } from "@/lib/receipt-image";
import {
  classifyReceiptBytes,
  receiptFallbackNote,
  RECEIPTS_UNAVAILABLE_NOTE,
  type ReceiptAttachment,
} from "@/lib/invoice-receipts";
import {
  resolveBillTo,
  type BillTo,
  type BillToInvoiceRow,
} from "@/lib/invoice-bill-to";
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
  /**
   * How many receipts were GENUINELY EMBEDDED as image pages — a real,
   * decoded JPEG/PNG the client can actually see. This deliberately EXCLUDES
   * the honest caption/fallback pages (a PDF-format receipt, an unsupported
   * format, a fetch failure, a corrupt image that wouldn't decode): those are
   * pages ABOUT a receipt, not the receipt itself, and the email must not
   * claim an image the attachment doesn't carry. 0 when receipts were toggled
   * off, when no rebill line has one, and when every receipt degraded to a
   * fallback page. The one number the email body copy is allowed to speak to
   * (lib/email/invoice-message.ts) — see that field's own note.
   */
  receiptCount: number;
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

type InvoiceRow = BillToInvoiceRow & {
  id: string;
  invoice_number: string | null;
  issued_on: string | null;
  due_on: string | null;
  notes: string | null;
};

/**
 * Every column resolveBillTo needs, in the order the select below asks for
 * them. Named here so the select string and the type cannot drift: a column
 * dropped from the query would otherwise arrive as undefined and render an
 * empty line on a client's bill with nothing to say so.
 */
const BILL_TO_COLUMNS =
  "bill_to_name, bill_to_contact_name, bill_to_address_line1, bill_to_address_line2, bill_to_city, bill_to_state, bill_to_postal_code, bill_to_country";

type TotalsRow = {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  balance_due_cents: number;
};

/*
 * The receipt decode gate that used to live here is now lib/receipt-image.ts,
 * shared with the client-facing share page (lib/invoice-share-receipts.ts).
 * It moved rather than being copied: the two surfaces fail differently and a
 * divergence between them would only ever be found by the pilot's client.
 * Called below with no options, which is exactly its previous behaviour —
 * full size, JPEG quality 90.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function buildInvoiceDocument(
  supabase: SupabaseClient<any, any, any>,
  accountId: string,
  invoiceId: string,
  options?: {
    /**
     * Append each rebilled-expense line's receipt as an extra PDF page.
     * Defaults ON — an invoice that rebills expenses normally travels with
     * its receipts (that is the substantiation norm the rebill exists
     * for) — and both surfaces (the pdf route's `?receipts=0`, the send
     * dialog's checkbox) let the pilot turn it off per document.
     */
    includeReceipts?: boolean;
  }
): Promise<InvoiceDocumentResult> {
  const includeReceipts = options?.includeReceipts ?? true;
  const [
    { data: invoiceData, error: invoiceError },
    { data: lineData, error: lineError },
    { data: totalsData, error: totalsError },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        `id, client_id, invoice_number, issued_on, due_on, notes, ${BILL_TO_COLUMNS}`
      )
      .eq("id", invoiceId)
      .eq("account_id", accountId) // defence in depth alongside RLS
      .maybeSingle(),
    supabase
      .from("invoice_lines")
      // expense_id rides along solely to find rebill lines' receipts below;
      // it is never rendered (the PDF shows the client the same fields it
      // always has).
      .select("description, quantity, unit_amount_cents, amount_cents, expense_id")
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

  // THE CLIENT READ IS SKIPPED ENTIRELY WHEN THERE IS NO CLIENT. Not issued
  // and discarded: `.eq("id", null)` is a query that means nothing, and a
  // round trip whose result is thrown away is a round trip that can fail and
  // be misread as a missing client.
  const [{ data: accountRow }, clientResult] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "legal_name, logo_url, address_line1, address_line2, city, state, postal_code, country"
      )
      .eq("id", accountId)
      .maybeSingle(),
    invoice.client_id === null
      ? Promise.resolve({ data: null })
      : supabase
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
  const clientInfo = clientResult.data as
    | (AddressFields & { name: string; contact_name: string | null })
    | null;

  // resolveBillTo (lib/invoice-bill-to.ts) returns null for exactly one
  // reason: this invoice NAMES a client and that client row did not come
  // back. That stays a hard failure, unchanged from when it was written as
  // `!clientInfo` here, because a bill with an empty "Bill to" block is a
  // document that cannot be paid and looks like nobody's fault.
  //
  // A clientless invoice never takes that branch: bill_to_name is non-null
  // whenever client_id is null (invoices_bill_to_or_client, 20260815100000),
  // so there is always a name to head the block with.
  const billTo: BillTo | null = resolveBillTo(invoice, clientInfo);

  if (!accountInfo || !billTo) {
    return { ok: false, reason: "not_found", error: "Not found." };
  }

  const lines = (lineData ?? []) as (InvoicePdfLine & { expense_id: string | null })[];
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

  // RECEIPT PAGES for rebilled expenses. Same never-fail-the-invoice
  // contract as the logo above, page by page: every failure mode along this
  // path — the metadata read, the bucket download, a format react-pdf can't
  // embed (PDF receipts, HEIC, WebP) — degrades to an honestly-captioned
  // page (copy in lib/invoice-receipts.ts) or, for the metadata read, one
  // honest notice page, and NEVER to a failed document. The bytes are
  // classified by magic number, not by extension or stored content type,
  // because renderToBuffer is where a wrong guess would explode — see
  // classifyReceiptBytes's own header.
  //
  // A rebill line whose expense simply has NO receipt on file gets no page
  // at all: nothing exists to attach and a "missing receipt" page would
  // invent a problem in front of the client.
  const receipts: ReceiptAttachment[] = [];
  const rebillLines = lines.filter(
    (line): line is (typeof lines)[number] & { expense_id: string } =>
      line.expense_id !== null
  );
  if (includeReceipts && rebillLines.length > 0) {
    const { data: expenseData, error: expenseError } = await supabase
      .from("expenses")
      .select("id, receipt_path")
      .in(
        "id",
        rebillLines.map((line) => line.expense_id)
      )
      .eq("account_id", accountId);

    if (expenseError) {
      console.error(
        "[invoice-document] receipt metadata unavailable, rendering notice page",
        expenseError.message
      );
      receipts.push({
        description: "Receipts for rebilled expenses",
        amountCents: null,
        imageDataUri: null,
        note: RECEIPTS_UNAVAILABLE_NOTE,
      });
    } else {
      const receiptPathByExpense = new Map(
        ((expenseData ?? []) as { id: string; receipt_path: string | null }[]).map((e) => [
          e.id,
          e.receipt_path,
        ])
      );
      for (const line of rebillLines) {
        const path = receiptPathByExpense.get(line.expense_id);
        if (!path) continue; // no receipt on file — nothing to attach
        const base = { description: line.description, amountCents: line.amount_cents };
        // Same folder check as the logo: the first path segment is the
        // tenant key (storage RLS enforces it too — this is defence in
        // depth, not the boundary).
        if (!path.startsWith(`${accountId}/`)) {
          receipts.push({ ...base, imageDataUri: null, note: receiptFallbackNote("unavailable") });
          continue;
        }
        try {
          const { data: blob, error: receiptError } = await supabase.storage
            .from("receipts")
            .download(path);
          if (receiptError || !blob) {
            throw new Error(receiptError?.message ?? "empty receipt download");
          }
          const bytes = Buffer.from(await blob.arrayBuffer());
          const classified = classifyReceiptBytes(bytes);
          if (classified.kind === "image") {
            // The magic number said JPEG/PNG; a real decode says whether the
            // rest of the file agrees. A truncated or corrupt image that only
            // LOOKS embeddable is sent to the same fallback page as a PDF or
            // HEIC receipt — never embedded blank, never counted as included.
            const decoded = await decodeEmbeddableReceipt(bytes, classified.mime);
            if (decoded) {
              receipts.push({
                ...base,
                imageDataUri: `data:${classified.mime};base64,${decoded.toString("base64")}`,
                note: null,
              });
            } else {
              receipts.push({
                ...base,
                imageDataUri: null,
                note: receiptFallbackNote("unavailable"),
              });
            }
          } else {
            receipts.push({
              ...base,
              imageDataUri: null,
              note: receiptFallbackNote(classified.kind),
            });
          }
        } catch (cause) {
          console.error(
            "[invoice-document] receipt unavailable, rendering caption page",
            cause
          );
          receipts.push({ ...base, imageDataUri: null, note: receiptFallbackNote("unavailable") });
        }
      }
    }
  }

  const buffer = await renderToBuffer(
    <InvoicePdf
      logoDataUri={logoDataUri}
      account={accountInfo}
      client={billTo}
      invoice={invoice}
      lines={lines}
      totals={totals}
      receipts={receipts}
    />
  );

  return {
    ok: true,
    document: {
      buffer,
      filename: `${invoice.invoice_number ?? `invoice-${invoice.id.slice(0, 8)}`}.pdf`,
      invoiceNumber: invoice.invoice_number,
      dueOn: invoice.due_on,
      clientName: billTo.name,
      accountName: accountInfo.legal_name,
      totalCents: totals.total_cents,
      balanceDueCents: totals.balance_due_cents,
      // Only the receipts that carry a real, decoded image — the caption/
      // fallback pages (imageDataUri === null) are excluded so the email
      // never claims an image the attachment doesn't contain.
      receiptCount: receipts.filter((r) => r.imageDataUri !== null).length,
    },
  };
}
