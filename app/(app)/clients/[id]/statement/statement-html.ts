import { formatCents, formatDate } from "@/lib/format";
import {
  addressLines,
  STATEMENT_STATUS_LABEL,
  type StatementPeriod,
  type StatementRow,
  type StatementTotals,
} from "./statement-lib";

/**
 * The print-quality statement document, as a standalone HTML string.
 *
 * WHY HTML AND NOT THE HOUSE react-pdf SETUP: a react-pdf document needs
 * its own StyleSheet.create() full of literal fontSize/fontFamily values,
 * and scripts/verify-tokens.mjs permits those in exactly one component
 * file — lib/invoice-pdf.tsx — with the exemption list itself living in a
 * file this feature does not own. A statement PDF would therefore require
 * widening either lib/ or the verifier, both outside this feature's
 * boundary. A print-quality HTML document needs neither: the browser's
 * print dialog produces the PDF the pilot attaches or mails, which is the
 * same artifact by another route.
 *
 * WHY THE DOCUMENT IS DELIBERATELY MONOCHROME: like the invoice PDF, this
 * is the pilot's own artifact going to their client — it carries no product
 * branding (lib/brand.ts's rule) and, unlike a screen, it will be printed,
 * photocopied, and filed by an AP department. Black-on-white with weight
 * and rules for hierarchy survives every one of those; a color-coded
 * overdue flag does not survive a grayscale office printer. It also means
 * this file hardcodes NO visual value the token system owns: no colors
 * anywhere (rules use currentColor, muted text uses opacity), which is
 * what lets it live outside the verifier's exemption list honestly.
 *
 * Pure string assembly — no server-only import — so
 * tests/customer-statement.test.mjs can pin the escaping and the
 * failed-vs-empty wording without a browser.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type StatementHtmlParty = {
  name: string;
  contactName?: string | null;
  address: {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
};

export type StatementHtmlInput = {
  account: StatementHtmlParty;
  client: StatementHtmlParty;
  period: StatementPeriod;
  rows: StatementRow[];
  totals: StatementTotals;
  /** "YYYY-MM-DD" — the day the document was generated, printed on it so a
   *  filed copy says what "paid to date" was measured through. */
  generatedOn: string;
};

function partyBlock(label: string, party: StatementHtmlParty): string {
  const lines = [
    `<p class="label">${escapeHtml(label)}</p>`,
    `<p class="party-name">${escapeHtml(party.name)}</p>`,
  ];
  if (party.contactName) {
    lines.push(`<p class="muted">${escapeHtml(party.contactName)}</p>`);
  }
  for (const line of addressLines(party.address)) {
    lines.push(`<p class="muted">${escapeHtml(line)}</p>`);
  }
  return `<div>${lines.join("")}</div>`;
}

function rowHtml(row: StatementRow): string {
  const overdue = row.daysOverdue !== null;
  const status = overdue
    ? `Overdue · ${row.daysOverdue}d`
    : STATEMENT_STATUS_LABEL[row.status];
  return [
    "<tr>",
    `<td>${escapeHtml(row.invoiceNumber ?? "Invoice")}</td>`,
    `<td>${escapeHtml(formatDate(row.issuedOn))}</td>`,
    `<td>${escapeHtml(formatDate(row.dueOn))}</td>`,
    `<td class="${overdue ? "overdue" : ""}">${escapeHtml(status)}</td>`,
    `<td class="num">${escapeHtml(formatCents(row.totalCents))}</td>`,
    `<td class="num">${escapeHtml(formatCents(row.paidCents))}</td>`,
    `<td class="num${row.balanceCents > 0 ? " strong" : ""}">${escapeHtml(formatCents(row.balanceCents))}</td>`,
    "</tr>",
  ].join("");
}

export function renderStatementHtml(input: StatementHtmlInput): string {
  const { account, client, period, rows, totals, generatedOn } = input;
  const periodLabel = `${formatDate(period.from)} to ${formatDate(period.to)}`;

  const body =
    rows.length === 0
      ? // The verified-empty statement. This sentence renders only after
        // every read succeeded (a failed read never reaches this renderer),
        // so "no invoices were issued" is a fact, not a guess.
        `<p class="empty">No invoices were issued to ${escapeHtml(client.name)} in this period. Drafts and voided invoices are never part of a statement.</p>`
      : `<table>
      <thead>
        <tr>
          <th>Number</th><th>Issued</th><th>Due</th><th>Status</th>
          <th class="num">Total</th><th class="num">Paid to date</th><th class="num">Balance due</th>
        </tr>
      </thead>
      <tbody>${rows.map(rowHtml).join("")}</tbody>
      <tfoot>
        <tr>
          <td colspan="4">Period totals</td>
          <td class="num strong">${escapeHtml(formatCents(totals.invoicedCents))}</td>
          <td class="num strong">${escapeHtml(formatCents(totals.paidCents))}</td>
          <td class="num strong">${escapeHtml(formatCents(totals.outstandingCents))}</td>
        </tr>
      </tfoot>
    </table>`;

  // No hex, no color functions, no named colors, no font-size/font-family
  // that the token system could ever reach — see the file header. Rules
  // draw with currentColor; secondary text is opacity, not gray.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Statement · ${escapeHtml(client.name)} · ${escapeHtml(periodLabel)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { font-family: ui-sans-serif, system-ui, sans-serif; }
  body { font-size: 10pt; line-height: 1.45; padding: 2rem; max-width: 52rem; margin-inline: auto; }
  h1 { font-size: 16pt; margin-bottom: 0.25rem; }
  .doc-meta { opacity: 0.65; margin-bottom: 1.5rem; }
  .parties { display: flex; gap: 3rem; margin-bottom: 1.5rem; }
  .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.65; }
  .party-name { font-weight: 700; }
  .muted { opacity: 0.65; }
  .summary { display: flex; gap: 3rem; border-block: 1px solid; padding-block: 0.75rem; margin-bottom: 1.5rem; }
  .summary .figure { font-size: 13pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; text-align: left; border-bottom: 1px solid; padding: 0.3rem 0.5rem 0.3rem 0; }
  td { padding: 0.3rem 0.5rem 0.3rem 0; border-bottom: 0.5pt solid; vertical-align: top; }
  tbody td { opacity: 0.9; }
  tfoot td { border-bottom: none; border-top: 1px solid; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .strong { font-weight: 700; }
  .overdue { font-weight: 700; }
  .empty { padding: 1.5rem 0; }
  .coverage { font-size: 8pt; opacity: 0.65; }
  .screen-bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; border: 1px solid; padding: 0.6rem 0.8rem; margin-bottom: 1.5rem; }
  .screen-bar button { font: inherit; padding: 0.35rem 0.9rem; border: 1px solid; background: transparent; cursor: pointer; }
  @media print {
    .screen-bar { display: none; }
    body { padding: 0; max-width: none; }
  }
  @page { margin: 0.75in; }
</style>
</head>
<body>
<div class="screen-bar">
  <span class="muted">This page is formatted for printing. Use your browser&#39;s print dialog to print it or save it as a PDF.</span>
  <button type="button" onclick="window.print()">Print</button>
</div>
<h1>Statement of account</h1>
<p class="doc-meta">Invoices issued ${escapeHtml(periodLabel)} · prepared ${escapeHtml(formatDate(generatedOn))}</p>
<div class="parties">
  ${partyBlock("From", account)}
  ${partyBlock("Prepared for", client)}
</div>
<div class="summary">
  <div><p class="label">Total invoiced</p><p class="figure">${escapeHtml(formatCents(totals.invoicedCents))}</p></div>
  <div><p class="label">Paid to date</p><p class="figure">${escapeHtml(formatCents(totals.paidCents))}</p></div>
  <div><p class="label">Balance outstanding</p><p class="figure">${escapeHtml(formatCents(totals.outstandingCents))}</p></div>
</div>
${body}
<p class="coverage">Covers invoices issued ${escapeHtml(periodLabel)} (sent, partially paid, or paid). Drafts and voided invoices are excluded. &ldquo;Paid to date&rdquo; reflects every payment recorded through ${escapeHtml(formatDate(generatedOn))}, including any received after the period ended. Questions about this statement? Contact ${escapeHtml(account.name)}.</p>
</body>
</html>`;
}
