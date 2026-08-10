import { ambiguousCommaReason, parseBankAmount } from "./amount";
import { parseStatementDate } from "./date";
import type { CsvRecord } from "./csv";
import type {
  BankAccountKind,
  BankFileFormat,
  BankParseResult,
  ColumnMapping,
  CsvColumnKey,
  ParsedBankRow,
  RejectedBankRow,
  SignInterpretation,
} from "./types";

/**
 * True when the cell's own text states which direction the money went —
 * parentheses (the accounting negative), or a trailing CR/DR marker.
 *
 * This is the signal that overrides every column convention and every
 * account-kind inference downstream: a cell reading "214.88 DR" has said
 * "money out" in words, and no amount of "but credit-card exports usually
 * write purchases positive" should be allowed to argue with it.
 */
function declaresOwnSign(raw: string): boolean {
  const v = raw.trim();
  if (v.startsWith("(") && v.endsWith(")")) return true;
  return /\s*(CR|DR)$/i.test(v);
}

/**
 * Header aliases used to AUTO-suggest a mapping for the pilot to confirm
 * — never applied silently as the final mapping. The import workspace
 * shows the suggested mapping and lets the pilot correct it before
 * parsing runs for real, same posture as lib/logbook-import/generic.ts.
 */
const HEADER_ALIASES: Record<CsvColumnKey, readonly string[]> = {
  posted_on: ["date", "posted date", "posting date", "transaction date", "post date"],
  description: ["description", "memo", "payee", "name", "transaction", "details"],
  amount: ["amount", "transaction amount", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "payment"],
  credit: ["credit", "deposit", "deposits"],
  ignore: [],
};

export function suggestColumnMapping(headerRow: string[]): ColumnMapping {
  const used = new Set<CsvColumnKey>();
  return headerRow.map((h) => {
    const norm = h.trim().toLowerCase();
    for (const key of ["posted_on", "description", "amount", "debit", "credit"] as CsvColumnKey[]) {
      if (used.has(key)) continue;
      if (HEADER_ALIASES[key].includes(norm)) {
        used.add(key);
        return key;
      }
    }
    return undefined;
  });
}

/**
 * The one CSV parser both csv_signed and csv_debit_credit share — which
 * shape a mapping implies is inferred from which columns are mapped
 * (amount vs. debit/credit), not passed as a separate flag, so there is
 * exactly one code path to validate rather than two that could drift.
 *
 * `accountKind` drives the ONE sign transformation this module performs:
 * a credit_card account's amounts are flipped so the canonical rule
 * (negative = money out = expense candidate) holds for every account
 * kind uniformly. See the migration's file header for the full
 * rationale. checking/savings rows are stored exactly as parsed — no
 * transformation.
 */
export function applyCsvMapping(params: {
  headerRow: string[];
  dataRecords: CsvRecord[];
  mapping: ColumnMapping;
  accountKind: BankAccountKind;
}): BankParseResult {
  const { headerRow, dataRecords, mapping, accountKind } = params;
  const valid: ParsedBankRow[] = [];
  const rejected: RejectedBankRow[] = [];

  const hasAmount = mapping.includes("amount");
  const hasDebitCredit = mapping.includes("debit") || mapping.includes("credit");
  const format: BankFileFormat = hasAmount ? "csv_signed" : "csv_debit_credit";

  const headerKeys = headerRow.map((h, i) => h.trim() || `column_${i + 1}`);
  const seen = new Map<string, number>();
  const uniqueHeaderKeys = headerKeys.map((k) => {
    const count = (seen.get(k) ?? 0) + 1;
    seen.set(k, count);
    return count === 1 ? k : `${k} (${count})`;
  });

  const idxFor = (key: CsvColumnKey): number => mapping.findIndex((m) => m === key);
  const dateIdx = idxFor("posted_on");
  const descIdx = idxFor("description");
  const amountIdx = idxFor("amount");
  const debitIdx = idxFor("debit");
  const creditIdx = idxFor("credit");

  if (dateIdx === -1) {
    return { format, header: headerRow, valid: [], rejected: [{ rowNumber: 0, raw: "", reason: "No column is mapped to the posted date." }] };
  }
  if (descIdx === -1) {
    return { format, header: headerRow, valid: [], rejected: [{ rowNumber: 0, raw: "", reason: "No column is mapped to the description." }] };
  }
  if (!hasAmount && !hasDebitCredit) {
    return {
      format,
      header: headerRow,
      valid: [],
      rejected: [{ rowNumber: 0, raw: "", reason: "No column is mapped to an amount (either a single signed amount column, or debit/credit columns)." }],
    };
  }

  // Pass 1 collects; the credit-card sign decision needs to see the whole
  // column before it can be made, so nothing is emitted until pass 2.
  type Staged = ParsedBankRow & { signSelfDeclared: boolean };
  const staged: Staged[] = [];

  dataRecords.forEach((record, i) => {
    const rowNumber = i + 1;
    let fields = record.fields;
    const reject = (reason: string) => rejected.push({ rowNumber, raw: record.raw, reason });

    if (fields.every((f) => f.trim() === "")) return;

    // ARITY (fixed after review). A row with MORE fields than the header
    // was silently accepted and the extras dropped — so an unquoted
    // European decimal, "2026-03-15,COFFEE,4,75", parsed as four fields
    // against a three-column header and stored the amount as "4": the
    // pilot saw +$4.00 for a €4,75 charge, with rejected: 0. A row with
    // FEWER fields lost cells from the source_row blob that is supposed to
    // preserve the file verbatim.
    //
    // This is the rule lib/logbook-import/foreflight.ts already applies
    // (pad short, reject long by name, keep parsing the rest) — ported
    // here rather than reinvented, because the two importers drifting on
    // something this basic is how the CSV path ended up without it.
    if (fields.length !== headerRow.length) {
      if (fields.length > headerRow.length) {
        reject(
          `This row has ${fields.length} values but the header has ${headerRow.length} columns, so we can't tell which value belongs to which column. A common cause is a number written with a comma (like 4,75) in a file that separates columns with commas.`
        );
        return;
      }
      // Short: pad, so the row still parses and source_row keeps a slot
      // for every header column rather than silently losing the tail.
      fields = [...fields, ...Array<string>(headerRow.length - fields.length).fill("")];
    }

    const sourceRow: Record<string, string> = {};
    uniqueHeaderKeys.forEach((key, idx) => {
      sourceRow[key] = fields[idx] ?? "";
    });

    const dateRaw = (fields[dateIdx] ?? "").trim();
    if (!dateRaw) {
      reject("Missing posted date.");
      return;
    }
    const postedOn = parseStatementDate(dateRaw);
    if (!postedOn) {
      reject(`Date isn't in a recognized format: "${dateRaw}". Expected YYYY-MM-DD, M/D/YYYY, or M-D-YYYY.`);
      return;
    }

    const description = (fields[descIdx] ?? "").trim();
    if (!description) {
      reject("Missing description.");
      return;
    }

    let amountCents: number | undefined;
    let signSelfDeclared = false;
    if (hasAmount) {
      const raw = (fields[amountIdx] ?? "").trim();
      if (!raw) {
        reject("Missing amount.");
        return;
      }
      amountCents = parseBankAmount(raw);
      if (amountCents === undefined) {
        // A comma-decimal gets its own sentence — "isn't a recognized
        // number" would send the pilot hunting for a typo that isn't there.
        reject(ambiguousCommaReason(raw) ?? `Amount isn't a recognized number: "${raw}".`);
        return;
      }
      signSelfDeclared = declaresOwnSign(raw);
    } else {
      const debitRaw = debitIdx >= 0 ? (fields[debitIdx] ?? "").trim() : "";
      const creditRaw = creditIdx >= 0 ? (fields[creditIdx] ?? "").trim() : "";
      const debitVal = debitRaw ? parseBankAmount(debitRaw) : undefined;
      const creditVal = creditRaw ? parseBankAmount(creditRaw) : undefined;
      if (debitRaw && debitVal === undefined) {
        reject(
          ambiguousCommaReason(debitRaw) ?? `Debit amount isn't a recognized number: "${debitRaw}".`
        );
        return;
      }
      if (creditRaw && creditVal === undefined) {
        reject(
          ambiguousCommaReason(creditRaw) ?? `Credit amount isn't a recognized number: "${creditRaw}".`
        );
        return;
      }
      const debitPresent = debitRaw !== "" && debitVal !== undefined && debitVal !== 0;
      const creditPresent = creditRaw !== "" && creditVal !== undefined && creditVal !== 0;
      if (debitPresent && creditPresent) {
        reject(`Both debit ("${debitRaw}") and credit ("${creditRaw}") are populated on the same row — a bank line is one or the other, never both.`);
        return;
      }
      if (!debitPresent && !creditPresent) {
        reject("Neither debit nor credit has a nonzero value.");
        return;
      }

      // debit = money out = canonical negative; credit = money in =
      // canonical positive — but ONLY when the cell itself is silent about
      // direction.
      //
      // This used to be `debitPresent ? -Math.abs(v) : Math.abs(v)`, which
      // DELETED a direction the cell had stated in words. amount.ts
      // documents trailing CR as money in and DR as money out by name, so
      // a Withdrawal cell reading "45.00 CR" — a reversal, stated
      // explicitly — was stored as -4500 while the identical text in a
      // signed Amount column stored +4500. A $90 swing on the same input,
      // decided by nothing but which header the bank happened to use.
      const rawCell = debitPresent ? debitRaw : creditRaw;
      const parsed = debitPresent ? debitVal! : creditVal!;
      if (declaresOwnSign(rawCell)) {
        // The text said which way the money went. Believe it over the
        // column, and record that we did so this row is never flipped
        // again downstream.
        amountCents = parsed;
        signSelfDeclared = true;
      } else if (/^\s*-/.test(rawCell)) {
        // A bare leading minus inside a debit/credit column is genuinely
        // ambiguous — "-45.00" in a Withdrawal column could mean a $45
        // withdrawal or a $45 reversal of one, and the file gives no way
        // to tell. Rejected by name rather than guessed at, matching this
        // module's treatment of every other ambiguity.
        reject(
          `"${rawCell}" is a negative value in the ${debitPresent ? "debit" : "credit"} column, which could mean either a ${debitPresent ? "withdrawal" : "deposit"} or a reversal of one. Re-export with a single signed amount column, or enter this transaction by hand.`
        );
        return;
      } else {
        amountCents = debitPresent ? -Math.abs(parsed) : Math.abs(parsed);
      }
    }

    staged.push({
      rowNumber,
      raw: record.raw,
      sourceRow,
      postedOn,
      description,
      amountCents: amountCents!,
      signSelfDeclared,
    });
  });

  // ---------------------------------------------------------------------
  // PASS 2 — the credit-card sign decision (fixed after review)
  // ---------------------------------------------------------------------
  // This used to be an unconditional `amountCents = -amountCents` for every
  // credit_card signed-amount file, on the premise that card issuers write
  // a purchase as a positive charge. Many do. Some do not — and for those,
  // the flip inverted the ENTIRE statement: a real $214.88 hotel charge
  // became +21488, was refused by confirmTransaction as "a deposit or
  // refund", and produced no expense at all, while the month's one refund
  // became the only row the pilot could file.
  //
  // The premise isn't wrong, it was just applied without checking. So:
  // infer it from the file instead. A credit-card statement is
  // overwhelmingly purchases, so whichever direction the majority of
  // amounts run IS that file's "money out" — a majority-negative column is
  // already canonical and must not be touched.
  //
  // Rows whose own text declared direction (parens, CR, DR) are excluded
  // from the vote AND exempt from the flip: "214.88 DR" already said money
  // out, and no amount of column convention overrides the cell saying so.
  let signInterpretation: SignInterpretation | undefined;
  let flip = false;
  if (accountKind === "credit_card" && hasAmount) {
    const votable = staged.filter((r) => !r.signSelfDeclared && r.amountCents !== 0);
    const negatives = votable.filter((r) => r.amountCents < 0).length;
    const positives = votable.length - negatives;
    // Majority-positive (the classic issuer convention) is the only case
    // that gets flipped. A tie, or an empty vote, leaves the file alone —
    // when in doubt, do not silently rewrite the pilot's money.
    flip = positives > negatives;
    signInterpretation = {
      flipped: flip,
      moneyOutRows: flip ? positives : negatives,
      moneyInRows: flip ? negatives : positives,
      selfDeclaredRows: staged.length - votable.length,
    };
  }

  for (const row of staged) {
    const { signSelfDeclared: declared, ...rest } = row;
    valid.push(
      flip && !declared ? { ...rest, amountCents: -rest.amountCents } : rest
    );
  }

  return { format, header: headerRow, valid, rejected, signInterpretation };
}
