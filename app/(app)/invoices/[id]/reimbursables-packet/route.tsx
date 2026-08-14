import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { decodeEmbeddableReceipt } from "@/lib/receipt-image";
import {
  classifyReceiptBytes,
  receiptFallbackNote,
  type ReceiptAttachment,
} from "@/lib/invoice-receipts";
import {
  ReimbursablesPacketPdf,
  type ReimbursableCategoryTotal,
  type ReimbursableItem,
} from "@/lib/reimbursables-packet-pdf";

// @react-pdf/renderer needs Node APIs, same requirement as the invoice PDF
// route this mirrors (see that route's own comment).
export const runtime = "nodejs";
// Always the invoice's CURRENT rebilled expenses, never a cached artifact.
export const dynamic = "force-dynamic";

/**
 * The reimbursables packet download — roadmap #1's remainder. Sibling to
 * app/(app)/invoices/[id]/pdf/route.tsx rather than a branch inside it: the
 * two documents answer different questions (see
 * lib/reimbursables-packet-pdf.tsx's header) and a query flag toggling
 * between two unrelated PDFs on one route would be the wrong seam.
 *
 * The I/O here is a deliberate near-duplicate of
 * lib/invoice-document.tsx's receipt-assembly block rather than a shared
 * helper: that block is reached today only from the invoice document (the
 * download route and the email attachment), and factoring out a third
 * caller's worth of shared plumbing was judged not worth widening that
 * file's contract under this feature's time budget. The RULES are not
 * duplicated by accident — classify-by-bytes, decode-before-embed,
 * never-fail-the-document — they are copied on purpose from the one place
 * they are argued for, lib/invoice-receipts.ts and lib/receipt-image.ts,
 * and called through the same shared functions.
 */
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
    categoryLabels,
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, invoice_number, issued_on")
      .eq("id", id)
      .eq("account_id", account.id) // defence in depth alongside RLS
      .maybeSingle(),
    // Only rebill lines carry expense_id — the same filter
    // lib/invoice-document.tsx uses to find receipts to attach.
    supabase
      .from("invoice_lines")
      .select("description, amount_cents, expense_id")
      .eq("invoice_id", id)
      .eq("account_id", account.id)
      .not("expense_id", "is", null)
      .order("sort_order", { ascending: true }),
    loadOptionLabels("expense_category"),
  ]);

  if (invoiceError) {
    return NextResponse.json({ error: "Couldn't load that invoice." }, { status: 500 });
  }
  const invoice = invoiceData as
    | { id: string; invoice_number: string | null; issued_on: string | null }
    | null;
  // A missing row and a cross-tenant row look identical under RLS.
  if (!invoice) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (lineError) {
    return NextResponse.json(
      { error: "Couldn't load that invoice's rebilled expenses." },
      { status: 500 }
    );
  }

  const rebillLines = (
    (lineData ?? []) as {
      description: string;
      amount_cents: number;
      expense_id: string | null;
    }[]
  ).filter(
    (line): line is typeof line & { expense_id: string } => line.expense_id !== null
  );

  // The download button (pdf-download.tsx) only ever renders this link when
  // the invoice carries rebilled receipts — this is the honest response to
  // anyone who hits the route directly on an invoice that has none, rather
  // than an empty-but-successful PDF.
  if (rebillLines.length === 0) {
    return NextResponse.json(
      { error: "This invoice has no rebilled expenses to pack." },
      { status: 404 }
    );
  }

  const { data: expenseData, error: expenseError } = await supabase
    .from("expenses")
    .select("id, incurred_on, category, vendor, receipt_path")
    .in(
      "id",
      rebillLines.map((line) => line.expense_id)
    )
    .eq("account_id", account.id);

  if (expenseError) {
    return NextResponse.json(
      { error: "Couldn't load the rebilled expenses' records." },
      { status: 500 }
    );
  }

  const expenseById = new Map(
    (
      (expenseData ?? []) as {
        id: string;
        incurred_on: string;
        category: string;
        vendor: string | null;
        receipt_path: string | null;
      }[]
    ).map((expense) => [expense.id, expense])
  );

  // ITEMS AND CATEGORY TOTALS, priced from the INVOICE LINE'S amount — see
  // lib/reimbursables-packet-pdf.tsx's header for why that is the billed
  // figure this packet reconciles against, not the expense's own recorded
  // cost. A line whose expense the expenses read didn't return (a rare
  // cross-tenant-timing edge, not an ordinary state) is skipped rather than
  // fabricating a category for it — the total below is summed from exactly
  // the items actually printed, so the packet never claims a total larger
  // than what it itemizes.
  const items: ReimbursableItem[] = [];
  const categoryTotals = new Map<string, { count: number; amountCents: number }>();
  for (const line of rebillLines) {
    const expense = expenseById.get(line.expense_id);
    if (!expense) continue;
    const categoryLabel = categoryLabels[expense.category] ?? expense.category;
    items.push({
      incurredOn: expense.incurred_on,
      category: categoryLabel,
      vendor: expense.vendor,
      description: line.description,
      amountCents: line.amount_cents,
    });
    const bucket = categoryTotals.get(categoryLabel) ?? { count: 0, amountCents: 0 };
    bucket.count += 1;
    bucket.amountCents += line.amount_cents;
    categoryTotals.set(categoryLabel, bucket);
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: "This invoice's rebilled expenses couldn't be matched to their records." },
      { status: 500 }
    );
  }

  const categories: ReimbursableCategoryTotal[] = [...categoryTotals.entries()]
    .map(([category, bucket]) => ({ category, ...bucket }))
    .sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category));
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);

  // RECEIPT PAGES — the same never-fail-the-document contract as
  // lib/invoice-document.tsx's own block: every failure mode (missing
  // receipt, unreachable storage, a format react-pdf can't embed, a file
  // that only looks embeddable) degrades to an honestly-captioned page,
  // never to a failed packet.
  const receipts: ReceiptAttachment[] = [];
  for (const line of rebillLines) {
    const expense = expenseById.get(line.expense_id);
    if (!expense || !expense.receipt_path) continue; // no receipt on file
    const base = { description: line.description, amountCents: line.amount_cents };
    if (!expense.receipt_path.startsWith(`${account.id}/`)) {
      receipts.push({ ...base, imageDataUri: null, note: receiptFallbackNote("unavailable") });
      continue;
    }
    try {
      const { data: blob, error: receiptError } = await supabase.storage
        .from("receipts")
        .download(expense.receipt_path);
      if (receiptError || !blob) {
        throw new Error(receiptError?.message ?? "empty receipt download");
      }
      const bytes = Buffer.from(await blob.arrayBuffer());
      const classified = classifyReceiptBytes(bytes);
      if (classified.kind === "image") {
        const decoded = await decodeEmbeddableReceipt(bytes, classified.mime);
        receipts.push(
          decoded
            ? {
                ...base,
                imageDataUri: `data:${classified.mime};base64,${decoded.toString("base64")}`,
                note: null,
              }
            : { ...base, imageDataUri: null, note: receiptFallbackNote("unavailable") }
        );
      } else {
        receipts.push({ ...base, imageDataUri: null, note: receiptFallbackNote(classified.kind) });
      }
    } catch (cause) {
      console.error(
        "[reimbursables-packet] receipt unavailable, rendering caption page",
        cause
      );
      receipts.push({ ...base, imageDataUri: null, note: receiptFallbackNote("unavailable") });
    }
  }

  const buffer = await renderToBuffer(
    <ReimbursablesPacketPdf
      account={{ legal_name: account.legal_name }}
      invoice={invoice}
      categories={categories}
      items={items}
      totalCents={totalCents}
      receipts={receipts}
    />
  );

  const filename = `${
    invoice.invoice_number ?? `invoice-${invoice.id.slice(0, 8)}`
  }-reimbursables.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
