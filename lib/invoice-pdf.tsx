/**
 * The invoice PDF, rendered with @react-pdf/renderer.
 *
 * Carries NO product branding — see lib/brand.ts's own comment: "an
 * invoice PDF... carries no AMG branding." This document is the pilot's
 * own, going to the pilot's OWN client, so it renders only the account's
 * legal_name/address, never the product name.
 *
 * Colours come from lib/pdf-palette.ts, which re-derives them from the
 * same Radix scales the screens render from (@radix-ui/colors, the plain
 * JS publication of Radix Themes' own palette). react-pdf has its own
 * styling engine and cannot reach CSS custom properties, so the palette
 * module is the bridge: restyle the <Theme> in app/layout.tsx and the
 * invoice follows, which is what docs/PLAN.md decision #20 requires of
 * every visual value. Note that scripts/verify-tokens.mjs only catches
 * hex and rgb()/hsl() literals, so plain named colours ("black", "grey")
 * would have passed CI here while still hardcoding the look of the one
 * artifact a customer keeps.
 */
import { Document, Image, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_PALETTE } from "@/lib/pdf-palette";
import { formatCents, formatDate } from "@/lib/format";

export type InvoicePdfLine = {
  description: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
};

export type InvoicePdfProps = {
  /**
   * The pilot's own logo as a base64 data URI, or null. Null is a normal
   * state, not an error — most accounts have no logo, and one that cannot
   * be fetched must not stop the invoice rendering.
   */
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
  invoice: {
    invoice_number: string | null;
    issued_on: string | null;
    due_on: string | null;
    notes: string | null;
  };
  lines: InvoicePdfLine[];
  totals: {
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    amount_paid_cents: number;
    balance_due_cents: number;
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
  notes: { marginTop: 24, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: PDF_PALETTE.hairline },
  // Bounded box, not a fixed size: `objectFit: contain` keeps a wide
  // wordmark and a square badge both legible without distorting either.
  logo: { maxWidth: 160, maxHeight: 48, objectFit: "contain", marginBottom: 6 },
});

export function InvoicePdf({
  logoDataUri,
  account,
  client,
  invoice,
  lines,
  totals,
}: InvoicePdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.row}>
          <View>
            <Text style={styles.h1}>Invoice</Text>
            <Text style={styles.block}>
              {invoice.invoice_number ?? "—"}
            </Text>
            {invoice.issued_on ? <Text>Issued {formatDate(invoice.issued_on)}</Text> : null}
            {invoice.due_on ? <Text>Due {formatDate(invoice.due_on)}</Text> : null}
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

        <View style={styles.row}>
          <View>
            <Text style={styles.label}>Bill to</Text>
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
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Paid</Text>
            <Text>{formatCents(totals.amount_paid_cents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalStrong}>Balance due</Text>
            <Text style={styles.totalStrong}>{formatCents(totals.balance_due_cents)}</Text>
          </View>
        </View>

        {invoice.notes ? (
          <View style={styles.notes}>
            <Text style={styles.label}>Notes</Text>
            <Text>{invoice.notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
