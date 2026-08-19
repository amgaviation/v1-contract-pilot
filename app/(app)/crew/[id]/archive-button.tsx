"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { setCrewArchived } from "../actions";

/**
 * Archive / restore. Same shape as clients/[id]/archive-button.tsx. Unlike
 * a client, nothing forces this choice at the database (pilot.crew_members
 * carries no ON DELETE RESTRICT reference the way pilot.trips does to
 * pilot.clients) — there simply is no delete path at all, by design: see
 * the migration's header on why a crew record is history from day one.
 *
 * Only archiving is destructive enough to confirm — restoring a crew
 * member has no consequence worth interrupting for.
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
      const result = await setCrewArchived(id, next);
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
        {pending ? "Working…" : "Restore crew member"}
      </LButton>
    );
  }

  return (
    <>
      <LButton ref={buttonRef} variant="outline" onClick={() => setOpen(true)}>
        Archive crew member
      </LButton>
      <LConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Archive this crew member?"
        description={
          <>
            <p>They stay on record. You can restore them any time.</p>
            {error ? <p className="mt-2 font-medium text-crit" role="alert">{error}</p> : null}
          </>
        }
        confirmLabel="Archive crew member"
        onConfirm={() => setArchived(true)}
        pending={pending}
      />
    </>
  );
}
