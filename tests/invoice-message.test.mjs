import test from "node:test";
import assert from "node:assert/strict";

const {
  buildInvoiceMessage,
  buildReminderMessage,
  daysOverdue,
  applyTemplate,
  templatePlaceholders,
  unknownPlaceholders,
  INVOICE_PLACEHOLDERS,
  REMINDER_PLACEHOLDERS,
  DEFAULT_INVOICE_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  MAX_MESSAGE_TEMPLATE_CHARS,
} = await import("../lib/email/invoice-message.ts");
const { normalizeMessageTemplates, messageTemplateProblem } = await import(
  "../lib/message-templates.ts"
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

/* ===========================================================================
 * MESSAGE TEMPLATES
 *
 * The substituter is the only place in this product where text a USER wrote
 * is expanded against values from a DATABASE and mailed to a THIRD PARTY.
 * That is the classic shape of an injection bug, and the fact that the
 * output is plain text rather than HTML removes one hazard without removing
 * the rest — a value that re-expands, or that is treated as a regex
 * replacement pattern, corrupts a bill either way. Every one of those is
 * pinned below.
 * ===========================================================================
 */

test("placeholder substitution", async (t) => {
  const VALUES = {
    client_name: "Dana Whitfield",
    invoice_number: "INV-0042",
    amount_due: "$14,000.00",
    due_date: "Sep 10, 2026",
  };

  await t.test("fills in every known token, whitespace and all", () => {
    assert.equal(
      applyTemplate(
        "{{client_name}} owes {{amount_due}} on {{ due_date }} for {{invoice_number}}.",
        VALUES,
        INVOICE_PLACEHOLDERS
      ),
      "Dana Whitfield owes $14,000.00 on Sep 10, 2026 for INV-0042."
    );
  });

  await t.test("repeats a token as many times as it appears", () => {
    assert.equal(
      applyTemplate("{{amount_due}} — {{amount_due}}", VALUES, INVOICE_PLACEHOLDERS),
      "$14,000.00 — $14,000.00"
    );
  });

  await t.test("INJECTION: a substituted value is never rescanned", () => {
    // A client legitimately named "{{amount_due}} Aviation" — or an
    // adversarial one — must appear as those characters. If the substituter
    // ever looped over its own output, this would print the balance where
    // the client's name belongs, on a bill.
    const m = applyTemplate(
      "Hello {{client_name}}, you owe {{amount_due}}.",
      { ...VALUES, client_name: "{{amount_due}}" },
      INVOICE_PLACEHOLDERS
    );
    assert.equal(m, "Hello {{amount_due}}, you owe $14,000.00.");
  });

  await t.test("INJECTION: a value is not a regex replacement pattern", () => {
    // `$&`, `$'`, "$`" and `$1` are special in a replacement STRING and
    // ordinary characters in a replacement FUNCTION's return value. A client
    // named "A&B $& Co" must not have the matched text spliced into it.
    for (const hostile of ["A&B $& Co", "$'", "$`", "$1$2", "$$"]) {
      assert.equal(
        applyTemplate("<{{client_name}}>", { client_name: hostile }, INVOICE_PLACEHOLDERS),
        `<${hostile}>`
      );
    }
  });

  await t.test("INJECTION: a value carrying newlines cannot reach a header", () => {
    // The subject is built by the module and is never templatable, which is
    // what makes CRLF in a value harmless. Proved on the whole message, not
    // on the substituter, because that is where it would actually matter.
    const m = buildInvoiceMessage({
      ...BASE,
      clientName: "Meridian\r\nBcc: someone@example.com",
      contactName: null,
      template: "For {{client_name}}.",
    });
    assert.doesNotMatch(m.subject, /[\r\n]/);
    assert.doesNotMatch(m.subject, /Bcc/i);
  });

  await t.test("declines rather than printing a hole for a missing value", () => {
    // An invoice with no due date cannot honestly render "due {{due_date}}",
    // and "due ." is not an option. null tells the caller to use the
    // built-in wording, which omits the clause instead.
    assert.equal(
      applyTemplate("due {{due_date}}", { ...VALUES, due_date: undefined }, INVOICE_PLACEHOLDERS),
      null
    );
    // An empty string is a missing value too — an unnumbered invoice must
    // not render "Invoice  is attached".
    assert.equal(
      applyTemplate("{{invoice_number}}", { invoice_number: "" }, INVOICE_PLACEHOLDERS),
      null
    );
  });

  await t.test("declines a token this build does not know", () => {
    assert.equal(applyTemplate("{{tail_number}}", VALUES, INVOICE_PLACEHOLDERS), null);
    // days_overdue belongs to the reminder only.
    assert.equal(applyTemplate("{{days_overdue}}", VALUES, INVOICE_PLACEHOLDERS), null);
    assert.equal(
      applyTemplate("{{days_overdue}}", { days_overdue: "21 days" }, REMINDER_PLACEHOLDERS),
      "21 days"
    );
  });

  await t.test("refuses a MALFORMED token instead of mailing the braces", () => {
    // The regression this pattern exists for. A near-miss that is not
    // recognised as a placeholder attempt is not merely unsubstituted — it
    // is unvalidated, so the settings panel accepts it and the pilot's
    // client reads `{{Client_Name}}` in a bill. Every one of these must be
    // caught as an attempt and refused.
    for (const malformed of [
      "{{Client_Name}}",
      "{{ CLIENT_NAME }}",
      "{{client name}}",
      "{{client-name}}",
      "{{}}",
      "{{ }}",
    ]) {
      assert.equal(
        applyTemplate(malformed, VALUES, INVOICE_PLACEHOLDERS),
        null,
        `${malformed} must be refused`
      );
      assert.ok(
        unknownPlaceholders(malformed, INVOICE_PLACEHOLDERS).length > 0,
        `${malformed} must be reported to the pilot`
      );
    }
  });

  await t.test("leaves text that is not a brace pair at all alone", () => {
    for (const plain of ["{client_name}", "curly {{", "}} stray", "100% {of it}"]) {
      assert.deepEqual(templatePlaceholders(plain), []);
      assert.equal(applyTemplate(plain, VALUES, INVOICE_PLACEHOLDERS), plain);
    }
  });

  await t.test("doubled braces substitute once, inside literal braces", () => {
    // Never a second round of substitution — the inner pair matches and the
    // outer braces are ordinary characters.
    assert.equal(
      applyTemplate("{{{{client_name}}}}", VALUES, INVOICE_PLACEHOLDERS),
      "{{Dana Whitfield}}"
    );
  });

  await t.test("names the unknown tokens, for a message a pilot can act on", () => {
    assert.deepEqual(
      unknownPlaceholders("{{client_name}} {{tail_number}} {{eta}}", INVOICE_PLACEHOLDERS),
      ["tail_number", "eta"]
    );
    const problem = messageTemplateProblem("{{client}}", INVOICE_PLACEHOLDERS);
    assert.match(problem, /\{\{client\}\}/);
    assert.match(problem, /\{\{client_name\}\}/);
  });
});

test("the default templates are what the product already says", async (t) => {
  // The load-bearing claim of this feature: a pilot who opens the settings
  // panel, sees the built-in wording, saves it untouched and sends, gets
  // exactly the message they would have got before templates existed. If
  // either sentence is edited without the other, this fails.
  await t.test("invoice: default template === built-in wording", () => {
    assert.equal(
      buildInvoiceMessage({ ...BASE, template: DEFAULT_INVOICE_TEMPLATE }).text,
      buildInvoiceMessage(BASE).text
    );
  });

  await t.test("reminder: default template === built-in wording", () => {
    const overdue = { ...BASE, daysOverdue: 21 };
    assert.equal(
      buildReminderMessage({ ...overdue, template: DEFAULT_REMINDER_TEMPLATE }).text,
      buildReminderMessage(overdue).text
    );
    // …including the singular, which the substituted value carries whole
    // ("1 day", not "1 days").
    const oneDay = { ...BASE, daysOverdue: 1 };
    assert.equal(
      buildReminderMessage({ ...oneDay, template: DEFAULT_REMINDER_TEMPLATE }).text,
      buildReminderMessage(oneDay).text
    );
  });

  await t.test("both defaults pass the panel's own validation", () => {
    assert.equal(messageTemplateProblem(DEFAULT_INVOICE_TEMPLATE, INVOICE_PLACEHOLDERS), null);
    assert.equal(messageTemplateProblem(DEFAULT_REMINDER_TEMPLATE, REMINDER_PLACEHOLDERS), null);
  });
});

test("a template changes the opening line and nothing else", async (t) => {
  const TEMPLATE = "Here is {{invoice_number}} for {{amount_due}}.";

  await t.test("replaces the built-in sentence", () => {
    const m = buildInvoiceMessage({ ...BASE, template: TEMPLATE });
    assert.match(m.text, /Here is INV-0042 for \$14,000\.00\./);
    assert.doesNotMatch(m.text, /is attached, for/);
  });

  await t.test("keeps the greeting, the sign-off and the subject", () => {
    const m = buildInvoiceMessage({ ...BASE, template: TEMPLATE });
    assert.match(m.text, /^Dana Whitfield,/);
    assert.match(m.text, /Halyard Air LLC$/);
    assert.equal(m.subject, buildInvoiceMessage(BASE).subject);
  });

  await t.test("cannot suppress the facts that must travel with the bill", () => {
    const m = buildInvoiceMessage({
      ...BASE,
      template: TEMPLATE,
      totalCents: 1_400_000,
      balanceDueCents: 400_000,
      paymentUrl: "https://pay.example/x",
      notes: "Ferry leg billed at half day.",
      receiptCount: 2,
    });
    assert.match(m.text, /remaining balance/i);
    assert.match(m.text, /2 receipts/);
    assert.match(m.text, /https:\/\/pay\.example\/x/);
    assert.match(m.text, /Ferry leg billed at half day\./);
  });

  await t.test("falls back when this invoice lacks a fact the template names", () => {
    // No due date: the built-in wording omits the clause, and that is what
    // must be sent rather than a sentence with a gap in it.
    const noDue = { ...BASE, dueOn: null };
    assert.equal(
      buildInvoiceMessage({ ...noDue, template: DEFAULT_INVOICE_TEMPLATE }).text,
      buildInvoiceMessage(noDue).text
    );
    // A reminder that isn't late yet cannot use wording written to chase.
    const notYet = { ...BASE, daysOverdue: 0 };
    assert.equal(
      buildReminderMessage({ ...notYet, template: DEFAULT_REMINDER_TEMPLATE }).text,
      buildReminderMessage(notYet).text
    );
    assert.match(buildReminderMessage({ ...notYet, template: DEFAULT_REMINDER_TEMPLATE }).text, /is due/i);
  });

  await t.test("an absent template changes nothing at all", () => {
    for (const empty of [null, undefined, "", "   "]) {
      assert.equal(
        buildInvoiceMessage({ ...BASE, template: empty }).text,
        buildInvoiceMessage(BASE).text
      );
    }
  });
});

test("the per-send message", async (t) => {
  await t.test("goes through verbatim, and is never substituted", () => {
    // A pilot who types braces into a one-off note is typing braces, not
    // invoking anything — and unlike a template, this note must never be
    // dropped for naming a fact the invoice lacks.
    const m = buildInvoiceMessage({
      ...BASE,
      customMessage: "Two KTEB legs on the 4th. {{amount_due}} is not a token here.",
    });
    assert.match(m.text, /Two KTEB legs on the 4th\. \{\{amount_due\}\} is not a token here\./);
  });

  await t.test("sits above the payment link and the notes", () => {
    const m = buildInvoiceMessage({
      ...BASE,
      customMessage: "PER-SEND",
      paymentUrl: "https://pay.example/x",
      notes: "INVOICE-NOTES",
    });
    assert.ok(m.text.indexOf("PER-SEND") < m.text.indexOf("pay online"));
    assert.ok(m.text.indexOf("PER-SEND") < m.text.indexOf("INVOICE-NOTES"));
  });

  await t.test("rides alongside a template rather than replacing it", () => {
    const m = buildInvoiceMessage({
      ...BASE,
      template: "Here is {{invoice_number}}.",
      customMessage: "PER-SEND",
    });
    assert.match(m.text, /Here is INV-0042\./);
    assert.match(m.text, /PER-SEND/);
  });

  await t.test("works on a reminder too", () => {
    const m = buildReminderMessage({ ...BASE, daysOverdue: 5, customMessage: "PER-SEND" });
    assert.match(m.text, /PER-SEND/);
    // …and does not disturb the honest out, which stays last.
    assert.ok(m.text.indexOf("PER-SEND") < m.text.indexOf("disregard"));
  });

  await t.test("absent or blank changes nothing", () => {
    for (const empty of [null, undefined, "", "  \n "]) {
      assert.equal(
        buildInvoiceMessage({ ...BASE, customMessage: empty }).text,
        buildInvoiceMessage(BASE).text
      );
    }
  });
});

test("normalizeMessageTemplates is total over anything the column can hold", async (t) => {
  await t.test("passes good templates through, trimmed", () => {
    assert.deepEqual(
      normalizeMessageTemplates({
        invoice: "  Here is {{invoice_number}}.  ",
        reminder: "Still outstanding: {{amount_due}}.",
      }),
      {
        invoice: "Here is {{invoice_number}}.",
        reminder: "Still outstanding: {{amount_due}}.",
      }
    );
  });

  await t.test("resolves anything it cannot vouch for to the built-in wording", () => {
    // A restored backup, a service-role fix, a retired placeholder, a row
    // written by a build that is no longer this one — every one of them ends
    // at null, which is the state a brand-new account is already in.
    for (const raw of [
      null,
      undefined,
      "a string",
      42,
      [],
      { invoice: 7 },
      { invoice: "   " },
      { invoice: "{{tail_number}}" },
      { invoice: "x".repeat(MAX_MESSAGE_TEMPLATE_CHARS + 1) },
      // days_overdue is a reminder token: on the invoice side it is unknown.
      { invoice: "{{days_overdue}}" },
    ]) {
      assert.equal(normalizeMessageTemplates(raw).invoice, null, JSON.stringify(raw));
    }
  });

  await t.test("never truncates or repairs — a rejected template is dropped whole", () => {
    const tooLong = "A ".repeat(MAX_MESSAGE_TEMPLATE_CHARS);
    assert.equal(normalizeMessageTemplates({ reminder: tooLong }).reminder, null);
  });

  await t.test("keeps the sections independent", () => {
    const resolved = normalizeMessageTemplates({
      invoice: "{{tail_number}}",
      reminder: "Still outstanding: {{amount_due}}.",
    });
    assert.equal(resolved.invoice, null);
    assert.equal(resolved.reminder, "Still outstanding: {{amount_due}}.");
  });

  await t.test("what it accepts, the builders will actually use", () => {
    // The round trip that matters: a template surviving normalization must
    // not then be declined by applyTemplate for being unknown-token-bearing.
    // (It may still be declined for a MISSING VALUE — that is per-invoice,
    // not per-template.)
    const stored = normalizeMessageTemplates({ invoice: DEFAULT_INVOICE_TEMPLATE }).invoice;
    assert.equal(stored, DEFAULT_INVOICE_TEMPLATE);
    assert.equal(unknownPlaceholders(stored, INVOICE_PLACEHOLDERS).length, 0);
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
