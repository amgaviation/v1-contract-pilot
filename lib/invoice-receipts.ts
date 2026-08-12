/**
 * Pure helpers for attaching rebilled-expense receipts to the invoice PDF
 * (docs/WAVE-PARITY.md §8 item 3, "attach receipts to invoices").
 *
 * Deliberately a plain .ts module with no imports at all, for the same
 * reason lib/email/invoice-message.ts is: the decisions here — "is this
 * blob something react-pdf can embed?" and "what does the client-facing
 * fallback page say?" — must be unit-testable without a database, a
 * storage bucket, or a PDF renderer. tests/invoice-receipts.test.mjs pins
 * both. The I/O half (fetching bytes from the private bucket) lives in
 * lib/invoice-document.tsx next to the logo fetch it mirrors.
 *
 * WHY CLASSIFY BY BYTES AND NOT BY receipt_path's EXTENSION OR THE STORED
 * CONTENT TYPE: react-pdf's <Image> supports JPEG and PNG only, and it
 * fails at RENDER time — inside renderToBuffer — for anything else. A
 * failed render there is a failed INVOICE, which is the one outcome this
 * feature is forbidden to produce (a pilot whose receipt is odd still
 * needs to bill). The stored content type is whatever the browser
 * declared at upload (expenses/actions.ts sniffs the magic number against
 * that declaration, but HEIC/WebP/PDF all pass ITS check and none of them
 * embed), and an extension is just a filename. The only thing that
 * decides whether renderToBuffer will succeed is the leading bytes, so
 * the leading bytes are what's checked — same signatures
 * expenses/actions.ts's looksLikeDeclaredType uses, reduced to the
 * embeddable set.
 */

export type ReceiptClassification =
  /** react-pdf can embed this: JPEG or PNG. */
  | { kind: "image"; mime: "image/jpeg" | "image/png" }
  /** A PDF receipt — real, on file, and NOT embeddable as an image. */
  | { kind: "pdf" }
  /** HEIC, WebP, or anything unrecognised — on file, not embeddable. */
  | { kind: "unsupported" };

export function classifyReceiptBytes(bytes: Uint8Array): ReceiptClassification {
  const startsWith = (...sig: number[]) =>
    bytes.length >= sig.length && sig.every((byte, index) => bytes[index] === byte);

  if (startsWith(0xff, 0xd8, 0xff)) {
    return { kind: "image", mime: "image/jpeg" };
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { kind: "image", mime: "image/png" };
  }
  if (startsWith(0x25, 0x50, 0x44, 0x46)) {
    // %PDF
    return { kind: "pdf" };
  }
  return { kind: "unsupported" };
}

/**
 * One receipt's worth of render input: either an embeddable image (as a
 * data URI, fetched-as-bytes exactly like the account logo) or an honest
 * note explaining why there is no image on this page. Never both, never
 * neither — the PDF component renders whichever side is present.
 */
export type ReceiptAttachment = {
  /** The invoice line's own description — the caption ties page to line. */
  description: string;
  /** The line's billed amount; null only for the load-failure notice page. */
  amountCents: number | null;
  imageDataUri: string | null;
  note: string | null;
};

/**
 * The client-facing sentence on a receipt page that carries no image.
 * Client-facing means the same copy rules as the invoice itself: state
 * the fact, claim nothing false, offer the obvious next step. In
 * particular the "pdf" case says WHY (the receipt exists and is a PDF —
 * this document format can't inline it), because "could not be rendered"
 * for a perfectly good PDF would read as a fault when it is a format
 * limit.
 */
export function receiptFallbackNote(reason: "pdf" | "unsupported" | "unavailable"): string {
  switch (reason) {
    case "pdf":
      return "This receipt is on file as a PDF document, which cannot be embedded as an image here. A copy is available on request.";
    case "unsupported":
      return "The receipt on file for this line is in a format that cannot be embedded here. A copy is available on request.";
    case "unavailable":
      return "The receipt on file for this line could not be rendered when this document was generated. A copy is available on request.";
  }
}

/**
 * The single notice page used when the receipt METADATA read itself fails
 * — at that point it is unknowable which lines even have receipts, so
 * per-line pages would fabricate specificity. One honest page instead,
 * and never a failed invoice (the same degrade-don't-die contract as the
 * logo fetch).
 */
export const RECEIPTS_UNAVAILABLE_NOTE =
  "Receipts for rebilled expenses are on file but could not be attached when this document was generated. Copies are available on request.";
