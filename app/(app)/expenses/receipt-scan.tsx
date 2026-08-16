"use client";

import { useEffect, useRef, useState } from "react";
import { LAlert, LButton, LSpinner } from "@/components/ledger";
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
 *
 * ***************************************************************************
 * THE FILE INPUT SURVIVES A REJECTED SUBMIT, AND THAT TAKES WORK
 * ***************************************************************************
 * React 19 calls the native form.reset() after EVERY action dispatch,
 * including one that came back with an error — `startHostTransition`
 * requests it unconditionally and `recursivelyResetForms` performs it. For
 * a file input, reset means the selected file is GONE.
 *
 * Left alone that produces a quiet data-loss bug with a lie on top: the
 * pilot picks a photo, scans it, saves, gets "Pick the trip this gets
 * rebilled to", fixes the trip, saves again — and the expense is created
 * with NO RECEIPT, while this component is still cheerfully saying one
 * will be attached. So the File is held in a ref and put back into the
 * input after the reset. If the browser won't allow that, the pilot is
 * told to pick it again rather than left to find out later.
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
  onFileChanged,
}: {
  hasExistingReceipt: boolean;
  onExtracted: (outcome: ScanOutcome) => void;
  /** Fires when the pilot swaps the file, so a stale scan can be cleared. */
  onFileChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // A scan is the one thing in this form that can take real time on a bad
  // connection, so it is the one thing that needs a way out. Without this
  // the button just greys out and the pilot's only option is to reload the
  // page, losing everything they had already typed.
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic scan id. Changing the file mid-scan used to re-enable the
  // button (the disabled state was derived from `status`, which
  // handleChange reset to idle), so a second worker could be started while
  // the first was still running — and whichever finished LAST wrote the
  // form. That put the fuel invoice's total on the form with the hotel
  // folio attached. A superseded scan now writes nothing.
  const scanIdRef = useRef(0);
  const fileRef = useRef<File | null>(null);

  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [inFlight, setInFlight] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [scannable, setScannable] = useState(false);
  const [fileLost, setFileLost] = useState(false);

  // Put the file back after React 19's post-action form.reset(). See the
  // header — without this a rejected submit silently drops the receipt.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const restore = () => {
      // The `reset` event fires BEFORE the form is actually reset, so the
      // repopulation has to wait for the current task to finish.
      queueMicrotask(() => {
        const held = fileRef.current;
        const input = inputRef.current;
        if (!held || !input || (input.files?.length ?? 0) > 0) return;
        try {
          const transfer = new DataTransfer();
          transfer.items.add(held);
          input.files = transfer.files;
        } catch {
          // Assigning input.files is not universally permitted. Say so
          // rather than letting the pilot save without their receipt.
          fileRef.current = null;
          setFileName(null);
          setScannable(false);
          setFileLost(true);
        }
      });
    };
    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
  }, []);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    fileRef.current = file;
    setFileName(file?.name ?? null);
    setScannable(Boolean(file) && file!.type !== "application/pdf");
    setStatus({ phase: "idle" });
    setFileLost(false);
    // Anything a previous scan wrote describes a DIFFERENT receipt now.
    // Without this, scanning a fuel invoice and then swapping in a hotel
    // folio saved the fuel invoice's amount, vendor, date and trip with
    // the folio's image attached.
    scanIdRef.current++;
    abortRef.current?.abort();
    onFileChanged();
  }

  async function scan() {
    const file = inputRef.current?.files?.[0] ?? fileRef.current;
    if (!file) {
      setStatus({
        phase: "failed",
        message: "No photo is selected any more. Pick the receipt again.",
      });
      return;
    }

    const scanId = ++scanIdRef.current;
    const current = () => scanIdRef.current === scanId;
    const controller = new AbortController();
    abortRef.current = controller;
    setInFlight(true);
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
      if (current()) {
        setInFlight(false);
        setStatus({
          phase: "failed",
          message:
            "Couldn't download the reader. Check your connection and try again, or just fill the fields in below.",
        });
      }
      return;
    }

    try {
      const { text, confidence } = await engine.readReceipt(
        file,
        (progress) => {
          if (current()) setStatus({ phase: "scanning", ...progress });
        },
        controller.signal
      );
      if (!current()) return;
      const extraction = extract.extractReceipt(text, { confidence });

      if (extraction.filled.length === 0) {
        setStatus({
          phase: "failed",
          message:
            "Nothing readable came off that photo. Fill the fields in below. A flatter, closer, better-lit shot usually scans.",
        });
        return;
      }

      onExtracted({ extraction, confidence });
      setStatus({
        phase: "read",
        summary: describe(extraction),
        // An UNKNOWN confidence is a shaky read, not a good one. This used
        // to read `confidence > 0 && confidence < SHAKY`, so a missing or
        // zero confidence produced the reassuring green callout — exactly
        // backwards for the case with the least evidence behind it.
        shaky: confidence < SHAKY_CONFIDENCE,
      });
    } catch (cause) {
      if (!current()) return;
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
            : "The scan didn't finish. Fill the fields in below. Nothing was lost.",
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (current()) setInFlight(false);
    }
  }

  const scanning = status.phase === "scanning";

  return (
    <div>
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
        className="text-body-s text-ink"
      />
      <p className="mt-2 text-caption text-ink-3">
        {hasExistingReceipt
          ? "A receipt is already attached. Choosing a file replaces it."
          : "JPEG, PNG, HEIC, WebP or PDF, up to 10 MB. Optional."}
      </p>

      {scannable ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <LButton type="button" variant="outline" onClick={() => void scan()} disabled={inFlight}>
            {inFlight ? <LSpinner /> : null}
            {inFlight ? "Reading…" : "Read this receipt"}
          </LButton>
          {inFlight ? (
            <LButton type="button" variant="quiet" onClick={() => abortRef.current?.abort()}>
              Cancel
            </LButton>
          ) : null}
          <span className="text-caption text-ink-3">
            {scanning
              ? status.message + (status.fraction === null ? "" : `, ${Math.round(status.fraction * 100)}%`)
              : "Fills in the date, amount, vendor and category for you. Runs on this device; the first scan downloads about 6 MB."}
          </span>
        </div>
      ) : null}

      {fileName && !scannable ? (
        <p className="mt-3 text-caption text-ink-3">
          {`${fileName} will be attached. PDFs are stored as-is. Type the amounts below.`}
        </p>
      ) : null}

      {fileLost ? (
        <LAlert tone="warn" className="mt-3">
          This browser cleared your photo when the form came back. Choose it again before you
          save, or the expense saves without a receipt.
        </LAlert>
      ) : null}

      {status.phase === "read" ? (
        <LAlert tone={status.shaky ? "warn" : "good"} className="mt-3">
          {status.summary}
          {status.shaky
            ? " That photo read poorly, so check every field against the paper before you save."
            : " Check them against the receipt before you save."}
        </LAlert>
      ) : null}

      {status.phase === "failed" ? (
        <LAlert tone="warn" className="mt-3">
          {status.message}
        </LAlert>
      ) : null}
    </div>
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

  return `Read ${list}${extras.length > 0 ? `. Also saw ${extras.join(" · ")}.` : "."}`;
}
