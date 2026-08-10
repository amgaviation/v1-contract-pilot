"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keep a chosen file attached across React 19's post-action form.reset().
 *
 * THE PROBLEM, once, in one place. React 19 calls the native form.reset()
 * after EVERY action dispatch — including a REJECTED one. For a file
 * input, reset means the selected file is gone. So a pilot who attaches a
 * scan, trips validation on some other field, and corrects it, saves the
 * record with NO FILE, while the screen still says one is attached.
 *
 * The expenses surface solved this and the documents surface did not, and
 * a review found the second one still losing scans months later. This is
 * that solution extracted so there is one implementation rather than two
 * that drift.
 *
 * WHEN THE BROWSER REFUSES. Assigning `input.files` is not universally
 * permitted. The honest failure is to TELL the pilot to pick the file
 * again — `lost` goes true — rather than let them save without it and
 * find out when a client asks for the document.
 */
export function useFileSurvivesReset(inputRef: React.RefObject<HTMLInputElement | null>) {
  const fileRef = useRef<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [lost, setLost] = useState(false);

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
          fileRef.current = null;
          setFileName(null);
          setLost(true);
        }
      });
    };
    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
  }, [inputRef]);

  /** Call from the input's onChange. */
  const onFileChange = useCallback((file: File | null) => {
    fileRef.current = file;
    setFileName(file?.name ?? null);
    setLost(false);
  }, []);

  return { fileName, lost, onFileChange, fileRef } as const;
}
