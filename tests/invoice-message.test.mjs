import test from "node:test";
import assert from "node:assert/strict";

const { buildInvoiceMessage, buildReminderMessage, daysOverdue } = await import(
  "../lib/email/invoice-message.ts"
);
const { looksLikeEmail } = await import("../lib/email/address.ts");

/**
 * The words that leave the building.
 *
 * These are worth pinning because unlike most of this codebase, a mistake here
 * is not visible to the person who made it — it is visible to the pilot's
 * client, in their inbox, permanently, attached to a bill. The pilot finds out
 * when they don't get paid.
 */

const BASE = {
  accountName: "Halyard Air LLC",
  clientName: "Meridian Aviation",
  contactName: "Dana Whitfield",
  invoiceNumber: "INV-0042",
  dueOn: "2026-09-10",
  totalCents: 1_400_000,
  balanceDueCents: 1_400_000,
  paymentUrl: null,
  notes: null,
};

test("the invoice email", async (t) => {
  await t.test("names the balance due, not the total, when they differ", () => {
    // The number a payer needs is what is LEFT. Naming the total on a
    // part-paid invoice asks the client for money they already sent.
    const m = buildInvoiceMessage({
      ...BASE,
      totalCents: 1_400_000,
      balanceDueCents: 400_000,
    });
    assert.match(m.text, /\$4,000\.00/);
    // …and explains the difference rather than leaving them to reconcile it.
    assert.match(m.text, /remaining balance/i);
    assert.match(m.text, /\$14,000\.00/);
  });

  await t.test("says it once when there is nothing to reconcile", () => {
    const m = buildInvoiceMessage(BASE);
    assert.match(m.text, /\$14,000\.00/);
    assert.doesNotMatch(m.text, /remaining balance/i);
  });

  await t.test("addresses the contact by name, falling back to the company", () => {
    assert.match(buildInvoiceMessage(BASE).text, /^Dana Whitfield,/);
    assert.match(
      buildInvoiceMessage({ ...BASE, contactName: null }).text,
      /^Meridian Aviation,/
    );
    // A blank string is not a name — it must fall back, not greet nobody.
    assert.match(
      buildInvoiceMessage({ ...BASE, contactName: "   " }).text,
      /^Meridian Aviation,/
    );
  });

  await t.test("signs as the pilot's business and never mentions AMG or V1", () => {
    const m = buildInvoiceMessage({ ...BASE, paymentUrl: "https://pay.example/x" });
    const haystack = `${m.subject}\n${m.text}`;
    // The pilot's client is not AMG's customer and this mail is not AMG's
    // mail. docs/PLAN.md: "Tony is a software vendor here, nothing more."
    assert.doesNotMatch(haystack, /AMG/i);
    assert.doesNotMatch(haystack, /\bV1\b/);
    assert.doesNotMatch(haystack, /sent (via|from|using)/i);
    assert.match(m.text, /Halyard Air LLC$/);
  });

  await t.test("includes the payment link only when there is one", () => {
    assert.match(
      buildInvoiceMessage({ ...BASE, paymentUrl: "https://pay.example/x" }).text,
      /https:\/\/pay\.example\/x/
    );
    assert.doesNotMatch(buildInvoiceMessage(BASE).text, /pay online/i);
  });

  await t.test("carries the invoice number into the subject", () => {
    assert.equal(buildInvoiceMessage(BASE).subject, "Invoice INV-0042 from Halyard Air LLC");
    // An unnumbered invoice still needs a subject that reads like one.
    assert.equal(
      buildInvoiceMessage({ ...BASE, invoiceNumber: null }).subject,
      "Invoice from Halyard Air LLC"
    );
  });

  await t.test("passes the pilot's own notes through untouched", () => {
    const m = buildInvoiceMessage({ ...BASE, notes: "Ferry leg billed at half day." });
    assert.match(m.text, /Ferry leg billed at half day\./);
  });
});

test("the reminder", async (t) => {
  await t.test("never threatens a late fee or a consequence", () => {
    const m = buildReminderMessage({ ...BASE, daysOverdue: 21 });
    const haystack = `${m.subject}\n${m.text}`.toLowerCase();
    // Late-fee percentages are negotiated convention, not law, and this
    // product neither computes nor knows the pilot's agreed terms. Inventing
    // one would damage the relationship the pilot depends on.
    for (const forbidden of [
      "late fee",
      "penalty",
      "interest",
      "collections",
      "legal action",
      "immediately",
      "failure to",
    ]) {
      assert.ok(!haystack.includes(forbidden), `reminder must not say "${forbidden}"`);
    }
  });

  await t.test("gives the client an honest out", () => {
    // The overwhelmingly common reason a flight department has not paid is an
    // approvals queue, not refusal. A chase that assumes bad faith costs the
    // pilot the next booking.
    const m = buildReminderMessage({ ...BASE, daysOverdue: 5 });
    assert.match(m.text, /disregard/i);
    assert.match(m.text, /needs correcting/i);
  });

  await t.test("counts days correctly and pluralises", () => {
    assert.match(buildReminderMessage({ ...BASE, daysOverdue: 1 }).text, /1 day ago/);
    assert.match(buildReminderMessage({ ...BASE, daysOverdue: 9 }).text, /9 days ago/);
  });

  await t.test("reads as a nudge, not an accusation, when not yet overdue", () => {
    const m = buildReminderMessage({ ...BASE, daysOverdue: 0 });
    assert.doesNotMatch(m.text, /ago/);
    assert.doesNotMatch(m.subject, /outstanding/);
    assert.match(m.text, /is due/i);
  });
});

test("daysOverdue", async (t) => {
  await t.test("is zero on and before the due date, never negative", () => {
    assert.equal(daysOverdue("2026-09-10", new Date("2026-09-10T12:00:00Z")), 0);
    assert.equal(daysOverdue("2026-09-10", new Date("2026-09-01T12:00:00Z")), 0);
  });

  await t.test("counts whole days after it", () => {
    assert.equal(daysOverdue("2026-09-10", new Date("2026-09-11T00:30:00Z")), 1);
    assert.equal(daysOverdue("2026-09-10", new Date("2026-10-01T23:59:00Z")), 21);
  });

  await t.test("does not drift by a day near midnight UTC", () => {
    // Parsing "2026-09-10" as LOCAL time in a negative-offset zone yields the
    // 9th, which would report every invoice as a day more overdue than it is.
    // Both sides are pinned to UTC midnight to stop that.
    assert.equal(daysOverdue("2026-09-10", new Date("2026-09-11T00:00:00Z")), 1);
    assert.equal(daysOverdue("2026-09-10", new Date("2026-09-10T23:59:59Z")), 0);
  });

  await t.test("treats a missing or malformed due date as not overdue", () => {
    assert.equal(daysOverdue(null, new Date("2026-09-11T00:00:00Z")), 0);
    assert.equal(daysOverdue("not-a-date", new Date("2026-09-11T00:00:00Z")), 0);
  });
});

test("looksLikeEmail is a typo guard, not an RFC", async (t) => {
  await t.test("accepts ordinary addresses", () => {
    for (const ok of [
      "dana@meridian-aviation.com",
      "a.b+tag@sub.example.co.uk",
      "ops@flightdept.aero",
    ]) {
      assert.ok(looksLikeEmail(ok), `${ok} should pass`);
    }
  });

  await t.test("rejects what would fail at the mail service anyway", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "dana",
      "dana@",
      "@meridian.com",
      "dana@meridian",
      "two@at@signs.com",
      "has space@meridian.com",
      "dana@.com",
      "dana@com.",
    ]) {
      assert.ok(!looksLikeEmail(bad), `${JSON.stringify(bad)} should fail`);
    }
  });
});
