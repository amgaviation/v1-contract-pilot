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

/**
 * Splits `text` into CSV records. Handles quoted fields, doubled-quote
 * escaping (`""` -> `"`), commas and newlines inside quotes, and both
 * `\r\n` and `\n` line endings. A trailing blank line (or trailing
 * newline) produces no record. Every record is returned, INCLUDING the
 * header row if present — callers slice that off themselves, since some
 * formats (ForeFlight) have more than one header inside a single file.
 */
export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const recordStart = i;
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    let sawAnyContent = false;

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
          field += ch;
          i += 1;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
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
        break;
      }
      if (ch === "\n") {
        i += 1;
        break;
      }
      field += ch;
      sawAnyContent = true;
      i += 1;
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
