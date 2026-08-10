import { parseBankAmount } from "./amount";
import { parseOfxDate } from "./date";
import type { BankParseResult, ParsedBankRow, RejectedBankRow } from "./types";

/**
 * Decodes the five predefined SGML/XML entities plus numeric character
 * references, in ONE pass over a single alternation.
 *
 * The single pass is the point, not a micro-optimisation: sequential
 * `.replace()` calls decode `&amp;lt;` into `<`, because the `&amp;` pass
 * produces an `&lt;` that the later `&lt;` pass then eats. One alternation
 * cannot do that — each match is consumed exactly once.
 *
 * Why this is needed at all: OFX 2.x is XML, so a bare `&` is a hard parse
 * error and any merchant with an ampersand in its name MUST arrive
 * escaped. Undecoded, "AT&amp;T MOBILITY" was stored verbatim, reached
 * `pilot.expenses.vendor`, and rendered to the pilot literally — React
 * escapes JSX text children, so the entity is what they see. It also made
 * the fingerprint diverge from the CSV export of the same charge, so both
 * rows landed.
 *
 * Unrecognised entities are left verbatim rather than mangled: a bank that
 * emits something exotic gets its text through unchanged instead of
 * half-decoded.
 *
 * Parser-forward only. Rows already imported are deliberately NOT
 * re-decoded — their fingerprints were computed from the stored text, and
 * changing it would break dedup against the very statements it protects.
 */
function decodeEntities(value: string): string {
  return value.replace(
    /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g,
    (whole, named: string | undefined, dec: string | undefined, hex: string | undefined) => {
      if (named) {
        switch (named) {
          case "amp":
            return "&";
          case "lt":
            return "<";
          case "gt":
            return ">";
          case "quot":
            return '"';
          case "apos":
            return "'";
        }
      }
      const code = dec ? Number.parseInt(dec, 10) : hex ? Number.parseInt(hex, 16) : NaN;
      // Reject non-characters rather than throwing from fromCodePoint.
      if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
  );
}

/**
 * A focused OFX/QFX parser for exactly the records this feature needs:
 * `<STMTTRN>` blocks inside a bank or credit-card statement download.
 * OFX is SGML, not XML — most tags are unclosed leaves ("`<DTPOSTED>`
 * value, newline, next tag" with no `</DTPOSTED>`), so this is
 * deliberately NOT a general SGML/XML parser. It does exactly one thing:
 * find every `<STMTTRN>...</STMTTRN>` block (that pairing IS reliably
 * closed in every real-world OFX/QFX export seen) and read a fixed set of
 * known leaf tags out of each one with a per-line regex. QFX is OFX plus
 * an Intuit `<INTU.BID>`/`<INTU.USERID>` extension block outside
 * `<STMTTRN>` — nothing this parser reads lives in that block, so QFX and
 * OFX share this exact code path; the only difference the caller sees is
 * which format label gets stored on the batch.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BLOCK REGEX REFUSES TO CROSS AN OPENER (fixed after review)
 * ---------------------------------------------------------------------------
 * The original pattern was `/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi`. Lazy, but
 * with nothing stopping the body from swallowing a nested `<STMTTRN>`. So a
 * file whose second record is missing its closing tag — truncation, or a
 * merely sloppy export — had that record's body merged into the third
 * record's. Reproduced against this exact parser:
 *
 *   openers in file: 3   valid: 2   rejected: 0
 *     row 1  2026-03-15  -1000     SYNTH ONE
 *     row 2  2026-03-17  -999900   SYNTH BRAVO — SYNTH MEMO CHARLIE
 *
 * Note what that second row IS. It is not the lost transaction and it is
 * not the surviving one: the leaf-tag scan is last-write-wins, so it took
 * BRAVO's name and CHARLIE's date and amount and produced a $9,999.00
 * charge **that does not appear anywhere in the file**. The real BRAVO was
 * $20.00. That row passes every validation, renders in the preview as
 * ordinary, and is offered to the pilot to file against a client.
 *
 * Silently losing a transaction is bad. Silently inventing one, with a
 * plausible merchant name and a four-figure amount, is the reason this is
 * the most severe defect this feature had.
 *
 * Two changes, and both are load-bearing:
 *   1. `(?:(?!<STMTTRN>)[\s\S])*?` — the body may not contain another
 *      opener, so an unclosed record can no longer absorb its successor.
 *      This alone converts fabrication into plain loss.
 *   2. Reconcile the opener count against the block count and reject once,
 *      by name, per unaccounted opener. THIS is what makes the loss loud;
 *      without it the file quietly reports fewer transactions than it has,
 *      and `totalRows` (computed downstream as valid + rejected) agrees
 *      with the wrong number instead of contradicting it.
 */
export function parseOfx(text: string, format: "ofx" | "qfx"): BankParseResult {
  const valid: ParsedBankRow[] = [];
  const rejected: RejectedBankRow[] = [];

  // Normalize line endings once; every downstream regex assumes \n only.
  const body = text.replace(/\r\n?/g, "\n");

  // The body may not contain a further opener — see the header comment.
  // Every opener in the file, BY POSITION — this is the numbering the
  // pilot's file actually has, and the only numbering worth reporting.
  //
  // Indexing the matched blocks instead (which an earlier version did)
  // renumbers everything after a malformed record: for valid / malformed /
  // valid, the third record was reported as row 2 and the rejection as row
  // 3, so both the pilot-facing message and the source_row_number stored
  // as lineage pointed at the wrong lines. Caught in review.
  const openerPositions: number[] = [];
  const openerRe = /<STMTTRN>/gi;
  let o: RegExpExecArray | null;
  while ((o = openerRe.exec(body))) openerPositions.push(o.index);

  const blockRe = /<STMTTRN>((?:(?!<STMTTRN>)[\s\S])*?)<\/STMTTRN>/gi;
  // Body keyed by the position of the opener that starts it, so each block
  // can be matched back to its ordinal in the file.
  const blockByStart = new Map<number, string>();
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body))) {
    blockByStart.set(m.index, m[1] ?? "");
  }

  const blocks: { rowNumber: number; body: string }[] = [];
  const unclosedRowNumbers: number[] = [];
  openerPositions.forEach((pos, i) => {
    const rowNumber = i + 1;
    const found = blockByStart.get(pos);
    if (found === undefined) unclosedRowNumbers.push(rowNumber);
    else blocks.push({ rowNumber, body: found });
  });

  if (blocks.length === 0) {
    return {
      format,
      header: [],
      valid: [],
      rejected: [
        {
          rowNumber: 0,
          raw: "",
          reason: "No <STMTTRN>...</STMTTRN> transaction records were found in this file — it may not be a valid OFX/QFX statement export.",
        },
      ],
    };
  }

  // One named rejection per record the file opened but this parser could
  // not close, carrying the record's REAL position in the file. The pilot
  // sees "3 transactions found, row 2 couldn't be read" instead of a
  // clean-looking import that is quietly short.
  for (const rowNumber of unclosedRowNumbers) {
    rejected.push({
      rowNumber,
      raw: "",
      reason:
        "This <STMTTRN> transaction record is missing its closing </STMTTRN> tag, so it couldn't be read. The file may have been truncated during download — re-download the statement and import it again.",
    });
  }

  blocks.forEach(({ rowNumber, body: block }) => {
    const reject = (reason: string) => rejected.push({ rowNumber, raw: block.trim(), reason });

    // Leaf-tag extraction: <TAG>value, value runs to end of line (OFX
    // leaves are almost always unclosed) OR to the next '<' if a closing
    // tag or sibling opening tag follows on the same line.
    const fields: Record<string, string> = {};
    const tagRe = /<([A-Za-z0-9.]+)>([^<\r\n]*)/g;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(block))) {
      const tag = t[1]!.toUpperCase();
      // Decode on the leaf value, once, before anything reads it — so the
      // description, the fingerprint and pilot.expenses.vendor all see the
      // same decoded text rather than three different opinions of it.
      const value = decodeEntities(t[2]!).trim();
      if (value !== "") fields[tag] = value;
    }

    const dtposted = fields.DTPOSTED;
    if (!dtposted) {
      reject("Missing DTPOSTED (posted date).");
      return;
    }
    // Arithmetically validated, not string-sliced — see date.ts's header
    // for what "2026-02-31" used to do to the preview.
    const postedOn = parseOfxDate(dtposted);
    if (!postedOn) {
      reject(
        `DTPOSTED isn't a real calendar date: "${dtposted}". Expected YYYYMMDD (for example 20260315).`
      );
      return;
    }

    const trnamt = fields.TRNAMT;
    if (!trnamt) {
      reject("Missing TRNAMT (amount).");
      return;
    }
    // "decimal", not the CSV default: OFX 2.0.2 §3.2.9.2 requires an amount
    // to carry "a decimal point or comma to indicate the start of the
    // fractional amount" and forbids thousands punctuation outright, so
    // `-540,32` here means $540.32 and is not ambiguous the way the same
    // string in a CSV would be. See amount.ts's comma section.
    const amountCents = parseBankAmount(trnamt, "decimal");
    if (amountCents === undefined) {
      reject(`TRNAMT isn't a recognized number: "${trnamt}".`);
      return;
    }

    // NAME (payee) and MEMO (free text) are both common; prefer NAME as
    // the primary description (closest analog to a CSV "Description"
    // column) and append MEMO when it adds information, same "don't
    // silently drop a narrative field" rule apply-mapping.ts (logbook)
    // applies to remarks.
    const name = fields.NAME ?? fields.PAYEE;
    const memo = fields.MEMO;
    let description: string | undefined;
    if (name && memo && memo !== name) description = `${name} — ${memo}`;
    else description = name ?? memo;
    if (!description) {
      reject("Missing both NAME and MEMO — no description available for this transaction.");
      return;
    }

    // NO credit-card sign flip here — unlike a CSV credit-card export
    // (where issuers commonly write a purchase as a POSITIVE charge, see
    // apply-mapping.ts), OFX's own spec convention already writes debits
    // (including credit-card purchases) as NEGATIVE consistently across
    // both <BANKMSGSRSV1> and <CREDITCARDMSGSRSV1> statement types. This
    // parser's output is therefore already canonical for every account
    // kind without transformation — flipping it here would be WRONG, not
    // merely redundant, for a real OFX credit-card export.
    valid.push({
      rowNumber,
      raw: block.trim(),
      sourceRow: fields,
      postedOn,
      description,
      amountCents,
    });
  });

  return { format, header: [], valid, rejected };
}
