import test from "node:test";
import assert from "node:assert/strict";

const { buildSubscriptionReceipt, buildSubscriptionPaymentFailed } = await import(
  "../lib/email/platform-mail.ts"
);

/**
 * The V1-branded platform mail — the ONE family of email allowed to carry
 * V1's name, because V1 itself is the sender and the pilot is the reader.
 * These tests pin the facts each mail must state and the branding rule's
 * boundary (the client-facing receipt in payment-receipt.test.mjs pins the
 * other side: no V1 anywhere).
 */

test("receipt states amount, date and invoice number in both bodies", () => {
  const mail = buildSubscriptionReceipt({
    amountCents: 4_900,
    stripeInvoiceNumber: "A1B2C3D4-0007",
    paidOnIso: "2026-08-17",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_x/test",
  });
  assert.equal(mail.subject, "V1 receipt — $49.00");
  for (const body of [mail.text, mail.html]) {
    assert.ok(body.includes("$49.00"));
    assert.ok(body.includes("August 17, 2026"));
    assert.ok(body.includes("A1B2C3D4-0007"));
  }
  assert.ok(mail.text.includes("https://invoice.stripe.com/i/acct_x/test"));
  assert.ok(mail.html.includes("https://invoice.stripe.com/i/acct_x/test"));
});

test("receipt without a hosted invoice URL still offers the billing page", () => {
  const mail = buildSubscriptionReceipt({
    amountCents: 12_000,
    stripeInvoiceNumber: null,
    paidOnIso: "2026-01-02",
    hostedInvoiceUrl: null,
  });
  assert.ok(mail.text.includes("https://v1.amgaviationgroup.com/settings/billing"));
  assert.ok(mail.html.includes("https://v1.amgaviationgroup.com/settings/billing"));
  assert.ok(!mail.text.includes("Invoice:"));
});

test("failure mail names the amount, the retry date, and the billing page", () => {
  const mail = buildSubscriptionPaymentFailed({
    amountCents: 4_900,
    attemptedOnIso: "2026-08-17",
    nextAttemptIso: "2026-08-21",
  });
  assert.equal(mail.subject, "V1 payment failed — update your card");
  for (const body of [mail.text, mail.html]) {
    assert.ok(body.includes("$49.00"));
    assert.ok(body.includes("August 21, 2026"));
    assert.ok(body.includes("https://v1.amgaviationgroup.com/settings/billing"));
  }
});

test("failure mail with no amount and no retry still reads whole", () => {
  const mail = buildSubscriptionPaymentFailed({
    amountCents: null,
    attemptedOnIso: "2026-08-17",
    nextAttemptIso: null,
  });
  assert.ok(mail.text.includes("didn't go through"));
  assert.ok(mail.text.includes("Update your payment method"));
  assert.ok(!mail.text.includes("retry on"));
});

test("HTML is the email-safe card: inline styles, hosted PNG wordmark, no <style> block", () => {
  const mail = buildSubscriptionReceipt({
    amountCents: 100,
    stripeInvoiceNumber: null,
    paidOnIso: "2026-08-17",
    hostedInvoiceUrl: null,
  });
  assert.ok(!mail.html.includes("<style"));
  assert.ok(mail.html.includes("https://v1.amgaviationgroup.com/brand/navy.png"));
  assert.ok(mail.html.includes('alt="V1"'));
  assert.ok(mail.html.includes("V1 &middot; Contract Pilot"));
});

test("a hostile hosted-invoice URL cannot break out of the href", () => {
  const mail = buildSubscriptionReceipt({
    amountCents: 100,
    stripeInvoiceNumber: '"><script>x</script>',
    paidOnIso: "2026-08-17",
    hostedInvoiceUrl: 'https://x/"><script>alert(1)</script>',
  });
  assert.ok(!mail.html.includes("<script>"));
});
