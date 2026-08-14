import test from "node:test";
import assert from "node:assert/strict";

const { transactionFingerprint } = await import("../lib/bank-import/fingerprint.ts");
const { rowFingerprint } = await import("../lib/logbook-import/fingerprint.ts");

/**
 * lib/bank-import/fingerprint.ts is the dedup key that decides whether a
 * re-imported bank statement double-counts money: two rows that hash
 * identically collide on bank_transactions_fingerprint_uniq and the
 * second is silently skipped. Before this file, nothing pinned it —
 * bank-import:verify (PART 1, in-process, no database) exercises it as
 * one step of a larger fixture, but it ran in no CI job (see the
 * companion ci.yml wiring fix) and nothing under `npm test` touched it at
 * all. A regression here either doubles every overlapping re-import
 * (fingerprint too narrow) or silently drops distinct transactions
 * (fingerprint collides more than intended).
 *
 * lib/logbook-import/fingerprint.ts is included alongside it: its own
 * header says it mirrors the bank fingerprint's reasoning "almost
 * exactly" (case/trim normalization, NOT source_row_number, the same
 * length-prefix defence), so the two are pinned together to keep that
 * documented symmetry honest rather than drifting unnoticed.
 */

test("transactionFingerprint: stability across re-parse of the same statement line", () => {
  const base = { postedOn: "2026-01-05", description: "COFFEE SHOP #42", amountCents: 475 };

  // A bank re-exporting the identical transaction produces byte-identical
  // postedOn/amount but description case/whitespace can vary between
  // export tools or even between two downloads of the same range.
  assert.equal(
    transactionFingerprint(base),
    transactionFingerprint({ ...base, description: "coffee shop #42" })
  );
  assert.equal(
    transactionFingerprint(base),
    transactionFingerprint({ ...base, description: "  COFFEE SHOP #42  " })
  );
  // Re-running it twice on the exact same input is of course also stable.
  assert.equal(transactionFingerprint(base), transactionFingerprint(base));
});

test("transactionFingerprint: distinct per field — date, description, amount each matter", () => {
  const base = { postedOn: "2026-01-05", description: "COFFEE SHOP", amountCents: 475 };
  const fpBase = transactionFingerprint(base);

  assert.notEqual(fpBase, transactionFingerprint({ ...base, postedOn: "2026-01-06" }));
  assert.notEqual(fpBase, transactionFingerprint({ ...base, description: "COFFEE SHOP #2" }));
  assert.notEqual(fpBase, transactionFingerprint({ ...base, amountCents: 476 }));
  // A negative (refund/reversal) amount is a genuinely different
  // transaction from its positive counterpart, not "the same charge."
  assert.notEqual(fpBase, transactionFingerprint({ ...base, amountCents: -475 }));
});

test("transactionFingerprint: length-prefixing defeats a field-boundary shift", () => {
  // Without the length-prefix (escapePart), a naive `postedOn + "|" +
  // description + "|" + amount` join would let a "|" inside a free-text
  // description shift the field boundary: these two inputs join to the
  // IDENTICAL raw string under that naive scheme even though they
  // describe different transactions (posted date carrying the injected
  // delimiter vs. description carrying it). The real function must NOT
  // collide them.
  const shiftedIntoDate = transactionFingerprint({
    postedOn: "2026-01-05|INJECTED",
    description: "REST",
    amountCents: 100,
  });
  const shiftedIntoDescription = transactionFingerprint({
    postedOn: "2026-01-05",
    description: "INJECTED|REST",
    amountCents: 100,
  });
  assert.notEqual(shiftedIntoDate, shiftedIntoDescription);
});

test("rowFingerprint (logbook): stability across re-parse — case and whitespace normalized", () => {
  const a = rowFingerprint({
    entry_date: "2026-01-05",
    aircraft_ident: " n123ab ",
    from_icao: "kteb",
    to_icao: "kbos",
    total_time: 1.25,
    role: "PIC",
  });
  const b = rowFingerprint({
    entry_date: "2026-01-05",
    aircraft_ident: "N123AB",
    from_icao: "KTEB",
    to_icao: "KBOS",
    total_time: 1.25,
    role: "PIC",
  });
  assert.equal(a, b);
});

test("rowFingerprint (logbook): distinct per field — the five-tuple that means \"the same flight\"", () => {
  const base = {
    entry_date: "2026-01-05",
    aircraft_ident: "N123AB",
    from_icao: "KTEB",
    to_icao: "KBOS",
    total_time: 1.5,
    role: "PIC",
  };
  const fpBase = rowFingerprint(base);

  assert.notEqual(fpBase, rowFingerprint({ ...base, entry_date: "2026-01-06" }));
  assert.notEqual(fpBase, rowFingerprint({ ...base, aircraft_ident: "N999ZZ" }));
  assert.notEqual(fpBase, rowFingerprint({ ...base, from_icao: "KJFK" }));
  assert.notEqual(fpBase, rowFingerprint({ ...base, to_icao: "KJFK" }));
  assert.notEqual(fpBase, rowFingerprint({ ...base, total_time: 1.6 }));
  assert.notEqual(fpBase, rowFingerprint({ ...base, role: "SIC" }));
});

test("rowFingerprint (logbook): length-prefixing defeats the same field-boundary shift", () => {
  const shiftedIntoIdent = rowFingerprint({
    entry_date: "2026-01-05",
    aircraft_ident: "N1|KTEB",
    from_icao: "KBOS",
    to_icao: "KJFK",
    total_time: 1,
    role: "PIC",
  });
  const shiftedIntoFrom = rowFingerprint({
    entry_date: "2026-01-05",
    aircraft_ident: "N1",
    from_icao: "KTEB|KBOS",
    to_icao: "KJFK",
    total_time: 1,
    role: "PIC",
  });
  assert.notEqual(shiftedIntoIdent, shiftedIntoFrom);
});

test("rowFingerprint (logbook): total_time is rounded to one decimal before hashing", () => {
  // Two total_time values that would round to the same tenth ARE the same
  // fingerprint input — this is documented behavior, not a bug, so pin it
  // rather than let a future reader assume more precision is preserved.
  const a = rowFingerprint({
    entry_date: "2026-01-05",
    aircraft_ident: "N1",
    from_icao: "KTEB",
    to_icao: "KBOS",
    total_time: 1.501,
    role: "PIC",
  });
  const b = rowFingerprint({
    entry_date: "2026-01-05",
    aircraft_ident: "N1",
    from_icao: "KTEB",
    to_icao: "KBOS",
    total_time: 1.504,
    role: "PIC",
  });
  assert.equal(a, b);
});
