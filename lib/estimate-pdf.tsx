/**
 * The estimate PDF, rendered with @react-pdf/renderer. Mirrors
 * lib/invoice-pdf.tsx's layout and branding rules exactly — same palette
 * bridge, same "no AMG branding, only the pilot's own business identity"
 * rule (see that file's header) — with the differences a QUOTE requires:
 *
 *   - clearly labelled "Estimate", never "Invoice", with its own status
 *     shown (a client reading a downloaded PDF days later should not have
 *     to guess whether this price still stands);
 *   - a valid-until date instead of a due date — an estimate is a price
 *     that expires, not a bill that is owed;
 *   - NO payment terms, remit instructions, "amount paid" or "balance
 *     due" — pilot.estimates' own migration comment is explicit that an
 *     estimate "is not a financial record… no payment can be recorded
 *     against it", and this document must not imply otherwise;
 *   - "Quote for" rather than "Bill to" — the recipient is being quoted a
 *     price, not billed one.
 *
 * Colours come from lib/pdf-palette.ts for the same reason invoice-pdf.tsx
 * uses it — see that file's header.
 */
import { Document, Image, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_PALETTE } from "@/lib/pdf-palette";
import { formatCents, formatDate } from "@/lib/format";

export type EstimatePdfLine = {
  description: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
};

/**
 * The four statuses pilot.estimates.status allows, duplicated from
 * app/(app)/estimates/estimate-lib.ts's ESTIMATE_STATUS_BADGE rather than
 * imported — that file lives under another agent's territory this
 * session and lib/ code should not reach up into app/ for a four-entry
 * vocabulary map. If the migration's status list changes, change both.
 */
const ESTIMATE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
};

export type EstimatePdfProps = {
  /** The pilot's own logo, or null — same "absence is normal" rule as invoices. */
  logoDataUri?: string | null;
  account: {
    legal_name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  client: {
    name: string;
    contact_name: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  estimate: {
    estimate_number: string | null;
    status: string;
    issued_on: string | null;
    valid_until: string | null;
    terms: string | null;
    notes: string | null;
  };
  lines: EstimatePdfLine[];
  totals: {
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
  };
};

function addressLines(a: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}): string[] {
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(", ");
  return [a.address_line1, a.address_line2, cityLine || null, a.country].filter(
    (line): line is string => Boolean(line && line.trim())
  );
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: PDF_PALETTE.ink, fontFamily: "Helvetica" },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  h1: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  label: { fontSize: 8, color: PDF_PALETTE.muted, textTransform: "uppercase", marginBottom: 2 },
  block: { marginBottom: 4 },
  status: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  banner: {
    marginBottom: 16,
    padding: 8,
    backgroundColor: PDF_PALETTE.hairline,
    fontSize: 9,
    color: PDF_PALETTE.muted,
  },
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
  colDescription: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" },
  colUnit: { flex: 1, textAlign: "right" },
  colAmount: { flex: 1, textAlign: "right" },
  headText: { fontFamily: "Helvetica-Bold", fontSize: 8, textTransform: "uppercase" },
  totals: { marginTop: 16, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 200, justifyContent: "space-between", marginBottom: 2 },
  totalLabel: { color: PDF_PALETTE.muted },
  totalStrong: { fontFamily: "Helvetica-Bold" },
  section: { marginTop: 24, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: PDF_PALETTE.hairline },
  logo: { maxWidth: 160, maxHeight: 48, objectFit: "contain", marginBottom: 6 },
});

export function EstimatePdf({
  logoDataUri,
  account,
  client,
  estimate,
  lines,
  totals,
}: EstimatePdfProps) {
  const statusLabel = ESTIMATE_STATUS_LABEL[estimate.status] ?? estimate.status;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.row}>
          <View>
            <Text style={styles.h1}>Estimate</Text>
            <Text style={styles.block}>{estimate.estimate_number ?? "—"}</Text>
            <Text style={styles.status}>Status: {statusLabel}</Text>
            {estimate.issued_on ? <Text>Issued {formatDate(estimate.issued_on)}</Text> : null}
            {estimate.valid_until ? (
              <Text>Valid until {formatDate(estimate.valid_until)}</Text>
            ) : null}
          </View>
          <View>
            {logoDataUri ? (
              /* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's
                 Image takes no alt; a PDF has no accessibility tree here. */
              <Image style={styles.logo} src={logoDataUri} />
            ) : null}
            <Text style={styles.label}>From</Text>
            <Text style={styles.block}>{account.legal_name}</Text>
            {addressLines(account).map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </View>
        </View>

        {/* THE LABEL A CLIENT MUST NOT MISS: a price, not a bill. No due
            date, no remit instructions, no "amount paid" appear anywhere
            on this document — see this file's own header. */}
        <View style={styles.banner}>
          <Text>
            This is an estimate of cost, not an invoice. No payment is due.
            {estimate.valid_until
              ? ` The price below is valid through ${formatDate(estimate.valid_until)}.`
              : ""}
          </Text>
        </View>

        <View style={styles.row}>
          <View>
            <Text style={styles.label}>Quote for</Text>
            <Text style={styles.block}>{client.name}</Text>
            {client.contact_name ? <Text>{client.contact_name}</Text> : null}
            {addressLines(client).map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.colDescription, styles.headText]}>Description</Text>
            <Text style={[styles.colQty, styles.headText]}>Qty</Text>
            <Text style={[styles.colUnit, styles.headText]}>Unit</Text>
            <Text style={[styles.colAmount, styles.headText]}>Amount</Text>
          </View>
          {lines.map((line, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.colDescription}>{line.description}</Text>
              <Text style={styles.colQty}>{line.quantity}</Text>
              <Text style={styles.colUnit}>{formatCents(line.unit_amount_cents)}</Text>
              <Text style={styles.colAmount}>{formatCents(line.amount_cents)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text>{formatCents(totals.subtotal_cents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text>{formatCents(totals.tax_cents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalStrong}>Total</Text>
            <Text style={styles.totalStrong}>{formatCents(totals.total_cents)}</Text>
          </View>
        </View>

        {estimate.terms ? (
          <View style={styles.section}>
            <Text style={styles.label}>Terms</Text>
            <Text>{estimate.terms}</Text>
          </View>
        ) : null}

        {estimate.notes ? (
          <View style={styles.section}>
            <Text style={styles.label}>Notes</Text>
            <Text>{estimate.notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
