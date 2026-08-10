import { parseBankAmount } from "./amount";
import type { CsvRecord } from "./csv";
import type {
  BankAccountKind,
  BankFileFormat,
  BankParseResult,
  ColumnMapping,
  CsvColumnKey,
  ParsedBankRow,
  RejectedBankRow,
} from "./types";

/**
 * Small, self-contained date parser — "YYYY-MM-DD" or "M/D/YYYY" —
 * arithmetically validated (rejects "2026-02-30" rather than rolling it
 * over), same approach as lib/logbook-import/fields.ts's
 * parseFlexibleDate. This one is small enough (and different enough —
 * bank exports also occasionally use "MM-DD-YYYY" with dashes, handled
 * below, which the logbook date parser has no reason to support) that
 * copying the ~25 lines seemed more honest than importing across the
 * feature boundary for a near-but-not-quite-identical rule.
 */
function parseStatementDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const usDash = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value);

  let y: number, m: number, d: number;
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (us) {
    m = Number(us[1]);
    d = Number(us[2]);
    y = Number(us[3]);
  } else if (usDash) {
    m = Number(usDash[1]);
    d = Number(usDash[2]);
    y = Number(usDash[3]);
  } else {
    return null;
  }

  if (m < 1 || m > 12) return null;
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[m - 1] ?? 31;
  if (d < 1 || d > maxDay) return null;
  if (y < 1900 || y > 2100) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
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

  dataRecords.forEach((record, i) => {
    const rowNumber = i + 1;
    const fields = record.fields;
    const reject = (reason: string) => rejected.push({ rowNumber, raw: record.raw, reason });

    if (fields.every((f) => f.trim() === "")) return;

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
    if (hasAmount) {
      const raw = (fields[amountIdx] ?? "").trim();
      if (!raw) {
        reject("Missing amount.");
        return;
      }
      amountCents = parseBankAmount(raw);
      if (amountCents === undefined) {
        reject(`Amount isn't a recognized number: "${raw}".`);
        return;
      }
    } else {
      const debitRaw = debitIdx >= 0 ? (fields[debitIdx] ?? "").trim() : "";
      const creditRaw = creditIdx >= 0 ? (fields[creditIdx] ?? "").trim() : "";
      const debitVal = debitRaw ? parseBankAmount(debitRaw) : undefined;
      const creditVal = creditRaw ? parseBankAmount(creditRaw) : undefined;
      if (debitRaw && debitVal === undefined) {
        reject(`Debit amount isn't a recognized number: "${debitRaw}".`);
        return;
      }
      if (creditRaw && creditVal === undefined) {
        reject(`Credit amount isn't a recognized number: "${creditRaw}".`);
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
      // debit = money out = canonical negative; credit = money in = canonical positive.
      // parseBankAmount returns whatever sign the cell's own text encoded
      // (a debit column is almost always written as a plain positive
      // number, but Math.abs guards a bank that writes it pre-signed too).
      amountCents = debitPresent ? -Math.abs(debitVal!) : Math.abs(creditVal!);
    }

    // THE credit-card flip — see file header / migration header. A
    // checking/savings row is already in canonical sign at this point
    // (a signed column already reads negative-for-debit; the
    // debit/credit branch above already produced canonical sign) — this
    // flip therefore applies ONLY to accountKind === 'credit_card', and
    // ONLY to the single-signed-amount shape, since that is the shape a
    // credit card issuer actually exports (positive = charge). A
    // debit/credit-shaped credit card export is not a real thing this
    // parser has seen documented by any issuer, so it is deliberately
    // NOT flipped — if one surfaces, canonicalizing it needs its own
    // judgment call, not a silent guess here.
    if (accountKind === "credit_card" && hasAmount) {
      amountCents = -amountCents!;
    }

    valid.push({ rowNumber, raw: record.raw, sourceRow, postedOn, description, amountCents: amountCents! });
  });

  return { format, header: headerRow, valid, rejected };
}
