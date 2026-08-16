"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { setClientArchived } from "../actions";

/**
 * Archive / restore. Deliberately not a delete: `pilot.trips` references
 * a client ON DELETE RESTRICT, so a client who has ever flown is not
 * deletable — and shouldn't be, since that history is what the invoices
 * were built from.
 *
 * Only archiving is destructive enough to confirm — restoring a client
 * has no consequence worth interrupting for.
 */
export default function ArchiveButton({
  id,
  archived,
}: {
  id: string;
  archived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justChanged, setJustChanged] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The archive/restore action swaps which button is rendered rather than
  // navigating away, so a successful toggle would otherwise drop focus to
  // <body> as the old button unmounts. Move it to the button that replaces it.
  useEffect(() => {
    if (justChanged) {
      buttonRef.current?.focus();
      setJustChanged(false);
    }
  }, [archived, justChanged]);

  function setArchived(next: boolean) {
    startTransition(async () => {
      const result = await setClientArchived(id, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
      setJustChanged(true);
    });
  }

  if (archived) {
    return (
      <LButton
        ref={buttonRef}
        variant="outline"
        disabled={pending}
        onClick={() => setArchived(false)}
      >
        {pending ? "Working…" : "Restore client"}
      </LButton>
    );
  }

  return (
    <>
      <LButton ref={buttonRef} variant="outline" onClick={() => setOpen(true)}>
        Archive client
      </LButton>
      <LConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Archive this client?"
        description={
          <>
            <p>
              Their trips and invoices are untouched. They just won&rsquo;t
              appear when you pick a client for new work. You can restore
              them any time.
            </p>
            {error ? <p className="mt-2 font-medium text-crit" role="alert">{error}</p> : null}
          </>
        }
        confirmLabel="Archive client"
        onConfirm={() => setArchived(true)}
        pending={pending}
      />
    </>
  );
}
