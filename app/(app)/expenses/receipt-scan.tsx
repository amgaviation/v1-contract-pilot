"use client";

import { useRef, useState } from "react";
import { Box, Button, Callout, Flex, Spinner, Text } from "@/components/ui";
import type { ReceiptExtraction } from "@/lib/receipt-ocr/extract";

/**
 * The receipt file input, plus the option to read the photo before saving.
 *
 * ***************************************************************************
 * THE BOUNDARY THIS COMPONENT SITS ON
 * ***************************************************************************
 * Scanning fills in a form. It does not file an expense, and it never will.
 * That is the same draft-confirm boundary the logbook import and the bank
 * import hold, and it exists for the same reason: a photograph taken at an
 * angle under FBO lighting is a hint, not a record. Everything this
 * produces lands in fields the pilot is looking at, with the value visible,
 * before anything is written.
 *
 * ***************************************************************************
 * WHY THE ENGINE IS BEHIND A BUTTON RATHER THAN AUTOMATIC
 * ***************************************************************************
 * The first scan pulls roughly 6 MB — a WebAssembly core and an English
 * language model — onto the pilot's device. Doing that silently because
 * they attached a receipt would be a rude thing to do to someone on FBO
 * wifi or a hotel connection. So it is one tap, the size is stated up
 * front, and a pilot who never taps it never downloads any of it: the
 * engine module is dynamically imported inside the click handler, so it is
 * not in this route's bundle at all.
 */

export type ScanOutcome = {
  extraction: ReceiptExtraction;
  /** Tesseract's mean confidence, 0-100. */
  confidence: number;
};

/** Below this, the read is unreliable enough to say so out loud. */
const SHAKY_CONFIDENCE = 65;

const ACCEPT = "image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf";

type Status =
  | { phase: "idle" }
  | { phase: "scanning"; message: string; fraction: number | null }
  | { phase: "failed"; message: string }
  | { phase: "read"; summary: string; shaky: boolean };

export default function ReceiptScan({
  hasExistingReceipt,
  onExtracted,
}: {
  hasExistingReceipt: boolean;
  onExtracted: (outcome: ScanOutcome) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // A scan is the one thing in this form that can take real time on a bad
  // connection, so it is the one thing that needs a way out. Without this
  // the button just greys out and the pilot's only option is to reload the
  // page, losing everything they had already typed.
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [scannable, setScannable] = useState(false);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileName(file?.name ?? null);
    setScannable(Boolean(file) && file!.type !== "application/pdf");
    setStatus({ phase: "idle" });
  }

  async function scan() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ phase: "scanning", message: "Opening the photo", fraction: null });

    // Both modules load here and nowhere else, so the ~6 MB engine and its
    // extraction rules stay out of the expenses route bundle for every
    // pilot who doesn't scan. Loaded OUTSIDE the try below so the catch can
    // name ReceiptOcrError — a failure to fetch the module itself is
    // handled by its own guard.
    let engine: typeof import("@/lib/receipt-ocr/engine");
    let extract: typeof import("@/lib/receipt-ocr/extract");
    try {
      [engine, extract] = await Promise.all([
        import("@/lib/receipt-ocr/engine"),
        import("@/lib/receipt-ocr/extract"),
      ]);
    } catch {
      setStatus({
        phase: "failed",
        message:
          "Couldn't download the reader. Check your connection and try again, or just fill the fields in below.",
      });
      return;
    }

    try {
      const { text, confidence } = await engine.readReceipt(
        file,
        (progress) => setStatus({ phase: "scanning", ...progress }),
        controller.signal
      );
      const extraction = extract.extractReceipt(text, { confidence });

      if (extraction.filled.length === 0) {
        setStatus({
          phase: "failed",
          message:
            "Nothing readable came off that photo. Fill the fields in below — a flatter, closer, better-lit shot usually scans.",
        });
        return;
      }

      onExtracted({ extraction, confidence });
      setStatus({
        phase: "read",
        summary: describe(extraction),
        shaky: confidence > 0 && confidence < SHAKY_CONFIDENCE,
      });
    } catch (cause) {
      // A cancel is the pilot's own decision, not a failure to report back
      // to them. Straight to idle, with the button ready to try again.
      if (controller.signal.aborted) {
        setStatus({ phase: "idle" });
        return;
      }
      setStatus({
        phase: "failed",
        message:
          cause instanceof engine.ReceiptOcrError
            ? cause.message
            : "The scan didn't finish. Fill the fields in below — nothing was lost.",
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const scanning = status.phase === "scanning";

  return (
    <Box>
      {/* A plain file input: the receipt is stored privately and read back
          through a short-lived signed URL, never a public URL. On both iOS
          and Android an accept="image/*" input already offers the camera
          alongside the photo library, so there is no second capture input
          to keep in sync. */}
      <input
        ref={inputRef}
        type="file"
        name="receipt"
        accept={ACCEPT}
        aria-label="Receipt image or PDF"
        onChange={handleChange}
      />
      <Text as="div" size="1" color="gray" mt="2">
        {hasExistingReceipt
          ? "A receipt is already attached. Choosing a file replaces it."
          : "JPEG, PNG, HEIC, WebP or PDF, up to 10 MB. Optional."}
      </Text>

      {scannable ? (
        <Flex mt="3" gap="3" align="center" wrap="wrap">
          <Button type="button" variant="soft" onClick={() => void scan()} disabled={scanning}>
            {scanning ? <Spinner /> : null}
            {scanning ? "Reading…" : "Read this receipt"}
          </Button>
          {scanning ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </Button>
          ) : null}
          <Text size="1" color="gray">
            {scanning
              ? status.message + (status.fraction === null ? "" : ` — ${Math.round(status.fraction * 100)}%`)
              : "Fills in the date, amount, vendor and category for you. Runs on this device; the first scan downloads about 6 MB."}
          </Text>
        </Flex>
      ) : null}

      {fileName && !scannable ? (
        <Text as="div" size="1" color="gray" mt="3">
          {`${fileName} will be attached. PDFs are stored as-is — type the amounts below.`}
        </Text>
      ) : null}

      {status.phase === "read" ? (
        <Box mt="3">
          <Callout.Root color={status.shaky ? "amber" : "green"} size="1">
            <Callout.Text>
              {status.summary}
              {status.shaky
                ? " That photo read poorly, so check every field against the paper before you save."
                : " Check them against the receipt before you save."}
            </Callout.Text>
          </Callout.Root>
        </Box>
      ) : null}

      {status.phase === "failed" ? (
        <Box mt="3">
          <Callout.Root color="amber" size="1">
            <Callout.Text>{status.message}</Callout.Text>
          </Callout.Root>
        </Box>
      ) : null}
    </Box>
  );
}

const FIELD_WORDS: Record<ReceiptExtraction["filled"][number], string> = {
  date: "the date",
  amount: "the amount",
  vendor: "the vendor",
  category: "a category",
};

/**
 * What the scan filled, in a sentence. Naming the fields matters more than
 * it looks: a pilot who can see that the amount was read but the date was
 * not knows exactly which box to check, instead of re-reading all four.
 */
function describe(extraction: ReceiptExtraction): string {
  const words = extraction.filled.map((field) => FIELD_WORDS[field]);
  const list =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

  const extras: string[] = [];
  if (extraction.aircraftIdent) extras.push(extraction.aircraftIdent);
  if (extraction.gallons !== null) extras.push(`${extraction.gallons} gal`);
  if (extraction.airportIdents.length > 0) extras.push(extraction.airportIdents.join(", "));

  return `Read ${list}${extras.length > 0 ? ` — also saw ${extras.join(" · ")}.` : "."}`;
}
