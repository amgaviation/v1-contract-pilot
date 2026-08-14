/**
 * The pilot-history report as a PDF, rendered with @react-pdf/renderer.
 *
 * WHY A SEPARATE MODULE RATHER THAN AN ADDITION TO lib/invoice-pdf.tsx:
 * these two documents share a renderer and nothing else. An invoice is a
 * demand for money with a totals block and a payment status; this is a
 * statement of experience that must not total anything it should not. They
 * have different letterheads, different tables and — most importantly —
 * different rules about what a number on them is allowed to mean. Putting
 * them in one file would put the invoice's totalling helpers one autocomplete
 * away from this document.
 *
 * WHAT IT SHARES, and it is the part that matters: lib/pdf-palette.ts.
 * @react-pdf/renderer has its own styling engine and cannot read CSS, so
 * that module is the bridge back to the same Radix scales every screen
 * renders from. Restyle the <Theme> in app/layout.tsx and both PDFs
 * follow. Read pdf-palette's own header before adding anything to it, and
 * note the trap it records: scripts/verify-tokens.mjs catches hex and
 * rgb()/hsl() literals but NOT plain named colours, so "black" or "grey"
 * would pass CI while hardcoding the look of a document a pilot hands to
 * an underwriter. Every colour below comes from PDF_PALETTE; the sizes and
 * weights are necessarily literal, which is exactly why this file is in
 * verify-tokens' EXEMPT_FILES alongside lib/invoice-pdf.tsx —
 * StyleSheet.create() is not CSS and not a JSX style prop and cannot take
 * a var() reference at all.
 *
 * ===========================================================================
 * NO PRODUCT BRANDING IN THE LETTERHEAD, and the reasoning is the invoice's
 * (lib/brand.ts): an invoice carries no branding because it is the pilot's
 * paper going to the pilot's own client. This document is the same kind of
 * thing one step further out — the pilot's own submission to an underwriter,
 * a management company or a chief pilot, on their own account. So the
 * letterhead is the ACCOUNT'S LEGAL NAME and nothing else.
 *
 * The single exception is the footer sentence, which names the product
 * because it is a provenance statement rather than a mark: it tells the
 * reader where the figures came from, which is information the reader of a
 * compiled document is entitled to. It is one line, at the bottom, in the
 * muted step, and it is assembled from BRAND rather than typed.
 *
 * ===========================================================================
 * THE LINE, verbatim, and it governs every string in this file: pure
 * arithmetic over what the pilot logged and recorded; NO currency or
 * legality conclusion anywhere, no regulation references in user-facing
 * copy, no "current" or "qualified" wording. A PDF is the surface where
 * that is easiest to breach, because a printed document reads as
 * authoritative and gets forwarded without the page around it. Nothing
 * here compares a figure to a minimum, and nothing here says what any
 * figure permits.
 */
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_PALETTE } from "@/lib/pdf-palette";
import { formatDate } from "@/lib/format";
import { BRAND } from "@/lib/brand";
import {
  compiledFromFooter,
  flagIsAnswerable,
  futureDatedNote,
  mixedProvenanceNote,
  totalInstrument,
  totalLandings,
  totalTakeoffs,
  unattributedEntriesNote,
  unrecordedHoursNote,
  UNMATCHED_LABEL,
  type BreakdownRow,
  type FlaggedHours,
  type PilotHistoryFigures,
  type RecordedDate,
} from "@/app/(app)/reports/pilot-history/report-lib";

export type PilotHistoryPdfProps = {
  account: {
    legal_name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  compiledOn: string;
  earliestEntryDate: string;
  latestEntryDate: string;
  /** Entries dated after today, excluded from every figure. Printed, for
   *  the same reason the screen prints it — and printed HERE especially,
   *  because this document is read beside the pilot's own logbook screen,
   *  whose career totals carry no upper date bound and so include them. A
   *  reader comparing the two must be able to see why they differ. */
  futureDatedEntryCount: number;
  /** Counted entries naming no airman. Zero on a single-seat account. */
  unattributedEntryCount: number;
  registeredAircraftCount: number;
  allTime: PilotHistoryFigures;
  lastTwelveMonths: PilotHistoryFigures;
  /** Last 90 calendar days, to date — see report-lib.ts's
   *  lastNinetyCalendarDays. Underwriter questionnaires typically ask for
   *  this alongside last-12-months and all-time. */
  lastNinetyDays: PilotHistoryFigures;
  recordedDates: RecordedDate[];
  hasUnattributedDates: boolean;
  /** Resolved document-kind labels, so a tenant who renamed a kind sees
   *  their own word here and on the screen alike. */
  kindLabels: Record<string, string>;
};

function addressLines(a: PilotHistoryPdfProps["account"]): string[] {
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(", ");
  return [a.address_line1, a.address_line2, cityLine || null, a.country].filter(
    (line): line is string => Boolean(line && line.trim())
  );
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: PDF_PALETTE.ink, fontFamily: "Helvetica" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  h2: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: PDF_PALETTE.ink,
  },
  label: { fontSize: 7, color: PDF_PALETTE.muted, textTransform: "uppercase", marginBottom: 2 },
  muted: { color: PDF_PALETTE.muted },
  block: { marginBottom: 3 },
  lede: { color: PDF_PALETTE.muted, marginBottom: 10, lineHeight: 1.4 },
  sectionNote: { color: PDF_PALETTE.muted, marginBottom: 4, lineHeight: 1.4 },
  sectionNoteAfter: { color: PDF_PALETTE.muted, marginTop: 6, lineHeight: 1.4 },

  tableHeadRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_PALETTE.ink,
    paddingVertical: 3,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_PALETTE.hairline,
    paddingVertical: 3,
  },
  headText: { fontFamily: "Helvetica-Bold", fontSize: 7, textTransform: "uppercase" },
  strong: { fontFamily: "Helvetica-Bold" },

  colLabel: { flex: 3 },
  colNum: { flex: 1, textAlign: "right" },
  colDate: { flex: 1.4 },

  flagRow: { marginBottom: 6 },
  footer: {
    marginTop: 20,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: PDF_PALETTE.hairline,
    color: PDF_PALETTE.muted,
    fontSize: 7,
    lineHeight: 1.4,
  },

  attestation: {
    marginTop: 24,
    paddingTop: 10,
  },
  signatureRow: { flexDirection: "row", marginTop: 26 },
  signatureBlock: { flex: 1, marginRight: 24 },
  signatureLine: {
    borderTopWidth: 0.75,
    borderTopColor: PDF_PALETTE.ink,
    marginBottom: 3,
    paddingTop: 3,
  },
});

function hours(value: number): string {
  return value.toFixed(1);
}

function ThreeColumnTable({
  rows,
  recentLabel,
  ninetyLabel,
}: {
  rows: { label: string; allTime: string; recent: string; ninety: string; strong?: boolean }[];
  recentLabel: string;
  ninetyLabel: string;
}) {
  return (
    <View>
      <View style={styles.tableHeadRow}>
        <Text style={[styles.colLabel, styles.headText]}> </Text>
        <Text style={[styles.colNum, styles.headText]}>All time</Text>
        <Text style={[styles.colNum, styles.headText]}>{recentLabel}</Text>
        <Text style={[styles.colNum, styles.headText]}>{ninetyLabel}</Text>
      </View>
      {rows.map((row) => (
        <View style={styles.row} key={row.label}>
          <Text style={[styles.colLabel, ...(row.strong ? [styles.strong] : [])]}>
            {row.label}
          </Text>
          <Text style={[styles.colNum, ...(row.strong ? [styles.strong] : [])]}>
            {row.allTime}
          </Text>
          <Text style={[styles.colNum, styles.muted]}>{row.recent}</Text>
          <Text style={[styles.colNum, styles.muted]}>{row.ninety}</Text>
        </View>
      ))}
    </View>
  );
}

function BreakdownTable({
  heading,
  rows,
  showLastFlown,
}: {
  heading: string;
  rows: BreakdownRow[];
  showLastFlown?: boolean;
}) {
  return (
    <View>
      <View style={styles.tableHeadRow}>
        <Text style={[styles.colLabel, styles.headText]}>{heading}</Text>
        <Text style={[styles.colNum, styles.headText]}>Total</Text>
        <Text style={[styles.colNum, styles.headText]}>PIC</Text>
        <Text style={[styles.colNum, styles.headText]}>SIC</Text>
        <Text style={[styles.colNum, styles.headText]}>Night</Text>
        <Text style={[styles.colNum, styles.headText]}>Sim</Text>
        {showLastFlown ? (
          <Text style={[styles.colDate, styles.headText]}>Last flown</Text>
        ) : null}
      </View>
      {rows.map((row) => (
        <View style={styles.row} key={row.label} wrap={false}>
          <View style={styles.colLabel}>
            <Text>{row.label}</Text>
            {row.sublabel ? <Text style={styles.muted}>{row.sublabel}</Text> : null}
            {/* A row can hold hours from an airframe on file AND hours
                that matched none; both facts travel with it. The remainder
                row already says so in its own label, so it is not told
                twice. */}
            {row.registered || row.label === UNMATCHED_LABEL ? null : (
              <Text style={styles.muted}>not matched to an aircraft on file</Text>
            )}
            {mixedProvenanceNote(row) ? (
              <Text style={styles.muted}>{mixedProvenanceNote(row)}</Text>
            ) : null}
          </View>
          <Text style={styles.colNum}>{hours(row.total)}</Text>
          <Text style={[styles.colNum, styles.muted]}>{hours(row.pic)}</Text>
          <Text style={[styles.colNum, styles.muted]}>{hours(row.sic)}</Text>
          <Text style={[styles.colNum, styles.muted]}>{hours(row.night)}</Text>
          <Text style={[styles.colNum, styles.muted]}>{hours(row.simulator)}</Text>
          {showLastFlown ? (
            <Text style={[styles.colDate, styles.muted]}>
              {formatDate(row.lastFlownOn)}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** The three-state figure, rendered as three states — see FlaggedHours in
 *  report-lib.ts for why a withheld figure is not the same as a zero. */
function FlagLine({
  label,
  figure,
  recent,
}: {
  label: string;
  figure: FlaggedHours;
  recent: FlaggedHours;
}) {
  if (!flagIsAnswerable(figure)) {
    return (
      <View style={styles.flagRow}>
        <Text style={styles.strong}>{label}</Text>
        <Text style={styles.muted}>
          Not recorded — no aircraft on this account states one way or the
          other, so no figure is given.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.flagRow}>
      <Text>
        <Text style={styles.strong}>{label}: </Text>
        <Text style={styles.strong}>{hours(figure.hours)}</Text>
        <Text style={styles.muted}>
          {`   ${hours(recent.hours)} in the last 12 months`}
        </Text>
      </Text>
      {/* The shortfall names its window — see unrecordedHoursNote. */}
      {unrecordedHoursNote(figure, recent) ? (
        <Text style={styles.muted}>{unrecordedHoursNote(figure, recent)}</Text>
      ) : null}
    </View>
  );
}

export function PilotHistoryPdf({
  account,
  compiledOn,
  earliestEntryDate,
  latestEntryDate,
  futureDatedEntryCount,
  unattributedEntryCount,
  registeredAircraftCount,
  allTime,
  lastTwelveMonths,
  lastNinetyDays,
  recordedDates,
  hasUnattributedDates,
  kindLabels,
}: PilotHistoryPdfProps) {
  const a = allTime.hours;
  const r = lastTwelveMonths.hours;
  const n = lastNinetyDays.hours;

  const rows = [
    { label: "Total time (aircraft)", allTime: hours(a.total), recent: hours(r.total), ninety: hours(n.total), strong: true },
    { label: "PIC", allTime: hours(a.pic), recent: hours(r.pic), ninety: hours(n.pic), strong: true },
    { label: "SIC", allTime: hours(a.sic), recent: hours(r.sic), ninety: hours(n.sic), strong: true },
    { label: "Solo", allTime: hours(a.solo), recent: hours(r.solo), ninety: hours(n.solo) },
    { label: "Dual received", allTime: hours(a.dualReceived), recent: hours(r.dualReceived), ninety: hours(n.dualReceived) },
    { label: "Instructor given", allTime: hours(a.instructorGiven), recent: hours(r.instructorGiven), ninety: hours(n.instructorGiven) },
    { label: "Cross country", allTime: hours(a.crossCountry), recent: hours(r.crossCountry), ninety: hours(n.crossCountry) },
    { label: "Night", allTime: hours(a.night), recent: hours(r.night), ninety: hours(n.night) },
    { label: "Instrument — actual", allTime: hours(a.instrumentActual), recent: hours(r.instrumentActual), ninety: hours(n.instrumentActual) },
    { label: "Instrument — simulated", allTime: hours(a.instrumentSimulated), recent: hours(r.instrumentSimulated), ninety: hours(n.instrumentSimulated) },
    { label: "Instrument — total", allTime: hours(totalInstrument(a)), recent: hours(totalInstrument(r)), ninety: hours(totalInstrument(n)) },
    { label: "Simulator (not aircraft time)", allTime: hours(a.simulator), recent: hours(r.simulator), ninety: hours(n.simulator), strong: true },
    { label: "Takeoffs", allTime: String(totalTakeoffs(a)), recent: String(totalTakeoffs(r)), ninety: String(totalTakeoffs(n)) },
    { label: "Landings", allTime: String(totalLandings(a)), recent: String(totalLandings(r)), ninety: String(totalLandings(n)) },
    {
      label: "Night landings",
      allTime: String(a.nightLandingsFullStop + a.nightLandingsTouchGo),
      recent: String(r.nightLandingsFullStop + r.nightLandingsTouchGo),
      ninety: String(n.nightLandingsFullStop + n.nightLandingsTouchGo),
    },
    { label: "Logbook entries", allTime: String(a.entryCount), recent: String(r.entryCount), ninety: String(n.entryCount) },
  ];

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.h1}>Pilot history</Text>
            <Text style={styles.muted}>{`Compiled ${formatDate(compiledOn)}`}</Text>
          </View>
          <View>
            {/* "ACCOUNT", NOT "AIRMAN", and the distinction is not
                pedantry. accounts.legal_name is the BUSINESS identity
                (the tenancy migration's field; 20260812400000 adds
                dba_name precisely because a sole proprietor's trade name
                differs from it), so for a pilot who onboarded as
                "<something> Aviation LLC" this line named a limited
                company as the airman — and a company cannot hold a pilot
                certificate. The invoice PDF's use of legal_name is right
                because an invoice is business paper; a pilot history is
                airman paper, and this account has no airman-name field to
                print instead. So the label states what the value actually
                is. The document says whose records these are in its
                framing sentence, which is a true statement either way. */}
            <Text style={styles.label}>Account</Text>
            <Text style={styles.block}>{account.legal_name}</Text>
            {addressLines(account).map((line, i) => (
              <Text key={i} style={styles.muted}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        {/* THE FRAMING SENTENCE, above every figure — the same placement
            and the same job as the callout at the top of the screen. A
            printed document travels without the page around it, so it has
            to carry its own frame. */}
        <Text style={styles.lede}>
          Every figure in this document is a sum of hours recorded in the
          airman&rsquo;s own logbook and a restatement of dates the airman
          entered. Nothing here is an assessment against any
          operator&rsquo;s, insurer&rsquo;s or other minimum, and nothing
          here states what the airman may fly — those judgements rest with
          the party requesting this document. The figures are as complete as
          the underlying records.
        </Text>

        <Text style={styles.h2}>Flight time</Text>
        <Text style={styles.sectionNote}>
          {`Logbook covers ${formatDate(earliestEntryDate)} to ${formatDate(
            latestEntryDate
          )}. Total time is time in an aircraft: simulator hours are shown on their own line and are never added to it.`}
        </Text>
        {/* The same two caveats the screen carries, from the same
            functions. This document leaves the app; the sentence that
            explains a difference from the pilot's own logbook screen has
            to leave with it. */}
        {futureDatedNote(futureDatedEntryCount) ? (
          <Text style={styles.sectionNote}>
            {futureDatedNote(futureDatedEntryCount)}
          </Text>
        ) : null}
        {unattributedEntriesNote(unattributedEntryCount) ? (
          <Text style={styles.sectionNote}>
            {unattributedEntriesNote(unattributedEntryCount)}
          </Text>
        ) : null}
        <ThreeColumnTable
          rows={rows}
          recentLabel={lastTwelveMonths.window.label}
          ninetyLabel={`${lastNinetyDays.window.label} (${formatDate(
            lastNinetyDays.window.from ?? lastNinetyDays.window.to
          )} – ${formatDate(lastNinetyDays.window.to)})`}
        />

        <Text style={styles.h2}>Turbine and retractable gear</Text>
        <FlagLine label="Turbine time" figure={allTime.turbine} recent={lastTwelveMonths.turbine} />
        <FlagLine
          label="Retractable-gear time"
          figure={allTime.retractable}
          recent={lastTwelveMonths.retractable}
        />

        <Text style={styles.h2}>By category and class</Text>
        {allTime.categoryClassUnrecorded ? (
          <Text style={styles.sectionNote}>
            Not recorded — no aircraft on this account carries a category
            and class, so the hours above are not broken down by one.
          </Text>
        ) : (
          <BreakdownTable heading="Category and class" rows={allTime.byCategoryClass} />
        )}
      </Page>

      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h2}>By type</Text>
        <Text style={styles.sectionNote}>
          Grouped by type rating where one is recorded, so a rating covering
          several models reads as one figure. Hours logged against an
          aircraft that is not on file are still counted, under whatever
          type was written on the entry.
        </Text>
        <BreakdownTable heading="Type" rows={allTime.byType} />

        <Text style={styles.h2}>By aircraft</Text>
        <Text style={styles.sectionNote}>
          {registeredAircraftCount === 0
            ? "No aircraft are on file, so every hour appears in the unmatched line."
            : `${registeredAircraftCount} aircraft on file. Entries are matched to an airframe regardless of how the registration was written on the entry.`}
        </Text>
        <BreakdownTable heading="Aircraft" rows={allTime.byTail} showLastFlown />

        <Text style={styles.h2}>Recorded dates</Text>
        <Text style={styles.sectionNote}>
          As entered by the airman. No date below is derived from another,
          checked against any registry, or calculated — an expiration shown
          is one the airman typed.
        </Text>
        {recordedDates.length === 0 ? (
          <Text style={styles.muted}>No dated documents on file.</Text>
        ) : (
          <View>
            <View style={styles.tableHeadRow}>
              <Text style={[styles.colLabel, styles.headText]}>Document</Text>
              <Text style={[styles.colDate, styles.headText]}>Completed</Text>
              <Text style={[styles.colDate, styles.headText]}>Issued</Text>
              <Text style={[styles.colDate, styles.headText]}>Expires (as entered)</Text>
            </View>
            {recordedDates.map((date, i) => (
              <View style={styles.row} key={`${date.kind}-${i}`} wrap={false}>
                <View style={styles.colLabel}>
                  <Text>{date.label}</Text>
                  <Text style={styles.muted}>
                    {(kindLabels[date.kind] ?? date.kind) +
                      (date.attribution === "unattributed"
                        ? " · no airman recorded"
                        : "")}
                  </Text>
                </View>
                <Text style={[styles.colDate, styles.muted]}>
                  {formatDate(date.completedOn)}
                </Text>
                <Text style={[styles.colDate, styles.muted]}>
                  {formatDate(date.issuedOn)}
                </Text>
                <Text style={[styles.colDate, styles.muted]}>
                  {formatDate(date.expiresOn)}
                </Text>
              </View>
            ))}
          </View>
        )}
        {hasUnattributedDates ? (
          <Text style={styles.sectionNoteAfter}>
            A document marked &ldquo;no airman recorded&rdquo; is held on
            this account without naming whose it is. It is listed rather
            than attributed.
          </Text>
        ) : null}

        {/* ATTESTATION BLOCK: two blank rule lines and their labels, and
            nothing else — no attestation TEXT above the lines, because any
            sentence this document supplied ("I certify that...") would be
            this product asserting what the airman is attesting to, which
            is exactly the kind of claim THE LINE (this file's header)
            forbids. The party requesting the document supplies its own
            attestation language; this is just where a pen goes. */}
        <View style={styles.attestation}>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <View style={styles.signatureLine} />
              <Text style={styles.muted}>Signature of airman</Text>
            </View>
            <View style={styles.signatureBlock}>
              <View style={styles.signatureLine} />
              <Text style={styles.muted}>Date</Text>
            </View>
          </View>
        </View>

        {/* THE NEUTRAL FOOTER. One sentence, and nothing else — same
            string on the screen, in this document and in the CSV, from one
            function so the three cannot drift. */}
        <Text style={styles.footer}>{compiledFromFooter(BRAND.name)}</Text>
      </Page>
    </Document>
  );
}
