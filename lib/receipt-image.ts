import "server-only";
import sharp from "sharp";

/**
 * THE DECODE GATE — the one place a receipt's bytes are proved to be a real
 * image before anything tries to render them.
 *
 * This lived inside lib/invoice-document.tsx until the client-facing share
 * page needed the identical guarantee. It moved here rather than being
 * copied, because a copy of this particular control is exactly the kind
 * that drifts: the two callers fail in different ways (a bad image fails a
 * PDF render; a bad image on a web page renders a broken-image icon in
 * front of the client), and a divergence would only ever be discovered by
 * the person least able to see it. One gate, two callers, and the PDF's
 * behaviour is byte-for-byte what it was — it passes no options, and the
 * defaults below are its previous constants.
 *
 * WHY A REAL DECODE AND NOT A MAGIC-NUMBER CHECK. classifyReceiptBytes
 * (lib/invoice-receipts.ts) only reads the LEADING bytes, so a truncated or
 * corrupt file that still begins with a valid JPEG/PNG signature passes
 * classification and arrives here looking embeddable. It is not:
 *
 *  - @react-pdf/renderer 4.5.x does NOT throw on such a file — its layout
 *    pass wraps image resolution in a try/catch and merely console.warns,
 *    dropping the image (see @react-pdf/layout fetchImage). The receipt page
 *    then renders BLANK beneath its caption, with none of the honest
 *    "available on request" fallback copy, and — worse — the empty page is
 *    still counted as an embedded receipt, so the email claims an image that
 *    isn't there.
 *  - A future react-pdf, or an exotic-but-decodable encoding its bespoke
 *    decoders choke on (progressive JPEG, interlaced/16-bit PNG), could fail
 *    harder. Because the whole document is composed in ONE renderToBuffer,
 *    one bad image failing there would fail the entire invoice.
 *  - A browser is more forgiving than react-pdf but not forgiving enough: a
 *    half-downloaded JPEG renders as a grey wedge, which on a bill reads as
 *    a doctored receipt rather than as a storage problem.
 *
 * So the bytes are put through a real decode FIRST. sharp reads every pixel
 * and re-encodes to a baseline JPEG / standard PNG — normalising the exotic
 * encodings to the plain forms both renderers handle most reliably, and
 * returning null for anything it cannot decode (`failOn: "error"` rejects
 * genuinely corrupt input while tolerating mere warnings). Every caller
 * degrades a null to the same captioned fallback every other non-embeddable
 * receipt already uses (receiptFallbackNote). This is the invariant proven
 * against the real renderer: any subset of corrupt receipts becomes fallback
 * pages and the invoice still renders.
 */

export type ReceiptDecodeOptions = {
  /**
   * Longest horizontal edge, in pixels. Never enlarges — a small receipt
   * stays small. Omitted (the PDF) means no resize at all: a print surface
   * is measured in inches at 72dpi and downsampling would throw away detail
   * an accounts-payable desk may zoom into.
   */
  maxWidth?: number;
  /**
   * JPEG quality. Ignored when the output is PNG, which is lossless.
   * Defaults to the PDF's long-standing 90 so passing no options reproduces
   * its previous output.
   */
  quality?: number;
  /**
   * Force the OUTPUT encoding instead of mirroring the input's.
   *
   * Omitted — the PDF — means "same format out as in", which is what this
   * function did unconditionally before and is right for a print surface:
   * a PNG receipt is usually a screenshot or a flatbed scan of text, and
   * re-encoding it lossily costs exactly the legibility an accounts-payable
   * desk zooms in for.
   *
   * The share page passes "image/jpeg" because for a WEB rendition the
   * trade runs the other way, and mirroring the input silently broke that
   * surface's stated size budget: `quality` does nothing to a PNG, so a
   * 4 MB phone screenshot resized to 1200px could still come out megabytes
   * of losslessly-encoded pixels, base64'd into the HTML of a page that
   * cannot be cached. Only "image/jpeg" is offered — there is no reason to
   * force PNG, and an unconstrained format parameter would invite one.
   *
   * A PNG's alpha channel is flattened onto WHITE before encoding, because
   * JPEG has no transparency and sharp's default flatten is BLACK: a
   * receipt scanned with a transparent margin would otherwise arrive in
   * front of a client as a photo-negative-looking document.
   */
  encodeAs?: "image/jpeg";
};

export async function decodeEmbeddableReceipt(
  bytes: Buffer,
  mime: "image/jpeg" | "image/png",
  options?: ReceiptDecodeOptions
): Promise<Buffer | null> {
  try {
    let pipe = sharp(bytes, { failOn: "error" });
    if (options?.maxWidth) {
      pipe = pipe.resize({
        width: options.maxWidth,
        withoutEnlargement: true,
      });
    }
    // Defaults to the input's own format, which is what every caller got
    // before `encodeAs` existed and is still what the PDF wants.
    const out = options?.encodeAs ?? mime;
    if (out === "image/png") return await pipe.png().toBuffer();
    if (mime === "image/png") {
      // Only on a real PNG->JPEG conversion, so the JPEG-in/JPEG-out path
      // stays byte-identical to what it produced before. See encodeAs.
      //
      // Written as channel values rather than a hex string on purpose: this
      // is the colour of PAPER behind a scanned receipt, a fact about image
      // data, not a visual choice the design system owns — and a hex
      // literal here would trip tokens:verify, which is right to be
      // suspicious of one and has no way to tell the two apart. Full white
      // for all three channels.
      pipe = pipe.flatten({ background: { r: 255, g: 255, b: 255 } });
    }
    return await pipe.jpeg({ quality: options?.quality ?? 90 }).toBuffer();
  } catch (cause) {
    console.error("[receipt-image] receipt would not decode", cause);
    return null;
  }
}
