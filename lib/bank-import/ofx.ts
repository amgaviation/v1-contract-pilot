import { parseBankAmount } from "./amount";
import type { BankParseResult, ParsedBankRow, RejectedBankRow } from "./types";

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
 */
export function parseOfx(text: string, format: "ofx" | "qfx"): BankParseResult {
  const valid: ParsedBankRow[] = [];
  const rejected: RejectedBankRow[] = [];

  // Normalize line endings once; every downstream regex assumes \n only.
  const body = text.replace(/\r\n?/g, "\n");

  const blockRe = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body))) {
    blocks.push(m[1] ?? "");
  }

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

  blocks.forEach((block, i) => {
    const rowNumber = i + 1;
    const reject = (reason: string) => rejected.push({ rowNumber, raw: block.trim(), reason });

    // Leaf-tag extraction: <TAG>value, value runs to end of line (OFX
    // leaves are almost always unclosed) OR to the next '<' if a closing
    // tag or sibling opening tag follows on the same line.
    const fields: Record<string, string> = {};
    const tagRe = /<([A-Za-z0-9.]+)>([^<\r\n]*)/g;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(block))) {
      const tag = t[1]!.toUpperCase();
      const value = t[2]!.trim();
      if (value !== "") fields[tag] = value;
    }

    const dtposted = fields.DTPOSTED;
    if (!dtposted) {
      reject("Missing DTPOSTED (posted date).");
      return;
    }
    const dateMatch = /^(\d{4})(\d{2})(\d{2})/.exec(dtposted);
    if (!dateMatch) {
      reject(`DTPOSTED isn't a recognized OFX date: "${dtposted}".`);
      return;
    }
    const postedOn = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

    const trnamt = fields.TRNAMT;
    if (!trnamt) {
      reject("Missing TRNAMT (amount).");
      return;
    }
    const amountCents = parseBankAmount(trnamt);
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
