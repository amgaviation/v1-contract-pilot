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

/**
 * What the parser concluded about which direction this file's amounts run,
 * and why — so the import preview can SAY it rather than the pilot finding
 * out from an inverted statement.
 *
 * Only produced for the credit-card signed-amount shape, which is the one
 * place a guess is involved (see applyCsvMapping's header). `flipped` is
 * what was actually done; `moneyOutRows`/`moneyInRows` are the counts the
 * decision was made from, so the preview can show its working.
 */
export type SignInterpretation = {
  flipped: boolean;
  /** True when the pilot overrode the parser's suggestion. */
  overridden: boolean;
  /**
   * Whether the file's own contents settled the question. False means the
   * counts were close enough that the parser guessed, and the preview must
   * ASK rather than quietly proceed — a short statement with one charge and
   * two payments is exactly the shape that fools a majority rule.
   */
  decisive: boolean;
  moneyOutRows: number;
  moneyInRows: number;
  /** Rows whose own text declared direction (a trailing CR/DR) and were never flipped. */
  selfDeclaredRows: number;
};

export type BankParseResult = {
  format: BankFileFormat;
  header: string[];
  valid: ParsedBankRow[];
  rejected: RejectedBankRow[];
  signInterpretation?: SignInterpretation;
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
