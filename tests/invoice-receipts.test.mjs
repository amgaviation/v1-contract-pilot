import test from "node:test";
import assert from "node:assert/strict";

const { classifyReceiptBytes, receiptFallbackNote, RECEIPTS_UNAVAILABLE_NOTE } =
  await import("../lib/invoice-receipts.ts");
const { buildInvoiceMessage } = await import("../lib/email/invoice-message.ts");

/**
 * The receipt-page pipeline's pure decisions (lib/invoice-receipts.ts).
 *
 * Why the classifier matters enough to pin: react-pdf's <Image> throws
 * INSIDE renderToBuffer for anything that isn't JPEG or PNG, and a throw
 * there is a failed INVOICE — the one outcome the receipts feature is
 * forbidden to produce. The classifier is the only thing standing between
 * "a pilot attached a HEIC photo" and "their client can't be billed", so
 * every branch is asserted against real magic numbers, including the
 * mislabelled-content case (bytes decide, not extensions or stored
 * content types — the upload path's own sniff accepts HEIC/WebP/PDF,
 * none of which embed).
 */

test("classifyReceiptBytes decides by magic number", async (t) => {
  await t.test("JPEG bytes are embeddable as image/jpeg", () => {
    assert.deepEqual(
      classifyReceiptBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
      { kind: "image", mime: "image/jpeg" }
    );
  });

  await t.test("PNG bytes are embeddable as image/png", () => {
    assert.deepEqual(
      classifyReceiptBytes(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
      ),
      { kind: "image", mime: "image/png" }
    );
  });

  await t.test("a PDF receipt is recognised as pdf, never as an image", () => {
    // %PDF-1.7
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    assert.deepEqual(classifyReceiptBytes(bytes), { kind: "pdf" });
  });

  await t.test("WebP is unsupported (react-pdf cannot embed it)", () => {
    // "RIFF....WEBP"
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    assert.deepEqual(classifyReceiptBytes(bytes), { kind: "unsupported" });
  });

  await t.test("HEIC (ISO-BMFF ftyp) is unsupported", () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    assert.deepEqual(classifyReceiptBytes(bytes), { kind: "unsupported" });
  });

  await t.test("empty and truncated blobs are unsupported, not a crash", () => {
    assert.deepEqual(classifyReceiptBytes(new Uint8Array([])), { kind: "unsupported" });
    // Two bytes of a real JPEG signature — not enough to claim JPEG.
    assert.deepEqual(classifyReceiptBytes(new Uint8Array([0xff, 0xd8])), {
      kind: "unsupported",
    });
  });

  await t.test("a PNG renamed to .jpg still classifies as PNG — bytes win", () => {
    // The function never sees a filename; this test documents that fact
    // for the next person tempted to "optimise" with an extension check.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(classifyReceiptBytes(pngBytes).kind, "image");
  });
});

test("the fallback-page copy is honest about WHY there is no image", async (t) => {
  await t.test("a PDF receipt names the real reason — a format limit, not a fault", () => {
    const note = receiptFallbackNote("pdf");
    assert.match(note, /on file as a PDF/);
    assert.match(note, /cannot be embedded/);
    // Never implies the receipt is missing or broken.
    assert.doesNotMatch(note, /could not be rendered/);
  });

  await t.test("unsupported and unavailable degrade to 'could not be' phrasing", () => {
    assert.match(receiptFallbackNote("unsupported"), /cannot be embedded/);
    assert.match(receiptFallbackNote("unavailable"), /could not be rendered/);
  });

  await t.test("every note offers the next step: a copy on request", () => {
    for (const reason of ["pdf", "unsupported", "unavailable"]) {
      assert.match(receiptFallbackNote(reason), /available on request/i);
    }
    assert.match(RECEIPTS_UNAVAILABLE_NOTE, /available on request/i);
  });
});

/**
 * The receipts sentence in the invoice email (the small addition to
 * lib/email/invoice-message.ts). Pinned separately from
 * invoice-message.test.mjs because that file owns the pre-existing copy;
 * this one owns only what the receipts feature added — including the
 * guarantee that it added NOTHING to messages without receipts.
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

test("the receipts line in the invoice email", async (t) => {
  await t.test("absent receiptCount changes nothing — pre-existing copy is byte-identical", () => {
    const without = buildInvoiceMessage(BASE);
    const withZero = buildInvoiceMessage({ ...BASE, receiptCount: 0 });
    assert.equal(without.text, withZero.text);
    assert.doesNotMatch(without.text, /receipt/i);
  });

  await t.test("one receipt reads singular", () => {
    const { text } = buildInvoiceMessage({ ...BASE, receiptCount: 1 });
    assert.match(text, /The receipt for the rebilled expense is included in the attached PDF\./);
  });

  await t.test("several receipts read plural", () => {
    const { text } = buildInvoiceMessage({ ...BASE, receiptCount: 3 });
    assert.match(
      text,
      /Receipts for the rebilled expenses are included in the attached PDF\./
    );
  });

  await t.test("the claim is about the ATTACHMENT, so it must only ever come from receiptCount", () => {
    // receiptCount is documented as "pages actually appended". This pins
    // that a message with receiptCount 0 makes no receipt claim even when
    // everything else suggests rebilling (notes mentioning expenses etc.).
    const { text } = buildInvoiceMessage({
      ...BASE,
      notes: "Includes rebilled fuel and catering.",
      receiptCount: 0,
    });
    assert.doesNotMatch(text, /included in the attached PDF/);
  });
});
