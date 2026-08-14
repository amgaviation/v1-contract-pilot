/**
 * The browser-side OCR engine: a photograph of a receipt in, plain text
 * out. Everything that decides what the text MEANS lives in ./extract.ts;
 * this file is only concerned with getting readable text out of a picture
 * taken one-handed at a fuel desk.
 *
 * ***************************************************************************
 * WHY THIS RUNS IN THE BROWSER
 * ***************************************************************************
 * The alternative is a server action that loads a 3 MB WebAssembly core on
 * every cold start and then spends 5-15 seconds of a serverless function's
 * budget per receipt. On the pilot's own device the same work is free,
 * parallel across users by construction, and — the part that matters for a
 * product whose trust story is that AMG cannot see a pilot's business —
 * the image never has to reach a server to be read. The receipt still gets
 * uploaded when the pilot saves the expense; it just isn't a precondition
 * of reading it.
 *
 * The whole engine is dynamically imported on first use. A pilot who never
 * scans a receipt downloads none of it.
 *
 * ***************************************************************************
 * WHY THE PREPROCESSING IS NOT OPTIONAL
 * ***************************************************************************
 * Three things reliably break OCR on a real receipt photo, and all three
 * are fixed here rather than by asking the pilot to take a better picture:
 *
 *   - EXIF ORIENTATION. A phone held in portrait writes a landscape frame
 *     plus a rotation flag. `createImageBitmap(blob)` ignores that flag
 *     unless told not to, and Tesseract reads a sideways receipt as noise —
 *     not as a worse result, as no result. Hence `imageOrientation`.
 *   - RESOLUTION. A 12-megapixel frame is ~8x more pixels than Tesseract
 *     needs and makes a phone chew for half a minute; a cropped thumbnail
 *     is too few. Both ends are normalised to a long edge in the range the
 *     LSTM was trained around.
 *   - CONTRAST. Thermal paper fades, and an FBO lounge is lit orange. A
 *     percentile-based stretch on the luminance channel recovers a faded
 *     total far more often than it harms a clean one.
 */

export type OcrProgress = {
  /** A sentence for the pilot, not a status enum. */
  message: string;
  /** 0-1, or null while the phase has no meaningful fraction. */
  fraction: number | null;
};

export type OcrResult = {
  text: string;
  /** Tesseract's own mean confidence, 0-100. Low means "check this". */
  confidence: number;
};

/** Anything larger is a scan or a screenshot, not a phone photo. */
const MAX_EDGE = 2200;
/** Below this, upscaling buys the segmenter more than it costs in blur. */
const MIN_EDGE = 1200;

/**
 * Mirrors MAX_RECEIPT_BYTES in app/(app)/expenses/actions.ts and the
 * bucket's own file_size_limit. Checked here as well as there because a
 * scan happens BEFORE the save: without it a pilot learns their photo was
 * too big only after sitting through a read and pressing save.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * A decode bound, which the MAX_EDGE cap below cannot provide.
 *
 * `createImageBitmap` decodes the WHOLE image before `prepare()` gets a
 * chance to scale anything, so the canvas cap bounds the OCR work but not
 * the allocation in front of it. A PNG decompression bomb — tens of
 * kilobytes on the wire, 30000x30000 on decode — is ~3.6 GB of RGBA and
 * takes the tab down with the half-filled expense form in it. 40 Mpx is
 * about four times the largest phone sensor a pilot will point at a
 * receipt, so nothing real trips it.
 */
const MAX_DECODED_PIXELS = 40_000_000;

export class ReceiptOcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptOcrError";
  }
}

/**
 * Decode a file the pilot picked into pixels.
 *
 * HEIC is the case worth naming: it is the iPhone default, Safari decodes
 * it natively, and Chrome and Firefox on the desktop do not. That is a
 * platform fact this product cannot fix, so it is reported as itself
 * rather than as a generic failure — a pilot told "your browser can't read
 * HEIC, save it as JPEG or scan it on your phone" can act; a pilot told
 * "couldn't read that image" cannot.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (file.type === "application/pdf") {
    throw new ReceiptOcrError(
      "Scanning reads photos and images, not PDFs. Attach the PDF to the expense and type the amounts, or photograph the printed copy."
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new ReceiptOcrError(
      "That photo is over 10 MB, which is more than a receipt needs. Take it again at a lower resolution, or crop it to the receipt."
    );
  }

  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the <img> path — Safari has shipped
      // createImageBitmap options unevenly, and an <img> honours EXIF
      // orientation on its own.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(
          new ReceiptOcrError(
            /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
              ? "This browser can't open HEIC photos. Scan it from your phone, or save the photo as JPEG first."
              : "That file didn't open as an image. A JPEG or PNG photo of the receipt works best."
          )
        );
      img.src = url;
    });
  } finally {
    // Safe immediately: decoding has either finished or failed by here.
    URL.revokeObjectURL(url);
  }
}

/**
 * Grayscale, then stretch contrast between the 2nd and 98th percentile of
 * the luminance histogram.
 *
 * Percentiles rather than min/max because a single black speck of toner
 * and a single blown-out highlight — both present on essentially every
 * receipt photo — would otherwise pin the range and make the stretch a
 * no-op. Clamped at a 24-level spread so a genuinely flat image (a photo
 * of a blank page) isn't amplified into pure noise.
 */
function normalise(data: Uint8ClampedArray): void {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 601 luma: the weighting human vision actually uses, and what
    // makes red ink on white paper darken rather than vanish.
    const y = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
    const level = y < 0 ? 0 : y > 255 ? 255 : Math.round(y);
    data[i] = level;
    data[i + 1] = level;
    data[i + 2] = level;
    histogram[level]!++;
  }

  const pixels = data.length / 4;
  const lowTarget = pixels * 0.02;
  const highTarget = pixels * 0.98;
  let low = 0;
  let high = 255;
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += histogram[level]!;
    if (seen >= lowTarget) {
      low = level;
      break;
    }
  }
  seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += histogram[level]!;
    if (seen >= highTarget) {
      high = level;
      break;
    }
  }

  if (high - low < 24) return;

  const scale = 255 / (high - low);
  for (let i = 0; i < data.length; i += 4) {
    const stretched = (data[i]! - low) * scale;
    const clamped = stretched < 0 ? 0 : stretched > 255 ? 255 : stretched;
    data[i] = clamped;
    data[i + 1] = clamped;
    data[i + 2] = clamped;
  }
}

function prepare(source: ImageBitmap | HTMLImageElement): HTMLCanvasElement {
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!width || !height) {
    throw new ReceiptOcrError("That image came through empty. Try taking the photo again.");
  }
  if (width * height > MAX_DECODED_PIXELS) {
    // Refused rather than scaled down: an image this size is not a photo
    // of a receipt, and scaling it means having already allocated it.
    throw new ReceiptOcrError(
      "That image is far too large to be a receipt photo. Crop it to the receipt and try again."
    );
  }

  const longEdge = Math.max(width, height);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : longEdge < MIN_EDGE ? MIN_EDGE / longEdge : 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  // willReadFrequently: this canvas exists to be read back once and thrown
  // away, and the GPU-backed default makes that readback slow on mobile.
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new ReceiptOcrError("This browser wouldn't give us a canvas to read the photo on.");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  normalise(frame.data);
  context.putImageData(frame, 0, 0);
  return canvas;
}

/**
 * `createWorker`, whichever shape the bundler hands it over in.
 *
 * This looks like defensive cruft and is not. tesseract.js ships two
 * incompatible module shapes and neither reliably exposes a named export:
 *
 *   - src/index.js (the `main`, what a bundler resolves) ends with
 *     `module.exports = { ..., createWorker, ...Tesseract }`. A spread in
 *     that object literal is the exact construct that defeats webpack's
 *     static named-export detection for CommonJS, so `createWorker` can
 *     land on `.default` instead of as a named binding depending on how
 *     the module graph was analysed.
 *   - dist/tesseract.esm.min.js is rolled up with
 *     `getDefaultExportFromCjs` and exports a DEFAULT AND NOTHING ELSE —
 *     verified by reading the emitted file, not assumed.
 *
 * A destructure that works in the dev server and returns undefined in a
 * production bundle is a failure a pilot meets at a fuel desk with a
 * receipt in their hand. Resolved explicitly instead, and thrown as a
 * sentence if neither shape is there.
 */
async function resolveCreateWorker() {
  const loaded = (await import("tesseract.js")) as unknown as {
    createWorker?: typeof import("tesseract.js").createWorker;
    default?: { createWorker?: typeof import("tesseract.js").createWorker };
  };
  const createWorker = loaded.createWorker ?? loaded.default?.createWorker;
  if (typeof createWorker !== "function") {
    throw new ReceiptOcrError("The reader didn't load properly. Reload the page and try again.");
  }
  return createWorker;
}

/**
 * Read a receipt photo.
 *
 * The worker is created and torn down per call. It is tempting to keep one
 * alive across scans to skip the ~3 MB core load, but the browser's HTTP
 * cache and Tesseract's own IndexedDB cache of the language model already
 * make the second scan fast, and a long-lived worker holding WebAssembly
 * memory on a phone is how a background tab gets killed mid-form.
 */
export async function readReceipt(
  file: File,
  onProgress: (progress: OcrProgress) => void,
  signal?: AbortSignal
): Promise<OcrResult> {
  onProgress({ message: "Opening the photo", fraction: null });
  const decoded = await decode(file);
  let canvas: HTMLCanvasElement;
  try {
    canvas = prepare(decoded);
  } finally {
    // Released even when prepare() throws — which it does on the oversize
    // and empty-image paths. Leaked across a few retries on a phone, a
    // decoded ImageBitmap is tens of megabytes of GPU-backed memory.
    if ("close" in decoded) decoded.close();
  }
  const release = () => {
    canvas.width = 0;
    canvas.height = 0;
  };
  if (signal?.aborted) {
    release();
    throw new ReceiptOcrError("Scan cancelled.");
  }

  onProgress({ message: "Loading the reader", fraction: null });
  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
  try {
    worker = await (await resolveCreateWorker())("eng", undefined, {
      // Self-hosted, never the jsdelivr default. scripts/sync-ocr-assets.mjs
      // puts these here and asserts all three still point at them.
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      // tesseract.js defaults this TRUE: it fetches the worker script and
      // re-serves it as a blob: URL, which exists purely to work around
      // loading a worker from a cross-origin CDN. Same-origin it buys
      // nothing, and it is not free — a blob worker inherits this
      // document's origin and CSP, so allowing it means `script-src blob:`
      // in the Content-Security-Policy next.config.ts already says this app
      // owes. `script-src blob:` is a standard way to defeat a nonce
      // policy: any future XSS can createObjectURL a Blob of JavaScript and
      // run it.
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") {
          onProgress({ message: "Reading the receipt", fraction: m.progress });
        } else if (m.status.startsWith("loading") || m.status.startsWith("initializ")) {
          onProgress({ message: "Loading the reader", fraction: null });
        }
      },
    });
  } catch (cause) {
    // The worker never came up — a dead connection mid-download, or the
    // interop guard above. Release the canvas before rethrowing: on bad FBO
    // wifi a pilot retries this several times, and each failed attempt
    // otherwise leaves a full-size canvas behind.
    release();
    if (cause instanceof ReceiptOcrError) throw cause;
    throw new ReceiptOcrError(
      "Couldn't start the reader. Check your connection and try again. The first scan downloads about 6 MB."
    );
  }

  // Recognition itself has no abort hook — tesseract.js exposes no way to
  // interrupt a running recognize(). Killing the worker is the only real
  // cancel there is, and it makes the pending recognize() reject, which is
  // caught below and reported as a cancellation rather than a failure.
  const abort = () => void worker.terminate().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });

  try {
    if (signal?.aborted) throw new ReceiptOcrError("Scan cancelled.");
    const { data } = await worker.recognize(canvas);
    return { text: data.text ?? "", confidence: data.confidence ?? 0 };
  } catch (cause) {
    if (signal?.aborted) throw new ReceiptOcrError("Scan cancelled.");
    if (cause instanceof ReceiptOcrError) throw cause;
    throw new ReceiptOcrError(
      "The reader failed partway through. Check your connection and try again. The first scan downloads about 6 MB."
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    // terminate() is fire-and-forget on purpose: a worker that fails to
    // shut down cleanly must not turn a successful read into an error the
    // pilot sees. Calling it twice after an abort is harmless for the same
    // reason.
    void worker.terminate().catch(() => {});
    release();
  }
}
