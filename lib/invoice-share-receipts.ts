import "server-only";
import { createServiceClient } from "@/lib/supabase/service-role";
import { decodeEmbeddableReceipt } from "@/lib/receipt-image";
import {
  classifyReceiptBytes,
  receiptFallbackNote,
  type ReceiptAttachment,
} from "@/lib/invoice-receipts";

/**
 * RECEIPTS FOR THE CLIENT-FACING SHARE PAGE.
 *
 * Read supabase/migrations/20260813020000_invoice_share_receipts.sql and
 * 20260809060000_invoice_public_share.sql before changing anything here.
 * The first is this module's access boundary; the second is the boundary
 * for the page that calls it.
 *
 * ===========================================================================
 * THIS FILE HOLDS THE SECRET KEY, AND THAT IS THE THING TO REVIEW.
 *
 * lib/supabase/service-role.ts says to stop and check whether a
 * session-scoped client would do instead. It would not, and the reason is
 * structural rather than a preference: the visitor is a client of the pilot,
 * with no account, no session and no Supabase identity of any kind. Receipt
 * images live in the PRIVATE `receipts` bucket, whose storage policies key
 * on `pilot.current_account_ids()` — which is the empty set for `anon`. So
 * there is no session-scoped client that can read these bytes, and no
 * signed URL either: minting one requires the caller to already hold SELECT
 * on the object.
 *
 * app/packet/[token]/page.tsx says, about a DIFFERENT set of files, "serving
 * the bytes needs its own signed-URL design and its own security review; do
 * not add it by reaching for the service-role client." That warning stands
 * for the credential packet and is untouched by this file. A packet holds
 * standing personal data — a passport, a medical certificate, a W-9 — that
 * the client has never been sent. A rebilled receipt is the opposite case in
 * every respect that matters: it is one document, about one transaction,
 * substantiating a line on the invoice in front of the reader, on a link the
 * pilot minted for that invoice on purpose and can revoke in one press.
 *
 * WHAT THIS FILE MUST NOT CLAIM, because an earlier version of this header
 * did: that the receipt "was already attached to the PDF this same client
 * was emailed", i.e. that showing it here is only a second surface for an
 * already-shared fact (20260809060000's argument about `notes`). It is not
 * reliably true. The send dialog's receipts checkbox is a per-send choice
 * stored nowhere; delivery_method 'manual_download' means this product
 * emailed nothing at all; and invoices predating fb1ea11 carried no receipt
 * pages. For some invoices this page IS the first time the client sees the
 * image. What authorises that is the pilot's per-invoice decision to create
 * the share link — which is only an informed decision while the panel that
 * mints it says the link shows receipts (app/(app)/invoices/[id]/
 * share-panel.tsx). Treat that copy as part of this module's security
 * argument, not as UI polish.
 *
 * THE BOUNDS, all four of which a reviewer should check hold:
 *
 *  1. NO TABLE IS READ THROUGH THE PRIVILEGED CLIENT. The single query is
 *     one RPC — pilot.invoice_share_receipts — which re-proves the token,
 *     the share's revocation state and the invoice's status in the database
 *     on EVERY call. This module never builds a query, a filter or a path.
 *  2. THE PATH COMES ONLY FROM THAT FUNCTION, never from the URL, and is
 *     re-checked here against the account_id the same function returned.
 *     The service-role client bypasses storage RLS, so the tenant-prefix
 *     rule that RLS would have enforced is enforced by the code holding the
 *     key — from a value only the database could supply.
 *  3. NOTHING IS ADDRESSABLE. The bytes are inlined into the page that
 *     already required the token. There is NO image route and NO signed URL,
 *     so there is no second bearer credential to leak through a Referer
 *     header, a browser history, or a proxy log — and, unlike a signed URL,
 *     nothing survives revocation: revoke the share and the very next render
 *     returns null and shows nothing. The cost is page weight, which is why
 *     MAX_INLINE_RECEIPTS and the resize below exist.
 *  4. IT RETURNS NOTHING ON EVERY FAILURE. No throw reaches the page, no
 *     error text reaches the client, and the token never appears in a log.
 *
 * If an addressable route is ever wanted (lazy loading, browser caching),
 * it is a different design with a different review — per-request token
 * re-validation, cache headers that cannot outlive a revocation, and a
 * content type driven by the sniffed bytes rather than the path. Do not
 * reach for it by exporting a path from this module.
 *
 * KNOWN AND NOT FIXED HERE: THE COST OF A REPEATED RENDER. Every render of
 * this force-dynamic, unauthenticated page re-downloads up to
 * MAX_INLINE_RECEIPTS originals and re-runs that many sharp decodes, so
 * anyone holding a share token can make the server do real work with cheap
 * GETs, and a client on a phone re-pays the whole payload each visit. What
 * bounds it today: MAX_INLINE_RECEIPTS caps the fan-out per request, the
 * resize + INLINE_MIME budget above caps the bytes, and the token is a
 * 256-bit bearer that the pilot can revoke in one press — after which this
 * function returns nothing and does no work at all.
 *
 * What would actually fix it is a server-side decode cache keyed by storage
 * path plus object version (which creates no addressable URL and no second
 * bearer credential, so it does not contradict point 3), and per-token rate
 * limiting on the public route. Both are deliberately NOT done here: this
 * product has no cache tier and no rate limiter, so either one is new
 * shared infrastructure whose eviction and revocation behaviour is its own
 * design and its own review. Putting a half-considered cache in front of
 * the one surface that must not outlive a revoked share is a worse trade
 * than the CPU. Do not add one as a performance tweak.
 * ===========================================================================
 */

const BUCKET = "receipts";

/**
 * How many receipt images the page will inline.
 *
 * Every byte here is base64 in the HTML of a page that cannot be cached
 * (force-dynamic) — so this number, times the resize budget below, IS the
 * page weight ceiling. Twelve covers a fortnight of rebilled hotel nights,
 * ground transport and landing fees on one invoice, which is well past what
 * a contract pilot's trip actually produces; beyond it the page says how
 * many it did not show rather than growing without limit. The PDF has no
 * such cap and does not need one — it is a download, not a render.
 */
const MAX_INLINE_RECEIPTS = 12;

/**
 * A receipt on a web page is being READ, not printed: 1200px is comfortably
 * legible for the amount and the vendor on a hotel folio at full-screen, and
 * turns a 4 MB phone photo into something in the low hundreds of kilobytes.
 * The PDF deliberately passes none of these (see lib/receipt-image.ts) — a
 * printed page is measured in inches and keeps its full detail.
 *
 * ALL THREE ARE NEEDED FOR THAT SENTENCE TO BE TRUE, which is why
 * INLINE_MIME exists. decodeEmbeddableReceipt used to mirror the input's
 * format, and `quality` does nothing to a PNG — so a PNG receipt (a
 * screenshot of a booking confirmation, a flatbed scan) came back as
 * losslessly-encoded 1200px pixels, potentially megabytes, base64'd into
 * the HTML of a page that cannot be cached. The width cap alone does not
 * bound page weight; forcing the web rendition to JPEG is what does.
 */
const INLINE_MAX_WIDTH = 1200;
const INLINE_JPEG_QUALITY = 70;
/**
 * The encoding of the INLINE rendition, and therefore the media type of the
 * data: URI below — which must be this and never `classified.mime`, since
 * that describes the bytes that came OUT of storage, not the ones going
 * into the page.
 */
const INLINE_MIME = "image/jpeg" as const;

/** Same shape the CHECK on invoice_shares.token guarantees. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ShareReceipts = {
  /**
   * One entry per rebilled line with a receipt on file, in invoice-line
   * order — carrying either a decoded image or the same honest fallback
   * sentence the PDF's caption pages use. Empty is the ordinary case for an
   * invoice with nothing rebilled.
   */
  attachments: ReceiptAttachment[];
  /** How many were left off by MAX_INLINE_RECEIPTS. Normally 0. */
  omitted: number;
};

const NOTHING: ShareReceipts = { attachments: [], omitted: 0 };

type ReceiptRow = {
  description: string;
  amount_cents: number;
  path: string;
};

export async function loadShareReceipts(token: string): Promise<ShareReceipts> {
  // Cheap exit before anything is constructed, matching the page's own
  // pre-check and the RPC's. Not the boundary — the RPC's token match is.
  if (!TOKEN_PATTERN.test(token)) return NOTHING;

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (cause) {
    // Missing secret key in this environment. The invoice itself renders
    // through the anon RPC and is unaffected, so the page loses its receipt
    // section and keeps its whole job.
    console.error("[invoice-share-receipts] privileged client unavailable", cause);
    return NOTHING;
  }

  const { data, error } = await supabase.rpc("invoice_share_receipts", {
    p_token: token,
  } as never);

  if (error) {
    // Code and message only — NEVER the token, the same rule the share page
    // applies to every log it writes.
    console.error(
      "[invoice-share-receipts] lookup failed",
      error.code ?? error.message
    );
    return NOTHING;
  }

  // SAYS NOTHING WHEN IT KNOWS NOTHING, and this is where it deliberately
  // parts company with lib/invoice-document.tsx. The PDF renders a
  // "receipts could not be attached" notice page on a failed metadata read
  // because it already knows the invoice HAS rebill lines and the pilot
  // asked for their receipts — the notice explains an absence the reader
  // would otherwise have to guess at. Here a failed read means this code
  // does not know whether any receipt exists at all, and a client-facing
  // sentence asserting that receipts are "on file" would be a claim about
  // data nobody managed to read. So a failure renders the page exactly as it
  // rendered before this feature existed, and the next reload — this page is
  // force-dynamic, so there will be one — resolves it.
  const payload = data as { account_id?: string; receipts?: unknown } | null;
  const accountId = payload?.account_id;
  if (!payload || typeof accountId !== "string") return NOTHING;

  const rows = (Array.isArray(payload.receipts) ? payload.receipts : []).filter(
    (row): row is ReceiptRow =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as ReceiptRow).description === "string" &&
      typeof (row as ReceiptRow).path === "string"
  );
  if (rows.length === 0) return NOTHING;

  const shown = rows.slice(0, MAX_INLINE_RECEIPTS);

  // Fetched in parallel, which is safe only because the slice above bounds
  // it: twelve concurrent downloads and twelve concurrent sharp decodes is a
  // known ceiling, an unbounded list is not. Order is preserved by Promise.all
  // regardless of which resolves first, so the pages stay in invoice-line
  // order.
  const attachments = await Promise.all(
    shown.map((row) => attachmentFor(supabase, accountId, row))
  );

  return { attachments, omitted: rows.length - shown.length };
}

/**
 * One receipt, degraded rather than thrown. Every failure mode — a path
 * outside the tenant's own folder, a download error, a PDF or HEIC receipt,
 * a corrupt image — produces the SAME honest sentence the PDF's caption
 * pages carry (lib/invoice-receipts.ts owns that copy, and it is not
 * rewritten here), so a client reads one consistent explanation whichever
 * surface they opened.
 */
async function attachmentFor(
  supabase: ReturnType<typeof createServiceClient>,
  accountId: string,
  row: ReceiptRow
): Promise<ReceiptAttachment> {
  const base = { description: row.description, amountCents: row.amount_cents };

  // The tenant-prefix check storage RLS would have made if this client were
  // session-scoped. Both values came from the database — the path from the
  // receipts join, the account id from the token match — so this cannot fail
  // on well-formed data; it is here for the day a path column is written by
  // something other than the upload it belongs to.
  if (!row.path.startsWith(`${accountId}/`)) {
    console.error("[invoice-share-receipts] receipt path outside its account");
    return { ...base, imageDataUri: null, note: receiptFallbackNote("unavailable") };
  }

  try {
    const { data: blob, error } = await supabase.storage
      .from(BUCKET)
      .download(row.path);
    if (error || !blob) {
      throw new Error(error?.message ?? "empty receipt download");
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    // Classified by BYTES, never by the path's extension or a stored content
    // type — classifyReceiptBytes's header explains why, and the reasoning
    // holds identically for a browser.
    const classified = classifyReceiptBytes(bytes);
    if (classified.kind !== "image") {
      return { ...base, imageDataUri: null, note: receiptFallbackNote(classified.kind) };
    }

    const decoded = await decodeEmbeddableReceipt(bytes, classified.mime, {
      maxWidth: INLINE_MAX_WIDTH,
      quality: INLINE_JPEG_QUALITY,
      encodeAs: INLINE_MIME,
    });
    if (!decoded) {
      // The magic number said JPEG/PNG and the pixels disagreed. A browser
      // would render this as a grey wedge, which on a bill looks like a
      // doctored receipt rather than a storage fault — so it takes the same
      // caption the PDF gives it.
      return { ...base, imageDataUri: null, note: receiptFallbackNote("unavailable") };
    }

    return {
      ...base,
      // INLINE_MIME, not classified.mime — see that constant. The bytes
      // here are the re-encoded rendition, not what came out of storage.
      imageDataUri: `data:${INLINE_MIME};base64,${decoded.toString("base64")}`,
      note: null,
    };
  } catch (cause) {
    console.error("[invoice-share-receipts] receipt unavailable", cause);
    return { ...base, imageDataUri: null, note: receiptFallbackNote("unavailable") };
  }
}
