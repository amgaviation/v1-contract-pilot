/**
 * Shared types for the bank/card statement import pipeline (CSV signed,
 * CSV debit/credit, OFX, QFX). See fingerprint.ts for the dedup key and
 * apply-mapping.ts for the CSV parser every CSV shape shares.
 */

export type BankFileFormat = "csv_signed" | "csv_debit_credit" | "ofx" | "qfx";

export type BankAccountKind = "checking" | "savings" | "credit_card";

/**
 * The set of columns a CSV row can be mapped onto. "amount" is a single
 * signed column (the common case). "debit"/"credit" are the two-column
 * shape some banks export instead (a value in exactly one of the two per
 * row) — apply-mapping.ts combines them into one signed amount rather
 * than exposing two raw columns downstream, since nothing past this
 * layer ever needs to know which shape the source file used.
 */
export type CsvColumnKey = "posted_on" | "description" | "amount" | "debit" | "credit" | "ignore";

/** header index -> canonical field, or "ignore"/undefined for unused columns. */
export type ColumnMapping = (CsvColumnKey | undefined)[];

/**
 * A row's parsed values, in the CANONICAL sign (see the migration's file
 * header comment): negative = money left the account (an expense
 * candidate), positive = money came back in. The CSV/OFX parsers are
 * responsible for producing this sign already — apply-mapping.ts flips a
 * credit_card account's rows at parse time, keyed on `accountKind`, so
 * every row leaving this module is already canonical regardless of
 * source shape.
 */
export type ParsedBankRow = {
  rowNumber: number;
  raw: string;
  /** Original row as a header-name -> raw-string-value map (CSV), or the raw OFX/QFX <STMTTRN> field map, stored verbatim into bank_transactions.source_row. */
  sourceRow: Record<string, string>;
  postedOn: string;
  description: string;
  amountCents: number;
};

export type RejectedBankRow = {
  rowNumber: number;
  raw: string;
  reason: string;
};

export type BankParseResult = {
  format: BankFileFormat;
  header: string[];
  valid: ParsedBankRow[];
  rejected: RejectedBankRow[];
};

/**
 * The insert payload for a bank_transactions row, built server-side only
 * (confirmBankImport, app/(app)/expenses/import/actions.ts) — mirrors
 * ImportEntryInsert in lib/logbook-import/types.ts.
 */
export type BankTransactionInsert = {
  account_id: string;
  bank_account_id: string;
  import_batch_id: string;
  source_file_id: string;
  source_row_number: number;
  source_row: Record<string, string>;
  posted_on: string;
  description: string;
  amount_cents: number;
  fingerprint: string;
};
