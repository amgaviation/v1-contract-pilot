import test from "node:test";
import assert from "node:assert/strict";

const { buildClientReceipt } = await import("../lib/email/payment-receipt.ts");

/**
 * The receipt a pilot's CLIENT receives when an online payment lands.
 * Two rules must never regress:
 *   VOICE     the only name in the mail is the pilot's — no V1, no AMG,
 *             no "sent via" (lib/brand.ts; same pin as invoice-message).
 *   BALANCE   the receipt states what remains, or says paid in full, and
 *             when the balance could not be read it says NOTHING about it
 *             rather than guessing.
 */

const BASE = {
  accountName: "Meridian Contract Aviation LLC",
  clientName: "Falcon Ops Group",
  contactName: "Dana Reyes",
  invoiceNumber: "INV-0042",
  amountCents: 450_000,
  paidOnIso: "2026-08-17",
  balanceDueCents: 0,
};

test("a paid-in-full receipt states amount, date, invoice, and settles the balance", () => {
  const receipt = buildClientReceipt(BASE);
  assert.equal(
    receipt.subject,
    "Payment received — Invoice INV-0042 — Meridian Contract Aviation LLC"
  );
  assert.ok(receipt.text.startsWith("Dana Reyes,"));
  assert.ok(receipt.text.includes("$4,500.00"));
  assert.ok(receipt.text.includes("Invoice INV-0042"));
  assert.ok(receipt.text.includes("Aug 17, 2026"));
  assert.ok(receipt.text.includes("paid in full"));
  assert.ok(receipt.text.trimEnd().endsWith("Meridian Contract Aviation LLC"));
});

test("a part payment states the remaining balance", () => {
  const receipt = buildClientReceipt({ ...BASE, balanceDueCents: 150_000 });
  assert.ok(receipt.text.includes("The remaining balance is $1,500.00."));
  assert.ok(!receipt.text.includes("paid in full"));
});

test("an unreadable balance says nothing about the balance", () => {
  const receipt = buildClientReceipt({ ...BASE, balanceDueCents: null });
  assert.ok(!receipt.text.includes("balance"));
  assert.ok(!receipt.text.includes("paid in full"));
  assert.ok(receipt.text.includes("$4,500.00"));
});

test("VOICE: no V1 or AMG branding anywhere in a client's mail", () => {
  const receipt = buildClientReceipt(BASE);
  const all = `${receipt.subject}\n${receipt.text}`;
  assert.ok(!/\bV1\b/.test(all));
  assert.ok(!/AMG/i.test(all));
  assert.ok(!/sent via/i.test(all));
});

test("no contact falls back to the client name; no invoice number reads naturally", () => {
  const receipt = buildClientReceipt({
    ...BASE,
    contactName: null,
    invoiceNumber: null,
  });
  assert.ok(receipt.text.startsWith("Falcon Ops Group,"));
  assert.equal(
    receipt.subject,
    "Payment received — Invoice — Meridian Contract Aviation LLC"
  );
  assert.ok(receipt.text.includes("your invoice"));
});
