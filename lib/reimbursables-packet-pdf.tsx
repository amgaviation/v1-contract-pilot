/**
 * The reimbursables packet — a standalone PDF for an operator's AP desk,
 * distinct from the invoice PDF (lib/invoice-pdf.tsx) even though the two
 * share a receipt: this document exists because "here is the invoice"
 * and "here is what to audit before you pay it" are different asks. An AP
 * clerk reconciling a rebill doesn't want to page through flight-day line
 * items to find the receipts; they want the reimbursable total by
 * category, the itemized list that adds up to it, and the receipts —
 * nothing else.
 *
 * Three sections, in order, per roadmap #1's remainder:
 *   1. Summary — total reimbursable by category.
 *   2. Itemized detail — one row per rebilled expense.
 *   3. Receipts — one full page per receipt, same embedding rules as the
 *      invoice PDF (see lib/invoice-receipts.ts's header for why bytes are
 *      classified rather than trusted, and why a page with no image still
 *      carries an honest reason instead of nothing).
 *
 * PURE RENDERING ONLY. No Supabase, no storage fetch, no react-pdf
 * rendering call — those live in the route that calls this component
 * (app/(app)/invoices/[id]/reimbursables-packet/route.tsx), mirroring how
 * lib/invoice-pdf.tsx stays pure while lib/invoice-document.tsx does the
 * I/O for it. The caller is responsible for one thing this file assumes
 * without checking: `items` summed by category must equal `categories`,
 * and both must equal `totalCents` — this is a rendering surface, not a
 * reconciliation engine, so it prints whatever it's handed.
 *
 * WHICH DOLLAR FIGURE THIS PRINTS: the INVOICED amount of each rebill line
 * (invoice_lines.amount_cents), not the expense's own recorded
 * amount_cents. Those are normally identical — addRebillExpenseLine
 * (app/(app)/invoices/actions.ts) prices a rebill line at the expense's own
 * cost — but the invoice line is what the client is actually being asked
 * to pay, and a packet handed to an AP desk has to reconcile against the
 * invoice it accompanies, not against the pilot's private expense record.
 */
import { Document, Image, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_PALETTE } from "@/lib/pdf-palette";
import { formatCents, formatDate } from "@/lib/format";
import type { ReceiptAttachment } from "@/lib/invoice-receipts";

export type ReimbursableCategoryTotal = {
  /** Already resolved to the tenant's own label (loadOptionLabels), not
   *  the raw enum key. */
  category: string;
  count: number;
  amountCents: number;
};

export type ReimbursableItem = {
  incurredOn: string;
  /** Already resolved to the tenant's own label, same source as above. */
  category: string;
  vendor: string | null;
  description: string;
  amountCents: number;
};

export type ReimbursablesPacketPdfProps = {
  account: { legal_name: string };
  invoice: {
    invoice_number: string | null;
    issued_on: string | null;
  };
  categories: ReimbursableCategoryTotal[];
  items: ReimbursableItem[];
  totalCents: number;
  /** One page per entry — same shape and same fallback contract as
   *  InvoicePdf's own receipts prop. */
  receipts: ReceiptAttachment[];
};

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: PDF_PALETTE.ink, fontFamily: "Helvetica" },
  h1: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subhead: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 12, marginTop: 4 },
  block: { marginBottom: 4 },
  label: { fontSize: 8, color: PDF_PALETTE.muted, textTransform: "uppercase", marginBottom: 2 },
  header: { marginBottom: 24 },
  table: { marginTop: 12, borderTopWidth: 1, borderTopColor: PDF_PALETTE.ink },
  tableHeadRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_PALETTE.ink,
    paddingVertical: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_PALETTE.hairline,
    paddingVertical: 4,
  },
  colDate: { flex: 1 },
  colCategory: { flex: 1 },
  colCount: { flex: 1, textAlign: "right" },
  colDescription: { flex: 3 },
  colAmount: { flex: 1, textAlign: "right" },
  headText: { fontFamily: "Helvetica-Bold", fontSize: 8, textTransform: "uppercase" },
  totals: { marginTop: 16, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 220, justifyContent: "space-between", marginBottom: 2 },
  totalStrong: { fontFamily: "Helvetica-Bold" },
  receiptCaption: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  receiptImage: { marginTop: 12, maxWidth: "100%", maxHeight: 620, objectFit: "contain" },
  receiptNote: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: PDF_PALETTE.hairline,
    color: PDF_PALETTE.muted,
  },
});

export function ReimbursablesPacketPdf({
  account,
  invoice,
  categories,
  items,
  totalCents,
  receipts,
}: ReimbursablesPacketPdfProps) {
  const invoiceRef = invoice.invoice_number
    ? `Invoice ${invoice.invoice_number}`
    : "Draft invoice";
  return (
    <Document>
      {/* 1. SUMMARY */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.h1}>Reimbursables packet</Text>
          <Text style={styles.block}>{invoiceRef}</Text>
          {invoice.issued_on ? <Text>Issued {formatDate(invoice.issued_on)}</Text> : null}
          <Text style={styles.label}>From</Text>
          <Text>{account.legal_name}</Text>
        </View>

        <Text style={styles.subhead}>Total by category</Text>
        <View style={styles.table}>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.colDescription, styles.headText]}>Category</Text>
            <Text style={[styles.colCount, styles.headText]}>Receipts</Text>
            <Text style={[styles.colAmount, styles.headText]}>Total</Text>
          </View>
          {categories.map((row, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.colDescription}>{row.category}</Text>
              <Text style={styles.colCount}>{row.count}</Text>
              <Text style={styles.colAmount}>{formatCents(row.amountCents)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalStrong}>Total reimbursable</Text>
            <Text style={styles.totalStrong}>{formatCents(totalCents)}</Text>
          </View>
        </View>
      </Page>

      {/* 2. ITEMIZED DETAIL */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Itemized detail</Text>
        <Text style={styles.block}>{invoiceRef}</Text>
        <View style={styles.table}>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.colDate, styles.headText]}>Date</Text>
            <Text style={[styles.colCategory, styles.headText]}>Category</Text>
            <Text style={[styles.colDescription, styles.headText]}>Description</Text>
            <Text style={[styles.colAmount, styles.headText]}>Amount</Text>
          </View>
          {items.map((item, i) => (
            <View style={styles.tableRow} key={i} wrap={false}>
              <Text style={styles.colDate}>{formatDate(item.incurredOn)}</Text>
              <Text style={styles.colCategory}>{item.category}</Text>
              <Text style={styles.colDescription}>
                {item.description}
                {item.vendor ? ` — ${item.vendor}` : ""}
              </Text>
              <Text style={styles.colAmount}>{formatCents(item.amountCents)}</Text>
            </View>
          ))}
        </View>
      </Page>

      {/* 3. RECEIPTS — one page each, same fallback contract as InvoicePdf's
          own receipt pages (lib/invoice-pdf.tsx). */}
      {receipts.map((receipt, i) => (
        <Page size="LETTER" style={styles.page} key={`receipt-${i}`}>
          <Text style={styles.label}>Receipt — {invoiceRef}</Text>
          <Text style={styles.receiptCaption}>
            {receipt.description}
            {receipt.amountCents !== null ? ` — ${formatCents(receipt.amountCents)}` : ""}
          </Text>
          {receipt.imageDataUri ? (
            /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's
               Image takes no alt; a PDF has no accessibility tree here. */
            <Image style={styles.receiptImage} src={receipt.imageDataUri} />
          ) : (
            <Text style={styles.receiptNote}>{receipt.note}</Text>
          )}
        </Page>
      ))}
    </Document>
  );
}
