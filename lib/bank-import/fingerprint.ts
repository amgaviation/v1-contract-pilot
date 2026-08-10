import { createHash } from "crypto";

/**
 * The dedup key for bank_transactions (unique per (account_id,
 * bank_account_id) per bank_transactions_fingerprint_uniq in
 * 20260809070000_bank_transactions.sql). Computed server-side in
 * confirmBankImport — never accepted from the client — so re-importing an
 * overlapping date range always produces the same fingerprints for the
 * same real transactions and lands on the same unique-index violation the
 * DB already enforces.
 *
 * FIELDS, AND WHY THESE AND NOT OTHERS — mirrors lib/logbook-import/
 * fingerprint.ts's reasoning almost exactly:
 *
 *   posted_on, description, amount_cents
 *     — together, "the same line on the statement." These three are
 *     exactly what a bank re-exports byte-identically across repeated
 *     downloads of the same underlying transaction (a bank's own posted
 *     date does not change on re-export the way a "pending" date might).
 *
 *   NOT bank_account_id — same reasoning as logbook's fingerprint.ts
 *     omitting account_id: the uniqueness constraint is already scoped
 *     to (account_id, bank_account_id, fingerprint), so folding it into
 *     the hash would be redundant, not additional safety. Leaving it out
 *     also means a pilot who re-labels/re-creates a bank_account row
 *     (rare, but not impossible) doesn't silently change every past
 *     fingerprint.
 *
 *   NOT source_row_number / file order — a bank whose export tool orders
 *     rows differently between two downloads of the same range (some do,
 *     sorting by amount vs. date) must not re-import every row as "new"
 *     just because it now sits at a different line number.
 *
 *   NOT a bank-provided transaction id — most CSV exports do not carry
 *     one at all (OFX's FITID is the exception; see below). Requiring one
 *     would make CSV dedup impossible for the majority of banks that
 *     never had this problem to begin with.
 *
 * KNOWN LIMITATION, stated rather than hidden: two GENUINELY DIFFERENT
 * transactions that happen to share date + description + amount (e.g. two
 * identical $4.75 coffee purchases at the same vendor on the same day)
 * hash identically and the second is skipped as a duplicate. This is the
 * same accepted trade logbook's fingerprint.ts documents: the dominant
 * failure mode this dedup prevents — re-importing overlapping statement
 * ranges doubling every transaction — is common and silent, whereas this
 * collision is comparatively rare (a bank distinguishes truly repeated
 * charges from a single duplicated download far less often than a pilot
 * flies two identical pattern-work hops) and recoverable: the pilot adds
 * the missed second transaction as a manual expense, which never touches
 * this fingerprint index at all.
 *
 * OFX/QFX ALSO CARRIES FITID (a bank-assigned unique id per transaction),
 * which would in principle be a STRONGER key than this hash for that one
 * format. It is deliberately NOT used here, to keep exactly one dedup
 * rule for every source format — a CSV re-import and an OFX re-import of
 * the same statement range must collide on the same logical key, not two
 * different ones that could disagree with each other about what "the same
 * transaction" means.
 *
 * Parts are length-prefixed before joining, same rationale as logbook's
 * fingerprint.ts: `description` is free text from the bank and not
 * guaranteed delimiter-free, so a naive "|"-join could let two DIFFERENT
 * transactions collide across a shifted field boundary.
 */
function escapePart(value: string): string {
  return `${value.length}:${value}`;
}

export function transactionFingerprint(values: {
  postedOn: string;
  description: string;
  amountCents: number;
}): string {
  const parts = [
    values.postedOn,
    values.description.trim().toUpperCase(),
    String(values.amountCents),
  ].map((p) => escapePart(String(p)));
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
