"use client";

import { useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { deleteLogbookEntry } from "../actions";

export default function DeleteLogbookEntryButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    startTransition(async () => {
      // A successful delete redirects and never returns, so anything
      // that comes back is a failure worth showing. On failure we keep
      // the dialog open so focus stays on the still-enabled confirm
      // button instead of falling back to <body>.
      const result = await deleteLogbookEntry(id);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <LButton variant="outline" onClick={() => setOpen(true)}>
        Delete entry
      </LButton>
      {error ? (
        <p role="alert" className="text-caption text-crit">
          {error}
        </p>
      ) : null}
      <LConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this logbook entry?"
        description="This can’t be undone."
        confirmLabel={pending ? "Deleting…" : "Delete entry"}
        confirmVariant="danger"
        onConfirm={doDelete}
        pending={pending}
      />
    </div>
  );
}
