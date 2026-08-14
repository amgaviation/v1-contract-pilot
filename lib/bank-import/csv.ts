/**
 * A minimal, correct RFC 4180 CSV tokenizer.
 *
 * DUPLICATION, STATED RATHER THAN HIDDEN: this is a near-verbatim copy of
 * lib/logbook-import/csv.ts's `parseCsv` — same quoted-field handling,
 * same doubled-quote escaping, same CRLF/bare-CR/LF handling, same
 * unclosed-quote detection, same trailing-blank-line suppression. That
 * file is out of this feature's edit scope (lib/logbook-import/** belongs
 * to the logbook feature) and importing it directly would create a
 * cross-feature runtime dependency between two features that are
 * intentionally developed independently. A SHARED tokenizer
 * (e.g. lib/csv.ts, already reserved/excluded from this task's edit
 * scope for exactly this reason) would be strictly better than this
 * copy — it is the one piece of this feature where "write it yourself"
 * produced a real duplicate of already-adversarially-reviewed code
 * rather than a genuinely new parser. Flagging it here and in the final
 * report instead of pretending this is independently-authored.
 *
 * Also strips a leading UTF-8 BOM (`﻿`), which lib/logbook-import's
 * copy does not need to handle at this layer (its caller strips it) but
 * bank exports are more likely to carry one straight from Windows-based
 * online banking portals, so it's handled here directly.
 */

export type CsvRecord = {
  fields: string[];
  raw: string;
};

export type CsvParseError = { error: string };

export function parseCsv(text: string): CsvRecord[] | CsvParseError {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let i = 0;
  const len = body.length;
  let line = 1;

  while (i < len) {
    const recordStart = i;
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    let sawAnyContent = false;
    let quoteStartLine = line;

    while (i < len) {
      const ch = body[i];

      if (inQuotes) {
        if (ch === '"') {
          if (body[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i += 1;
          }
        } else {
          if (ch === "\n") line += 1;
          field += ch;
          i += 1;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        quoteStartLine = line;
        sawAnyContent = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        fields.push(field);
        field = "";
        sawAnyContent = true;
        i += 1;
        continue;
      }
      if (ch === "\r") {
        i += 1;
        if (body[i] === "\n") i += 1;
        line += 1;
        break;
      }
      if (ch === "\n") {
        i += 1;
        line += 1;
        break;
      }
      field += ch;
      sawAnyContent = true;
      i += 1;
    }

    if (inQuotes) {
      return {
        error: `This file has an unclosed quote starting at line ${quoteStartLine}. A " was opened but never closed, so everything from there to the end of the file was read as one field. Fix the quoting near that line and re-upload.`,
      };
    }

    fields.push(field);

    const raw = body.slice(recordStart, i).replace(/[\r\n]+$/g, "");
    const isBlank = !sawAnyContent && fields.length === 1 && fields[0] === "";
    if (!isBlank) {
      records.push({ fields, raw });
    }
  }

  return records;
}
