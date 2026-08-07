/**
 * A minimal, correct RFC 4180 CSV tokenizer.
 *
 * WHY NOT `line.split(",")`: every real logbook export quotes at least one
 * field sooner or later — a remarks/comments column with a comma in it
 * ("Diverted to KABC, weather"), or a route field. A naive split breaks the
 * row apart at that comma and every column after it shifts by one, which
 * silently corrupts times and landing counts rather than failing loudly.
 *
 * This also tracks the exact source substring behind each parsed record
 * (`raw`), including embedded newlines inside a quoted field, so the
 * rejected-row surface can show the pilot the actual original line instead
 * of a re-serialized approximation.
 */

export type CsvRecord = {
  /** 1-based row number counting DATA rows only in the caller's numbering scheme; left 0 here and assigned by the caller once header handling is decided. */
  fields: string[];
  raw: string;
};

export type CsvParseError = { error: string };

/**
 * Splits `text` into CSV records. Handles quoted fields, doubled-quote
 * escaping (`""` -> `"`), commas and newlines inside quotes, and both
 * `\r\n` and `\n` line endings. A trailing blank line (or trailing
 * newline) produces no record. Every record is returned, INCLUDING the
 * header row if present — callers slice that off themselves, since some
 * formats (ForeFlight) have more than one header inside a single file.
 *
 * Returns a `CsvParseError` instead of records when a quoted field is
 * opened and never closed before end of file. WITHOUT this check the
 * tokenizer's only well-defined behaviour is to keep consuming — commas,
 * newlines, everything — as content of that one field all the way to EOF,
 * so the entire remainder of the file becomes a single record (typically
 * later surfaced as exactly one rejected row) with no indication that
 * dozens of real flights are hiding inside it unparsed. Rather than
 * change that consuming behaviour (a correct, standard tokenizer
 * response to a genuinely malformed file), this detects the condition
 * and reports it as a distinct, named error naming the line where the
 * unclosed quote started, so the pilot is told the file itself is
 * malformed instead of being told "1 row rejected."
 */
export function parseCsv(text: string): CsvRecord[] | CsvParseError {
  const records: CsvRecord[] = [];
  let i = 0;
  const len = text.length;
  let line = 1;

  while (i < len) {
    const recordStart = i;
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    let sawAnyContent = false;
    // The line the MOST RECENTLY opened quote in this record started on —
    // if the record ends (EOF) while still inQuotes, this is the quote
    // that never closed.
    let quoteStartLine = line;

    while (i < len) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
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
        // Peek past \r\n as one terminator; a bare \r (old Mac) also ends
        // the record.
        i += 1;
        if (text[i] === "\n") i += 1;
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
        error: `This file has an unclosed quote starting at line ${quoteStartLine} — a " was opened but never closed, so everything from there to the end of the file was read as one field. Fix the quoting near that line (check for a stray " inside a remarks/comments cell) and re-upload.`,
      };
    }

    fields.push(field);

    const raw = text.slice(recordStart, i).replace(/[\r\n]+$/g, "");
    // Skip a record that is genuinely empty (no content at all, not even
    // an empty-quoted field) — this is what makes a trailing blank line or
    // trailing newline not produce a phantom row.
    const isBlank = !sawAnyContent && fields.length === 1 && fields[0] === "";
    if (!isBlank) {
      records.push({ fields, raw });
    }
  }

  return records;
}
