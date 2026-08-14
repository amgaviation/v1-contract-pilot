/**
 * The general ledger / journal CSV export — pure assembly, no I/O, so
 * tests/accounting-lib.test.mjs can exercise it directly (the same split
 * as ledger-lib.ts and app/(app)/settings/export/entities.ts). The route
 * at app/(app)/accounting/journal/export/route.ts does all the Supabase
 * reads and streaming; everything here is a plain function of rows it's
 * handed.
 *
 * CPA-SHAPED, ON PURPOSE: one row per POSTING LINE (not one row per
 * entry), with separate Debit and Credit columns rather than a single
 * signed amount — that is the layout a bookkeeper/CPA expects to drop
 * into a spreadsheet or an accounting import, and it is what lets
 * "balanced pairs adjacent" mean something (two rows, same entry, one
 * with a Debit and one with a Credit, sitting next to each other).
 *
 * Small vocabularies (the source-type label map, cents→dollars,
 * filename slugify) are RESTATED here rather than imported from
 * app/(app)/settings/export/entities.ts — that directory is another
 * agent's surface this session, the same "restated, not imported"
 * posture entities.ts itself documents for OPERATOR_QUALIFICATION_*
 * and app/(app)/estimates/estimate-lib.ts documents for
 * parsePercentToBps.
 */

/** What lib/csv.ts's csvField accepts. */
export type CsvValue = string | number | null | undefined;

/** Cents → "1234.56". Never blank here: every posting line has an amount. */
export function centsToDollarsString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Same strings as app/(app)/settings/export/entities.ts's
 *  JOURNAL_SOURCE_TYPE_LABEL — restated, see file header. */
const SOURCE_TYPE_LABEL: Record<string, string> = {
  manual: "Manual entry",
  invoice_issued: "Invoice issued",
  invoice_voided: "Invoice voided",
  payment: "Payment",
  payment_void_reclass: "Payment reclass (void)",
  expense: "Expense",
  mileage: "Mileage",
};

/**
 * "Invoice issued — <source id>" for a derived entry, or just the label
 * for a manual one (source_id is always null on manual entries — see the
 * journal_entries CHECK in 20260812100000_accounting_ledger.sql). The
 * source id is the pilot's own invoice/payment/expense/mileage row, which
 * a CPA can hand back as "which record does this line come from" —
 * that's the whole point of a "source reference" column.
 */
export function sourceReference(sourceType: string, sourceId: string | null): string {
  const label = SOURCE_TYPE_LABEL[sourceType] ?? sourceType;
  return sourceId ? `${label}: ${sourceId}` : label;
}

export const GENERAL_LEDGER_HEADER = [
  "Date",
  "Account code",
  "Account name",
  "Memo",
  "Debit",
  "Credit",
  "Source reference",
  "Journal entry ID",
] as const;

export type GeneralLedgerLine = {
  entryId: string;
  entryDate: string;
  memo: string;
  /** The chart account's system_key — the closest thing this chart has to
   *  a GL code (see accounts_chart's own schema comment: it's the stable
   *  posting identity, not client-writable). Blank for a pilot-added
   *  account, which has no system_key. */
  accountCode: string | null;
  accountName: string;
  side: "debit" | "credit";
  amountCents: number;
  sourceReference: string;
};

/**
 * The values, in GENERAL_LEDGER_HEADER's order. Debit and Credit are
 * separate columns, each blank on the side a line doesn't use — never
 * "0.00", which would read as a real zero on the side that isn't posted.
 */
export function generalLedgerRowValues(line: GeneralLedgerLine): CsvValue[] {
  return [
    line.entryDate,
    line.accountCode ?? "",
    line.accountName,
    line.memo,
    line.side === "debit" ? centsToDollarsString(line.amountCents) : "",
    line.side === "credit" ? centsToDollarsString(line.amountCents) : "",
    line.sourceReference,
    line.entryId,
  ];
}

/**
 * A CSV whose header and rows disagree does not fail — it SHIFTS,
 * silently — see logbook/export/route.ts's and settings/export/
 * entities.ts's identical guards, both written after that exact bug
 * reached a shipped export. Checked at module load with a minimal probe
 * row, so a mismatch here is a startup error, never a corrupted download.
 */
{
  const probe: GeneralLedgerLine = {
    entryId: "",
    entryDate: "",
    memo: "",
    accountCode: null,
    accountName: "",
    side: "debit",
    amountCents: 0,
    sourceReference: "",
  };
  const probeLength = generalLedgerRowValues(probe).length;
  if (probeLength !== GENERAL_LEDGER_HEADER.length) {
    throw new Error(
      `general ledger export is broken: GENERAL_LEDGER_HEADER has ${GENERAL_LEDGER_HEADER.length} columns but each row emits ${probeLength}.`
    );
  }
}

export type JournalEntryLite = {
  id: string;
  entry_date: string;
  memo: string;
  source_type: string;
  source_id: string | null;
  created_at: string;
};

export type JournalLineLite = {
  id: string;
  entry_id: string;
  chart_account_id: string;
  side: "debit" | "credit";
  amount_cents: number;
  line_no: number;
};

export type ChartAccountLite = {
  id: string;
  name: string;
  system_key: string | null;
};

/**
 * Turns the raw entries + lines + chart into one row per posting line, in
 * BOOK ORDER: entry date, then the entry's own created_at (so same-day
 * entries keep the order they were recorded in), then entry id as a final
 * tiebreak, then line_no within the entry. That last key is what keeps a
 * balanced pair adjacent — line_no 0 (the debit leg, by the seed
 * convention every derived entry uses) immediately followed by line_no 1
 * (the credit leg), never interleaved with another entry's lines.
 *
 * A line whose entry_id isn't in `entries` is dropped rather than guessed
 * at — it cannot be dated or given a memo, and a row with blanks in a
 * financial export reads as a fact ("this line has no date") rather than
 * what it actually is (the caller fetched an inconsistent pair of lists).
 * Callers are expected to pass entries and lines fetched from the SAME
 * account in the SAME read, in which case this can't happen.
 */
export function assembleGeneralLedger(
  entries: JournalEntryLite[],
  lines: JournalLineLite[],
  chartById: Map<string, ChartAccountLite>
): GeneralLedgerLine[] {
  const entryById = new Map(entries.map((e) => [e.id, e]));

  return lines
    .map((line) => ({ line, entry: entryById.get(line.entry_id) }))
    .filter(
      (x): x is { line: JournalLineLite; entry: JournalEntryLite } => x.entry !== undefined
    )
    .sort((a, b) => {
      if (a.entry.entry_date !== b.entry.entry_date) {
        return a.entry.entry_date < b.entry.entry_date ? -1 : 1;
      }
      if (a.entry.created_at !== b.entry.created_at) {
        return a.entry.created_at < b.entry.created_at ? -1 : 1;
      }
      if (a.entry.id !== b.entry.id) {
        return a.entry.id < b.entry.id ? -1 : 1;
      }
      return a.line.line_no - b.line.line_no;
    })
    .map(({ line, entry }) => {
      const chart = chartById.get(line.chart_account_id);
      return {
        entryId: entry.id,
        entryDate: entry.entry_date,
        memo: entry.memo,
        accountCode: chart?.system_key ?? null,
        accountName: chart?.name ?? "Unknown account",
        side: line.side,
        amountCents: line.amount_cents,
        sourceReference: sourceReference(entry.source_type, entry.source_id),
      };
    });
}

/** Filesystem/header-safe filename component — same as the other exports. */
export function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pilot"
  );
}
