import test from "node:test";
import assert from "node:assert/strict";

const { buildEstimateMessage } = await import("../lib/email/estimate-message.ts");

/**
 * The words a pilot's client receives when a quote is emailed. Worth
 * pinning for the same reason tests/invoice-message.test.mjs pins the
 * invoice wording: a mistake here reaches the client's inbox, permanently,
 * and the pilot who made it never sees it happen.
 */

const BASE = {
  accountName: "Halyard Air LLC",
  clientName: "Meridian Aviation",
  contactName: "Dana Whitfield",
  estimateNumber: "EST-2026-0007",
  validUntil: "2026-09-10",
  totalCents: 450_000,
  notes: null,
};

test("buildEstimateMessage: subject names the estimate and the pilot's business", () => {
  const message = buildEstimateMessage(BASE);
  assert.equal(message.subject, "Estimate EST-2026-0007 from Halyard Air LLC");
});

test("buildEstimateMessage: greets the contact, not the client's own name, when both exist", () => {
  const message = buildEstimateMessage(BASE);
  assert.ok(message.text.startsWith("Dana Whitfield,\n"));
});

test("buildEstimateMessage: falls back to the client's own name with no contact on file", () => {
  const message = buildEstimateMessage({ ...BASE, contactName: null });
  assert.ok(message.text.startsWith("Meridian Aviation,\n"));
});

test("buildEstimateMessage: states the total, the valid-until date, and that no payment is due", () => {
  const message = buildEstimateMessage(BASE);
  assert.match(message.text, /\$4,500\.00/);
  assert.match(message.text, /valid until Sep 10, 2026/);
  assert.match(message.text, /no payment is due/i);
});

test("buildEstimateMessage: omits the valid-until clause when there is none", () => {
  const message = buildEstimateMessage({ ...BASE, validUntil: null });
  assert.doesNotMatch(message.text, /valid until/);
  assert.match(message.text, /\$4,500\.00\. This is a price quote/);
});

test("buildEstimateMessage: never carries payment-terms or remittance language", () => {
  const message = buildEstimateMessage(BASE);
  // The one permitted use of "due" is the fixed disclaimer sentence
  // itself ("no payment is due") — a due DATE, a balance, or a pay-online
  // link are invoice concepts and must never appear on a quote.
  assert.doesNotMatch(message.text, /due (Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug)/i);
  assert.doesNotMatch(message.text, /balance/i);
  assert.doesNotMatch(message.text, /pay(ment)? (online|here)/i);
  assert.match(message.text, /no payment is due/i);
});

test("buildEstimateMessage: an unnumbered estimate says 'Estimate' plainly", () => {
  const message = buildEstimateMessage({ ...BASE, estimateNumber: null });
  assert.equal(message.subject, "Estimate from Halyard Air LLC");
  assert.match(message.text, /^Dana Whitfield,\n\nEstimate is attached/);
});

test("buildEstimateMessage: the per-send note is passed through verbatim, not templated", () => {
  const message = buildEstimateMessage({
    ...BASE,
    customMessage: "This covers the two KTEB legs we discussed on the 4th.",
  });
  assert.match(message.text, /This covers the two KTEB legs we discussed on the 4th\./);
});

test("buildEstimateMessage: the estimate's own notes ride along, untouched", () => {
  const message = buildEstimateMessage({
    ...BASE,
    notes: "Price assumes fuel is provided by the client.",
  });
  assert.match(message.text, /Price assumes fuel is provided by the client\./);
});

test("buildEstimateMessage: signs off with the account name, never AMG", () => {
  const message = buildEstimateMessage(BASE);
  assert.ok(message.text.trim().endsWith("Thank you,\nHalyard Air LLC"));
  assert.doesNotMatch(message.text, /AMG/i);
});
